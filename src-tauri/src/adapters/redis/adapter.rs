//! Redis adapter implementation
//!
//! Implements key-value database operations for Redis using the fred crate.

use async_trait::async_trait;
use fred::clients::Client;
use fred::interfaces::{ClientLike, HashesInterface, KeysInterface, ListInterface, ServerInterface, SetsInterface, SortedSetsInterface};
use fred::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::core::capabilities::*;
use crate::error::AppError;
use crate::types::ConnectionProfile;

use super::types::RedisMode;

/// Redis database adapter
pub struct RedisAdapter {
    client: Arc<RwLock<Option<Client>>>,
    connected: Arc<RwLock<bool>>,
    current_db: Arc<RwLock<u8>>,
}

impl RedisAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(RwLock::new(None)),
            connected: Arc::new(RwLock::new(false)),
            current_db: Arc::new(RwLock::new(0)),
        }
    }

    /// Get the current database index
    pub async fn current_database(&self) -> u8 {
        *self.current_db.read().await
    }

    /// Get the current client reference
    pub async fn get_client(&self) -> Option<Client> {
        self.client.read().await.clone()
    }

    /// Build Redis config from connection profile
    fn build_config(profile: &ConnectionProfile) -> Result<Config, AppError> {
        // Check for custom connection string
        if let Some(conn_str) = profile.options.get("connection_string") {
            if !conn_str.is_empty() {
                return Config::from_url(conn_str)
                    .map_err(|e| AppError::DatabaseError(format!("Invalid Redis URL: {}", e)));
            }
        }

        // Determine mode from options
        let mode_str = profile.options.get("mode").map(|s| s.as_str());
        let mode = match mode_str {
            Some("cluster") => RedisMode::Cluster,
            Some("sentinel") => RedisMode::Sentinel,
            _ => RedisMode::Standalone,
        };

        let server_config = match mode {
            RedisMode::Standalone | RedisMode::Cluster => ServerConfig::Centralized {
                server: Server::new(profile.host.clone(), profile.port),
            },
            RedisMode::Sentinel => {
                let master_name = profile
                    .options
                    .get("sentinel_master")
                    .cloned()
                    .unwrap_or_else(|| "mymaster".to_string());

                let hosts: Vec<Server> = if let Some(nodes_str) = profile.options.get("nodes") {
                    nodes_str
                        .split(',')
                        .filter_map(|s| {
                            let parts: Vec<&str> = s.trim().split(':').collect();
                            if parts.len() == 2 {
                                parts[1]
                                    .parse::<u16>()
                                    .ok()
                                    .map(|port| Server::new(parts[0].to_string(), port))
                            } else {
                                None
                            }
                        })
                        .collect()
                } else {
                    vec![Server::new(profile.host.clone(), profile.port)]
                };

                ServerConfig::Sentinel {
                    hosts,
                    service_name: master_name,
                }
            }
        };

        // Parse database number
        let database: Option<u8> = profile
            .database
            .parse()
            .ok()
            .or_else(|| profile.options.get("database").and_then(|d| d.parse().ok()));

        let config = Config {
            server: server_config,
            password: profile.password.clone(),
            username: if profile.username.is_empty() {
                None
            } else {
                Some(profile.username.clone())
            },
            database,
            ..Default::default()
        };

        Ok(config)
    }

    /// Connect to Redis using a connection profile
    pub async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        let redis_config = Self::build_config(profile)?;

        let client = Builder::from_config(redis_config)
            .build()
            .map_err(|e| AppError::DatabaseError(format!("Failed to build Redis client: {}", e)))?;

        client.init().await.map_err(|e| {
            AppError::DatabaseError(format!("Failed to connect to Redis: {}", e))
        })?;

        // Verify with PING
        let _: String = client.ping(None).await.map_err(|e| {
            AppError::DatabaseError(format!("Redis PING failed: {}", e))
        })?;

        let db_num: u8 = profile
            .database
            .parse()
            .ok()
            .or_else(|| profile.options.get("database").and_then(|d| d.parse().ok()))
            .unwrap_or(0);

        *self.client.write().await = Some(client);
        *self.connected.write().await = true;
        *self.current_db.write().await = db_num;

        Ok(())
    }

    /// Disconnect from Redis
    pub async fn disconnect(&self) -> Result<(), AppError> {
        let mut client = self.client.write().await;
        if let Some(c) = client.take() {
            let _ = c.quit().await;
        }
        *self.connected.write().await = false;
        Ok(())
    }

    /// Select a different database (0-15)
    pub async fn select_db(&self, db: u8) -> Result<(), AppError> {
        if db > 15 {
            return Err(AppError::InvalidInput(
                "Redis database index must be 0-15".to_string(),
            ));
        }

        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                c.select(db as i64).await.map_err(|e| {
                    AppError::DatabaseError(format!("SELECT failed: {}", e))
                })?;
                drop(client);
                *self.current_db.write().await = db;
                Ok(())
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Get server info as raw string
    pub async fn get_server_info_raw(&self) -> Result<String, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let info: String = c.info(None).await.map_err(|e| {
                    AppError::DatabaseError(format!("Failed to get server info: {}", e))
                })?;
                Ok(info)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Get database size (number of keys)
    pub async fn dbsize(&self) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let size: u64 = c.dbsize().await.map_err(|e| {
                    AppError::DatabaseError(format!("Failed to get database size: {}", e))
                })?;
                Ok(size)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }
}

impl Default for RedisAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseCapability for RedisAdapter {
    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let client = self.client.read().await;

        match client.as_ref() {
            Some(c) => {
                let start = Instant::now();

                let result: Result<String, _> = c.ping(None).await;
                let latency = start.elapsed().as_millis() as u64;

                match result {
                    Ok(_) => {
                        // Get server version from INFO
                        let info: Result<String, _> = c.info(None).await;

                        let version = info.ok().and_then(|info_str| {
                            info_str
                                .lines()
                                .find(|line| line.starts_with("redis_version:"))
                                .map(|line| line.trim_start_matches("redis_version:").to_string())
                        });

                        Ok(CapabilityTestResult {
                            success: true,
                            message: "Connection successful".to_string(),
                            latency_ms: Some(latency),
                            server_version: version,
                        })
                    }
                    Err(e) => Ok(CapabilityTestResult {
                        success: false,
                        message: format!("PING failed: {}", e),
                        latency_ms: Some(latency),
                        server_version: None,
                    }),
                }
            }
            None => Ok(CapabilityTestResult {
                success: false,
                message: "Not connected".to_string(),
                latency_ms: None,
                server_version: None,
            }),
        }
    }

    fn is_connected(&self) -> bool {
        self.connected
            .try_read()
            .map(|guard| *guard)
            .unwrap_or(false)
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![
            AdapterCapability::KeyValueOperable,
            AdapterCapability::RichKeyValueOperable,
        ]
    }
}

// ============ KeyValueOperable Implementation ============

impl RedisAdapter {
    // Note: TYPE command implementation deferred - needs proper custom command handling
    // Will be implemented in a follow-up when we add the key browser functionality.

    /// Get TTL of a key in seconds (-1 if no expiry, -2 if key doesn't exist)
    pub async fn key_ttl(&self, key: &str) -> Result<i64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let ttl: i64 = c.ttl(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("TTL failed: {}", e))
                })?;
                Ok(ttl)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Set TTL on a key
    pub async fn set_key_ttl(&self, key: &str, seconds: u64) -> Result<bool, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let result: bool = c.expire(key, seconds as i64, None).await.map_err(|e| {
                    AppError::DatabaseError(format!("EXPIRE failed: {}", e))
                })?;
                Ok(result)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Get a string value
    pub async fn get_string(&self, key: &str) -> Result<Option<String>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let value: Option<String> = c.get(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("GET failed: {}", e))
                })?;
                Ok(value)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Set a string value
    pub async fn set_string(
        &self,
        key: &str,
        value: &str,
        ttl_seconds: Option<u64>,
    ) -> Result<(), AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let expiration = ttl_seconds.map(|s| Expiration::EX(s as i64));
                c.set::<(), _, _>(key, value, expiration, None, false)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SET failed: {}", e)))?;
                Ok(())
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Delete a single key
    pub async fn delete_key(&self, key: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.del(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("DEL failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Check if a key exists
    pub async fn key_exists(&self, key: &str) -> Result<bool, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.exists(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("EXISTS failed: {}", e))
                })?;
                Ok(count > 0)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    // Note: KEYS command is intentionally not implemented as it's 
    // blocking and should not be used in production. Use SCAN instead.
    // SCAN will be implemented when we add the key browser functionality.

    // ============ Hash Operations ============

    /// Get all fields and values from a hash
    pub async fn hash_get_all(&self, key: &str) -> Result<HashMap<String, String>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let result: HashMap<String, String> = c.hgetall(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("HGETALL failed: {}", e))
                })?;
                Ok(result)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Get a single hash field
    pub async fn hash_get(&self, key: &str, field: &str) -> Result<Option<String>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let result: Option<String> = c.hget(key, field).await.map_err(|e| {
                    AppError::DatabaseError(format!("HGET failed: {}", e))
                })?;
                Ok(result)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Set a single hash field
    pub async fn hash_set_field(
        &self,
        key: &str,
        field: &str,
        value: &str,
    ) -> Result<bool, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let result: bool = c.hset(key, (field, value)).await.map_err(|e| {
                    AppError::DatabaseError(format!("HSET failed: {}", e))
                })?;
                Ok(result)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Delete a hash field
    pub async fn hash_delete_field(&self, key: &str, field: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.hdel(key, field).await.map_err(|e| {
                    AppError::DatabaseError(format!("HDEL failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    // ============ List Operations ============

    /// Get list range
    pub async fn list_range(
        &self,
        key: &str,
        start: i64,
        stop: i64,
    ) -> Result<Vec<String>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let result: Vec<String> = c.lrange(key, start, stop).await.map_err(|e| {
                    AppError::DatabaseError(format!("LRANGE failed: {}", e))
                })?;
                Ok(result)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Push to left of list
    pub async fn list_lpush(&self, key: &str, value: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.lpush(key, value).await.map_err(|e| {
                    AppError::DatabaseError(format!("LPUSH failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Push to right of list
    pub async fn list_rpush(&self, key: &str, value: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.rpush(key, value).await.map_err(|e| {
                    AppError::DatabaseError(format!("RPUSH failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Get list length
    pub async fn list_len(&self, key: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let len: u64 = c.llen(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("LLEN failed: {}", e))
                })?;
                Ok(len)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    // ============ Set Operations ============

    /// Get all set members
    pub async fn set_members(&self, key: &str) -> Result<Vec<String>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let result: Vec<String> = c.smembers(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("SMEMBERS failed: {}", e))
                })?;
                Ok(result)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Add a member to a set
    pub async fn set_add(&self, key: &str, member: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.sadd(key, member).await.map_err(|e| {
                    AppError::DatabaseError(format!("SADD failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Remove a member from a set
    pub async fn set_remove(&self, key: &str, member: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.srem(key, member).await.map_err(|e| {
                    AppError::DatabaseError(format!("SREM failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Get set cardinality
    pub async fn set_card(&self, key: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.scard(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("SCARD failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    // ============ Sorted Set Operations ============

    /// Add a member to a sorted set
    pub async fn zset_add(&self, key: &str, score: f64, member: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.zadd(key, None, None, false, false, (score, member)).await.map_err(|e| {
                    AppError::DatabaseError(format!("ZADD failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Get sorted set cardinality
    pub async fn zset_card(&self, key: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let count: u64 = c.zcard(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("ZCARD failed: {}", e))
                })?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Get member score in sorted set
    pub async fn zset_score(&self, key: &str, member: &str) -> Result<Option<f64>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let score: Option<f64> = c.zscore(key, member).await.map_err(|e| {
                    AppError::DatabaseError(format!("ZSCORE failed: {}", e))
                })?;
                Ok(score)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    // ============ Key Type Operation ============

    /// Get key type
    pub async fn key_type(&self, key: &str) -> Result<String, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let key_type: String = c.r#type(key).await.map_err(|e| {
                    AppError::DatabaseError(format!("TYPE failed: {}", e))
                })?;
                Ok(key_type)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_adapter() {
        let adapter = RedisAdapter::new();
        assert!(!adapter.is_connected());
    }

    #[test]
    fn test_capabilities() {
        let adapter = RedisAdapter::new();
        let caps = adapter.get_capabilities();
        assert!(caps.contains(&AdapterCapability::KeyValueOperable));
        assert!(caps.contains(&AdapterCapability::RichKeyValueOperable));
    }

    #[tokio::test]
    async fn test_current_database_default() {
        let adapter = RedisAdapter::new();
        assert_eq!(adapter.current_database().await, 0);
    }

    #[test]
    fn test_build_config_standalone() {
        use std::collections::HashMap;

        let profile = ConnectionProfile {
            id: "test".to_string(),
            name: "test".to_string(),
            db_type: crate::types::DbType::Redis,
            host: "localhost".to_string(),
            port: 6379,
            database: "0".to_string(),
            username: String::new(),
            password: None,
            ssl_mode: None,
            ssl_config: None,
            ssh_tunnel: None,
            bastion: None,
            options: HashMap::new(),
            group: None,
        };

        let config = RedisAdapter::build_config(&profile);
        assert!(config.is_ok());
    }

    #[tokio::test]
    async fn test_select_db_requires_connection() {
        let adapter = RedisAdapter::new();
        let result = adapter.select_db(2).await;
        assert!(
            result.is_err(),
            "select_db should fail when not connected"
        );
    }

    #[tokio::test]
    async fn test_select_db_validates_range() {
        let adapter = RedisAdapter::new();
        let result = adapter.select_db(16).await;
        assert!(result.is_err(), "select_db should reject db index > 15");
    }

    #[tokio::test]
    #[ignore = "requires live Redis server on localhost:6379"]
    async fn test_select_db_issues_select_command() {
        use std::collections::HashMap;

        let profile = ConnectionProfile {
            id: "test".to_string(),
            name: "test".to_string(),
            db_type: crate::types::DbType::Redis,
            host: "localhost".to_string(),
            port: 6379,
            database: "0".to_string(),
            username: String::new(),
            password: None,
            ssl_mode: None,
            ssl_config: None,
            ssh_tunnel: None,
            bastion: None,
            options: HashMap::new(),
            group: None,
        };

        let adapter = RedisAdapter::new();
        adapter.connect(&profile).await.expect("Failed to connect to Redis");

        adapter.select_db(2).await.expect("select_db should succeed");
        assert_eq!(adapter.current_database().await, 2);

        let test_key = format!("__test_select_db_{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos());

        adapter.set_string(&test_key, "test_value", None).await.expect("SET should work");

        adapter.select_db(0).await.expect("select_db to 0 should succeed");
        let result = adapter.get_string(&test_key).await.expect("GET should work");
        assert!(
            result.is_none(),
            "Key set in db2 should not exist in db0"
        );

        adapter.select_db(2).await.expect("select_db back to 2");
        let result = adapter.get_string(&test_key).await.expect("GET should work");
        assert_eq!(result, Some("test_value".to_string()));

        adapter.delete_key(&test_key).await.expect("cleanup");
        adapter.disconnect().await.expect("disconnect");
    }
}
