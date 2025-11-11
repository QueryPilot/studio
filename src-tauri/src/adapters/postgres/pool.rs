use deadpool_postgres::{ManagerConfig, Pool, RecyclingMethod, Runtime};
use std::time::Duration;
use tokio_postgres::tls::{MakeTlsConnect, TlsConnect};
use tokio_postgres::Config;
use tokio_postgres::Socket;

pub struct PostgresPoolBuilder {
    pool_size: usize,
}

impl Default for PostgresPoolBuilder {
    fn default() -> Self {
        Self {
            pool_size: 50, // Max 50 connections per window for concurrent introspection + streaming queries
        }
    }
}

impl PostgresPoolBuilder {
    pub fn build<T>(self, pg_config: Config, tls: T) -> Result<Pool, String>
    where
        T: MakeTlsConnect<Socket> + Clone + Send + Sync + 'static,
        T::Stream: Send + Sync,
        T::TlsConnect: Send + Sync,
        <T::TlsConnect as TlsConnect<Socket>>::Future: Send,
    {
        let mgr_config = ManagerConfig {
            recycling_method: RecyclingMethod::Fast, // Quickly recycle connections
        };
        let mgr = deadpool_postgres::Manager::from_config(pg_config, tls, mgr_config);

        // Build pool with proper timeouts to prevent crashes and memory leaks
        let pool = Pool::builder(mgr)
            .max_size(self.pool_size)
            .wait_timeout(Some(Duration::from_secs(5))) // Wait max 5s for available connection
            .create_timeout(Some(Duration::from_secs(10))) // Create new connection timeout
            .recycle_timeout(Some(Duration::from_secs(1))) // Health check timeout
            .runtime(Runtime::Tokio1)
            .build()
            .map_err(|e| format!("Failed to build pool: {}", e))?;

        Ok(pool)
    }
}
