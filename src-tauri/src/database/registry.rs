use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use uuid::Uuid;
use sqlx::{postgres::PgPoolOptions, mysql::MySqlPoolOptions, sqlite::SqlitePoolOptions};

use crate::database::adapter::{postgres::PostgresAdapter, mysql::MySqlAdapter, sqlite::SqliteAdapter, mssql::MssqlAdapter, mongodb::MongoDbAdapter, DbAdapter, types::*};
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
        self.connect_with_id(config, conn_id).await
    }
    
    pub async fn connect_with_id(&self, config: ConnectionConfig, conn_id: String) -> Result<String, AppError> {
        println!("[ConnectionRegistry] connect_with_id called with ID: {}", conn_id);
        println!("[ConnectionRegistry] Connection config: name={}, host={}, port={}, db_type={:?}", 
            config.name, config.host, config.port, config.db_type);
        
        // Check if connection already exists
        if self.connections.read().await.contains_key(&conn_id) {
            println!("[ConnectionRegistry] Connection already exists with ID: {}, reusing existing connection", conn_id);
            return Ok(conn_id);
        }
        
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
            DbType::Mssql => {
                Box::new(MssqlAdapter::new(&config).await?)
            }
            DbType::Mariadb => {
                // MariaDB uses MySQL adapter
                let pool = create_mysql_pool(&config).await?;
                Box::new(MySqlAdapter::new(pool))
            }
            DbType::Mongodb => {
                let (client, database_name) = create_mongodb_client(&config).await?;
                Box::new(MongoDbAdapter::new(client, &database_name))
            }
        };
        
        println!("[ConnectionRegistry] Database adapter created, testing connection...");
        
        // Verify connection
        adapter.ping().await
            .map_err(|e| {
                println!("[ConnectionRegistry] ERROR: Initial ping failed: {}", e);
                e
            })?;
        
        println!("[ConnectionRegistry] Initial ping successful");
        
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
        
        println!("[ConnectionRegistry] Storing connection in registry with ID: {}", conn_id);
        self.connections.write().await.insert(conn_id.clone(), handle);
        
        let connection_count = self.connections.read().await.len();
        println!("[ConnectionRegistry] Connection stored successfully. Total connections: {}", connection_count);
        
        Ok(conn_id)
    }
    
    pub async fn get(&self, conn_id: &str) -> Option<Arc<ConnectionHandle>> {
        println!("[ConnectionRegistry] Getting connection for ID: {}", conn_id);
        let result = self.connections.read().await.get(conn_id).cloned();
        println!("[ConnectionRegistry] Get result for ID {}: {}", conn_id, if result.is_some() { "FOUND" } else { "NOT FOUND" });
        result
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
        let connections: Vec<String> = self.connections.read().await.keys().cloned().collect();
        println!("[ConnectionRegistry] list_connections returning {} connections: {:?}", connections.len(), connections);
        connections
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
    
    println!("[create_pg_pool] Connecting to PostgreSQL: postgresql://{}@{}:{}/{}", 
        config.username, config.host, config.port, config.database);
    
    let pool = PgPoolOptions::new()
        .max_connections(config.pool_size.unwrap_or(10))
        .acquire_timeout(std::time::Duration::from_millis(config.connection_timeout))
        .connect(&database_url)
        .await
        .map_err(|e| {
            println!("[create_pg_pool] ERROR: Failed to connect to PostgreSQL: {}", e);
            match e {
                sqlx::Error::PoolTimedOut => AppError::Database(format!(
                    "Connection timeout: Unable to connect to PostgreSQL at {}:{} within {}ms. Check if server is running and accessible.", 
                    config.host, config.port, config.connection_timeout
                )),
                sqlx::Error::Database(db_err) => AppError::Database(format!(
                    "Database error: {} (Check credentials and database name)", db_err
                )),
                sqlx::Error::Io(io_err) => AppError::Database(format!(
                    "Network error: {} (Check host and port)", io_err
                )),
                _ => AppError::from_sqlx(e)
            }
        })?;
    
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
    
    println!("[create_mysql_pool] Connecting to MySQL: mysql://{}@{}:{}/{}", 
        config.username, config.host, config.port, config.database);
    
    let pool = MySqlPoolOptions::new()
        .max_connections(config.pool_size.unwrap_or(10))
        .acquire_timeout(std::time::Duration::from_millis(config.connection_timeout))
        .connect(&database_url)
        .await
        .map_err(|e| {
            println!("[create_mysql_pool] ERROR: Failed to connect to MySQL: {}", e);
            match e {
                sqlx::Error::PoolTimedOut => AppError::Database(format!(
                    "Connection timeout: Unable to connect to MySQL at {}:{} within {}ms. Check if server is running and accessible.", 
                    config.host, config.port, config.connection_timeout
                )),
                sqlx::Error::Database(db_err) => AppError::Database(format!(
                    "Database error: {} (Check credentials and database name)", db_err
                )),
                sqlx::Error::Io(io_err) => AppError::Database(format!(
                    "Network error: {} (Check host and port)", io_err
                )),
                _ => AppError::from_sqlx(e)
            }
        })?;
    
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

async fn create_mongodb_client(config: &ConnectionConfig) -> Result<(mongodb::Client, String), AppError> {
    // Build MongoDB connection URI
    let connection_uri = if let Some(uri) = &config.connection_string {
        uri.clone()
    } else {
        let password_part = if let Some(password) = &config.password {
            if !password.is_empty() {
                format!(":{}@", password)
            } else {
                "@".to_string()
            }
        } else {
            "@".to_string()
        };
        
        let auth_part = if !config.username.is_empty() {
            format!("{}{}", config.username, password_part)
        } else {
            String::new()
        };
        
        let auth_prefix = if !auth_part.is_empty() && !auth_part.ends_with('@') {
            auth_part
        } else if auth_part.ends_with('@') {
            auth_part
        } else {
            String::new()
        };
        
        // For root users (like devuser), we need to authenticate against admin database
        // This is a temporary workaround - ideally authSource should come from the frontend
        let auth_source_param = if config.username == "devuser" {
            "?authSource=admin"
        } else {
            ""
        };
        
        format!(
            "mongodb://{}{}:{}/{}{}",
            auth_prefix,
            config.host,
            config.port,
            config.database,
            auth_source_param
        )
    };
    
    println!("[create_mongodb_client] Connecting to MongoDB: {}", 
        connection_uri.replace(&config.password.clone().unwrap_or_default(), "****"));
    
    // Create MongoDB client options
    let mut client_options = mongodb::options::ClientOptions::parse(&connection_uri)
        .await
        .map_err(|e| AppError::Database(format!("Failed to parse MongoDB connection URI: {}", e)))?;
    
    // Configure additional options
    if let Some(timeout) = config.server_selection_timeout_ms {
        client_options.server_selection_timeout = Some(std::time::Duration::from_millis(timeout));
    } else {
        client_options.server_selection_timeout = Some(std::time::Duration::from_millis(config.connection_timeout));
    }
    
    if let Some(replica_set) = &config.replica_set {
        client_options.repl_set_name = Some(replica_set.clone());
    }
    
    if let Some(direct) = config.direct_connection {
        client_options.direct_connection = Some(direct);
    }
    
    // Create the MongoDB client
    let client = mongodb::Client::with_options(client_options)
        .map_err(|e| AppError::Database(format!("Failed to create MongoDB client: {}", e)))?;
    
    // Test connection by pinging the server
    client
        .database("admin")
        .run_command(mongodb::bson::doc! { "ping": 1 }, None)
        .await
        .map_err(|e| AppError::Database(format!("Failed to connect to MongoDB: {}", e)))?;
    
    println!("[create_mongodb_client] Successfully connected to MongoDB");
    
    Ok((client, config.database.clone()))
}

fn spawn_health_monitor(
    conn_id: String,
    adapter: Arc<Box<dyn DbAdapter>>,
    app_handle: AppHandle,
) -> JoinHandle<()> {
    println!("[HealthMonitor] Starting health monitor for connection: {}", conn_id);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        let mut miss_count = 0;
        let mut last_status = "ready";
        let mut reconnect_attempts = 0;
        const MAX_RECONNECT_ATTEMPTS: u32 = 5;
        
        println!("[HealthMonitor] Health monitor loop started for connection: {}", conn_id);
        
        // Emit initial status event
        println!("[HealthMonitor] Emitting initial status event for connection: {}", conn_id);
        
        // Test emit - simple event first
        let test_emit = app_handle.emit("test-event", &serde_json::json!({
            "message": "Test from health monitor",
            "connectionId": conn_id.clone()
        }));
        println!("[HealthMonitor] Test event emission result: {:?}", test_emit);
        
        let emit_result = app_handle.emit("db:connection_status", &serde_json::json!({
            "connectionId": conn_id,
            "status": "ready",
            "rttMs": 0,
            "at": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        }));
        println!("[HealthMonitor] Initial status event emission result: {:?}", emit_result);
        
        loop {
            interval.tick().await;
            
            // Add jitter (±10%)
            let jitter = rand::random::<u64>() % 3000;
            tokio::time::sleep(std::time::Duration::from_millis(jitter)).await;
            
            match tokio::time::timeout(
                std::time::Duration::from_secs(5),
                adapter.ping()
            ).await {
                Ok(Ok(rtt)) => {
                    miss_count = 0;
                    reconnect_attempts = 0;
                    let rtt_ms = rtt.as_millis() as u32;
                    
                    let status = if rtt_ms <= 150 {
                        "ready"
                    } else if rtt_ms <= 1000 {
                        "degraded"
                    } else {
                        "degraded"
                    };
                    
                    println!("[HealthMonitor] Connection {}: status={}, rtt={}ms, last_status={}", 
                        conn_id, status, rtt_ms, last_status);
                    
                    // Always emit status event (not just on changes) for frontend sync
                    let emit_result = app_handle.emit("db:connection_status", &serde_json::json!({
                        "connectionId": conn_id,
                        "status": status,
                        "rttMs": rtt_ms,
                        "at": std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as i64,
                    }));
                    println!("[HealthMonitor] Status event emission result: {:?}", emit_result);
                    
                    last_status = status;
                }
                Ok(Err(_)) | Err(_) => {
                    miss_count += 1;
                    
                    let status = if miss_count == 1 {
                        "degraded"
                    } else if miss_count >= 2 {
                        // Start reconnection attempts
                        if reconnect_attempts < MAX_RECONNECT_ATTEMPTS {
                            spawn_reconnect(
                                conn_id.clone(),
                                adapter.clone(),
                                app_handle.clone(),
                                reconnect_attempts,
                            );
                            reconnect_attempts += 1;
                            "reconnecting"
                        } else {
                            "error"
                        }
                    } else {
                        "degraded"
                    };
                    
                    if status != last_status {
                        // Emit health event
                        let _ = app_handle.emit("db:connection_status", &serde_json::json!({
                            "connectionId": conn_id,
                            "status": status,
                            "reason": if status == "error" {
                                Some(format!("Connection lost after {} attempts", reconnect_attempts))
                            } else if miss_count > 0 {
                                Some("Connection timeout".to_string())
                            } else {
                                None
                            },
                            "at": std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis() as i64,
                        }));
                        last_status = status;
                    }
                }
            }
        }
    })
}

fn spawn_reconnect(
    conn_id: String,
    adapter: Arc<Box<dyn DbAdapter>>,
    app_handle: AppHandle,
    attempt: u32,
) {
    tokio::spawn(async move {
        let backoff = [1, 2, 5, 10, 30];
        let delay = backoff.get(attempt as usize).unwrap_or(&30);
        
        tokio::time::sleep(std::time::Duration::from_secs(*delay)).await;
        
        if adapter.ping().await.is_ok() {
            let _ = app_handle.emit("db:connection_recovered", &serde_json::json!({
                "connectionId": conn_id,
                "attempts": attempt + 1,
            }));
        }
    });
}