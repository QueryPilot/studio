use dashmap::{DashMap, DashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Notify, RwLock};
use tokio::task::JoinHandle;

use crate::adapters::mongodb::MongoDbAdapter;
use crate::adapters::mssql::MssqlAdapter;
use crate::adapters::mysql::MySqlAdapter;
use crate::adapters::postgres::PostgresAdapter;
use crate::adapters::redis::RedisAdapter;
use crate::adapters::sqlite::SqliteAdapter;
use crate::core::backup_capability::BackupCapable;
use crate::core::capabilities::{
    BaseCapability, CapabilityTestResult, DocumentQueryable, RichKeyValueOperable, SqlQueryable,
};
use crate::error::{AppError, Result};
use crate::ssh::secrets::delete_ssh_passphrase;
use crate::ssh::SshTunnel;
use crate::types::*;

/// Unified adapter that wraps any database adapter and provides paradigm-specific access.
///
/// Uses raw pointers to store trait object references for paradigm capabilities,
/// avoiding the need for enum dispatch or unsafe downcasting at runtime.
///
/// # Safety
/// The raw pointers stored in `sql`, `document`, and `keyvalue` fields point to
/// the same allocation as `inner`. They are valid for the lifetime of `inner`
/// and we never mutate through them. The constructors ensure this invariant.
pub struct UnifiedAdapter {
    /// The underlying adapter implementing BaseCapability
    inner: Box<dyn BaseCapability>,

    /// Pointer to SqlQueryable trait object (if supported)
    sql: Option<*const dyn SqlQueryable>,

    /// Pointer to DocumentQueryable trait object (if supported)
    document: Option<*const dyn DocumentQueryable>,

    /// Pointer to RichKeyValueOperable trait object (if supported)
    keyvalue: Option<*const dyn RichKeyValueOperable>,

    /// Pointer to BackupCapable trait object (if supported)
    backup: Option<*const dyn BackupCapable>,

    /// Concrete adapter pointers for adapter-specific access
    postgres: Option<*const PostgresAdapter>,
    mysql: Option<*const MySqlAdapter>,
    mssql: Option<*const MssqlAdapter>,
    mongo: Option<*const MongoDbAdapter>,
    redis: Option<*const RedisAdapter>,

    /// Database type
    db_type: DbType,
}

// SAFETY: The raw pointers point to the same allocation as `inner`.
// They're valid for the lifetime of `inner` and we never mutate through them.
unsafe impl Send for UnifiedAdapter {}
unsafe impl Sync for UnifiedAdapter {}

impl UnifiedAdapter {
    /// Create a new UnifiedAdapter for PostgreSQL
    pub fn postgres(adapter: PostgresAdapter) -> Self {
        let boxed = Box::new(adapter);
        let ptr = &*boxed as *const PostgresAdapter;
        let sql_ptr: *const dyn SqlQueryable = ptr;
        let backup_ptr: *const dyn BackupCapable = ptr;
        Self {
            inner: boxed,
            sql: Some(sql_ptr),
            document: None,
            keyvalue: None,
            backup: Some(backup_ptr),
            postgres: Some(ptr),
            mysql: None,
            mssql: None,
            mongo: None,
            redis: None,
            db_type: DbType::PostgreSQL,
        }
    }

    /// Create a new UnifiedAdapter for MySQL/MariaDB
    pub fn mysql(adapter: MySqlAdapter, db_type: DbType) -> Self {
        let boxed = Box::new(adapter);
        let ptr = &*boxed as *const MySqlAdapter;
        let sql_ptr: *const dyn SqlQueryable = ptr;
        let backup_ptr: *const dyn BackupCapable = ptr;
        Self {
            inner: boxed,
            sql: Some(sql_ptr),
            document: None,
            keyvalue: None,
            backup: Some(backup_ptr),
            postgres: None,
            mysql: Some(ptr),
            mssql: None,
            mongo: None,
            redis: None,
            db_type,
        }
    }

    /// Create a new UnifiedAdapter for SQLite
    pub fn sqlite(adapter: SqliteAdapter) -> Self {
        let boxed = Box::new(adapter);
        let ptr = &*boxed as *const SqliteAdapter;
        let sql_ptr: *const dyn SqlQueryable = ptr;
        let backup_ptr: *const dyn BackupCapable = ptr;
        Self {
            inner: boxed,
            sql: Some(sql_ptr),
            document: None,
            keyvalue: None,
            backup: Some(backup_ptr),
            postgres: None,
            mysql: None,
            mssql: None,
            mongo: None,
            redis: None,
            db_type: DbType::SQLite,
        }
    }

    /// Create a new UnifiedAdapter for SQL Server
    pub fn mssql(adapter: MssqlAdapter) -> Self {
        let boxed = Box::new(adapter);
        let ptr = &*boxed as *const MssqlAdapter;
        let sql_ptr: *const dyn SqlQueryable = ptr;
        let backup_ptr: *const dyn BackupCapable = ptr;
        Self {
            inner: boxed,
            sql: Some(sql_ptr),
            document: None,
            keyvalue: None,
            backup: Some(backup_ptr),
            postgres: None,
            mysql: None,
            mssql: Some(ptr),
            mongo: None,
            redis: None,
            db_type: DbType::SQLServer,
        }
    }

    /// Create a new UnifiedAdapter for MongoDB
    pub fn mongodb(adapter: MongoDbAdapter) -> Self {
        let boxed = Box::new(adapter);
        let ptr = &*boxed as *const MongoDbAdapter;
        let doc_ptr: *const dyn DocumentQueryable = ptr;
        let backup_ptr: *const dyn BackupCapable = ptr;
        Self {
            inner: boxed,
            sql: None,
            document: Some(doc_ptr),
            keyvalue: None,
            backup: Some(backup_ptr),
            postgres: None,
            mysql: None,
            mssql: None,
            mongo: Some(ptr),
            redis: None,
            db_type: DbType::MongoDB,
        }
    }

    /// Create a new UnifiedAdapter for Redis
    pub fn redis(adapter: RedisAdapter) -> Self {
        let boxed = Box::new(adapter);
        let ptr = &*boxed as *const RedisAdapter;
        let kv_ptr: *const dyn RichKeyValueOperable = ptr;
        let backup_ptr: *const dyn BackupCapable = ptr;
        Self {
            inner: boxed,
            sql: None,
            document: None,
            keyvalue: Some(kv_ptr),
            backup: Some(backup_ptr),
            postgres: None,
            mysql: None,
            mssql: None,
            mongo: None,
            redis: Some(ptr),
            db_type: DbType::Redis,
        }
    }

    // ========== BaseCapability delegation ==========

    pub fn is_connected(&self) -> bool {
        self.inner.is_connected()
    }

    pub async fn test_connection(&self) -> Result<CapabilityTestResult> {
        self.inner.test_connection().await
    }

    pub async fn disconnect(&self) -> Result<()> {
        self.inner.disconnect().await
    }

    pub async fn connect(&self, profile: &ConnectionProfile) -> Result<()> {
        self.inner.connect(profile).await
    }

    pub fn db_type(&self) -> DbType {
        self.db_type
    }

    // ========== Paradigm-specific access ==========

    /// Get SQL queryable interface (returns None for MongoDB/Redis)
    pub fn as_sql(&self) -> Option<&dyn SqlQueryable> {
        self.sql.map(|p| unsafe { &*p })
    }

    /// Get document queryable interface (returns None for SQL/Redis)
    pub fn as_document(&self) -> Option<&dyn DocumentQueryable> {
        self.document.map(|p| unsafe { &*p })
    }

    /// Get key-value operable interface (returns None for SQL/MongoDB)
    pub fn as_keyvalue(&self) -> Option<&dyn RichKeyValueOperable> {
        self.keyvalue.map(|p| unsafe { &*p })
    }

    /// Get backup capable interface (returns None for adapters that don't support backup)
    pub fn as_backup(&self) -> Option<&dyn BackupCapable> {
        self.backup.map(|p| unsafe { &*p })
    }

    // ========== Concrete adapter access ==========

    pub fn as_postgres(&self) -> Option<&PostgresAdapter> {
        self.postgres.map(|p| unsafe { &*p })
    }

    pub fn as_mysql(&self) -> Option<&MySqlAdapter> {
        self.mysql.map(|p| unsafe { &*p })
    }

    pub fn as_mssql(&self) -> Option<&MssqlAdapter> {
        self.mssql.map(|p| unsafe { &*p })
    }

    pub fn as_mongo(&self) -> Option<&MongoDbAdapter> {
        self.mongo.map(|p| unsafe { &*p })
    }

    pub fn as_redis(&self) -> Option<&RedisAdapter> {
        self.redis.map(|p| unsafe { &*p })
    }
}

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
    profiles: Arc<DashMap<String, ConnectionProfile>>,
    tunnels: Arc<DashMap<String, ManagedTunnel>>,
    pending_connections: Arc<DashSet<String>>,
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
    pub adapter: Arc<UnifiedAdapter>,
    pub profile: ConnectionProfile,
    #[allow(dead_code)]
    pub created_at: Instant,
    pub last_used: Arc<RwLock<Instant>>,
    #[allow(dead_code)]
    pub query_count: Arc<AtomicUsize>,
    pub active_queries: Arc<AtomicUsize>,
}

/// RAII guard that holds an `Arc<UnifiedAdapter>` and tracks active usage.
///
/// Increments `active_queries` on creation, decrements on drop.
/// This prevents the idle reaper from removing the connection while in use
/// and allows callers to hold the adapter across `.await` points without
/// holding the DashMap read lock.
pub struct AdapterHandle {
    adapter: Arc<UnifiedAdapter>,
    active_queries: Arc<AtomicUsize>,
}

impl AdapterHandle {
    pub fn db_type(&self) -> DbType {
        self.adapter.db_type()
    }
}

impl std::ops::Deref for AdapterHandle {
    type Target = UnifiedAdapter;
    fn deref(&self) -> &UnifiedAdapter {
        &self.adapter
    }
}

impl Drop for AdapterHandle {
    fn drop(&mut self) {
        self.active_queries.fetch_sub(1, Ordering::SeqCst);
    }
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
            idle_timeout: Duration::from_secs(1800),
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
                    // Re-check active_queries before removing to close the TOCTOU window:
                    // a borrow_adapter() call between the scan and removal could have
                    // started using this connection.
                    let still_idle = connections
                        .get(&key)
                        .map(|e| e.active_queries.load(Ordering::SeqCst) == 0)
                        .unwrap_or(false);
                    if still_idle {
                        if let Some((_, conn)) = connections.remove(&key) {
                            let _ = conn.adapter.disconnect().await;
                        }
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
            let wait_result =
                tokio::time::timeout(timeout_duration, self.wait_for_connection_ready(&conn_id))
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
        let result = self.get_or_create_connection_inner(&conn_id, profile).await;

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
        // Unified path for all database types - tunnel support for all
        let tunnel_status = self.ensure_tunnel(conn_id, profile).await?;
        let effective_profile = Self::build_effective_profile(profile, &tunnel_status);

        // Check if connection exists. If it does but the adapter is no longer connected,
        // attempt a transparent reconnect to heal broken sessions after reloads/network hiccups.
        if let Some((_, conn)) = self.connections.remove(conn_id) {
            let needs_reconnect =
                !conn.adapter.is_connected() || tunnel_status.requires_reconnect();

            if needs_reconnect {
                if let Err(err) = conn.adapter.connect(&effective_profile).await {
                    if tunnel_status.requires_reconnect() {
                        if let Some((_, tunnel)) = self.tunnels.remove(conn_id) {
                            let _ = tunnel.close().await;
                        }
                    }
                    // Re-insert the connection even on failure so subsequent
                    // reconnection attempts can find and retry it, rather than
                    // permanently losing the connection from the map.
                    self.connections.insert(
                        conn_id.to_string(),
                        LiveConnection {
                            id: conn.id,
                            adapter: conn.adapter,
                            profile: profile.clone(),
                            created_at: conn.created_at,
                            last_used: conn.last_used,
                            query_count: conn.query_count,
                            active_queries: conn.active_queries,
                        },
                    );
                    return Err(err);
                }
            }

            *conn.last_used.write().await = Instant::now();
            // Note: profile update requires mutable access, but we can insert fresh
            let updated_conn = LiveConnection {
                id: conn.id,
                adapter: conn.adapter,
                profile: profile.clone(),
                created_at: conn.created_at,
                last_used: conn.last_used,
                query_count: conn.query_count,
                active_queries: conn.active_queries,
            };
            self.connections.insert(conn_id.to_string(), updated_conn);
            self.profiles.insert(conn_id.to_string(), profile.clone());
            return Ok(conn_id.to_string());
        }

        // Start reaper on first connection if not already running
        if self.connections.is_empty() {
            self.start_reaper_internal().await;
        }

        // Create new connection (unified factory for all db types)
        let adapter = self.create_adapter(profile)?;
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
            adapter: Arc::new(adapter),
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

    /// **Deprecated**: Returns a DashMap `Ref` guard that holds a read lock.
    /// Do NOT hold the returned value across `.await` points — this blocks
    /// concurrent reconnection. Use `borrow_adapter()` instead.
    #[cfg(test)]
    pub fn get_connection(
        &self,
        conn_id: &str,
    ) -> Option<impl std::ops::Deref<Target = LiveConnection> + '_> {
        self.connections.get(conn_id)
    }

    /// Borrow a connection's adapter as an RAII handle.
    ///
    /// Unlike `get_connection`, this immediately releases the DashMap read lock
    /// so callers can safely hold the adapter across `.await` points without
    /// blocking concurrent reconnection attempts.
    ///
    /// The returned `AdapterHandle` increments `active_queries` to prevent the
    /// idle reaper from removing the connection while in use, and decrements
    /// it on drop.
    pub fn borrow_adapter(&self, conn_id: &str) -> Option<AdapterHandle> {
        self.connections.get(conn_id).map(|entry| {
            entry.active_queries.fetch_add(1, Ordering::SeqCst);
            // Update last_used to prevent idle reaper from removing actively-used connections.
            // try_write() is non-blocking: if contended, skip — the connection is clearly active.
            if let Ok(mut last_used) = entry.last_used.try_write() {
                *last_used = Instant::now();
            }
            AdapterHandle {
                adapter: Arc::clone(&entry.adapter),
                active_queries: Arc::clone(&entry.active_queries),
            }
        })
    }

    /// Touch connection to update last_used timestamp (prevents idle timeout)
    pub fn touch_connection(&self, conn_id: &str) -> Result<()> {
        if let Some(entry) = self.connections.get(conn_id) {
            // Use try_write() to avoid holding the DashMap read lock across an async yield.
            if let Ok(mut last_used) = entry.last_used.try_write() {
                *last_used = Instant::now();
            }
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

    /// Get the safe_mode setting for a connection.
    ///
    /// Extracts the base connection ID from a composite key (e.g. `{conn_id}:{tab_id}`)
    /// and looks up the profile's safe_mode. This is a synchronous, non-blocking operation
    /// that does not hold any DashMap lock across await points.
    pub fn get_safe_mode(&self, conn_id: &str) -> Option<SafeMode> {
        let base_id = conn_id.split(':').next().unwrap_or(conn_id);
        self.profiles.get(base_id).and_then(|p| p.safe_mode)
    }

    /// Get connection with automatic retry and reconnect.
    ///
    /// **Deprecated**: Returns a DashMap `Ref` guard that holds a read lock.
    /// Do NOT hold the returned value across `.await` points — this blocks
    /// concurrent reconnection. Use [`borrow_adapter_with_retry`] instead.
    ///
    /// If connection is not found, attempts to reconnect using stored profile.
    #[deprecated(note = "Use borrow_adapter_with_retry() instead — this holds a DashMap read lock")]
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

    /// Like `get_connection_with_retry` but returns an `AdapterHandle` that does
    /// not hold the DashMap read lock. Safe to hold across `.await` points.
    pub async fn borrow_adapter_with_retry(
        &self,
        conn_id: &str,
        max_retries: usize,
    ) -> Result<AdapterHandle> {
        for attempt in 0..max_retries {
            if let Some(handle) = self.borrow_adapter(conn_id) {
                return Ok(handle);
            }

            // Connection not found, try to reconnect
            if attempt < max_retries - 1 {
                tracing::info!(
                    "Connection {} not found, attempting reconnect (attempt {}/{})",
                    conn_id,
                    attempt + 1,
                    max_retries
                );

                let base_conn_id = conn_id.split(':').next().unwrap_or(conn_id);

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

                profile.id = conn_id.to_string();

                match self.get_or_create_connection(&profile).await {
                    Ok(_) => {
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
                    }
                }
            }
        }

        Err(AppError::internal(format!(
            "Connection {} not found after {} retries",
            conn_id, max_retries
        )))
    }

    pub async fn disconnect(&self, conn_id: &str) -> Result<()> {
        if let Some((_, conn)) = self.connections.remove(conn_id) {
            let disconnect_result =
                tokio::time::timeout(Duration::from_secs(2), conn.adapter.disconnect()).await;

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

    fn create_adapter(&self, profile: &ConnectionProfile) -> Result<UnifiedAdapter> {
        match profile.db_type {
            DbType::PostgreSQL => Ok(UnifiedAdapter::postgres(PostgresAdapter::new())),
            DbType::MySQL | DbType::MariaDB => {
                Ok(UnifiedAdapter::mysql(MySqlAdapter::new(), profile.db_type))
            }
            DbType::SQLite => Ok(UnifiedAdapter::sqlite(SqliteAdapter::new())),
            DbType::SQLServer => Ok(UnifiedAdapter::mssql(MssqlAdapter::new())),
            DbType::MongoDB => Ok(UnifiedAdapter::mongodb(MongoDbAdapter::new())),
            DbType::Redis => Ok(UnifiedAdapter::redis(RedisAdapter::new())),
        }
    }

    /// Update the safe mode level on a live connection.
    ///
    /// Propagates the change to:
    /// 1. The stored profile (so reconnections inherit the new mode)
    /// 2. The base connection entry
    /// 3. All tab-specific connections (key format: `{conn_id}:{tab_id}`)
    pub fn update_safe_mode(&self, conn_id: &str, safe_mode: SafeMode) -> Result<()> {
        // Update the stored profile so reconnections/new tabs inherit the mode
        if let Some(mut profile) = self.profiles.get_mut(conn_id) {
            profile.safe_mode = Some(safe_mode);
        }

        // Update all live connections: the base connection and any tab-specific ones
        let prefix = format!("{}:", conn_id);
        let mut found = false;
        for mut entry in self.connections.iter_mut() {
            let key = entry.key();
            if key == conn_id || key.starts_with(&prefix) {
                entry.value_mut().profile.safe_mode = Some(safe_mode);
                found = true;
            }
        }

        if found {
            Ok(())
        } else {
            Err(AppError::internal(format!(
                "Connection {} not found",
                conn_id
            )))
        }
    }

    pub async fn ping_connection(&self, conn_id: &str) -> Result<bool> {
        if let Some(conn) = self.connections.get(conn_id) {
            Ok(conn.adapter.is_connected())
        } else {
            Ok(false)
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

    /// List all active connections with their basic info
    pub fn list_connections(&self) -> Vec<ConnectionInfo> {
        self.connections
            .iter()
            .map(|entry| {
                let conn = entry.value();
                ConnectionInfo {
                    id: conn.profile.id.clone(),
                    name: conn.profile.name.clone(),
                    db_type: format!("{:?}", conn.profile.db_type),
                    database: conn.profile.database.clone(),
                }
            })
            .collect()
    }
}

/// Basic information about an active connection (for MCP bridge)
#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub database: String,
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
