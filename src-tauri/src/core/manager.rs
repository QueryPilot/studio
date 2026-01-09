use dashmap::{DashMap, DashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Notify, RwLock};
use tokio::task::JoinHandle;

use crate::adapters::mssql::MssqlAdapter;
use crate::adapters::mysql::MySqlAdapter;
use crate::adapters::postgres::PostgresAdapter;
use crate::adapters::sqlite::SqliteAdapter;
use crate::error::{AppError, Result};
use crate::ssh::secrets::delete_ssh_passphrase;
use crate::ssh::SshTunnel;
use crate::types::*;

enum ManagedTunnel {
    Ssh(SshTunnel),
}

impl ManagedTunnel {
    fn local_port(&self) -> u16 {
        match self {
            Self::Ssh(tunnel) => tunnel.local_port(),
        }
    }

    async fn health_check(&self) -> Result<()> {
        match self {
            Self::Ssh(tunnel) => tunnel.health_check().await,
        }
    }

    async fn close(self) -> Result<()> {
        match self {
            Self::Ssh(tunnel) => tunnel.close().await,
        }
    }
}

pub struct ConnectionManager {
    connections: Arc<DashMap<String, LiveConnection>>,
    // Store profiles separately so we can reconnect after reaper removes connection
    profiles: Arc<DashMap<String, ConnectionProfile>>,
    tunnels: Arc<DashMap<String, ManagedTunnel>>,
    /// Track in-flight connection attempts to prevent duplicate tunnel creation
    pending_connections: Arc<DashSet<String>>,
    /// Notification for when a connection attempt completes (replaces polling)
    connection_ready: Arc<Notify>,
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

enum TunnelStatus {
    NotRequired,
    Reused { local_port: u16 },
    Created { local_port: u16 },
}

impl TunnelStatus {
    fn local_port(&self) -> Option<u16> {
        match self {
            TunnelStatus::NotRequired => None,
            TunnelStatus::Reused { local_port } | TunnelStatus::Created { local_port } => {
                Some(*local_port)
            }
        }
    }

    fn requires_reconnect(&self) -> bool {
        matches!(self, TunnelStatus::Created { .. })
    }
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            profiles: Arc::new(DashMap::new()),
            tunnels: Arc::new(DashMap::new()),
            pending_connections: Arc::new(DashSet::new()),
            connection_ready: Arc::new(Notify::new()),
            queries: Arc::new(DashMap::new()),
            idle_timeout: Duration::from_secs(1800), // 30 minutes
            reaper_handle: Arc::new(tokio::sync::Mutex::new(None)),
            total_connections: Arc::new(AtomicUsize::new(0)),
        }
    }

    async fn ensure_tunnel(
        &self,
        conn_id: &str,
        profile: &ConnectionProfile,
    ) -> Result<TunnelStatus> {
        // Check if bastion is configured (new approach)
        if let Some(ref bastion) = profile.bastion {
            return self.ensure_bastion_tunnel(conn_id, profile, bastion).await;
        }

        // Fallback to legacy ssh_tunnel field
        let Some(ssh_config) = &profile.ssh_tunnel else {
            return Ok(TunnelStatus::NotRequired);
        };

        if let Some((_, tunnel)) = self.tunnels.remove(conn_id) {
            match tunnel.health_check().await {
                Ok(()) => {
                    let local_port = tunnel.local_port();
                    self.tunnels.insert(conn_id.to_string(), tunnel);
                    return Ok(TunnelStatus::Reused { local_port });
                }
                Err(err) => {
                    tracing::warn!(
                        "Tunnel for connection {} failed health check: {}. Recreating...",
                        conn_id,
                        err
                    );
                    let _ = tunnel.close().await;
                }
            }
        }

        self.create_ssh_tunnel(conn_id, profile, ssh_config).await
    }

    async fn ensure_bastion_tunnel(
        &self,
        conn_id: &str,
        profile: &ConnectionProfile,
        bastion: &BastionConfig,
    ) -> Result<TunnelStatus> {
        // Check existing tunnel health
        if let Some((_, tunnel)) = self.tunnels.remove(conn_id) {
            match tunnel.health_check().await {
                Ok(()) => {
                    let local_port = tunnel.local_port();
                    self.tunnels.insert(conn_id.to_string(), tunnel);
                    return Ok(TunnelStatus::Reused { local_port });
                }
                Err(err) => {
                    tracing::warn!(
                        "Bastion tunnel for connection {} failed health check: {}. Recreating...",
                        conn_id,
                        err
                    );
                    let _ = tunnel.close().await;
                }
            }
        }

        match bastion {
            BastionConfig::Ssh(ssh_config) => {
                self.create_ssh_tunnel(conn_id, profile, ssh_config).await
            }
        }
    }

    async fn create_ssh_tunnel(
        &self,
        conn_id: &str,
        profile: &ConnectionProfile,
        ssh_config: &SshTunnelConfig,
    ) -> Result<TunnelStatus> {
        let tunnel = SshTunnel::establish(ssh_config, &profile.host, profile.port).await?;
        let local_port = tunnel.local_port();
        self.tunnels
            .insert(conn_id.to_string(), ManagedTunnel::Ssh(tunnel));
        Ok(TunnelStatus::Created { local_port })
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

        // Prevent duplicate concurrent connection attempts (race condition protection)
        // If a connection attempt is already in progress, wait for it using Notify
        if self.pending_connections.contains(&conn_id) {
            tracing::info!(
                "Connection {} already has an in-flight attempt, waiting for notification...",
                conn_id
            );

            // Wait for notification with 120s timeout (uses proper async signaling, not polling)
            let timeout_duration = Duration::from_secs(120);
            let wait_result = tokio::time::timeout(
                timeout_duration,
                self.wait_for_connection_ready(&conn_id),
            )
            .await;

            match wait_result {
                Ok(()) => {
                    // Check if connection was created successfully
                    if self.connections.contains_key(&conn_id) {
                        tracing::info!(
                            "Connection {} created by another attempt, reusing",
                            conn_id
                        );
                        return Ok(conn_id);
                    }
                    // Connection attempt finished but failed, fall through to create new attempt
                    tracing::info!(
                        "Previous attempt for {} finished but connection not found, creating new",
                        conn_id
                    );
                }
                Err(_) => {
                    // Timeout - force remove stuck pending and proceed
                    tracing::warn!(
                        "Connection {} still pending after 120s, forcing new attempt",
                        conn_id
                    );
                    self.pending_connections.remove(&conn_id);
                }
            }
        }

        // Mark this connection as pending
        self.pending_connections.insert(conn_id.clone());

        // Execute connection attempt
        let result = self
            .get_or_create_connection_inner(&conn_id, profile)
            .await;

        // Always remove from pending set and notify waiters
        self.pending_connections.remove(&conn_id);
        self.connection_ready.notify_waiters();

        result
    }

    /// Wait until a specific connection is no longer pending
    async fn wait_for_connection_ready(&self, conn_id: &str) {
        loop {
            // Check if no longer pending
            if !self.pending_connections.contains(conn_id) {
                return;
            }
            // Wait for any connection to complete
            self.connection_ready.notified().await;
        }
    }

    async fn get_or_create_connection_inner(
        &self,
        conn_id: &str,
        profile: &ConnectionProfile,
    ) -> Result<String> {
        let tunnel_status = self.ensure_tunnel(conn_id, profile).await?;
        let effective_profile = Self::build_effective_profile(profile, &tunnel_status);

        // Check if connection exists. If it does but the adapter is no longer connected,
        // attempt a transparent reconnect to heal broken sessions after reloads/network hiccups.
        if let Some((_, mut conn)) = self.connections.remove(conn_id) {
            let needs_reconnect =
                !conn.adapter.is_connected().await || tunnel_status.requires_reconnect();

            if needs_reconnect {
                if let Err(err) = conn.adapter.connect(&effective_profile).await {
                    if tunnel_status.requires_reconnect() {
                        if let Some((_, tunnel)) = self.tunnels.remove(conn_id) {
                            let _ = tunnel.close().await;
                        }
                    }
                    return Err(err);
                }
            }

            *conn.last_used.write().await = Instant::now();
            conn.profile = profile.clone();
            self.connections.insert(conn_id.to_string(), conn);
            self.profiles.insert(conn_id.to_string(), profile.clone());
            return Ok(conn_id.to_string());
        }

        // Start reaper on first connection if not already running
        if self.connections.is_empty() {
            self.start_reaper_internal().await;
        }

        // Create new connection
        let mut adapter = self.create_adapter(profile)?;
        tracing::info!(
            "Connecting to {}:{}/{} (type: {:?})",
            effective_profile.host,
            effective_profile.port,
            effective_profile.database,
            effective_profile.db_type
        );
        if let Err(err) = adapter.connect(&effective_profile).await {
            tracing::error!("Connection failed: {}", err);
            if tunnel_status.local_port().is_some() {
                if let Some((_, tunnel)) = self.tunnels.remove(conn_id) {
                    let _ = tunnel.close().await;
                }
            }
            return Err(err);
        }
        tracing::info!("Connection established successfully");

        let live_conn = LiveConnection {
            id: conn_id.to_string(),
            adapter,
            profile: profile.clone(),
            created_at: Instant::now(),
            last_used: Arc::new(RwLock::new(Instant::now())),
            query_count: Arc::new(AtomicUsize::new(0)),
            active_queries: Arc::new(AtomicUsize::new(0)),
        };

        self.connections.insert(conn_id.to_string(), live_conn);
        // Store profile separately for reconnection after reaper
        self.profiles.insert(conn_id.to_string(), profile.clone());
        self.total_connections.fetch_add(1, Ordering::SeqCst);
        Ok(conn_id.to_string())
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

    /// Get stored connection profile
    pub fn get_stored_profile(&self, conn_id: &str) -> Option<ConnectionProfile> {
        self.profiles.get(conn_id).map(|p| p.clone())
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

                // Extract base connection ID from composite key (format: {base_id}:{tab_id})
                let base_conn_id = conn_id.split(':').next().unwrap_or(conn_id);

                // Get stored profile (stored separately from connection for reconnection)
                let mut profile = self
                    .profiles
                    .get(base_conn_id)
                    .map(|p| p.clone())
                    .ok_or_else(|| {
                        AppError::internal(format!(
                            "Cannot reconnect: profile for connection {} not found",
                            conn_id
                        ))
                    })?;

                // Use composite key as the connection ID for tab-specific connections
                profile.id = conn_id.to_string();

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
        // Remove from pool first - this is always safe and non-blocking
        if let Some((_, mut conn)) = self.connections.remove(conn_id) {
            // Disconnect adapter with timeout - don't hang on dead connections
            let disconnect_result = tokio::time::timeout(
                Duration::from_secs(2),
                conn.adapter.disconnect(),
            )
            .await;

            match disconnect_result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    tracing::warn!("Disconnect adapter error for {}: {}", conn_id, e);
                }
                Err(_) => {
                    tracing::warn!("Disconnect timed out for {}, forcing cleanup", conn_id);
                }
            }
            self.total_connections.fetch_sub(1, Ordering::SeqCst);
        }

        // Close tunnel with timeout
        if let Some((_, tunnel)) = self.tunnels.remove(conn_id) {
            let tunnel_result = tokio::time::timeout(Duration::from_secs(2), tunnel.close()).await;
            if let Err(_) | Ok(Err(_)) = tunnel_result {
                tracing::warn!("Tunnel close failed or timed out for {}", conn_id);
            }
        }

        // Always remove stored profile
        self.profiles.remove(conn_id);
        delete_ssh_passphrase(conn_id).await.ok();
        Ok(())
    }

    pub async fn disconnect_all(&self) -> Result<()> {
        let keys: Vec<String> = self
            .connections
            .iter()
            .map(|entry| entry.key().clone())
            .collect();

        // Disconnect all connections with individual timeouts
        // Don't fail on individual errors - log and continue
        for key in keys {
            if let Err(e) = self.disconnect(&key).await {
                tracing::warn!("Failed to disconnect {}: {}", key, e);
            }
        }

        // Close any remaining tunnels (if any connections failed earlier)
        let tunnel_keys: Vec<String> = self
            .tunnels
            .iter()
            .map(|entry| entry.key().clone())
            .collect();

        for key in tunnel_keys {
            if let Some((_, tunnel)) = self.tunnels.remove(&key) {
                let _ = tokio::time::timeout(Duration::from_secs(2), tunnel.close()).await;
            }
        }

        Ok(())
    }

    fn create_adapter(
        &self,
        profile: &ConnectionProfile,
    ) -> Result<Box<dyn crate::core::adapter::DbAdapter>> {
        match profile.db_type {
            DbType::PostgreSQL => Ok(Box::new(PostgresAdapter::new())),
            DbType::MySQL | DbType::MariaDB => Ok(Box::new(MySqlAdapter::new())),
            DbType::SQLite => Ok(Box::new(SqliteAdapter::new())),
            DbType::SQLServer => Ok(Box::new(MssqlAdapter::new())),
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

impl ConnectionManager {
    fn build_effective_profile(
        profile: &ConnectionProfile,
        tunnel_status: &TunnelStatus,
    ) -> ConnectionProfile {
        if let Some(local_port) = tunnel_status.local_port() {
            let mut effective = profile.clone();
            effective.host = "127.0.0.1".into();
            effective.port = local_port;
            // Prevent adapters from attempting nested tunnel creation.
            effective.ssh_tunnel = None;
            effective
        } else {
            profile.clone()
        }
    }
}

impl Drop for ConnectionManager {
    fn drop(&mut self) {
        // Note: We can't properly clean up the async handle in Drop
        // The handle will be aborted when the runtime shuts down
    }
}
