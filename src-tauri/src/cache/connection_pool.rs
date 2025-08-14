use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::AnyPool;
use std::time::Duration;

/// Connection pool configuration
#[derive(Debug, Clone)]
pub struct PoolConfig {
    pub max_connections: u32,
    pub min_connections: u32,
    pub connection_timeout: Duration,
    pub idle_timeout: Duration,
    pub max_lifetime: Duration,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            max_connections: 10,
            min_connections: 1,
            connection_timeout: Duration::from_secs(30),
            idle_timeout: Duration::from_secs(600), // 10 minutes
            max_lifetime: Duration::from_secs(1800), // 30 minutes
        }
    }
}

/// Manages database connection pools for performance
pub struct ConnectionPool {
    pools: Arc<RwLock<HashMap<String, AnyPool>>>,
    config: PoolConfig,
}

impl ConnectionPool {
    pub fn new(config: PoolConfig) -> Self {
        Self {
            pools: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    /// Get or create a connection pool for the given connection
    pub async fn get_pool(
        &self,
        connection_id: &str,
        database_url: &str,
    ) -> Result<AnyPool, Box<dyn std::error::Error>> {
        // Check if pool already exists
        {
            let pools = self.pools.read().await;
            if let Some(pool) = pools.get(connection_id) {
                // Verify pool is still healthy
                if !pool.is_closed() {
                    return Ok(pool.clone());
                }
            }
        }

        // Create new pool
        let pool = self.create_pool(database_url).await?;
        
        // Store in cache
        {
            let mut pools = self.pools.write().await;
            pools.insert(connection_id.to_string(), pool.clone());
        }
        
        Ok(pool)
    }

    /// Create a new connection pool with optimized settings
    async fn create_pool(&self, database_url: &str) -> Result<AnyPool, Box<dyn std::error::Error>> {
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(self.config.max_connections)
            .min_connections(self.config.min_connections)
            .acquire_timeout(self.config.connection_timeout)
            .idle_timeout(Some(self.config.idle_timeout))
            .max_lifetime(Some(self.config.max_lifetime))
            .connect(database_url)
            .await?;
        
        Ok(pool)
    }

    /// Close a specific connection pool
    pub async fn close_pool(&self, connection_id: &str) {
        let mut pools = self.pools.write().await;
        if let Some(pool) = pools.remove(connection_id) {
            pool.close().await;
        }
    }

    /// Close all connection pools
    pub async fn close_all(&self) {
        let mut pools = self.pools.write().await;
        for (_, pool) in pools.drain() {
            pool.close().await;
        }
    }

    /// Get pool statistics
    pub async fn get_stats(&self, connection_id: &str) -> Option<PoolStats> {
        let pools = self.pools.read().await;
        
        pools.get(connection_id).map(|pool| {
            PoolStats {
                size: pool.size() as usize,
                idle_connections: pool.num_idle() as usize,
                max_connections: self.config.max_connections as usize,
                is_closed: pool.is_closed(),
            }
        })
    }

    /// Clean up idle connections across all pools
    pub async fn cleanup_idle(&self) {
        let pools = self.pools.read().await;
        let mut closed_pools = Vec::new();
        
        for (id, pool) in pools.iter() {
            if pool.is_closed() {
                closed_pools.push(id.clone());
            }
        }
        
        drop(pools); // Release read lock
        
        // Remove closed pools
        if !closed_pools.is_empty() {
            let mut pools = self.pools.write().await;
            for id in closed_pools {
                pools.remove(&id);
            }
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct PoolStats {
    pub size: usize,
    pub idle_connections: usize,
    pub max_connections: usize,
    pub is_closed: bool,
}

/// Background task to periodically clean up idle connections
pub async fn start_pool_maintenance(pool_manager: Arc<ConnectionPool>) {
    let mut interval = tokio::time::interval(Duration::from_secs(60)); // Check every minute
    
    loop {
        interval.tick().await;
        pool_manager.cleanup_idle().await;
    }
}