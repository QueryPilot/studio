use async_trait::async_trait;
use mysql_async::prelude::*;
use mysql_async::{Conn, Opts, OptsBuilder, Pool, PoolConstraints, PoolOpts, SslOpts};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::simple_converter::SimpleConverter;
use super::types::MySqlTypeConverter;
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct MySqlAdapter {
    pool: Arc<RwLock<Option<Pool>>>,
}

impl MySqlAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(RwLock::new(None)),
        }
    }

    /// Get a connection from the pool
    pub async fn get_conn(&self) -> Result<Conn> {
        let pool_guard = self.pool.read().await;
        let pool = pool_guard
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        pool.get_conn()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))
    }

    /// Get the pool for streaming queries
    pub async fn get_pool(&self) -> Option<Pool> {
        self.pool.read().await.clone()
    }

    /// Execute multiple SQL statements within a transaction
    pub async fn execute_in_transaction(&self, statements: Vec<String>) -> Result<Vec<u64>> {
        let mut conn = self.get_conn().await?;

        // Start transaction manually
        conn.query_drop("BEGIN")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to begin transaction: {}", e)))?;

        let mut results = Vec::new();

        for sql in statements {
            let result = conn
                .exec_iter(&sql, ())
                .await
                .map_err(|e| AppError::DatabaseError(format!("Transaction failed: {}", e)))?;
            results.push(result.affected_rows());
            // Drop the result to release resources
            let _ = result.drop_result().await;
        }

        // Commit transaction
        conn.query_drop("COMMIT")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to commit transaction: {}", e)))?;

        Ok(results)
    }

    fn build_opts(profile: &ConnectionProfile) -> Result<Opts> {
        // Build connection options directly instead of using URL parsing
        // This avoids issues with special characters and URL encoding
        let mut builder = OptsBuilder::default()
            .ip_or_hostname(&profile.host)
            .tcp_port(profile.port as u16)
            .user(Some(&profile.username))
            .db_name(Some(&profile.database));
        
        // Set password if provided
        if let Some(password) = &profile.password {
            builder = builder.pass(Some(password));
        }

        // Apply connection options from profile (e.g., charset=utf8mb4)
        // Collect all init commands first, then apply them once
        let mut init_commands = Vec::new();
        
        for (key, value) in &profile.options {
            match key.to_lowercase().as_str() {
                "charset" => {
                    init_commands.push(format!("SET NAMES '{}'", value));
                }
                "collation" => {
                    init_commands.push(format!("SET collation_connection = '{}'", value));
                }
                "timezone" | "time_zone" => {
                    init_commands.push(format!("SET time_zone = '{}'", value));
                }
                "sql_mode" => {
                    init_commands.push(format!("SET sql_mode = '{}'", value));
                }
                "connect_timeout" => {
                    if let Ok(secs) = value.parse::<u64>() {
                        builder = builder.conn_ttl(std::time::Duration::from_secs(secs));
                    }
                }
                _ => {
                    // Log unknown options but don't fail
                    tracing::debug!("Ignoring unknown MySQL option: {}={}", key, value);
                }
            }
        }
        
        // Apply all init commands at once
        if !init_commands.is_empty() {
            builder = builder.init(init_commands);
        }

        // SSL configuration
        if let Some(ssl_mode) = &profile.ssl_mode {
            match ssl_mode {
                SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => {
                    let mut ssl_opts = SslOpts::default();
                    
                    // Apply SSL CA certificate if provided
                    if let Some(ssl_config) = &profile.ssl_config {
                        if let Some(ca_file) = &ssl_config.ca_file {
                            ssl_opts = ssl_opts.with_root_certs(vec![std::path::PathBuf::from(ca_file).into()]);
                        }
                        // Note: mysql_async client identity requires PKCS12 format
                        // For PEM cert/key files, users need to convert to PKCS12 first
                    }
                    
                    // For verify modes, enable hostname verification
                    if matches!(ssl_mode, SslMode::VerifyFull) {
                        ssl_opts = ssl_opts.with_danger_accept_invalid_certs(false);
                    }
                    
                    builder = builder.ssl_opts(ssl_opts);
                }
                SslMode::Disable => {
                    // No SSL - default
                }
            }
        }

        // Connection pool options
        let pool_opts = PoolOpts::default()
            .with_constraints(PoolConstraints::new(1, 50).unwrap());

        builder = builder.pool_opts(pool_opts);

        Ok(builder.into())
    }
}

impl Default for MySqlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DbAdapter for MySqlAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        // Disconnect if already connected
        if self.pool.read().await.is_some() {
            self.disconnect().await?;
        }

        tracing::info!(
            "MySQL connecting to {}:{}/{}",
            profile.host,
            profile.port,
            profile.database
        );

        let opts = Self::build_opts(profile)?;
        let pool = Pool::new(opts);

        // Test the connection
        let conn = pool
            .get_conn()
            .await
            .map_err(|e| {
                tracing::error!("MySQL connection failed: {}", e);
                AppError::Internal(format!("Failed to connect: {}", e))
            })?;

        // Drop connection back to pool
        drop(conn);

        *self.pool.write().await = Some(pool);

        tracing::info!("MySQL connected successfully");
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<()> {
        if let Some(pool) = self.pool.write().await.take() {
            pool.disconnect().await.map_err(|e| {
                AppError::Internal(format!("Failed to disconnect: {}", e))
            })?;
        }
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult> {
        let mut conn = self.get_conn().await?;

        // Get version and current database
        let row: Option<(String, String, String)> = conn
            .query_first("SELECT VERSION(), DATABASE(), USER()")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        match row {
            Some((version, database, user)) => Ok(ConnectionTestResult {
                success: true,
                message: format!("Connected to {} as {}", database, user),
                version: Some(version),
                warnings: vec![],
            }),
            None => Err(AppError::DatabaseError(
                "Failed to get connection info".into(),
            )),
        }
    }

    async fn is_connected(&self) -> bool {
        if let Ok(mut conn) = self.get_conn().await {
            conn.query_drop("SELECT 1").await.is_ok()
        } else {
            false
        }
    }

    async fn query(&self, sql: &str) -> Result<QueryResult> {
        let mut conn = self.get_conn().await?;

        let mut result = conn
            .query_iter(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        // Get column metadata
        let columns_ref = result.columns_ref();
        let columns: Vec<ColumnMeta> = columns_ref
            .iter()
            .map(|col| {
                let is_unsigned = col.flags().contains(mysql_async::consts::ColumnFlags::UNSIGNED_FLAG);
                ColumnMeta {
                    name: col.name_str().to_string(),
                    data_type: MySqlTypeConverter::column_type_to_cell_type(
                        col.column_type(),
                        is_unsigned,
                    ),
                    nullable: !col.flags().contains(mysql_async::consts::ColumnFlags::NOT_NULL_FLAG),
                    primary_key: col.flags().contains(mysql_async::consts::ColumnFlags::PRI_KEY_FLAG),
                    db_type: MySqlTypeConverter::column_type_to_string(col.column_type()),
                    type_oid: None,
                    default_value: None,
                    comment: None,
                    enum_values: None,
                    type_category: None,
                    precision: None,
                    scale: None,
                }
            })
            .collect();

        // Collect rows
        let rows: Vec<mysql_async::Row> = result
            .collect()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to collect rows: {}", e)))?;

        // Convert to JSON
        let json_rows = SimpleConverter::rows_to_json(&rows);

        Ok(QueryResult {
            columns,
            rows: json_rows,
        })
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        let mut conn = self.get_conn().await?;

        let result = conn
            .query_iter(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;

        let affected = result.affected_rows();

        // Drop the result to release resources
        result
            .drop_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to drop result: {}", e)))?;

        Ok(affected)
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
            CellValueType::Json,
            CellValueType::Bit,
            CellValueType::Geometry,
        ]
    }

    fn supports_schemas(&self) -> bool {
        // MySQL uses databases instead of schemas
        false
    }

    fn supports_procedures(&self) -> bool {
        true
    }

    fn supports_functions(&self) -> bool {
        true
    }
}

