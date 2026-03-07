//! Redis adapter implementation
//!
//! Implements key-value database operations for Redis using the fred crate.

use async_trait::async_trait;
use fred::clients::Client;
use fred::interfaces::{
    ClientLike, HashesInterface, KeysInterface, ListInterface, LuaInterface, ServerInterface,
    SetsInterface, SortedSetsInterface, StreamsInterface,
};
use fred::prelude::{Builder, Config, Expiration, Server, ServerConfig};
use fred::types::config::ClusterDiscoveryPolicy;
use fred::types::SetOptions as FredSetOptions;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityTestResult, KeyInfo, KeyInfoWithPreview,
    KeyValueOperable, ListSide, RedisType, RedisValue, RichKeyValueOperable, ScanResult,
    ScanResultWithPreviews, SetOptions, StreamEntry, ZSetMember,
};
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
            RedisMode::Standalone => ServerConfig::Centralized {
                server: Server::new(profile.host.clone(), profile.port),
            },
            RedisMode::Cluster => {
                let hosts: Vec<Server> = if let Some(nodes_str) = profile.options.get("nodes") {
                    let mut parsed: Vec<Server> = nodes_str
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
                        .collect();
                    // Ensure the primary host is included
                    let primary = Server::new(profile.host.clone(), profile.port);
                    if !parsed.contains(&primary) {
                        parsed.insert(0, primary);
                    }
                    parsed
                } else {
                    vec![Server::new(profile.host.clone(), profile.port)]
                };

                ServerConfig::Clustered {
                    hosts,
                    policy: ClusterDiscoveryPolicy::ConfigEndpoint,
                }
            }
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

        // Initialize with timeout to prevent indefinite hangs on unreachable hosts
        let connect_timeout = std::time::Duration::from_secs(15);
        tokio::time::timeout(connect_timeout, client.init())
            .await
            .map_err(|_| {
                AppError::ConnectionClosed(format!(
                    "Connection timed out after {} seconds - host may be unreachable",
                    connect_timeout.as_secs()
                ))
            })?
            .map_err(|e| AppError::DatabaseError(format!("Failed to connect to Redis: {}", e)))?;

        // Verify with PING (also with timeout)
        let _: String = tokio::time::timeout(connect_timeout, client.ping(None))
            .await
            .map_err(|_| AppError::ConnectionClosed("PING timed out".into()))?
            .map_err(|e| AppError::DatabaseError(format!("Redis PING failed: {}", e)))?;

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
                c.select(db as i64)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SELECT failed: {}", e)))?;
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
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        RedisAdapter::connect(self, profile).await
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        RedisAdapter::disconnect(self).await
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let client = self.client.read().await;

        match client.as_ref() {
            Some(c) => {
                let start = Instant::now();

                let result: std::result::Result<String, _> = c.ping(None).await;
                let latency = start.elapsed().as_millis() as u64;

                match result {
                    Ok(_) => {
                        // Get server version from INFO
                        let info: std::result::Result<String, _> = c.info(None).await;

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
                let ttl: i64 = c
                    .ttl(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("TTL failed: {}", e)))?;
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
                let result: bool = c
                    .expire(key, seconds as i64, None)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("EXPIRE failed: {}", e)))?;
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
                let value: Option<String> = c
                    .get(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("GET failed: {}", e)))?;
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
                let count: u64 = c
                    .del(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("DEL failed: {}", e)))?;
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
                let count: u64 = c
                    .exists(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("EXISTS failed: {}", e)))?;
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
                let result: HashMap<String, String> = c
                    .hgetall(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("HGETALL failed: {}", e)))?;
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
                let result: Option<String> = c
                    .hget(key, field)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("HGET failed: {}", e)))?;
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
                let result: bool = c
                    .hset(key, (field, value))
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("HSET failed: {}", e)))?;
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
                let count: u64 = c
                    .hdel(key, field)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("HDEL failed: {}", e)))?;
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
                let result: Vec<String> = c
                    .lrange(key, start, stop)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("LRANGE failed: {}", e)))?;
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
                let count: u64 = c
                    .lpush(key, value)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("LPUSH failed: {}", e)))?;
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
                let count: u64 = c
                    .rpush(key, value)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("RPUSH failed: {}", e)))?;
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
                let len: u64 = c
                    .llen(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("LLEN failed: {}", e)))?;
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
                let result: Vec<String> = c
                    .smembers(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SMEMBERS failed: {}", e)))?;
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
                let count: u64 = c
                    .sadd(key, member)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SADD failed: {}", e)))?;
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
                let count: u64 = c
                    .srem(key, member)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SREM failed: {}", e)))?;
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
                let count: u64 = c
                    .scard(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SCARD failed: {}", e)))?;
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
                let count: u64 = c
                    .zadd(key, None, None, false, false, (score, member))
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("ZADD failed: {}", e)))?;
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
                let count: u64 = c
                    .zcard(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("ZCARD failed: {}", e)))?;
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
                let score: Option<f64> = c
                    .zscore(key, member)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("ZSCORE failed: {}", e)))?;
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
                let key_type: String = c
                    .r#type(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("TYPE failed: {}", e)))?;
                Ok(key_type)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    fn string_to_redis_type(s: &str) -> RedisType {
        match s.to_lowercase().as_str() {
            "string" => RedisType::String,
            "list" => RedisType::List,
            "set" => RedisType::Set,
            "zset" => RedisType::ZSet,
            "hash" => RedisType::Hash,
            "stream" => RedisType::Stream,
            _ => RedisType::Unknown,
        }
    }

    fn parse_redis_info(info_str: &str, section: Option<&str>) -> HashMap<String, String> {
        let mut result = HashMap::new();
        let mut current_section = String::new();

        for line in info_str.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if line.starts_with('#') {
                current_section = line.trim_start_matches('#').trim().to_lowercase();
                continue;
            }
            if let Some(filter_section) = section {
                if !current_section.eq_ignore_ascii_case(filter_section) {
                    continue;
                }
            }
            if let Some((key, value)) = line.split_once(':') {
                result.insert(key.to_string(), value.to_string());
            }
        }
        result
    }
}

#[async_trait]
impl KeyValueOperable for RedisAdapter {
    async fn get_key(&self, key: &str) -> Result<Option<RedisValue>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let value: Option<String> = c
                    .get(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("GET failed: {}", e)))?;
                Ok(value.map(RedisValue::String))
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn set_key(
        &self,
        key: &str,
        value: RedisValue,
        options: SetOptions,
    ) -> Result<(), AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let str_value = match value {
                    RedisValue::String(s) => s,
                    RedisValue::Integer(i) => i.to_string(),
                    RedisValue::Float(f) => f.to_string(),
                    RedisValue::Boolean(b) => if b { "1" } else { "0" }.to_string(),
                    RedisValue::Nil => return Ok(()),
                    _ => {
                        return Err(AppError::InvalidInput(
                            "Cannot SET complex values directly".to_string(),
                        ))
                    }
                };

                let expiration = options.ttl_seconds.map(|s| Expiration::EX(s as i64));
                let set_options = if options.nx {
                    Some(FredSetOptions::NX)
                } else if options.xx {
                    Some(FredSetOptions::XX)
                } else {
                    None
                };

                c.set::<(), _, _>(key, str_value.as_str(), expiration, set_options, false)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SET failed: {}", e)))?;
                Ok(())
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn delete_keys(&self, keys: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                if keys.is_empty() {
                    return Ok(0);
                }
                let count: u64 = c
                    .del(keys.to_vec())
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("DEL failed: {}", e)))?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn key_exists(&self, keys: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                if keys.is_empty() {
                    return Ok(0);
                }
                let count: u64 = c
                    .exists(keys.to_vec())
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("EXISTS failed: {}", e)))?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn scan_keys(
        &self,
        pattern: &str,
        cursor: u64,
        count: u32,
    ) -> Result<ScanResult, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let cursor_str = cursor.to_string();
                let (new_cursor, scanned_keys): (String, Vec<fred::types::Key>) = c
                    .scan_page(cursor_str, pattern, Some(count), None)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SCAN failed: {}", e)))?;

                if scanned_keys.is_empty() {
                    let new_cursor_u64 = new_cursor.parse().unwrap_or(0);
                    return Ok(ScanResult {
                        cursor: new_cursor_u64,
                        keys: vec![],
                    });
                }

                // Pipeline TYPE + TTL for all keys in a single round-trip
                let pipeline = c.pipeline();
                for key in &scanned_keys {
                    let key_str = key.as_str_lossy();
                    let _: () = pipeline.r#type(key_str.as_ref()).await.map_err(|e| {
                        AppError::DatabaseError(format!("Pipeline TYPE failed: {}", e))
                    })?;
                    let _: () = pipeline.ttl(key_str.as_ref()).await.map_err(|e| {
                        AppError::DatabaseError(format!("Pipeline TTL failed: {}", e))
                    })?;
                }
                let results: Vec<fred::types::Value> = pipeline.all().await.map_err(|e| {
                    AppError::DatabaseError(format!("Pipeline execute failed: {}", e))
                })?;

                // Results alternate: [type0, ttl0, type1, ttl1, ...]
                let mut keys = Vec::with_capacity(scanned_keys.len());
                for (i, key) in scanned_keys.iter().enumerate() {
                    let key_str = key.as_str_lossy().to_string();
                    let type_val = results.get(i * 2);
                    let ttl_val = results.get(i * 2 + 1);

                    let key_type_str = type_val
                        .and_then(|v| v.as_str().map(|s| s.to_string()))
                        .unwrap_or_else(|| "unknown".to_string());
                    let ttl = ttl_val.and_then(|v| v.as_i64()).unwrap_or(-1);

                    keys.push(KeyInfo {
                        key: key_str,
                        key_type: Self::string_to_redis_type(&key_type_str),
                        ttl,
                        size_bytes: None,
                    });
                }

                let new_cursor_u64 = new_cursor.parse().unwrap_or(0);
                Ok(ScanResult {
                    cursor: new_cursor_u64,
                    keys,
                })
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn get_key_type(&self, key: &str) -> Result<RedisType, AppError> {
        let type_str = self.key_type(key).await?;
        Ok(Self::string_to_redis_type(&type_str))
    }

    async fn get_key_ttl(&self, key: &str) -> Result<i64, AppError> {
        self.key_ttl(key).await
    }

    async fn set_key_ttl(&self, key: &str, seconds: u64) -> Result<bool, AppError> {
        RedisAdapter::set_key_ttl(self, key, seconds).await
    }

    async fn execute_raw(&self, command: &str, args: &[String]) -> Result<RedisValue, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let result: fred::types::Value = c
                    .custom(fred::cmd!(command), args.to_vec())
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Command failed: {}", e)))?;

                Ok(Self::fred_value_to_redis_value(result))
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn get_database_size(&self) -> Result<u64, AppError> {
        self.dbsize().await
    }

    async fn select_database(&self, index: u8) -> Result<(), AppError> {
        self.select_db(index).await
    }

    async fn get_server_info(
        &self,
        section: Option<&str>,
    ) -> Result<HashMap<String, String>, AppError> {
        let info_str = self.get_server_info_raw().await?;
        Ok(Self::parse_redis_info(&info_str, section))
    }

    async fn scan_keys_with_previews(
        &self,
        pattern: &str,
        cursor: u64,
        count: u32,
    ) -> Result<ScanResultWithPreviews, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                // Lua script: SCAN + TYPE + TTL + value preview in a single round-trip.
                // Returns: { cursor, { {key, type, ttl, preview}, ... } }
                //
                // For complex types, the preview is cjson-encoded on the server so we
                // get a ready-to-use JSON string without extra parsing round-trips.
                let script = r#"
local cursor, keys = unpack(redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3]))
local results = {}
for i, key in ipairs(keys) do
    local t = redis.call('TYPE', key)['ok']
    local ttl = redis.call('TTL', key)
    local preview
    if t == 'string' then
        local v = redis.call('GET', key)
        if v == false then preview = '(nil)' else preview = tostring(v) end
    elseif t == 'hash' then
        local h = redis.call('HGETALL', key)
        local obj = {}
        for j = 1, #h, 2 do obj[h[j]] = h[j+1] end
        preview = cjson.encode(obj)
    elseif t == 'list' then
        preview = cjson.encode(redis.call('LRANGE', key, 0, 99))
    elseif t == 'set' then
        preview = cjson.encode(redis.call('SMEMBERS', key))
    elseif t == 'zset' then
        local raw = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
        local arr = {}
        for j = 1, #raw, 2 do
            arr[#arr+1] = {member = raw[j], score = tonumber(raw[j+1])}
        end
        preview = cjson.encode(arr)
    elseif t == 'stream' then
        local raw = redis.call('XRANGE', key, '-', '+', 'COUNT', 100)
        local arr = {}
        for j, entry in ipairs(raw) do
            local fields = {}
            for k = 1, #entry[2], 2 do fields[entry[2][k]] = entry[2][k+1] end
            arr[j] = {id = entry[1], fields = fields}
        end
        preview = cjson.encode(arr)
    else
        preview = '(' .. t .. ')'
    end
    results[i] = {key, t, ttl, preview}
end
return {cursor, results}
"#;

                let result: fred::types::Value = c
                    .eval(
                        script,
                        Vec::<String>::new(), // no KEYS - SCAN uses ARGV
                        vec![cursor.to_string(), pattern.to_string(), count.to_string()],
                    )
                    .await
                    .map_err(|e| {
                        AppError::DatabaseError(format!("EVAL scan_with_previews failed: {}", e))
                    })?;

                Self::parse_lua_scan_result(result)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }
}

impl RedisAdapter {
    /// Parse the Lua script result: [cursor, [[key, type, ttl, preview], ...]]
    fn parse_lua_scan_result(
        value: fred::types::Value,
    ) -> Result<ScanResultWithPreviews, AppError> {
        let arr = match value {
            fred::types::Value::Array(a) => a,
            _ => {
                return Err(AppError::DatabaseError(
                    "Unexpected EVAL result format".to_string(),
                ))
            }
        };

        if arr.len() < 2 {
            return Err(AppError::DatabaseError("EVAL result too short".to_string()));
        }

        let cursor = arr[0].as_u64().unwrap_or(0);

        let key_entries = match &arr[1] {
            fred::types::Value::Array(entries) => entries,
            _ => {
                return Ok(ScanResultWithPreviews {
                    cursor,
                    keys: vec![],
                })
            }
        };

        let mut keys = Vec::with_capacity(key_entries.len());
        for entry in key_entries {
            if let fred::types::Value::Array(fields) = entry {
                if fields.len() >= 4 {
                    let key = fields[0]
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                    let type_str = fields[1]
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "unknown".to_string());
                    let ttl = fields[2].as_i64().unwrap_or(-1);
                    let preview = fields[3]
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_default();

                    keys.push(KeyInfoWithPreview {
                        key,
                        key_type: Self::string_to_redis_type(&type_str),
                        ttl,
                        size_bytes: None,
                        preview,
                    });
                }
            }
        }

        Ok(ScanResultWithPreviews { cursor, keys })
    }

    fn fred_value_to_redis_value(value: fred::types::Value) -> RedisValue {
        match value {
            fred::types::Value::Null => RedisValue::Nil,
            fred::types::Value::Boolean(b) => RedisValue::Boolean(b),
            fred::types::Value::Integer(i) => RedisValue::Integer(i),
            fred::types::Value::Double(f) => RedisValue::Float(f),
            fred::types::Value::String(s) => RedisValue::String(s.to_string()),
            fred::types::Value::Bytes(b) => RedisValue::Bytes(b.to_vec()),
            fred::types::Value::Array(arr) => RedisValue::Array(
                arr.into_iter()
                    .map(Self::fred_value_to_redis_value)
                    .collect(),
            ),
            fred::types::Value::Map(map) => {
                let mut result = HashMap::new();
                for (k, v) in map.inner() {
                    let key = k.as_str_lossy().to_string();
                    result.insert(key, Self::fred_value_to_redis_value(v));
                }
                RedisValue::Map(result)
            }
            fred::types::Value::Queued => RedisValue::String("QUEUED".to_string()),
        }
    }

}

#[async_trait]
impl RichKeyValueOperable for RedisAdapter {
    async fn hash_get_all(&self, key: &str) -> Result<HashMap<String, String>, AppError> {
        RedisAdapter::hash_get_all(self, key).await
    }

    async fn hash_set(&self, key: &str, fields: HashMap<String, String>) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let pairs: Vec<(&String, &String)> = fields.iter().collect();
                let count: u64 = c
                    .hset(key, pairs)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("HSET failed: {}", e)))?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn hash_delete(&self, key: &str, fields: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                if fields.is_empty() {
                    return Ok(0);
                }
                let count: u64 = c
                    .hdel(key, fields.to_vec())
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("HDEL failed: {}", e)))?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn list_range(&self, key: &str, start: i64, stop: i64) -> Result<Vec<String>, AppError> {
        RedisAdapter::list_range(self, key, start, stop).await
    }

    async fn list_push(
        &self,
        key: &str,
        values: &[String],
        side: ListSide,
    ) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                if values.is_empty() {
                    return Ok(0);
                }
                let count: u64 = match side {
                    ListSide::Left => c.lpush(key, values.to_vec()).await,
                    ListSide::Right => c.rpush(key, values.to_vec()).await,
                }
                .map_err(|e| AppError::DatabaseError(format!("LPUSH/RPUSH failed: {}", e)))?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn list_len(&self, key: &str) -> Result<u64, AppError> {
        RedisAdapter::list_len(self, key).await
    }

    async fn set_members(&self, key: &str) -> Result<Vec<String>, AppError> {
        RedisAdapter::set_members(self, key).await
    }

    async fn set_add(&self, key: &str, members: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                if members.is_empty() {
                    return Ok(0);
                }
                let count: u64 = c
                    .sadd(key, members.to_vec())
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SADD failed: {}", e)))?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn set_remove(&self, key: &str, members: &[String]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                if members.is_empty() {
                    return Ok(0);
                }
                let count: u64 = c
                    .srem(key, members.to_vec())
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("SREM failed: {}", e)))?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn zset_range(
        &self,
        key: &str,
        start: i64,
        stop: i64,
        with_scores: bool,
    ) -> Result<Vec<ZSetMember>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                if with_scores {
                    let result: Vec<(String, f64)> = c
                        .zrange(key, start, stop, None, false, None, true)
                        .await
                        .map_err(|e| AppError::DatabaseError(format!("ZRANGE failed: {}", e)))?;
                    Ok(result
                        .into_iter()
                        .map(|(member, score)| ZSetMember { member, score })
                        .collect())
                } else {
                    let members: Vec<String> = c
                        .zrange(key, start, stop, None, false, None, false)
                        .await
                        .map_err(|e| AppError::DatabaseError(format!("ZRANGE failed: {}", e)))?;
                    Ok(members
                        .into_iter()
                        .map(|member| ZSetMember { member, score: 0.0 })
                        .collect())
                }
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn zset_add(&self, key: &str, members: &[ZSetMember]) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                if members.is_empty() {
                    return Ok(0);
                }
                let pairs: Vec<(f64, &str)> = members
                    .iter()
                    .map(|m| (m.score, m.member.as_str()))
                    .collect();
                let count: u64 = c
                    .zadd(key, None, None, false, false, pairs)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("ZADD failed: {}", e)))?;
                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn stream_range(
        &self,
        key: &str,
        start: &str,
        end: &str,
        count: Option<u32>,
    ) -> Result<Vec<StreamEntry>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let result: Vec<(String, HashMap<String, String>)> = c
                    .xrange(key, start, end, count.map(|c| c as u64))
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("XRANGE failed: {}", e)))?;

                Ok(result
                    .into_iter()
                    .map(|(id, fields)| StreamEntry { id, fields })
                    .collect())
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    async fn stream_len(&self, key: &str) -> Result<u64, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let len: u64 = c
                    .xlen(key)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("XLEN failed: {}", e)))?;
                Ok(len)
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
            safe_mode: None,
        };

        let config = RedisAdapter::build_config(&profile);
        assert!(config.is_ok());
    }

    #[tokio::test]
    async fn test_select_db_requires_connection() {
        let adapter = RedisAdapter::new();
        let result = adapter.select_db(2).await;
        assert!(result.is_err(), "select_db should fail when not connected");
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
            safe_mode: None,
        };

        let adapter = RedisAdapter::new();
        adapter
            .connect(&profile)
            .await
            .expect("Failed to connect to Redis");

        adapter
            .select_db(2)
            .await
            .expect("select_db should succeed");
        assert_eq!(adapter.current_database().await, 2);

        let test_key = format!(
            "__test_select_db_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        adapter
            .set_string(&test_key, "test_value", None)
            .await
            .expect("SET should work");

        adapter
            .select_db(0)
            .await
            .expect("select_db to 0 should succeed");
        let result = adapter
            .get_string(&test_key)
            .await
            .expect("GET should work");
        assert!(result.is_none(), "Key set in db2 should not exist in db0");

        adapter.select_db(2).await.expect("select_db back to 2");
        let result = adapter
            .get_string(&test_key)
            .await
            .expect("GET should work");
        assert_eq!(result, Some("test_value".to_string()));

        adapter.delete_key(&test_key).await.expect("cleanup");
        adapter.disconnect().await.expect("disconnect");
    }
}
