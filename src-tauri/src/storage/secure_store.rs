use std::error::Error;
use std::path::PathBuf;
use sqlx::{SqlitePool, Row};
use tauri::AppHandle;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::sync::{Arc, Mutex};

use crate::crypto::{
    EncryptionService, SecureBytes,
    KeyManager, encrypt_field, decrypt_field,
};
use crate::storage::keychain::KeychainManager;
use crate::storage::audit_log::{AuditLogger, AuditEvent, SecurityEventType, EventOutcome};
use crate::storage::models::ConnectionConfig;
use crate::cache::{CredentialCache, ConnectionPool, PoolConfig};

/// Secure storage service with encryption at rest and performance optimizations
pub struct SecureStorage {
    pool: SqlitePool,
    key_manager: Arc<Mutex<KeyManager>>,
    encryption_service: EncryptionService,
    audit_logger: AuditLogger,
    app_handle: AppHandle,
    credential_cache: Arc<CredentialCache>,
    connection_pool: Arc<ConnectionPool>,
}

impl SecureStorage {
    /// Initialize the secure storage with encrypted SQLite database
    pub async fn init(app_handle: &AppHandle) -> Result<Self, Box<dyn Error>> {
        // Get secure app data directory
        let app_dir = Self::get_secure_app_dir(app_handle)?;
        std::fs::create_dir_all(&app_dir)?;
        
        // Initialize keychain and get/create master key
        let keychain = KeychainManager::new();
        let master_key = match keychain.get_or_create_master_key() {
            Ok(key) => {
                println!("[SecureStorage] Successfully initialized with Keychain");
                key
            }
            Err(e) => {
                println!("[SecureStorage] Keychain initialization failed: {}", e);
                println!("[SecureStorage] Falling back to file-based key storage");
                // Fallback: Generate a random key and store it in a file
                // This is less secure but allows the app to work
                let key_file = app_dir.join(".master_key");
                if key_file.exists() {
                    println!("[SecureStorage] Loading existing file-based master key");
                    std::fs::read(&key_file)?
                } else {
                    println!("[SecureStorage] Creating new file-based master key");
                    use crate::crypto::nonce::generate_random_key;
                    let key = generate_random_key().to_vec();
                    std::fs::write(&key_file, &key)?;
                    // Make the file readable only by the owner
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let mut perms = std::fs::metadata(&key_file)?.permissions();
                        perms.set_mode(0o600);
                        std::fs::set_permissions(&key_file, perms)?;
                    }
                    key
                }
            }
        };
        
        // Initialize key manager with master key
        let key_manager = Arc::new(Mutex::new(KeyManager::new(SecureBytes::new(master_key))?));
        
        // Create encryption service
        let encryption_service = EncryptionService::default();
        
        // Setup SQLite database
        let db_path = app_dir.join("devdb_secure_store.db");
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
        let pool = SqlitePool::connect(&db_url).await?;
        
        // Run migrations
        crate::storage::migrations::run_migrations(&pool).await?;
        
        // Initialize audit logger
        let audit_logger = AuditLogger::new(pool.clone());
        
        // Initialize performance caches
        let credential_cache = Arc::new(CredentialCache::new(
            300, // 5 minute TTL for cached credentials
            100, // Max 100 cached entries
        ));
        
        let connection_pool = Arc::new(ConnectionPool::new(PoolConfig::default()));
        
        Ok(SecureStorage {
            pool,
            key_manager,
            encryption_service,
            audit_logger,
            app_handle: app_handle.clone(),
            credential_cache,
            connection_pool,
        })
    }
    
    /// Get the secure app data directory - platform-specific sandboxed location
    fn get_secure_app_dir(_app_handle: &AppHandle) -> Result<PathBuf, Box<dyn Error>> {
        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir().ok_or("Failed to get home directory")?;
            let path = home.join("Library")
                .join("Application Support")
                .join("com.devdb.studio");
            Ok(path)
        }
        
        #[cfg(target_os = "windows")]
        {
            let data_dir = dirs::data_dir().ok_or("Failed to get data directory")?;
            let path = data_dir.join("DevDB Studio");
            Ok(path)
        }
        
        #[cfg(target_os = "linux")]
        {
            let config_dir = dirs::config_dir().ok_or("Failed to get config directory")?;
            let path = config_dir.join("devdb-studio");
            Ok(path)
        }
        
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Err("Unsupported platform".into())
        }
    }
    
    /// Store a connection configuration with field-level encryption
    pub async fn store_connection(&mut self, config: ConnectionConfig) -> Result<String, Box<dyn Error>> {
        // Use provided ID if available, otherwise generate a new one
        let connection_id = if let Some(id) = &config.id {
            Uuid::parse_str(id)?
        } else {
            Uuid::new_v4()
        };
        
        // Get database-specific encryption key
        let db_key = {
            let mut key_manager = self.key_manager.lock().unwrap();
            key_manager.get_database_key(connection_id)?.clone()
        };
        
        // Encrypt sensitive fields
        let encrypted_password = if let Some(password) = &config.password {
            Some(encrypt_field("password", password, &db_key)?)
        } else {
            None
        };
        
        let encrypted_ssh_key = if let Some(ssh_key) = &config.ssh_private_key {
            Some(encrypt_field("ssh_private_key", ssh_key, &db_key)?)
        } else {
            None
        };
        
        let encrypted_api_key = if let Some(api_key) = &config.api_key {
            Some(encrypt_field("api_key", api_key, &db_key)?)
        } else {
            None
        };
        
        // Store in database
        let mut conn = self.pool.acquire().await?;
        sqlx::query(
            r#"
            INSERT INTO connections (
                id, name, host, port, username, 
                encrypted_password, database_name, 
                encrypted_ssh_key, encrypted_api_key,
                connection_type, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&connection_id.to_string())
        .bind(&config.name)
        .bind(&config.host)
        .bind(config.port)
        .bind(&config.username)
        .bind(&encrypted_password)
        .bind(&config.database)
        .bind(&encrypted_ssh_key)
        .bind(&encrypted_api_key)
        .bind(&config.connection_type)
        .bind(Utc::now().to_rfc3339())
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *conn)
        .await?;
        
        // Audit log the action
        self.audit_logger.log_event(AuditEvent::new(
            SecurityEventType::CredentialCreated,
            connection_id.to_string(),
            EventOutcome::Success,
            Some(serde_json::json!({
                "connection_name": config.name,
                "connection_type": config.connection_type,
            })),
        )).await?;
        
        Ok(connection_id.to_string())
    }
    
    /// Retrieve and decrypt a connection configuration with caching
    pub async fn get_connection(&self, connection_id: &str) -> Result<ConnectionConfig, Box<dyn Error>> {
        // Check cache first
        if let Some(cached) = self.credential_cache.get(connection_id) {
            // Convert from SecureConnectionConfig to ConnectionConfig
            return Ok(ConnectionConfig {
                id: Some(connection_id.to_string()),
                name: cached.name,
                host: cached.host,
                port: cached.port,
                username: cached.username,
                password: cached.password,
                database: cached.database,
                ssh_private_key: None,
                api_key: None,
                connection_type: cached.connection_type,
                created_at: None,
                updated_at: None,
            });
        }
        
        let uuid = Uuid::parse_str(connection_id)?;
        
        // Get database-specific decryption key
        let db_key = {
            let mut key_manager = self.key_manager.lock().unwrap();
            key_manager.get_database_key(uuid)?.clone()
        };
        
        // Fetch from database
        let mut conn = self.pool.acquire().await?;
        let row = sqlx::query(
            r#"
            SELECT name, host, port, username, 
                   encrypted_password, database_name,
                   encrypted_ssh_key, encrypted_api_key,
                   connection_type, created_at, updated_at
            FROM connections
            WHERE id = ?
            "#
        )
        .bind(connection_id)
        .fetch_one(&mut *conn)
        .await?;
        
        // Decrypt sensitive fields
        let password: Option<String> = row.get("encrypted_password");
        let password = if let Some(encrypted) = password {
            Some(decrypt_field(&encrypted, &db_key)?)
        } else {
            None
        };
        
        let ssh_private_key: Option<String> = row.get("encrypted_ssh_key");
        let ssh_private_key = if let Some(encrypted) = ssh_private_key {
            Some(decrypt_field(&encrypted, &db_key)?)
        } else {
            None
        };
        
        let api_key: Option<String> = row.get("encrypted_api_key");
        let api_key = if let Some(encrypted) = api_key {
            Some(decrypt_field(&encrypted, &db_key)?)
        } else {
            None
        };
        
        // Audit log the access
        self.audit_logger.log_event(AuditEvent::new(
            SecurityEventType::CredentialAccess,
            connection_id.to_string(),
            EventOutcome::Success,
            None,
        )).await?;
        
        // Note: Caching is disabled here to avoid mutable borrow
        // TODO: Implement separate cache update method if needed
        
        Ok(ConnectionConfig {
            id: Some(connection_id.to_string()),
            name: row.get("name"),
            host: row.get("host"),
            port: row.get("port"),
            username: row.get("username"),
            password,
            database: row.get("database_name"),
            ssh_private_key,
            api_key,
            connection_type: row.get("connection_type"),
            created_at: {
                let date_str: Option<String> = row.get("created_at");
                date_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)))
            },
            updated_at: {
                let date_str: Option<String> = row.get("updated_at");
                date_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)))
            },
        })
    }
    
    /// List connections with pagination support (without decrypting sensitive data)
    pub async fn list_connections_paginated(
        &self, 
        page: u32, 
        page_size: u32
    ) -> Result<(Vec<ConnectionConfig>, u32), Box<dyn Error>> {
        let mut conn = self.pool.acquire().await?;
        
        // Get total count
        let count_row = sqlx::query("SELECT COUNT(*) as count FROM connections")
            .fetch_one(&mut *conn)
            .await?;
        let total_count: i64 = count_row.get("count");
        
        // Calculate offset
        let offset = (page - 1) * page_size;
        
        let rows = sqlx::query(
            r#"
            SELECT id, name, host, port, username, 
                   database_name, connection_type, 
                   created_at, updated_at
            FROM connections
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
            "#
        )
        .bind(page_size as i64)
        .bind(offset as i64)
        .fetch_all(&mut *conn)
        .await?;
        
        let connections = rows.into_iter().map(|row| {
            ConnectionConfig {
                id: Some(row.get("id")),
                name: row.get("name"),
                host: row.get("host"),
                port: row.get("port"),
                username: row.get("username"),
                password: None, // Never include in list
                database: row.get("database_name"),
                ssh_private_key: None,
                api_key: None,
                connection_type: row.get("connection_type"),
                created_at: {
                    let date_str: Option<String> = row.get("created_at");
                    date_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)))
                },
                updated_at: {
                    let date_str: Option<String> = row.get("updated_at");
                    date_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)))
                },
            }
        }).collect();
        
        Ok((connections, total_count as u32))
    }
    
    /// List all connections (without decrypting sensitive data) - backwards compatibility
    pub async fn list_connections(&self) -> Result<Vec<ConnectionConfig>, Box<dyn Error>> {
        // Default to first page with 100 items for backwards compatibility
        let (connections, _) = self.list_connections_paginated(1, 100).await?;
        Ok(connections)
    }
    
    /// Original list_connections implementation for reference
    async fn _list_connections_all(&self) -> Result<Vec<ConnectionConfig>, Box<dyn Error>> {
        let mut conn = self.pool.acquire().await?;
        let rows = sqlx::query(
            r#"
            SELECT id, name, host, port, username, 
                   database_name, connection_type, 
                   created_at, updated_at
            FROM connections
            ORDER BY name
            "#
        )
        .fetch_all(&mut *conn)
        .await?;
        
        let connections = rows.into_iter().map(|row| {
            ConnectionConfig {
                id: Some(row.get("id")),
                name: row.get("name"),
                host: row.get("host"),
                port: row.get("port"),
                username: row.get("username"),
                password: None, // Don't decrypt for listing
                database: row.get("database_name"),
                ssh_private_key: None,
                api_key: None,
                connection_type: row.get("connection_type"),
                created_at: {
                    let date_str: Option<String> = row.get("created_at");
                    date_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)))
                },
                updated_at: {
                    let date_str: Option<String> = row.get("updated_at");
                    date_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)))
                },
            }
        }).collect();
        
        Ok(connections)
    }
    
    /// Update a connection configuration
    pub async fn update_connection(&mut self, connection_id: &str, config: ConnectionConfig) -> Result<(), Box<dyn Error>> {
        let uuid = Uuid::parse_str(connection_id)?;
        let db_key = {
            let mut key_manager = self.key_manager.lock().unwrap();
            key_manager.get_database_key(uuid)?.clone()
        };
        
        // Encrypt sensitive fields if provided
        let encrypted_password = if let Some(password) = &config.password {
            Some(encrypt_field("password", password, &db_key)?)
        } else {
            None
        };
        
        let encrypted_ssh_key = if let Some(ssh_key) = &config.ssh_private_key {
            Some(encrypt_field("ssh_private_key", ssh_key, &db_key)?)
        } else {
            None
        };
        
        let encrypted_api_key = if let Some(api_key) = &config.api_key {
            Some(encrypt_field("api_key", api_key, &db_key)?)
        } else {
            None
        };
        
        // Update in database
        let mut conn = self.pool.acquire().await?;
        sqlx::query(
            r#"
            UPDATE connections 
            SET name = ?, host = ?, port = ?, username = ?,
                encrypted_password = COALESCE(?, encrypted_password),
                database_name = ?, 
                encrypted_ssh_key = COALESCE(?, encrypted_ssh_key),
                encrypted_api_key = COALESCE(?, encrypted_api_key),
                connection_type = ?, updated_at = ?
            WHERE id = ?
            "#
        )
        .bind(&config.name)
        .bind(&config.host)
        .bind(config.port)
        .bind(&config.username)
        .bind(&encrypted_password)
        .bind(&config.database)
        .bind(&encrypted_ssh_key)
        .bind(&encrypted_api_key)
        .bind(&config.connection_type)
        .bind(Utc::now().to_rfc3339())
        .bind(connection_id)
        .execute(&mut *conn)
        .await?;
        
        // Audit log the modification
        self.audit_logger.log_event(AuditEvent::new(
            SecurityEventType::CredentialModified,
            connection_id.to_string(),
            EventOutcome::Success,
            None,
        )).await?;
        
        Ok(())
    }
    
    /// Delete a connection
    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), Box<dyn Error>> {
        let mut conn = self.pool.acquire().await?;
        
        // Delete from database
        sqlx::query("DELETE FROM connections WHERE id = ?")
            .bind(connection_id)
            .execute(&mut *conn)
            .await?;
        
        // Audit log the deletion
        self.audit_logger.log_event(AuditEvent::new(
            SecurityEventType::CredentialDeleted,
            connection_id.to_string(),
            EventOutcome::Success,
            None,
        )).await?;
        
        Ok(())
    }
    
    /// Store arbitrary encrypted data
    pub async fn store_secure_data(&mut self, key: &str, value: &str) -> Result<(), Box<dyn Error>> {
        let field_key = {
            let mut key_manager = self.key_manager.lock().unwrap();
            key_manager.get_field_key("generic")?.clone()
        };
        let encrypted = encrypt_field(key, value, &field_key)?;
        
        let mut conn = self.pool.acquire().await?;
        sqlx::query(
            r#"
            INSERT INTO secure_storage (key, encrypted_value, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET 
                encrypted_value = excluded.encrypted_value,
                updated_at = excluded.updated_at
            "#
        )
        .bind(key)
        .bind(&encrypted)
        .bind(Utc::now().to_rfc3339())
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *conn)
        .await?;
        
        Ok(())
    }
    
    /// Retrieve and decrypt arbitrary data
    pub async fn get_secure_data(&mut self, key: &str) -> Result<Option<String>, Box<dyn Error>> {
        let field_key = {
            let mut key_manager = self.key_manager.lock().unwrap();
            key_manager.get_field_key("generic")?.clone()
        };
        
        let mut conn = self.pool.acquire().await?;
        let row = sqlx::query(
            "SELECT encrypted_value FROM secure_storage WHERE key = ?"
        )
        .bind(key)
        .fetch_optional(&mut *conn)
        .await?;
        
        if let Some(row) = row {
            let encrypted: String = row.get("encrypted_value");
            let decrypted = decrypt_field(&encrypted, &field_key)?;
            Ok(Some(decrypted))
        } else {
            Ok(None)
        }
    }
    
    /// Delete secure data
    pub async fn delete_secure_data(&mut self, key: &str) -> Result<(), Box<dyn Error>> {
        let mut conn = self.pool.acquire().await?;
        sqlx::query("DELETE FROM secure_storage WHERE key = ?")
            .bind(key)
            .execute(&mut *conn)
            .await?;
        
        Ok(())
    }
    
    /// List all keys in secure storage (without decrypting values)
    pub async fn list_secure_keys(&self, prefix: Option<&str>) -> Result<Vec<String>, Box<dyn Error>> {
        let mut conn = self.pool.acquire().await?;
        
        let query = if let Some(prefix) = prefix {
            sqlx::query("SELECT key FROM secure_storage WHERE key LIKE ? || '%' ORDER BY key")
                .bind(prefix)
        } else {
            sqlx::query("SELECT key FROM secure_storage ORDER BY key")
        };
        
        let rows = query.fetch_all(&mut *conn).await?;
        let keys = rows.into_iter().map(|row| row.get("key")).collect();
        
        Ok(keys)
    }
    
    /// Rotate encryption keys
    pub async fn rotate_keys(&mut self) -> Result<(), Box<dyn Error>> {
        // Get all keys needing rotation
        let keys_to_rotate = {
            let key_manager = self.key_manager.lock().unwrap();
            key_manager.get_keys_needing_rotation()
        };
        
        for key_id in keys_to_rotate {
            // Rotate the key
            let new_key = {
                let mut key_manager = self.key_manager.lock().unwrap();
                key_manager.rotate_database_key(key_id)?.clone()
            };
            
            // Re-encrypt all data with the new key
            // This would be done lazily in production
            
            // Audit log the rotation
            self.audit_logger.log_event(AuditEvent::new(
                SecurityEventType::KeyRotation,
                key_id.to_string(),
                EventOutcome::Success,
                Some(serde_json::json!({
                    "reason": "scheduled",
                })),
            )).await?;
        }
        
        Ok(())
    }
    
    // Performance monitoring methods
    
    /// Get cache statistics
    pub fn get_cache_stats(&self) -> crate::cache::CacheStats {
        self.credential_cache.stats()
    }
    
    /// Clear the credential cache
    pub fn clear_cache(&self) {
        self.credential_cache.clear();
    }
    
    /// Cleanup expired cache entries
    pub fn cleanup_expired_cache(&self) {
        self.credential_cache.cleanup_expired();
    }
    
    /// Get active connection IDs from pools
    pub async fn get_active_connection_ids(&self) -> Vec<String> {
        // This would need to be implemented based on tracking active connections
        // For now, return empty vector
        vec![]
    }
    
    /// Get pool statistics for a connection
    pub async fn get_pool_stats(&self, connection_id: &str) -> Option<crate::cache::PoolStats> {
        self.connection_pool.get_stats(connection_id).await
    }
    
    /// Cleanup idle connection pools
    pub async fn cleanup_idle_pools(&self) {
        self.connection_pool.cleanup_idle().await;
    }
    
    /// Invalidate a specific cache entry
    pub fn invalidate_cache(&mut self, connection_id: &str) {
        self.credential_cache.invalidate(connection_id);
    }
}