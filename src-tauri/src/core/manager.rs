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
    queries: Arc<DashMap<String, QueryHandle>>,
    idle_timeout: Duration,
    reaper_handle: Arc<tokio::sync::Mutex<Option<JoinHandle<()>>>>,
    total_connections: Arc<AtomicUsize>,
}

pub struct LiveConnection {
    pub id: String,
    pub adapter: Box<dyn crate::core::adapter::DbAdapter>,
    pub profile: ConnectionProfile,
    pub created_at: Instant,
    pub last_used: Arc<RwLock<Instant>>,
    pub query_count: Arc<AtomicUsize>,
    pub active_queries: Arc<AtomicUsize>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            queries: Arc::new(DashMap::new()),
            idle_timeout: Duration::from_secs(600), // 10 minutes
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
            return Err(AppError::internal("Connection profile id must not be empty"));
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
        self.total_connections.fetch_add(1, Ordering::SeqCst);
        Ok(conn_id)
    }

    pub fn get_connection(
        &self,
        conn_id: &str,
    ) -> Option<impl std::ops::Deref<Target = LiveConnection> + '_> {
        self.connections.get(conn_id)
    }

    pub async fn disconnect(&self, conn_id: &str) -> Result<()> {
        if let Some((_, mut conn)) = self.connections.remove(conn_id) {
            conn.adapter.disconnect().await?;
            self.total_connections.fetch_sub(1, Ordering::SeqCst);
        }
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

    pub async fn register_query(&self, conn_id: &str, query_handle: QueryHandle) -> Result<String> {
        let query_id = query_handle.id.clone();

        if let Some(conn) = self.connections.get(conn_id) {
            conn.query_count.fetch_add(1, Ordering::SeqCst);
            conn.active_queries.fetch_add(1, Ordering::SeqCst);
            *conn.last_used.write().await = Instant::now();
        }

        self.queries.insert(query_id.clone(), query_handle);
        Ok(query_id)
    }

    pub fn complete_query(&self, conn_id: &str, query_id: &str) {
        if let Some(conn) = self.connections.get(conn_id) {
            conn.active_queries.fetch_sub(1, Ordering::SeqCst);
        }
        self.queries.remove(query_id);
    }

    pub fn get_query(
        &self,
        query_id: &str,
    ) -> Option<impl std::ops::Deref<Target = QueryHandle> + '_> {
        self.queries.get(query_id)
    }

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
