use async_trait::async_trait;
use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use tokio_postgres::NoTls;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::simple_converter::SimpleConverter;
use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityColumnMeta, CapabilityQueryResult,
    CapabilityTestResult, SqlQueryable,
};
use crate::error::AppError;
use crate::types::*;

pub struct PostgresAdapter {
    pool: Arc<RwLock<Option<Pool>>>,
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(RwLock::new(None)),
        }
    }

    /// Get the pool for streaming queries
    pub async fn get_pool(&self) -> Option<Pool> {
        self.pool.read().await.clone()
    }

    async fn get_client(&self) -> Result<deadpool_postgres::Client, AppError> {
        let pool = self.get_pool().await.ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        pool.get().await.map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))
    }
}

impl Default for PostgresAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseCapability for PostgresAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        if self.pool.read().await.is_some() {
            self.disconnect().await?;
        }

        let mut cfg = Config::new();
        cfg.host = Some(profile.host.clone());
        cfg.port = Some(profile.port);
        cfg.user = Some(profile.username.clone());
        cfg.password = profile.password.clone();
        cfg.dbname = Some(profile.database.clone());
        cfg.manager = Some(ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        });

        // Handle options
        for (key, _value) in &profile.options {
            match key.to_lowercase().as_str() {
                "connect_timeout" => {
                    // deadpool config doesn't have connect_timeout directly on Config root usually,
                    // it might be in pool options or handled via Runtime.
                    // For now, ignore or set generic options if Config supports it.
                }
                "application_name" => {
                    // cfg.application_name = Some(value.clone()); // Check if Config has this
                }
                _ => {}
            }
        }

        let pool = cfg
            .create_pool(Some(Runtime::Tokio1), NoTls)
            .map_err(|e| AppError::Internal(format!("Failed to create pool: {}", e)))?;

        // Test connection
        let _ = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to connect: {}", e)))?;

        *self.pool.write().await = Some(pool);
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        *self.pool.write().await = None;
        Ok(())
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let test_fn = async {
            let client = self.get_client().await?;
            let row = client
                .query_one("SELECT version(), current_database(), current_user", &[])
                .await
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

            let version: String = row.get(0);
            let database: String = row.get(1);
            let user: String = row.get(2);

            Ok(CapabilityTestResult {
                success: true,
                message: format!("Connected to {} as {}", database, user),
                latency_ms: None,
                server_version: Some(version),
            })
        };

        tokio::time::timeout(std::time::Duration::from_secs(10), test_fn)
            .await
            .map_err(|_| AppError::ConnectionClosed("Connection test timed out".into()))?
    }

    fn is_connected(&self) -> bool {
        // Use try_read to avoid blocking - if lock is held, assume connected
        self.pool
            .try_read()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![
            AdapterCapability::SqlQueryable,
        ]
    }
}

#[async_trait]
impl SqlQueryable for PostgresAdapter {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        let client = self.get_client().await?;
        let stmt = client
            .prepare(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let columns: Vec<CapabilityColumnMeta> = stmt
            .columns()
            .iter()
            .map(|col| CapabilityColumnMeta {
                name: col.name().to_string(),
                data_type: col.type_().name().to_string(),
            })
            .collect();

        let rows = client
            .query(&stmt, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let json_rows = SimpleConverter::rows_to_json(&rows);

        Ok(CapabilityQueryResult {
            columns,
            rows: json_rows,
        })
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError> {
        let client = self.get_client().await?;
        let affected = client
            .execute(sql, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;
        Ok(affected)
    }
}
