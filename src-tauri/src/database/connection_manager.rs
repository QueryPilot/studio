use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use serde::{Serialize, Deserialize};
use crate::storage::SecureStorage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password: Option<String>,
    pub max_connections: u32,
    pub min_connections: u32,
    pub connection_timeout: u64,
    pub idle_timeout: u64,
    pub max_lifetime: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    PostgreSQL,
    MySQL,
    SQLite,
}

pub enum DatabasePool {
    PostgreSQL(PgPool),
    MySQL(MySqlPool),
    SQLite(SqlitePool),
}

pub struct ConnectionManager {
    pools: Arc<RwLock<HashMap<String, Arc<DatabasePool>>>>,
    configs: Arc<RwLock<HashMap<String, ConnectionConfig>>>,
    secure_storage: Arc<tokio::sync::Mutex<Option<SecureStorage>>>,
}

impl ConnectionManager {
    pub fn new(secure_storage: Arc<tokio::sync::Mutex<Option<SecureStorage>>>) -> Self {
        Self {
            pools: Arc::new(RwLock::new(HashMap::new())),
            configs: Arc::new(RwLock::new(HashMap::new())),
            secure_storage,
        }
    }

    pub async fn create_connection(&self, config: ConnectionConfig) -> Result<String, String> {
        let connection_id = config.id.clone();
        
        // Get password from secure storage
        let password = self.get_password(&connection_id).await?;
        
        // Build connection pool based on database type
        let pool = match config.db_type {
            DatabaseType::PostgreSQL => {
                let connection_string = format!(
                    "postgresql://{}:{}@{}:{}/{}?statement_cache_size=0",
                    config.username,
                    password,
                    config.host,
                    config.port,
                    config.database
                );
                
                let pool = PgPoolOptions::new()
                    .max_connections(config.max_connections)
                    .min_connections(config.min_connections)
                    .acquire_timeout(std::time::Duration::from_secs(config.connection_timeout))
                    .idle_timeout(std::time::Duration::from_secs(config.idle_timeout))
                    .max_lifetime(std::time::Duration::from_secs(config.max_lifetime))
                    .after_connect(|conn, _meta| {
                        Box::pin(async move {
                            // Disable prepared statement caching to avoid conflicts
                            use sqlx::postgres::PgConnection;
                            use sqlx::Connection;
                            // This helps prevent "prepared statement already exists" errors
                            Ok(())
                        })
                    })
                    .connect(&connection_string)
                    .await
                    .map_err(|e| format!("Failed to create PostgreSQL pool: {}", e))?;
                
                DatabasePool::PostgreSQL(pool)
            },
            DatabaseType::MySQL => {
                let connection_string = format!(
                    "mysql://{}:{}@{}:{}/{}",
                    config.username,
                    password,
                    config.host,
                    config.port,
                    config.database
                );
                
                let pool = MySqlPoolOptions::new()
                    .max_connections(config.max_connections)
                    .min_connections(config.min_connections)
                    .acquire_timeout(std::time::Duration::from_secs(config.connection_timeout))
                    .idle_timeout(std::time::Duration::from_secs(config.idle_timeout))
                    .max_lifetime(std::time::Duration::from_secs(config.max_lifetime))
                    .connect(&connection_string)
                    .await
                    .map_err(|e| format!("Failed to create MySQL pool: {}", e))?;
                
                DatabasePool::MySQL(pool)
            },
            DatabaseType::SQLite => {
                let connection_string = if config.database == ":memory:" {
                    "sqlite::memory:".to_string()
                } else {
                    format!("sqlite:{}", config.database)
                };
                
                let pool = SqlitePoolOptions::new()
                    .max_connections(config.max_connections)
                    .min_connections(config.min_connections)
                    .acquire_timeout(std::time::Duration::from_secs(config.connection_timeout))
                    .idle_timeout(std::time::Duration::from_secs(config.idle_timeout))
                    .max_lifetime(std::time::Duration::from_secs(config.max_lifetime))
                    .connect(&connection_string)
                    .await
                    .map_err(|e| format!("Failed to create SQLite pool: {}", e))?;
                
                DatabasePool::SQLite(pool)
            },
        };
        
        // Store pool and config
        let mut pools = self.pools.write().await;
        let mut configs = self.configs.write().await;
        
        pools.insert(connection_id.clone(), Arc::new(pool));
        configs.insert(connection_id.clone(), config);
        
        Ok(connection_id)
    }
    
    pub async fn test_connection(&self, connection_id: &str) -> Result<bool, String> {
        let pools = self.pools.read().await;
        
        if let Some(pool) = pools.get(connection_id) {
            match pool.as_ref() {
                DatabasePool::PostgreSQL(pg_pool) => {
                    // Use a simple query that doesn't create prepared statements
                    use sqlx::postgres::PgRow;
                    use sqlx::Row;
                    let _row: PgRow = sqlx::query("SELECT 1 as test")
                        .persistent(false) // Don't cache this statement
                        .fetch_one(pg_pool)
                        .await
                        .map_err(|e| format!("PostgreSQL test failed: {}", e))?;
                },
                DatabasePool::MySQL(mysql_pool) => {
                    use sqlx::mysql::MySqlRow;
                    use sqlx::Row;
                    let _row: MySqlRow = sqlx::query("SELECT 1 as test")
                        .persistent(false) // Don't cache this statement
                        .fetch_one(mysql_pool)
                        .await
                        .map_err(|e| format!("MySQL test failed: {}", e))?;
                },
                DatabasePool::SQLite(sqlite_pool) => {
                    use sqlx::sqlite::SqliteRow;
                    use sqlx::Row;
                    let _row: SqliteRow = sqlx::query("SELECT 1 as test")
                        .persistent(false) // Don't cache this statement
                        .fetch_one(sqlite_pool)
                        .await
                        .map_err(|e| format!("SQLite test failed: {}", e))?;
                },
            }
            Ok(true)
        } else {
            Err(format!("Connection {} not found", connection_id))
        }
    }
    
    pub async fn execute_query(&self, connection_id: &str, query: &str) -> Result<QueryResult, String> {
        let pools = self.pools.read().await;
        
        if let Some(pool) = pools.get(connection_id) {
            let start = std::time::Instant::now();
            
            match pool.as_ref() {
                DatabasePool::PostgreSQL(pg_pool) => {
                    self.execute_pg_query(pg_pool, query, start).await
                },
                DatabasePool::MySQL(mysql_pool) => {
                    self.execute_mysql_query(mysql_pool, query, start).await
                },
                DatabasePool::SQLite(sqlite_pool) => {
                    self.execute_sqlite_query(sqlite_pool, query, start).await
                },
            }
        } else {
            Err(format!("Connection {} not found", connection_id))
        }
    }
    
    async fn execute_pg_query(&self, pool: &PgPool, query: &str, start: std::time::Instant) -> Result<QueryResult, String> {
        use sqlx::{Row as SqlxRow, Column};
        
        // Check if it's a SELECT query
        let trimmed = query.trim().to_uppercase();
        if trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") {
            // Execute as a raw query to avoid prepared statement conflicts
            let rows = sqlx::raw_sql(query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Query execution failed: {}", e))?;
            
            let execution_time = start.elapsed().as_millis() as f64;
            
            // Convert rows to JSON values
            let mut result_rows = Vec::new();
            let mut columns = Vec::new();
            
            if !rows.is_empty() {
                // Get column names from the first row
                let first_row = &rows[0];
                for column in first_row.columns() {
                    columns.push(column.name().to_string());
                }
                
                // Convert each row to a vector of JSON values
                for row in rows {
                    let mut row_values = Vec::new();
                    for i in 0..columns.len() {
                        // Safety check: ensure column index exists in this row
                        if i >= row.len() {
                            row_values.push(serde_json::Value::Null);
                            continue;
                        }
                        // Try to get value as different types
                        let value = if let Ok(v) = row.try_get::<String, _>(i) {
                            serde_json::Value::String(v)
                        } else if let Ok(v) = row.try_get::<i32, _>(i) {
                            serde_json::Value::Number(serde_json::Number::from(v))
                        } else if let Ok(v) = row.try_get::<i64, _>(i) {
                            serde_json::Value::Number(serde_json::Number::from(v))
                        } else if let Ok(v) = row.try_get::<f64, _>(i) {
                            serde_json::Number::from_f64(v)
                                .map(serde_json::Value::Number)
                                .unwrap_or(serde_json::Value::Null)
                        } else if let Ok(v) = row.try_get::<bool, _>(i) {
                            serde_json::Value::Bool(v)
                        } else {
                            serde_json::Value::Null
                        };
                        row_values.push(value);
                    }
                    result_rows.push(row_values);
                }
            }
            
            let row_count = result_rows.len();
            Ok(QueryResult {
                columns,
                rows: result_rows,
                row_count,
                execution_time,
            })
        } else {
            // Execute as a raw command (INSERT, UPDATE, DELETE, etc.)
            let result = sqlx::raw_sql(query)
                .execute(pool)
                .await
                .map_err(|e| format!("Query execution failed: {}", e))?;
            
            let execution_time = start.elapsed().as_millis() as f64;
            
            Ok(QueryResult {
                columns: vec!["rows_affected".to_string()],
                rows: vec![vec![serde_json::Value::Number(serde_json::Number::from(result.rows_affected()))]],
                row_count: 1,
                execution_time,
            })
        }
    }
    
    async fn execute_mysql_query(&self, pool: &MySqlPool, query: &str, start: std::time::Instant) -> Result<QueryResult, String> {
        use sqlx::{Row as SqlxRow, Column};
        
        // Check if it's a SELECT query
        let trimmed = query.trim().to_uppercase();
        if trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") {
            // Execute as a raw query to avoid prepared statement conflicts
            let rows = sqlx::raw_sql(query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Query execution failed: {}", e))?;
            
            let execution_time = start.elapsed().as_millis() as f64;
            
            // Convert rows to JSON values
            let mut result_rows = Vec::new();
            let mut columns = Vec::new();
            
            if !rows.is_empty() {
                // Get column names from the first row
                let first_row = &rows[0];
                for column in first_row.columns() {
                    columns.push(column.name().to_string());
                }
                
                // Convert each row to a vector of JSON values
                for row in rows {
                    let mut row_values = Vec::new();
                    for i in 0..columns.len() {
                        // Safety check: ensure column index exists in this row
                        if i >= row.len() {
                            row_values.push(serde_json::Value::Null);
                            continue;
                        }
                        // Try to get value as different types
                        let value = if let Ok(v) = row.try_get::<String, _>(i) {
                            serde_json::Value::String(v)
                        } else if let Ok(v) = row.try_get::<i32, _>(i) {
                            serde_json::Value::Number(serde_json::Number::from(v))
                        } else if let Ok(v) = row.try_get::<i64, _>(i) {
                            serde_json::Value::Number(serde_json::Number::from(v))
                        } else if let Ok(v) = row.try_get::<f64, _>(i) {
                            serde_json::Number::from_f64(v)
                                .map(serde_json::Value::Number)
                                .unwrap_or(serde_json::Value::Null)
                        } else if let Ok(v) = row.try_get::<bool, _>(i) {
                            serde_json::Value::Bool(v)
                        } else {
                            serde_json::Value::Null
                        };
                        row_values.push(value);
                    }
                    result_rows.push(row_values);
                }
            }
            
            let row_count = result_rows.len();
            Ok(QueryResult {
                columns,
                rows: result_rows,
                row_count,
                execution_time,
            })
        } else {
            // Execute as a raw command (INSERT, UPDATE, DELETE, etc.)
            let result = sqlx::raw_sql(query)
                .execute(pool)
                .await
                .map_err(|e| format!("Query execution failed: {}", e))?;
            
            let execution_time = start.elapsed().as_millis() as f64;
            
            Ok(QueryResult {
                columns: vec!["rows_affected".to_string()],
                rows: vec![vec![serde_json::Value::Number(serde_json::Number::from(result.rows_affected()))]],
                row_count: 1,
                execution_time,
            })
        }
    }
    
    async fn execute_sqlite_query(&self, pool: &SqlitePool, query: &str, start: std::time::Instant) -> Result<QueryResult, String> {
        use sqlx::{Row as SqlxRow, Column};
        
        // Check if it's a SELECT query
        let trimmed = query.trim().to_uppercase();
        if trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") {
            // Execute as a raw query to avoid prepared statement conflicts
            let rows = sqlx::raw_sql(query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Query execution failed: {}", e))?;
            
            let execution_time = start.elapsed().as_millis() as f64;
            
            // Convert rows to JSON values
            let mut result_rows = Vec::new();
            let mut columns = Vec::new();
            
            if !rows.is_empty() {
                // Get column names from the first row
                let first_row = &rows[0];
                for column in first_row.columns() {
                    columns.push(column.name().to_string());
                }
                
                // Convert each row to a vector of JSON values
                for row in rows {
                    let mut row_values = Vec::new();
                    for i in 0..columns.len() {
                        // Safety check: ensure column index exists in this row
                        if i >= row.len() {
                            row_values.push(serde_json::Value::Null);
                            continue;
                        }
                        // Try to get value as different types
                        let value = if let Ok(v) = row.try_get::<String, _>(i) {
                            serde_json::Value::String(v)
                        } else if let Ok(v) = row.try_get::<i32, _>(i) {
                            serde_json::Value::Number(serde_json::Number::from(v))
                        } else if let Ok(v) = row.try_get::<i64, _>(i) {
                            serde_json::Value::Number(serde_json::Number::from(v))
                        } else if let Ok(v) = row.try_get::<f64, _>(i) {
                            serde_json::Number::from_f64(v)
                                .map(serde_json::Value::Number)
                                .unwrap_or(serde_json::Value::Null)
                        } else if let Ok(v) = row.try_get::<bool, _>(i) {
                            serde_json::Value::Bool(v)
                        } else {
                            serde_json::Value::Null
                        };
                        row_values.push(value);
                    }
                    result_rows.push(row_values);
                }
            }
            
            let row_count = result_rows.len();
            Ok(QueryResult {
                columns,
                rows: result_rows,
                row_count,
                execution_time,
            })
        } else {
            // Execute as a raw command (INSERT, UPDATE, DELETE, etc.)
            let result = sqlx::raw_sql(query)
                .execute(pool)
                .await
                .map_err(|e| format!("Query execution failed: {}", e))?;
            
            let execution_time = start.elapsed().as_millis() as f64;
            
            Ok(QueryResult {
                columns: vec!["rows_affected".to_string()],
                rows: vec![vec![serde_json::Value::Number(serde_json::Number::from(result.rows_affected()))]],
                row_count: 1,
                execution_time,
            })
        }
    }
    
    pub async fn close_connection(&self, connection_id: &str) -> Result<(), String> {
        let mut pools = self.pools.write().await;
        let mut configs = self.configs.write().await;
        
        pools.remove(connection_id);
        configs.remove(connection_id);
        
        Ok(())
    }
    
    pub async fn get_connection_status(&self, connection_id: &str) -> Result<ConnectionStatus, String> {
        let pools = self.pools.read().await;
        
        if let Some(pool) = pools.get(connection_id) {
            let (size, idle) = match pool.as_ref() {
                DatabasePool::PostgreSQL(pg_pool) => {
                    (pg_pool.size() as usize, pg_pool.num_idle())
                },
                DatabasePool::MySQL(mysql_pool) => {
                    (mysql_pool.size() as usize, mysql_pool.num_idle())
                },
                DatabasePool::SQLite(sqlite_pool) => {
                    (sqlite_pool.size() as usize, sqlite_pool.num_idle())
                },
            };
            
            // Get max connections from config
            let configs = self.configs.read().await;
            let max = configs.get(connection_id)
                .map(|c| c.max_connections as usize)
                .unwrap_or(10);
            
            Ok(ConnectionStatus {
                connection_id: connection_id.to_string(),
                is_connected: true,
                pool_size: size,
                idle_connections: idle,
                max_connections: max,
            })
        } else {
            Ok(ConnectionStatus {
                connection_id: connection_id.to_string(),
                is_connected: false,
                pool_size: 0,
                idle_connections: 0,
                max_connections: 0,
            })
        }
    }
    
    async fn get_password(&self, connection_id: &str) -> Result<String, String> {
        let storage_lock = self.secure_storage.lock().await;
        if let Some(storage) = storage_lock.as_ref() {
            let connection = storage.get_connection(connection_id).await
                .map_err(|e| format!("Failed to get connection from secure storage: {}", e))?;
            
            Ok(connection.password.unwrap_or_default())
        } else {
            Err("Secure storage not initialized".to_string())
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub execution_time: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub connection_id: String,
    pub is_connected: bool,
    pub pool_size: usize,
    pub idle_connections: usize,
    pub max_connections: usize,
}