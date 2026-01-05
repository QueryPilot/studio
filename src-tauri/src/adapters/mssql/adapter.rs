use async_trait::async_trait;
use bb8::Pool;
use bb8_tiberius::ConnectionManager;
use std::sync::Arc;
use tiberius::{AuthMethod, Config, EncryptionLevel};
use tokio::sync::RwLock;

use super::simple_converter::SimpleConverter;
use super::types::MssqlTypeConverter;
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
use crate::types::*;

/// SQL Server adapter using tiberius with bb8 connection pooling.
pub struct MssqlAdapter {
    pool: Arc<RwLock<Option<Pool<ConnectionManager>>>>,
}

impl MssqlAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(RwLock::new(None)),
        }
    }

    /// Get the pool
    async fn get_pool_ref(&self) -> Result<Pool<ConnectionManager>> {
        let pool_guard = self.pool.read().await;
        pool_guard
            .clone()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))
    }

    /// Get the pool for streaming queries
    pub async fn get_pool(&self) -> Option<Pool<ConnectionManager>> {
        self.pool.read().await.clone()
    }

    fn build_config(profile: &ConnectionProfile) -> Result<Config> {
        let mut config = Config::new();

        config.host(&profile.host);
        config.port(profile.port);
        config.database(&profile.database);

        // Authentication - check for Windows auth option
        let use_windows_auth = profile
            .options
            .get("trusted_connection")
            .map(|v| v.to_lowercase() == "true" || v == "1")
            .unwrap_or(false);

        if use_windows_auth {
            #[cfg(target_os = "windows")]
            {
                config.authentication(AuthMethod::Integrated);
            }
            #[cfg(not(target_os = "windows"))]
            {
                return Err(AppError::Internal(
                    "Windows Authentication is only supported on Windows".into(),
                ));
            }
        } else {
            config.authentication(AuthMethod::sql_server(
                &profile.username,
                profile.password.as_deref().unwrap_or(""),
            ));
        }

        // Apply connection options
        for (key, value) in &profile.options {
            match key.to_lowercase().as_str() {
                "application_name" | "applicationname" | "app" => {
                    config.application_name(value);
                }
                "instance" | "instance_name" => {
                    config.instance_name(value);
                }
                "trust_cert" | "trustservercertificate" => {
                    if value.to_lowercase() == "true" || value == "1" {
                        config.trust_cert();
                    }
                }
                _ => {
                    tracing::debug!("Ignoring unknown MSSQL option: {}={}", key, value);
                }
            }
        }

        // SSL/TLS configuration
        match profile.ssl_mode {
            Some(SslMode::Disable) => {
                config.encryption(EncryptionLevel::NotSupported);
            }
            Some(SslMode::Require) | Some(SslMode::VerifyCa) | Some(SslMode::VerifyFull) => {
                config.encryption(EncryptionLevel::Required);
            }
            None => {
                // Default to opportunistic encryption
                config.encryption(EncryptionLevel::Off);
            }
        }

        // Trust the server certificate by default (useful for development)
        // Can be overridden via options above
        config.trust_cert();

        Ok(config)
    }
}

impl Default for MssqlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DbAdapter for MssqlAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        // Disconnect if already connected
        if self.pool.read().await.is_some() {
            self.disconnect().await?;
        }

        let config = Self::build_config(profile)?;

        // Create connection manager
        let mgr = ConnectionManager::new(config);

        // Build pool
        let pool = Pool::builder()
            .max_size(50)
            .connection_timeout(std::time::Duration::from_secs(10))
            .build(mgr)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create pool: {}", e)))?;

        // Test connection by getting a connection and dropping it immediately
        {
            let _conn = pool
                .get()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to connect: {}", e)))?;
            // _conn dropped here
        }

        *self.pool.write().await = Some(pool);

        Ok(())
    }

    async fn disconnect(&mut self) -> Result<()> {
        *self.pool.write().await = None;
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult> {
        let pool = self.get_pool_ref().await?;
        let mut conn = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        // Get SQL Server version
        let row = conn
            .simple_query("SELECT @@VERSION, DB_NAME(), SUSER_NAME()")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get result: {}", e)))?
            .into_iter()
            .next();

        match row {
            Some(row) => {
                let version: Option<&str> = row.get(0);
                let database: Option<&str> = row.get(1);
                let user: Option<&str> = row.get(2);

                Ok(ConnectionTestResult {
                    success: true,
                    message: format!(
                        "Connected to {} as {}",
                        database.unwrap_or("unknown"),
                        user.unwrap_or("unknown")
                    ),
                    version: version.map(|s| s.to_string()),
                    warnings: vec![],
                })
            }
            None => Err(AppError::DatabaseError(
                "Failed to get connection info".into(),
            )),
        }
    }

    async fn is_connected(&self) -> bool {
        if let Ok(pool) = self.get_pool_ref().await {
            if let Ok(mut conn) = pool.get().await {
                return conn.simple_query("SELECT 1").await.is_ok();
            }
        }
        false
    }

    async fn query(&self, sql: &str) -> Result<QueryResult> {
        let pool = self.get_pool_ref().await?;
        let mut conn = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let mut result = conn
            .simple_query(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        // Get column metadata - columns() is async
        let columns_opt = result
            .columns()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get columns: {}", e)))?;
        
        let columns: Vec<ColumnMeta> = columns_opt
            .map(|cols| {
                cols.iter()
                    .map(|col| ColumnMeta {
                        name: col.name().to_string(),
                        data_type: MssqlTypeConverter::column_type_to_cell_type(&col.column_type()),
                        nullable: true, // SQL Server doesn't provide this in TDS column metadata
                        primary_key: false,
                        db_type: MssqlTypeConverter::column_type_to_string(&col.column_type()),
                        type_oid: None,
                        default_value: None,
                        comment: None,
                        enum_values: None,
                        type_category: None,
                        precision: None,
                        scale: None,
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Collect rows
        let rows: Vec<tiberius::Row> = result
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to collect rows: {}", e)))?;

        // Convert to JSON
        let json_rows: Vec<Vec<serde_json::Value>> =
            rows.iter().map(SimpleConverter::row_to_json).collect();

        Ok(QueryResult {
            columns,
            rows: json_rows,
        })
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        let pool = self.get_pool_ref().await?;
        let mut conn = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let result = conn
            .execute(sql, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;

        Ok(result.rows_affected().iter().sum())
    }

    fn get_supported_types(&self) -> Vec<CellValueType> {
        vec![
            CellValueType::Null,
            CellValueType::Text,
            CellValueType::Integer,
            CellValueType::Decimal,
            CellValueType::Boolean,
            CellValueType::Date,
            CellValueType::Time,
            CellValueType::DateTime,
            CellValueType::Binary,
            CellValueType::Uuid,
            CellValueType::Xml,
            CellValueType::Money,
        ]
    }

    fn supports_schemas(&self) -> bool {
        true
    }

    fn supports_procedures(&self) -> bool {
        true
    }

    fn supports_functions(&self) -> bool {
        true
    }
}
