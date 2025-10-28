use dashmap::DashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

use crate::adapters::postgres::PostgresAdapter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct ConnectionManager {
    connections: Arc<DashMap<String, LiveConnection>>,
    // Store profiles separately so we can reconnect after reaper removes connection
    profiles: Arc<DashMap<String, ConnectionProfile>>,
    #[allow(dead_code)]
    queries: Arc<DashMap<String, QueryHandle>>,
    idle_timeout: Duration,
    reaper_handle: Arc<tokio::sync::Mutex<Option<JoinHandle<()>>>>,
    total_connections: Arc<AtomicUsize>,
}

pub struct LiveConnection {
    #[allow(dead_code)]
    pub id: String,
    pub adapter: Box<dyn crate::core::adapter::DbAdapter>,
    pub profile: ConnectionProfile,
    #[allow(dead_code)]
    pub created_at: Instant,
    pub last_used: Arc<RwLock<Instant>>,
    #[allow(dead_code)]
    pub query_count: Arc<AtomicUsize>,
    pub active_queries: Arc<AtomicUsize>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            profiles: Arc::new(DashMap::new()),
            queries: Arc::new(DashMap::new()),
            idle_timeout: Duration::from_secs(1800), // 30 minutes
            reaper_handle: Arc::new(tokio::sync::Mutex::new(None)),
            total_connections: Arc::new(AtomicUsize::new(0)),
        }
    }

    async fn start_reaper_internal(&self) {
        let mut reaper_guard = self.reaper_handle.lock().await;
        if reaper_guard.is_some() {
            return; // Already running
        }

        let connections = self.connections.clone();
        let idle_timeout = self.idle_timeout;

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));

            loop {
                interval.tick().await;

                let now = Instant::now();
                let mut to_remove = Vec::new();

                for entry in connections.iter() {
                    let last_used = *entry.last_used.read().await;
                    let active_queries = entry.active_queries.load(Ordering::SeqCst);

                    // Only remove if idle and no active queries
                    if active_queries == 0 && now.duration_since(last_used) > idle_timeout {
                        to_remove.push(entry.key().clone());
                    }
                }

                for key in to_remove {
                    if let Some((_, mut conn)) = connections.remove(&key) {
                        let _ = conn.adapter.disconnect().await;
                    }
                }
            }
        });

        *reaper_guard = Some(handle);
    }

    pub async fn get_or_create_connection(&self, profile: &ConnectionProfile) -> Result<String> {
        // Source of truth for connection identity is the profile.id provided by the frontend
        let conn_id = profile.id.clone();

        if conn_id.is_empty() {
            return Err(AppError::internal(
                "Connection profile id must not be empty",
            ));
        }

        // Check if connection exists. If it does but the adapter is no longer connected,
        // attempt a transparent reconnect to heal broken sessions after reloads/network hiccups.
        if let Some(mut entry) = self.connections.get_mut(&conn_id) {
            *entry.last_used.write().await = Instant::now();

            if !entry.adapter.is_connected().await {
                // Reconnect in-place; adapter.connect should cleanly reset any prior state
                entry.adapter.connect(profile).await?;
            }

            return Ok(conn_id);
        }

        // Start reaper on first connection if not already running
        if self.connections.is_empty() {
            self.start_reaper_internal().await;
        }

        // Create new connection
        let mut adapter = self.create_adapter(profile)?;
        adapter.connect(profile).await?;

        let live_conn = LiveConnection {
            id: conn_id.clone(),
            adapter,
            profile: profile.clone(),
            created_at: Instant::now(),
            last_used: Arc::new(RwLock::new(Instant::now())),
            query_count: Arc::new(AtomicUsize::new(0)),
            active_queries: Arc::new(AtomicUsize::new(0)),
        };

        self.connections.insert(conn_id.clone(), live_conn);
        // Store profile separately for reconnection after reaper
        self.profiles.insert(conn_id.clone(), profile.clone());
        self.total_connections.fetch_add(1, Ordering::SeqCst);
        Ok(conn_id)
    }

    pub fn get_connection(
        &self,
        conn_id: &str,
    ) -> Option<impl std::ops::Deref<Target = LiveConnection> + '_> {
        self.connections.get(conn_id)
    }

    /// Touch connection to update last_used timestamp (prevents idle timeout)
    pub async fn touch_connection(&self, conn_id: &str) -> Result<()> {
        if let Some(entry) = self.connections.get(conn_id) {
            *entry.last_used.write().await = Instant::now();
            Ok(())
        } else {
            Err(AppError::internal(format!(
                "Connection {} not found",
                conn_id
            )))
        }
    }

    /// Get connection with automatic retry and reconnect
    /// If connection is not found, attempts to reconnect using stored profile
    pub async fn get_connection_with_retry(
        &self,
        conn_id: &str,
        max_retries: usize,
    ) -> Result<impl std::ops::Deref<Target = LiveConnection> + '_> {
        for attempt in 0..max_retries {
            // Try to get existing connection
            if let Some(conn) = self.connections.get(conn_id) {
                // Update timestamp to prevent idle timeout
                *conn.last_used.write().await = Instant::now();
                return Ok(conn);
            }

            // Connection not found, try to reconnect
            if attempt < max_retries - 1 {
                tracing::info!(
                    "Connection {} not found, attempting reconnect (attempt {}/{})",
                    conn_id,
                    attempt + 1,
                    max_retries
                );

                // Get stored profile (stored separately from connection for reconnection)
                let profile = self
                    .profiles
                    .get(conn_id)
                    .map(|p| p.clone())
                    .ok_or_else(|| {
                        AppError::internal(format!(
                            "Cannot reconnect: profile for connection {} not found",
                            conn_id
                        ))
                    })?;

                // Try to reconnect
                match self.get_or_create_connection(&profile).await {
                    Ok(_) => {
                        // Exponential backoff: 100ms, 500ms, 1000ms
                        let delay_ms = match attempt {
                            0 => 100,
                            1 => 500,
                            _ => 1000,
                        };
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        continue;
                    }
                    Err(e) => {
                        tracing::warn!("Reconnect attempt {} failed: {}", attempt + 1, e);
                        // Continue to next retry
                    }
                }
            }
        }

        // All retries exhausted
        Err(AppError::internal(format!(
            "Connection {} not found after {} retries",
            conn_id, max_retries
        )))
    }

    pub async fn disconnect(&self, conn_id: &str) -> Result<()> {
        if let Some((_, mut conn)) = self.connections.remove(conn_id) {
            conn.adapter.disconnect().await?;
            self.total_connections.fetch_sub(1, Ordering::SeqCst);
        }
        // Also remove stored profile
        self.profiles.remove(conn_id);
        Ok(())
    }

    pub async fn disconnect_all(&self) -> Result<()> {
        let keys: Vec<String> = self
            .connections
            .iter()
            .map(|entry| entry.key().clone())
            .collect();

        for key in keys {
            self.disconnect(&key).await?;
        }

        Ok(())
    }

    fn create_adapter(
        &self,
        profile: &ConnectionProfile,
    ) -> Result<Box<dyn crate::core::adapter::DbAdapter>> {
        match profile.db_type {
            DbType::PostgreSQL => Ok(Box::new(PostgresAdapter::new())),
            _ => Err(AppError::unsupported("Database type not supported yet")),
        }
    }

    #[allow(dead_code)]
    pub fn get_connection_stats(&self, conn_id: &str) -> Option<ConnectionStats> {
        self.connections.get(conn_id).map(|conn| ConnectionStats {
            query_count: conn.query_count.load(Ordering::SeqCst),
            active_queries: conn.active_queries.load(Ordering::SeqCst),
            created_at: conn.created_at,
            last_used: conn
                .last_used
                .try_read()
                .map(|t| *t)
                .unwrap_or(conn.created_at),
        })
    }

    #[allow(dead_code)]
    pub fn get_all_stats(&self) -> ManagerStats {
        let total_connections = self.total_connections.load(Ordering::SeqCst);
        let active_connections = self.connections.len();
        let total_queries = self.queries.len();

        ManagerStats {
            total_connections,
            active_connections,
            total_queries,
        }
    }
}

impl Drop for ConnectionManager {
    fn drop(&mut self) {
        // Note: We can't properly clean up the async handle in Drop
        // The handle will be aborted when the runtime shuts down
    }
}
