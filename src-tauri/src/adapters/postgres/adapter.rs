use async_trait::async_trait;
use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use tokio_postgres::NoTls;
use std::sync::{Arc, RwLock};

use super::simple_converter::SimpleConverter;
use super::types::PostgresTypeConverter;
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
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
    pub fn get_pool(&self) -> Option<Pool> {
        self.pool.read().unwrap().clone()
    }

    async fn get_client(&self) -> Result<deadpool_postgres::Client> {
        let pool = self.get_pool().ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        pool.get().await.map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))
    }
}

impl Default for PostgresAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DbAdapter for PostgresAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        if self.pool.read().unwrap().is_some() {
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
        for (key, value) in &profile.options {
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

        let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)
            .map_err(|e| AppError::Internal(format!("Failed to create pool: {}", e)))?;

        // Test connection
        let _ = pool.get().await.map_err(|e| AppError::Internal(format!("Failed to connect: {}", e)))?;

        *self.pool.write().unwrap() = Some(pool);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<()> {
        *self.pool.write().unwrap() = None;
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult> {
        let test_fn = async {
            let client = self.get_client().await?;
            let row = client
                .query_one("SELECT version(), current_database(), current_user", &[])
                .await
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

            let version: String = row.get(0);
            let database: String = row.get(1);
            let user: String = row.get(2);

            Ok(ConnectionTestResult {
                success: true,
                message: format!("Connected to {} as {}", database, user),
                version: Some(version),
                warnings: vec![],
                detected_db_type: None,
            })
        };

        tokio::time::timeout(std::time::Duration::from_secs(10), test_fn)
            .await
            .map_err(|_| AppError::ConnectionClosed("Connection test timed out".into()))?
    }

    async fn is_connected(&self) -> bool {
        let check = async {
            let client = self.get_client().await.ok()?;
            client.simple_query("SELECT 1").await.ok()?;
            Some(())
        };
        
        tokio::time::timeout(std::time::Duration::from_secs(5), check)
            .await
            .map(|r| r.is_some())
            .unwrap_or(false)
    }

    async fn query(&self, sql: &str) -> Result<QueryResult> {
        let client = self.get_client().await?;
        let stmt = client
            .prepare(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let columns: Vec<ColumnMeta> = stmt
            .columns()
            .iter()
            .map(|col| ColumnMeta {
                name: col.name().to_string(),
                data_type: PostgresTypeConverter::oid_to_cell_type(col.type_().oid()),
                nullable: true,
                primary_key: false,
                db_type: col.type_().name().to_string(),
                type_oid: Some(col.type_().oid()),
                default_value: None,
                comment: None,
                enum_values: None,
                type_category: None,
                precision: None,
                scale: None,
            })
            .collect();

        let rows = client
            .query(&stmt, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let json_rows = SimpleConverter::rows_to_json(&rows);

        Ok(QueryResult {
            columns,
            rows: json_rows,
        })
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        let client = self.get_client().await?;
        let affected = client
            .execute(sql, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;
        Ok(affected)
    }
}

crate::impl_sql_capabilities!(PostgresAdapter, pool_check: sync_rwlock);
