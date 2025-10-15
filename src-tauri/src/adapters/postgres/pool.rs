use deadpool_postgres::{Config as PoolConfig, Pool, Runtime, ManagerConfig, RecyclingMethod};
use std::time::Duration;
use tokio_postgres::Config;

pub struct PostgresPoolBuilder {
    pool_size: usize,
    idle_timeout: Duration,
    max_lifetime: Duration,
}

impl Default for PostgresPoolBuilder {
    fn default() -> Self {
        Self {
            pool_size: 10,                             // Max 10 connections per window (increased for concurrent queries)
            idle_timeout: Duration::from_secs(15 * 60), // 15 minutes (configurable)
            max_lifetime: Duration::from_secs(60 * 60), // 1 hour max lifetime
        }
    }
}

impl PostgresPoolBuilder {
    pub fn with_idle_timeout(mut self, timeout: Duration) -> Self {
        self.idle_timeout = timeout;
        self
    }

    pub fn build(self, pg_config: Config) -> Result<Pool, String> {
        let mgr_config = ManagerConfig {
            recycling_method: RecyclingMethod::Fast, // Quickly recycle connections
        };
        let mgr = deadpool_postgres::Manager::from_config(pg_config, tokio_postgres::NoTls, mgr_config);
        
        // Build pool with proper timeouts to prevent crashes and memory leaks
        let pool = Pool::builder(mgr)
            .max_size(self.pool_size)
            .wait_timeout(Some(Duration::from_secs(5)))    // Wait max 5s for available connection
            .create_timeout(Some(Duration::from_secs(10))) // Create new connection timeout
            .recycle_timeout(Some(Duration::from_secs(1))) // Health check timeout
            .runtime(Runtime::Tokio1)
            .build()
            .map_err(|e| format!("Failed to build pool: {}", e))?;
        
        Ok(pool)
    }
}

