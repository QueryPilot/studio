use async_trait::async_trait;
use deadpool_postgres::{
    Config, ManagerConfig, Pool, PoolConfig, RecyclingMethod, Runtime, SslMode as PgSslMode,
};
use native_tls::{Certificate, TlsConnector};
use postgres_native_tls::MakeTlsConnector;
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use tokio::sync::RwLock;
use tokio_postgres::NoTls;

use super::simple_converter::SimpleConverter;
use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityColumnMeta, CapabilityQueryResult,
    CapabilityTestResult, SqlQueryable,
};
use crate::error::AppError;
use crate::types::*;

pub struct PostgresAdapter {
    pool: Arc<RwLock<Option<Pool>>>,
    pooler_mode: Arc<StdRwLock<Option<bool>>>,
    current_schema: Arc<StdRwLock<Option<String>>>,
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(RwLock::new(None)),
            pooler_mode: Arc::new(StdRwLock::new(None)),
            current_schema: Arc::new(StdRwLock::new(None)),
        }
    }

    fn current_schema_from_profile(profile: &ConnectionProfile) -> Option<String> {
        profile
            .options
            .get("postgres_current_schema")
            .cloned()
            .filter(|schema| !schema.trim().is_empty())
    }

    fn quote_identifier(identifier: &str) -> String {
        format!("\"{}\"", identifier.replace('"', "\"\""))
    }

    fn search_path_sql(schema: &str) -> String {
        let quoted_schema = Self::quote_identifier(schema);
        if schema.eq_ignore_ascii_case("public") {
            format!("SET search_path TO {}", quoted_schema)
        } else {
            format!("SET search_path TO {}, public", quoted_schema)
        }
    }

    pub fn decorate_simple_query_sql(&self, sql: &str) -> String {
        let schema = self.current_schema.read().ok().and_then(|guard| guard.clone());
        match schema {
            Some(schema) => format!("{}; {}", Self::search_path_sql(&schema), sql),
            None => sql.to_string(),
        }
    }

    fn is_pooler_mode_error(error: &tokio_postgres::Error) -> bool {
        let message = error.to_string().to_lowercase();
        message.contains("pgbouncer")
            || message.contains("transaction pooling")
            || message.contains("prepared statement")
    }

    fn should_pin_single_session(profile: &ConnectionProfile) -> bool {
        is_tab_scoped_connection_id(&profile.id) || profile.pooler_mode == Some(true)
    }

    pub fn pooler_mode(&self) -> Option<bool> {
        self.pooler_mode
            .read()
            .ok()
            .and_then(|guard| *guard)
    }

    pub fn set_current_schema(&self, schema: Option<String>) {
        if let Ok(mut guard) = self.current_schema.write() {
            *guard = schema.filter(|value| !value.trim().is_empty());
        }
    }

    pub async fn get_client_with_schema(&self) -> Result<deadpool_postgres::Client, AppError> {
        self.get_client().await
    }

    fn create_pool(cfg: &Config, profile: &ConnectionProfile) -> Result<Pool, AppError> {
        let runtime = Some(Runtime::Tokio1);
        let ssl_mode = profile.ssl_mode.unwrap_or(SslMode::Disable);

        match ssl_mode {
            SslMode::Disable => cfg
                .create_pool(runtime, NoTls)
                .map_err(|e| AppError::Internal(format!("Failed to create pool: {}", e))),
            SslMode::Allow
            | SslMode::Prefer
            | SslMode::Require
            | SslMode::VerifyCa
            | SslMode::VerifyFull => {
                let mut tls_builder = TlsConnector::builder();

                // Apply CA bundle when provided.
                if let Some(ca_file) = profile
                    .ssl_config
                    .as_ref()
                    .and_then(|ssl| ssl.ca_file.as_deref())
                {
                    let ca_pem = std::fs::read(ca_file).map_err(|e| {
                        AppError::DatabaseError(format!(
                            "Failed to read PostgreSQL CA certificate {}: {}",
                            ca_file, e
                        ))
                    })?;
                    let cert = Certificate::from_pem(&ca_pem).map_err(|e| {
                        AppError::DatabaseError(format!(
                            "Invalid PostgreSQL CA certificate {}: {}",
                            ca_file, e
                        ))
                    })?;
                    tls_builder.add_root_certificate(cert);
                }

                if let Some(ssl_config) = &profile.ssl_config {
                    if ssl_config.key_file.is_some() || ssl_config.cert_file.is_some() {
                        tracing::warn!(
                            "PostgreSQL client certificate/key files are not currently applied by native-tls unless provided as a PKCS#12 identity"
                        );
                    }
                }

                match ssl_mode {
                    SslMode::Allow | SslMode::Prefer | SslMode::Require => {
                        // Require encrypted transport without certificate/hostname verification.
                        tls_builder.danger_accept_invalid_certs(true);
                        tls_builder.danger_accept_invalid_hostnames(true);
                    }
                    SslMode::VerifyCa => {
                        tls_builder.danger_accept_invalid_certs(false);
                        tls_builder.danger_accept_invalid_hostnames(true);
                    }
                    SslMode::VerifyFull => {
                        tls_builder.danger_accept_invalid_certs(false);
                        tls_builder.danger_accept_invalid_hostnames(false);
                    }
                    SslMode::Disable => unreachable!("handled in outer match"),
                }

                let tls_connector = tls_builder.build().map_err(|e| {
                    AppError::DatabaseError(format!(
                        "Failed to build PostgreSQL TLS connector: {}",
                        e
                    ))
                })?;
                let tls = MakeTlsConnector::new(tls_connector);

                cfg.create_pool(runtime, tls)
                    .map_err(|e| AppError::Internal(format!("Failed to create pool: {}", e)))
            }
        }
    }

    /// Get the pool for streaming queries
    pub async fn get_pool(&self) -> Option<Pool> {
        self.pool.read().await.clone()
    }

    async fn get_client(&self) -> Result<deadpool_postgres::Client, AppError> {
        let pool = self
            .get_pool()
            .await
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        if self.pooler_mode() != Some(true) {
            let schema = self.current_schema.read().ok().and_then(|guard| guard.clone());
            if let Some(schema) = schema {
                client
                    .batch_execute(Self::search_path_sql(&schema).as_str())
                    .await
                    .map_err(|e| {
                        AppError::DatabaseError(format!(
                            "Failed to apply PostgreSQL search_path: {}",
                            e
                        ))
                    })?;
            }
        }

        Ok(client)
    }

    async fn resolve_pooler_mode(
        client: &deadpool_postgres::Client,
        requested_mode: Option<bool>,
    ) -> Result<bool, AppError> {
        match requested_mode {
            Some(value) => Ok(value),
            None => match client.prepare("SELECT 1").await {
                Ok(_) => Ok(false),
                Err(error) if Self::is_pooler_mode_error(&error) => {
                    tracing::warn!(
                        "Detected PostgreSQL pooler mode during prepare probe: {}",
                        error
                    );
                    Ok(true)
                }
                Err(error) => Err(AppError::DatabaseError(format!(
                    "PostgreSQL pooler probe failed: {}",
                    error
                ))),
            },
        }
    }

    async fn execute_simple_query(
        &self,
        sql: &str,
    ) -> Result<CapabilityQueryResult, AppError> {
        let client = self.get_client().await?;
        let sql = self.decorate_simple_query_sql(sql);
        let messages = client
            .simple_query(&sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Simple query failed: {}", e)))?;

        let mut columns = Vec::new();
        let mut rows = Vec::new();

        for message in messages {
            match message {
                tokio_postgres::SimpleQueryMessage::RowDescription(description) => {
                    columns = description
                        .iter()
                        .map(|column| CapabilityColumnMeta {
                            name: column.name().to_string(),
                            data_type: "text".to_string(),
                        })
                        .collect();
                }
                tokio_postgres::SimpleQueryMessage::Row(row) => {
                    if columns.is_empty() {
                        columns = row
                            .columns()
                            .iter()
                            .map(|column| CapabilityColumnMeta {
                                name: column.name().to_string(),
                                data_type: "text".to_string(),
                            })
                            .collect();
                    }

                    rows.push(
                        (0..row.len())
                            .map(|index| match row.get(index) {
                                Some(value) => serde_json::Value::String(value.to_string()),
                                None => serde_json::Value::Null,
                            })
                            .collect(),
                    );
                }
                tokio_postgres::SimpleQueryMessage::CommandComplete(_) => {}
                _ => {}
            }
        }

        Ok(CapabilityQueryResult { columns, rows })
    }

    async fn execute_simple_statement(&self, sql: &str) -> Result<u64, AppError> {
        let client = self.get_client().await?;
        let sql = self.decorate_simple_query_sql(sql);
        let messages = client
            .simple_query(&sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Simple query failed: {}", e)))?;

        let affected = messages
            .into_iter()
            .filter_map(|message| match message {
                tokio_postgres::SimpleQueryMessage::CommandComplete(count) => Some(count),
                _ => None,
            })
            .last()
            .unwrap_or(0);

        Ok(affected)
    }
}

fn is_tab_scoped_connection_id(conn_id: &str) -> bool {
    conn_id.contains(':')
}

#[cfg(test)]
fn pool_max_size_for_connection_id(conn_id: &str) -> Option<usize> {
    if is_tab_scoped_connection_id(conn_id) {
        Some(1)
    } else {
        None
    }
}

impl Default for PostgresAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseCapability for PostgresAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        if self.pool.read().await.is_some() {
            self.disconnect().await?;
        }

        let mut cfg = Config::new();
        cfg.host = Some(profile.host.clone());
        cfg.port = Some(profile.port);
        cfg.user = Some(profile.username.clone());
        cfg.password = profile.password.clone();
        cfg.dbname = Some(profile.database.clone());
        cfg.ssl_mode = Some(match profile.ssl_mode.unwrap_or(SslMode::Disable) {
            SslMode::Disable => PgSslMode::Disable,
            SslMode::Allow => {
                tracing::warn!("PostgreSQL sslmode=allow is mapped to sslmode=prefer");
                PgSslMode::Prefer
            }
            SslMode::Prefer => PgSslMode::Prefer,
            SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => PgSslMode::Require,
        });
        cfg.manager = Some(ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        });
        if Self::should_pin_single_session(profile) {
            cfg.pool = Some(PoolConfig::new(1));
        }

        self.set_current_schema(Self::current_schema_from_profile(profile));
        if let Ok(mut guard) = self.pooler_mode.write() {
            *guard = profile.pooler_mode;
        }

        // Handle options
        for key in profile.options.keys() {
            match key.to_lowercase().as_str() {
                "connect_timeout" => {
                    // deadpool config doesn't have connect_timeout directly on Config root usually,
                    // it might be in pool options or handled via Runtime.
                    // For now, ignore or set generic options if Config supports it.
                }
                "application_name" => {
                    // cfg.application_name = Some(value.clone()); // Check if Config has this
                }
                _ => {}
            }
        }

        let pool = Self::create_pool(&cfg, profile)?;

        // Test connection with timeout to prevent indefinite hangs on unreachable hosts
        let connect_timeout = std::time::Duration::from_secs(15);
        let client = tokio::time::timeout(connect_timeout, pool.get())
            .await
            .map_err(|_| {
                AppError::ConnectionClosed(format!(
                    "Connection timed out after {} seconds - host may be unreachable",
                    connect_timeout.as_secs()
                ))
            })?
            .map_err(|e| AppError::Internal(format!("Failed to connect: {}", e)))?;

        let resolved_pooler_mode = Self::resolve_pooler_mode(&client, profile.pooler_mode).await?;
        if let Ok(mut guard) = self.pooler_mode.write() {
            *guard = Some(resolved_pooler_mode);
        }

        *self.pool.write().await = Some(pool);
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        let mut pool_guard = self.pool.write().await;
        if let Some(pool) = pool_guard.take() {
            // Close the pool to immediately terminate all connections
            // This prevents stale connections from lingering after disconnect
            pool.close();
        }
        Ok(())
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let test_fn = async {
            let client = self.get_client().await?;
            let (version, database, user) = if self.pooler_mode() == Some(true) {
                let messages = client
                    .simple_query("SELECT version(), current_database(), current_user")
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;
                let row = messages
                    .into_iter()
                    .find_map(|message| match message {
                        tokio_postgres::SimpleQueryMessage::Row(row) => Some(row),
                        _ => None,
                    })
                    .ok_or_else(|| {
                        AppError::DatabaseError(
                            "PostgreSQL test query returned no row".to_string(),
                        )
                    })?;

                (
                    row.get(0).unwrap_or_default().to_string(),
                    row.get(1).unwrap_or_default().to_string(),
                    row.get(2).unwrap_or_default().to_string(),
                )
            } else {
                let row = client
                    .query_one("SELECT version(), current_database(), current_user", &[])
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;
                (row.get(0), row.get(1), row.get(2))
            };

            Ok(CapabilityTestResult {
                success: true,
                message: format!("Connected to {} as {}", database, user),
                latency_ms: None,
                server_version: Some(version),
            })
        };

        tokio::time::timeout(std::time::Duration::from_secs(10), test_fn)
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
impl SqlQueryable for PostgresAdapter {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        if self.pooler_mode() == Some(true) {
            return self.execute_simple_query(sql).await;
        }

        let client = self.get_client().await?;
        let stmt = client
            .prepare(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

        let columns: Vec<CapabilityColumnMeta> = stmt
            .columns()
            .iter()
            .map(|col| CapabilityColumnMeta {
                name: col.name().to_string(),
                data_type: col.type_().name().to_string(),
            })
            .collect();

        let rows = client
            .query(&stmt, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let json_rows = SimpleConverter::rows_to_json(&rows);

        Ok(CapabilityQueryResult {
            columns,
            rows: json_rows,
        })
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError> {
        if self.pooler_mode() == Some(true) {
            return self.execute_simple_statement(sql).await;
        }

        let client = self.get_client().await?;
        let affected = client
            .execute(sql, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;
        Ok(affected)
    }
}

#[cfg(test)]
mod tests {
    use super::{pool_max_size_for_connection_id, PostgresAdapter};
    use crate::types::{ConnectionProfile, DbType};
    use std::collections::HashMap;

    #[test]
    fn tab_scoped_connections_are_pinned_to_single_postgres_session() {
        assert_eq!(pool_max_size_for_connection_id("conn-1:tab-1"), Some(1));
    }

    #[test]
    fn base_connections_keep_default_postgres_pool_size() {
        assert_eq!(pool_max_size_for_connection_id("conn-1"), None);
    }

    #[test]
    fn manual_pooler_mode_is_pinned_to_single_session() {
        let profile = ConnectionProfile {
            id: "conn-1".to_string(),
            name: "test".to_string(),
            db_type: DbType::PostgreSQL,
            host: "localhost".to_string(),
            port: 5432,
            database: "postgres".to_string(),
            username: "postgres".to_string(),
            password: None,
            ssl_mode: None,
            ssl_config: None,
            ssh_tunnel: None,
            bastion: None,
            tunnel_profile_id: None,
            tunnel_inline: None,
            tunnel_remote_host: None,
            tunnel_remote_port: None,
            options: HashMap::new(),
            group: None,
            safe_mode: None,
            pooler_mode: Some(true),
        };

        assert!(PostgresAdapter::should_pin_single_session(&profile));
    }
}
