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
            pool_size: 3,                              // Max 3 connections per window
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
        let mgr = deadpool_postgres::Manager::new(pg_config, tokio_postgres::NoTls);
        
        let pool = Pool::builder(mgr)
            .max_size(self.pool_size)
            .build()
            .map_err(|e| format!("Failed to build pool: {}", e))?;
        
        Ok(pool)
    }
}

