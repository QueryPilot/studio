use async_trait::async_trait;
use deadpool_postgres::Pool;
use native_tls::{Certificate, TlsConnector};
use postgres_native_tls::MakeTlsConnector;
use std::fs;
use tokio_postgres::config::{ChannelBinding as PgChannelBinding, SslMode as PgSslMode};
use tokio_postgres::{Config, NoTls};

use super::pool::PostgresPoolBuilder;
use super::simple_converter::SimpleConverter;
use super::types::PostgresTypeConverter;
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct PostgresAdapter {
    pool: Option<Pool>,
    connection_handle: Option<tokio::task::JoinHandle<()>>,
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            pool: None,
            connection_handle: None,
        }
    }

    /// Get the connection pool for streaming queries
    pub fn get_pool(&self) -> Option<Pool> {
        self.pool.clone()
    }

    /// Execute multiple SQL statements within a transaction
    /// This properly uses a SINGLE connection for all operations
    pub async fn execute_in_transaction(&self, statements: Vec<String>) -> Result<Vec<u64>> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        // Get ONE connection and hold it for the entire transaction
        let mut client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        // Start transaction
        let transaction = client
            .transaction()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to begin transaction: {}", e)))?;

        let mut results = Vec::new();

        // Execute all statements in the transaction
        for sql in statements {
            let rows_affected = transaction
                .execute(&sql, &[])
                .await
                .map_err(|e| AppError::DatabaseError(format!("Transaction failed: {}", e)))?;
            results.push(rows_affected);
        }

        // Commit transaction
        transaction
            .commit()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to commit transaction: {}", e)))?;

        Ok(results)
    }

    fn build_config(profile: &ConnectionProfile) -> Result<(Config, PgSslMode)> {
        let mut config = Config::new();
        config.host(&profile.host);
        config.port(profile.port);
        config.dbname(&profile.database);
        config.user(&profile.username);

        if let Some(password) = &profile.password {
            config.password(password);
        }

        // Determine SSL mode from profile or connection options
        let mut ssl_mode = profile
            .ssl_mode
            .and_then(Self::map_profile_ssl_mode)
            .unwrap_or(PgSslMode::Disable);
        let mut channel_binding: Option<PgChannelBinding> = None;
        let mut runtime_options: Vec<String> = Vec::new();

        for (key, value) in &profile.options {
            let key_lower = key.to_ascii_lowercase();
            match key_lower.as_str() {
                "sslmode" => {
                    if let Some(parsed) = Self::parse_ssl_mode(value) {
                        ssl_mode = parsed;
                    }
                }
                "channel_binding" => {
                    if let Some(parsed) = Self::parse_channel_binding(value) {
                        channel_binding = Some(parsed);
                    }
                }
                _ => runtime_options.push(format!("-c {}={}", key, value)),
            }
        }

        config.ssl_mode(ssl_mode);

        if let Some(binding) = channel_binding {
            config.channel_binding(binding);
        }

        // TCP optimizations: Reduce network latency and improve responsiveness
        use std::time::Duration;
        config.tcp_user_timeout(Duration::from_secs(60));
        config.connect_timeout(Duration::from_secs(10));
        config.keepalives(true);
        config.keepalives_idle(Duration::from_secs(30));

        // Add additional runtime options (converted to -c style parameters)
        if !runtime_options.is_empty() {
            config.options(&runtime_options.join(" "));
        }

        Ok((config, ssl_mode))
    }

    fn map_profile_ssl_mode(mode: SslMode) -> Option<PgSslMode> {
        match mode {
            SslMode::Disable => Some(PgSslMode::Disable),
            SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => Some(PgSslMode::Require),
        }
    }

    fn parse_ssl_mode(value: &str) -> Option<PgSslMode> {
        match value.to_ascii_lowercase().as_str() {
            "disable" => Some(PgSslMode::Disable),
            "prefer" => Some(PgSslMode::Prefer),
            "require" | "verify-ca" | "verify_full" | "verify-full" => Some(PgSslMode::Require),
            _ => None,
        }
    }

    fn parse_channel_binding(value: &str) -> Option<PgChannelBinding> {
        match value.to_ascii_lowercase().as_str() {
            "disable" => Some(PgChannelBinding::Disable),
            "prefer" => Some(PgChannelBinding::Prefer),
            "require" => Some(PgChannelBinding::Require),
            _ => None,
        }
    }

    fn build_tls_connector(
        profile: &ConnectionProfile,
        ssl_mode: PgSslMode,
    ) -> Result<Option<MakeTlsConnector>> {
        if matches!(ssl_mode, PgSslMode::Disable) {
            return Ok(None);
        }

        let mut builder = TlsConnector::builder();

        if let Some(ssl_config) = &profile.ssl_config {
            if let Some(ca_file) = &ssl_config.ca_file {
                let pem = fs::read(ca_file).map_err(|err| {
                    AppError::Internal(format!(
                        "Failed to read CA certificate file {}: {}",
                        ca_file, err
                    ))
                })?;
                let cert = Certificate::from_pem(&pem).map_err(|err| {
                    AppError::Internal(format!(
                        "Failed to parse CA certificate from {}: {}",
                        ca_file, err
                    ))
                })?;
                builder.add_root_certificate(cert);
            }

            if ssl_config.key_file.is_some() || ssl_config.cert_file.is_some() {
                tracing::warn!(
                    "Client TLS key/certificate files are not yet supported for PostgreSQL adapter"
                );
            }
        }

        let connector = builder
            .build()
            .map_err(|err| AppError::Internal(format!("Failed to build TLS connector: {}", err)))?;

        Ok(Some(MakeTlsConnector::new(connector)))
    }
}

#[async_trait]
impl DbAdapter for PostgresAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        // Disconnect if already connected
        if self.pool.is_some() {
            self.disconnect().await?;
        }

        let (config, ssl_mode) = Self::build_config(profile)?;
        let tls = Self::build_tls_connector(profile, ssl_mode)?;

        // Create connection pool (2-3 connections per window)
        let pool_result = match tls {
            Some(tls_connector) => PostgresPoolBuilder::default().build(config, tls_connector),
            None => PostgresPoolBuilder::default().build(config, NoTls),
        };

        let pool = pool_result
            .map_err(|e| AppError::Internal(format!("Failed to create connection pool: {}", e)))?;

        // Get a connection to verify pool is working
        let _conn = pool.get().await.map_err(|e| {
            AppError::Internal(format!("Failed to get connection from pool: {}", e))
        })?;

        self.pool = Some(pool);

        Ok(())
    }

    async fn disconnect(&mut self) -> Result<()> {
        // Drop pool
        self.pool = None;

        // Cancel connection task
        if let Some(handle) = self.connection_handle.take() {
            handle.abort();
        }

        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult> {
        // Use pool if available (new connection pooling), otherwise fall back to client
        if let Some(pool) = &self.pool {
            // Use timeout to avoid hanging on dead connections
            let test = async {
                let conn = pool.get().await.map_err(|e| {
                    AppError::ConnectionClosed(format!("Failed to get connection from pool: {}", e))
                })?;

                // Test query and get version
                let row = conn
                    .query_one("SELECT version(), current_database(), current_user", &[])
                    .await?;

                let version: String = row.get(0);
                let database: String = row.get(1);
                let user: String = row.get(2);

                Ok(ConnectionTestResult {
                    success: true,
                    message: format!("Connected to {} as {}", database, user),
                    version: Some(version),
                    warnings: vec![],
                    detected_db_type: None,
                })
            };

            // 10 second timeout for test_connection (longer than is_connected since it does more work)
            tokio::time::timeout(std::time::Duration::from_secs(10), test)
                .await
                .map_err(|_| AppError::ConnectionClosed("Connection test timed out".into()))?
        } else {
            Err(AppError::ConnectionClosed("Not connected".into()))
        }
    }

    async fn is_connected(&self) -> bool {
        if let Some(pool) = &self.pool {
            // Try to get a connection from the pool and run a simple query
            // Use timeout to avoid hanging on dead connections
            let check = async {
                let conn = pool.get().await.ok()?;
                conn.query_one("SELECT 1", &[]).await.ok()?;
                Some(())
            };
            
            // 5 second timeout - long enough for slow connections, short enough to not freeze UI
            tokio::time::timeout(std::time::Duration::from_secs(5), check)
                .await
                .map(|r| r.is_some())
                .unwrap_or(false)
        } else {
            false
        }
    }

    async fn query(&self, sql: &str) -> Result<QueryResult> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let conn = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let rows = conn.query(sql, &[]).await?;

        // Build column metadata
        let columns = if rows.is_empty() {
            vec![]
        } else {
            rows[0]
                .columns()
                .iter()
                .map(|col| ColumnMeta {
                    name: col.name().to_string(),
                    data_type: PostgresTypeConverter::type_to_cell_type(col.type_()),
                    nullable: true,
                    primary_key: false,
                    db_type: col.type_().name().to_string(),
                    type_oid: Some(col.type_().oid()),
                    default_value: None,
                    comment: None,
                    enum_values: None,
                    type_category: None,
                    precision: None,
                    scale: None,
                })
                .collect()
        };

        // Use simple converter (no JSON parsing overhead!)
        let json_rows = SimpleConverter::rows_to_json(&rows);

        Ok(QueryResult { columns, rows: json_rows })
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let rows_affected = client.execute(sql, &[]).await?;
        Ok(rows_affected)
    }

    // NOTE: Introspection methods removed. Frontend now uses IntrospectionService
    // which generates dialect-specific SQL and executes via the `query` method.
    // See: src/services/introspectionService.ts

    fn get_supported_types(&self) -> Vec<CellValueType> {
        vec![
            CellValueType::Null,
            CellValueType::Text,
            CellValueType::Integer,
            CellValueType::Decimal,
            CellValueType::Boolean,
            CellValueType::Date,
            CellValueType::Time,
            CellValueType::DateTime,
            CellValueType::Binary,
            CellValueType::Json,
            CellValueType::Uuid,
            CellValueType::Array(Box::new(CellValueType::Text)),
            CellValueType::Composite(vec![]),
            CellValueType::Range(Box::new(CellValueType::Integer)),
            CellValueType::Multirange(Box::new(CellValueType::Integer)),
            CellValueType::Geometry,
            CellValueType::Geography,
            CellValueType::Xml,
            CellValueType::Inet,
            CellValueType::Cidr,
            CellValueType::MacAddr,
            CellValueType::Interval,
            CellValueType::TsVector,
            CellValueType::TsQuery,
            CellValueType::Money,
            CellValueType::Hstore,
            CellValueType::Ltree,
            CellValueType::Cube,
        ]
    }

    fn supports_schemas(&self) -> bool {
        true
    }
    fn supports_procedures(&self) -> bool {
        true
    }
    fn supports_functions(&self) -> bool {
        true
    }
}
