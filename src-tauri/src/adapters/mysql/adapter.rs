use async_trait::async_trait;
use mysql_async::prelude::*;
use mysql_async::{Conn, Opts, OptsBuilder, Pool, PoolConstraints, PoolOpts, SslOpts};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::simple_converter::SimpleConverter;
use super::types::MySqlTypeConverter;
use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityColumnMeta, CapabilityQueryResult,
    CapabilityTestResult, SqlQueryable,
};
use crate::error::AppError;
use crate::types::*;

pub struct MySqlAdapter {
    pool: Arc<RwLock<Option<Pool>>>,
}

impl MySqlAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(RwLock::new(None)),
        }
    }

    /// Get a connection from the pool with timeout
    pub async fn get_conn(&self) -> Result<Conn, AppError> {
        let pool_guard = self.pool.read().await;
        let pool = pool_guard
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        // Add timeout to prevent hanging on stale/dead connections
        tokio::time::timeout(std::time::Duration::from_secs(30), pool.get_conn())
            .await
            .map_err(|_| AppError::Internal("Timed out waiting for database connection".into()))?
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))
    }

    /// Get the pool for streaming queries
    pub async fn get_pool(&self) -> Option<Pool> {
        self.pool.read().await.clone()
    }

    /// Execute multiple SQL statements within a transaction
    pub async fn execute_in_transaction(
        &self,
        statements: Vec<String>,
    ) -> Result<Vec<u64>, AppError> {
        let mut conn = self.get_conn().await?;

        // Start transaction manually
        conn.query_drop("BEGIN")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to begin transaction: {}", e)))?;

        let mut results = Vec::new();

        for sql in statements {
            let result = conn
                .exec_iter(&sql, ())
                .await
                .map_err(|e| AppError::DatabaseError(format!("Transaction failed: {}", e)))?;
            results.push(result.affected_rows());
            // Drop the result to release resources
            let _ = result.drop_result().await;
        }

        // Commit transaction
        conn.query_drop("COMMIT")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to commit transaction: {}", e)))?;

        Ok(results)
    }

    fn build_opts(profile: &ConnectionProfile) -> Result<Opts, AppError> {
        // Build connection options directly instead of using URL parsing
        // This avoids issues with special characters and URL encoding
        let mut builder = OptsBuilder::default()
            .ip_or_hostname(&profile.host)
            .tcp_port(profile.port)
            .user(Some(&profile.username))
            .db_name(Some(&profile.database));

        // Set password if provided
        if let Some(password) = &profile.password {
            builder = builder.pass(Some(password));
        }

        // Apply connection options from profile (e.g., charset=utf8mb4)
        // Collect all init commands first, then apply them once
        let mut init_commands = Vec::new();

        for (key, value) in &profile.options {
            match key.to_lowercase().as_str() {
                "charset" => {
                    init_commands.push(format!("SET NAMES '{}'", value));
                }
                "collation" => {
                    init_commands.push(format!("SET collation_connection = '{}'", value));
                }
                "timezone" | "time_zone" => {
                    init_commands.push(format!("SET time_zone = '{}'", value));
                }
                "sql_mode" => {
                    init_commands.push(format!("SET sql_mode = '{}'", value));
                }
                "connect_timeout" => {
                    if let Ok(secs) = value.parse::<u64>() {
                        builder = builder.conn_ttl(std::time::Duration::from_secs(secs));
                    }
                }
                _ => {
                    // Log unknown options but don't fail
                    tracing::debug!("Ignoring unknown MySQL option: {}={}", key, value);
                }
            }
        }

        // Apply all init commands at once
        if !init_commands.is_empty() {
            builder = builder.init(init_commands);
        }

        // SSL configuration
        if let Some(ssl_mode) = &profile.ssl_mode {
            match ssl_mode {
                SslMode::Allow
                | SslMode::Prefer
                | SslMode::Require
                | SslMode::VerifyCa
                | SslMode::VerifyFull => {
                    let mut ssl_opts = SslOpts::default();

                    // Apply SSL CA certificate if provided
                    if let Some(ssl_config) = &profile.ssl_config {
                        if let Some(ca_file) = &ssl_config.ca_file {
                            ssl_opts = ssl_opts
                                .with_root_certs(vec![std::path::PathBuf::from(ca_file).into()]);
                        }
                        // Note: mysql_async client identity requires PKCS12 format
                        // For PEM cert/key files, users need to convert to PKCS12 first
                    }

                    // Dialect-aware TLS verification levels:
                    // - allow/prefer/require: encrypt but skip certificate and hostname validation
                    // - verify-ca: validate certificate chain, skip hostname validation
                    // - verify-full: validate both certificate chain and hostname
                    ssl_opts = match ssl_mode {
                        SslMode::Allow | SslMode::Prefer | SslMode::Require => ssl_opts
                            .with_danger_accept_invalid_certs(true)
                            .with_danger_skip_domain_validation(true),
                        SslMode::VerifyCa => ssl_opts
                            .with_danger_accept_invalid_certs(false)
                            .with_danger_skip_domain_validation(true),
                        SslMode::VerifyFull => ssl_opts
                            .with_danger_accept_invalid_certs(false)
                            .with_danger_skip_domain_validation(false),
                        SslMode::Disable => unreachable!("disable handled in separate match arm"),
                    };

                    if matches!(ssl_mode, SslMode::Allow | SslMode::Prefer) {
                        tracing::warn!(
                            "MySQL sslmode={} currently maps to encrypted connections without fallback to plaintext if TLS is unavailable",
                            match ssl_mode {
                                SslMode::Allow => "allow",
                                SslMode::Prefer => "prefer",
                                _ => "unknown",
                            }
                        );
                    }

                    builder = builder.ssl_opts(ssl_opts);
                }
                SslMode::Disable => {
                    // No SSL - default
                }
            }
        }

        // Connection pool options with proper settings to prevent stale connections
        let pool_opts = PoolOpts::default()
            .with_constraints(PoolConstraints::new(1, 20).unwrap())
            // Reset connections when returning to pool to ensure clean state
            .with_reset_connection(true);

        builder = builder
            .pool_opts(pool_opts)
            // Enable TCP keepalive to detect dead connections (30 seconds)
            .tcp_keepalive(Some(30_000_u32))
            // Enable TCP_NODELAY for faster responses
            .tcp_nodelay(true);

        Ok(builder.into())
    }
}

impl Default for MySqlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseCapability for MySqlAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        // Disconnect if already connected
        if self.pool.read().await.is_some() {
            self.disconnect().await?;
        }

        tracing::info!(
            "MySQL connecting to {}:{}/{}",
            profile.host,
            profile.port,
            profile.database
        );

        let opts = Self::build_opts(profile)?;
        let pool = Pool::new(opts);

        // Test the connection with timeout to prevent indefinite hangs on unreachable hosts
        let connect_timeout = std::time::Duration::from_secs(15);
        let conn = tokio::time::timeout(connect_timeout, pool.get_conn())
            .await
            .map_err(|_| {
                AppError::ConnectionClosed(format!(
                    "Connection timed out after {} seconds - host may be unreachable",
                    connect_timeout.as_secs()
                ))
            })?
            .map_err(|e| {
                tracing::error!("MySQL connection failed: {}", e);
                AppError::Internal(format!("Failed to connect: {}", e))
            })?;

        // Drop connection back to pool
        drop(conn);

        *self.pool.write().await = Some(pool);

        tracing::info!("MySQL connected successfully");
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        if let Some(pool) = self.pool.write().await.take() {
            pool.disconnect()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to disconnect: {}", e)))?;
        }
        Ok(())
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let start = std::time::Instant::now();
        // Use timeout to avoid hanging on dead connections
        let test = async {
            let mut conn = self.get_conn().await?;

            // Get version and current database
            let row: Option<(String, String, String)> = conn
                .query_first("SELECT VERSION(), DATABASE(), USER()")
                .await
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

            match row {
                Some((version, database, user)) => Ok(CapabilityTestResult {
                    success: true,
                    message: format!("Connected to {} as {}", database, user),
                    latency_ms: Some(start.elapsed().as_millis() as u64),
                    server_version: Some(version),
                }),
                None => Err(AppError::DatabaseError(
                    "Failed to get connection info".into(),
                )),
            }
        };

        // 10 second timeout for test_connection (longer than is_connected since it does more work)
        tokio::time::timeout(std::time::Duration::from_secs(10), test)
            .await
            .map_err(|_| AppError::ConnectionClosed("Connection test timed out".into()))?
    }

    fn is_connected(&self) -> bool {
        // Use try_read to avoid blocking - if lock is held, assume connected
        self.pool
            .try_read()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![AdapterCapability::SqlQueryable]
    }
}

#[async_trait]
impl SqlQueryable for MySqlAdapter {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        let mut conn = self.get_conn().await?;

        let mut result = conn
            .query_iter(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        // Get column metadata
        let columns_ref = result.columns_ref();
        let columns: Vec<CapabilityColumnMeta> = columns_ref
            .iter()
            .map(|col| CapabilityColumnMeta {
                name: col.name_str().to_string(),
                data_type: MySqlTypeConverter::column_type_to_string(col.column_type()),
            })
            .collect();

        // Collect rows
        let rows: Vec<mysql_async::Row> = result
            .collect()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to collect rows: {}", e)))?;

        // Convert to JSON
        let json_rows = SimpleConverter::rows_to_json(&rows);

        Ok(CapabilityQueryResult {
            columns,
            rows: json_rows,
        })
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError> {
        let mut conn = self.get_conn().await?;

        let result = conn
            .query_iter(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;

        let affected = result.affected_rows();

        // Drop the result to release resources
        result
            .drop_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to drop result: {}", e)))?;

        Ok(affected)
    }
}
