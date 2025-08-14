use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use zeroize::Zeroize;
use crate::storage::models::SecureConnectionConfig;

/// Time-limited in-memory cache for decrypted credentials
/// Automatically expires entries after a configurable duration
#[derive(Debug, Clone)]
struct CachedCredential {
    config: SecureConnectionConfig,
    expires_at: Instant,
}

impl Drop for CachedCredential {
    fn drop(&mut self) {
        // Zeroize sensitive data when dropped
        if let Some(password) = &mut self.config.password {
            password.zeroize();
        }
    }
}

pub struct CredentialCache {
    cache: Arc<RwLock<HashMap<String, CachedCredential>>>,
    ttl: Duration,
    max_entries: usize,
}

impl CredentialCache {
    /// Create a new credential cache with specified TTL and max entries
    pub fn new(ttl_seconds: u64, max_entries: usize) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            ttl: Duration::from_secs(ttl_seconds),
            max_entries,
        }
    }

    /// Store a credential in the cache
    pub fn store(&self, connection_id: &str, config: SecureConnectionConfig) {
        let mut cache = self.cache.write().unwrap();
        
        // Enforce max entries limit - remove oldest if at capacity
        if cache.len() >= self.max_entries {
            // Find and remove the entry closest to expiration
            if let Some(oldest_key) = cache
                .iter()
                .min_by_key(|(_, v)| v.expires_at)
                .map(|(k, _)| k.clone())
            {
                cache.remove(&oldest_key);
            }
        }

        let cached = CachedCredential {
            config,
            expires_at: Instant::now() + self.ttl,
        };
        
        cache.insert(connection_id.to_string(), cached);
    }

    /// Retrieve a credential from the cache if not expired
    pub fn get(&self, connection_id: &str) -> Option<SecureConnectionConfig> {
        let mut cache = self.cache.write().unwrap();
        
        // Check if entry exists and is not expired
        if let Some(cached) = cache.get(connection_id) {
            if Instant::now() < cached.expires_at {
                // Clone the config to return
                return Some(cached.config.clone());
            } else {
                // Remove expired entry
                cache.remove(connection_id);
            }
        }
        
        None
    }

    /// Invalidate a specific cache entry
    pub fn invalidate(&self, connection_id: &str) {
        let mut cache = self.cache.write().unwrap();
        cache.remove(connection_id);
    }

    /// Clear all cached credentials
    pub fn clear(&self) {
        let mut cache = self.cache.write().unwrap();
        cache.clear();
    }

    /// Clean up expired entries
    pub fn cleanup_expired(&self) {
        let mut cache = self.cache.write().unwrap();
        let now = Instant::now();
        
        cache.retain(|_, cached| now < cached.expires_at);
    }

    /// Get cache statistics
    pub fn stats(&self) -> CacheStats {
        let cache = self.cache.read().unwrap();
        let now = Instant::now();
        
        let expired_count = cache
            .values()
            .filter(|cached| now >= cached.expires_at)
            .count();
        
        CacheStats {
            total_entries: cache.len(),
            expired_entries: expired_count,
            active_entries: cache.len() - expired_count,
            max_entries: self.max_entries,
            ttl_seconds: self.ttl.as_secs(),
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct CacheStats {
    pub total_entries: usize,
    pub expired_entries: usize,
    pub active_entries: usize,
    pub max_entries: usize,
    pub ttl_seconds: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_cache_expiration() {
        let cache = CredentialCache::new(1, 10); // 1 second TTL
        
        let config = SecureConnectionConfig {
            name: "test".to_string(),
            host: "localhost".to_string(),
            port: 5432,
            username: "user".to_string(),
            password: Some("password".to_string()),
            database: Some("testdb".to_string()),
            connection_type: "postgresql".to_string(),
        };
        
        cache.store("test-id", config.clone());
        
        // Should retrieve immediately
        assert!(cache.get("test-id").is_some());
        
        // Wait for expiration
        thread::sleep(Duration::from_secs(2));
        
        // Should be expired now
        assert!(cache.get("test-id").is_none());
    }

    #[test]
    fn test_max_entries_limit() {
        let cache = CredentialCache::new(60, 2); // Max 2 entries
        
        let config1 = SecureConnectionConfig {
            name: "test1".to_string(),
            host: "localhost".to_string(),
            port: 5432,
            username: "user1".to_string(),
            password: Some("pass1".to_string()),
            database: Some("db1".to_string()),
            connection_type: "postgresql".to_string(),
        };
        
        let config2 = config1.clone();
        let config3 = config1.clone();
        
        cache.store("id1", config1);
        cache.store("id2", config2);
        cache.store("id3", config3); // Should evict oldest
        
        let stats = cache.stats();
        assert_eq!(stats.active_entries, 2);
    }
}