use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use uuid::Uuid;
use sqlx::{postgres::PgPoolOptions, mysql::MySqlPoolOptions, sqlite::SqlitePoolOptions};

use crate::database::adapter::{postgres::PostgresAdapter, mysql::MySqlAdapter, sqlite::SqliteAdapter, DbAdapter, types::*};
use crate::database::executor::QueryExecutor;
use crate::error::AppError;

pub struct ConnectionHandle {
    pub adapter: Arc<Box<dyn DbAdapter>>,
    pub config: ConnectionConfig,
    pub health_monitor: Option<JoinHandle<()>>,
    pub query_executor: Arc<QueryExecutor>,
}

pub struct ConnectionRegistry {
    connections: Arc<RwLock<HashMap<String, Arc<ConnectionHandle>>>>,
    app_handle: AppHandle,
}

impl ConnectionRegistry {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            app_handle,
        }
    }
    
    pub async fn connect(&self, config: ConnectionConfig) -> Result<String, AppError> {
        let conn_id = Uuid::new_v4().to_string();
        
        // Create appropriate adapter based on database type
        let adapter: Box<dyn DbAdapter> = match config.db_type {
            DbType::Postgres => {
                let pool = create_pg_pool(&config).await?;
                Box::new(PostgresAdapter::new(pool))
            }
            DbType::Mysql => {
                let pool = create_mysql_pool(&config).await?;
                Box::new(MySqlAdapter::new(pool))
            }
            DbType::Sqlite => {
                let pool = create_sqlite_pool(&config).await?;
                Box::new(SqliteAdapter::new(pool))
            }
        };
        
        // Verify connection
        adapter.ping().await?;
        
        // Create Arc for adapter to share between components
        let adapter_arc = Arc::new(adapter);
        
        // Create query executor with cancellation support
        let query_executor = Arc::new(QueryExecutor::new());
        
        // Start health monitor (if enabled)
        let health_monitor = if config.enable_health_check.unwrap_or(true) {
            Some(spawn_health_monitor(
                conn_id.clone(),
                adapter_arc.clone(),
                self.app_handle.clone(),
            ))
        } else {
            None
        };
        
        let handle = Arc::new(ConnectionHandle {
            adapter: adapter_arc,
            config,
            health_monitor,
            query_executor,
        });
        
        self.connections.write().await.insert(conn_id.clone(), handle);
        
        Ok(conn_id)
    }
    
    pub async fn get(&self, conn_id: &str) -> Option<Arc<ConnectionHandle>> {
        self.connections.read().await.get(conn_id).cloned()
    }
    
    pub async fn disconnect(&self, conn_id: &str) -> Result<(), AppError> {
        if let Some(handle) = self.connections.write().await.remove(conn_id) {
            // Stop health monitor
            if let Some(ref monitor) = handle.health_monitor {
                monitor.abort();
            }
            
            // Disconnect adapter
            handle.adapter.disconnect().await?;
        }
        
        Ok(())
    }
    
    pub async fn list_connections(&self) -> Vec<String> {
        self.connections.read().await.keys().cloned().collect()
    }
}

async fn create_pg_pool(config: &ConnectionConfig) -> Result<sqlx::PgPool, AppError> {
    let database_url = if let Some(url) = &config.database_url {
        url.clone()
    } else {
        format!(
            "postgresql://{}:{}@{}:{}/{}",
            config.user.as_ref().unwrap_or(&config.username),
            config.password.as_ref().ok_or_else(|| AppError::InvalidConfig("Missing password".to_string()))?,
            config.host,
            config.port,
            config.database
        )
    };
    
    let pool = PgPoolOptions::new()
        .max_connections(config.pool_size.unwrap_or(10))
        .connect(&database_url)
        .await
        .map_err(AppError::from_sqlx)?;
    
    Ok(pool)
}

async fn create_mysql_pool(config: &ConnectionConfig) -> Result<sqlx::MySqlPool, AppError> {
    let database_url = if let Some(url) = &config.database_url {
        url.clone()
    } else {
        format!(
            "mysql://{}:{}@{}:{}/{}",
            config.user.as_ref().unwrap_or(&config.username),
            config.password.as_ref().ok_or_else(|| AppError::InvalidConfig("Missing password".to_string()))?,
            config.host,
            config.port,
            config.database
        )
    };
    
    let pool = MySqlPoolOptions::new()
        .max_connections(config.pool_size.unwrap_or(10))
        .connect(&database_url)
        .await
        .map_err(AppError::from_sqlx)?;
    
    Ok(pool)
}

async fn create_sqlite_pool(config: &ConnectionConfig) -> Result<sqlx::SqlitePool, AppError> {
    let database_url = if let Some(url) = &config.database_url {
        url.clone()
    } else if !config.database.is_empty() {
        format!("sqlite:{}", config.database)
    } else {
        "sqlite::memory:".to_string()
    };
    
    let pool = SqlitePoolOptions::new()
        .max_connections(config.pool_size.unwrap_or(1))
        .connect(&database_url)
        .await
        .map_err(AppError::from_sqlx)?;
    
    Ok(pool)
}

fn spawn_health_monitor(
    conn_id: String,
    adapter: Arc<Box<dyn DbAdapter>>,
    app_handle: AppHandle,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        let mut miss_count = 0;
        
        loop {
            interval.tick().await;
            
            match adapter.ping().await {
                Ok(rtt) => {
                    miss_count = 0;
                    
                    // Emit health event
                    let _ = app_handle.emit("db:connection_health", serde_json::json!({
                        "connection_id": conn_id,
                        "status": "healthy",
                        "rtt_ms": rtt.as_millis(),
                    })).ok();
                }
                Err(_) => {
                    miss_count += 1;
                    
                    let status = if miss_count == 1 {
                        "degraded"
                    } else if miss_count >= 3 {
                        "error"
                    } else {
                        "degraded"
                    };
                    
                    // Emit health event
                    let _ = app_handle.emit("db:connection_health", serde_json::json!({
                        "connection_id": conn_id,
                        "status": status,
                        "miss_count": miss_count,
                    })).ok();
                }
            }
        }
    })
}