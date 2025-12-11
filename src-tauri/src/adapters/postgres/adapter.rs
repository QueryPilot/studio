use async_trait::async_trait;
use deadpool_postgres::Pool;
use native_tls::{Certificate, TlsConnector};
use postgres_native_tls::MakeTlsConnector;
use rust_decimal::Decimal;
use std::fs;
use std::sync::Arc;
use tokio_postgres::config::{ChannelBinding as PgChannelBinding, SslMode as PgSslMode};
use tokio_postgres::{Config, NoTls};
use uuid::Uuid;

use super::pool::PostgresPoolBuilder;
use super::query_fast::FastPostgresQueryExecutor;
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct PostgresAdapter {
    pool: Option<Pool>,
    connection_handle: Option<tokio::task::JoinHandle<()>>,
    query_executor: Option<Arc<FastPostgresQueryExecutor>>,
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            pool: None,
            connection_handle: None,
            query_executor: None,
        }
    }

    /// Get query executor (for fast path optimization)
    pub fn get_query_executor(&self) -> Option<Arc<FastPostgresQueryExecutor>> {
        self.query_executor.clone()
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

    /// Execute parameterized SQL statements within a transaction (SQL INJECTION SAFE)
    /// Uses proper $1, $2 placeholders with separate parameter values
    pub async fn execute_parameterized_transaction(
        &self,
        statements: Vec<crate::core::adapter::ParameterizedSql>,
    ) -> Result<Vec<u64>> {
        use crate::core::adapter::SqlParam;
        use tokio_postgres::types::ToSql;

        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let mut client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let transaction = client
            .transaction()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to begin transaction: {}", e)))?;

        let mut results = Vec::new();

        for stmt in statements {
            // Log the SQL and parameters for debugging
            tracing::info!("  Executing parameterized SQL: {}", stmt.sql);
            tracing::info!("  Parameters: {:?}", stmt.params);
            
            // Convert SqlParam to tokio_postgres compatible types
            // Note: PostgreSQL is strict about type sizes. Int values that fit in i32
            // should be sent as i32 to work with int4 columns. This is critical for
            // parameterized queries where the column type must match exactly.
            let params: Vec<Box<dyn ToSql + Sync + Send>> = stmt
                .params
                .iter()
                .map(|p| -> Box<dyn ToSql + Sync + Send> {
                    match p {
                        SqlParam::Null => Box::new(None::<String>),
                        SqlParam::Bool(b) => Box::new(*b),
                        SqlParam::Int(i) => {
                            // PostgreSQL int4 (serial/integer) expects i32, int8 (bigserial/bigint) expects i64
                            // Send as i32 if the value fits, otherwise i64
                            if *i >= i32::MIN as i64 && *i <= i32::MAX as i64 {
                                tracing::debug!("    Param Int({}) -> i32", i);
                                Box::new(*i as i32)
                            } else {
                                tracing::debug!("    Param Int({}) -> i64 (out of i32 range)", i);
                                Box::new(*i)
                            }
                        }
                        SqlParam::Float(f) => {
                            // Convert to Decimal for better PostgreSQL compatibility (money, numeric, decimal)
                            // f64 doesn't serialize properly to money type
                            if let Some(decimal) = Decimal::from_f64_retain(*f) {
                                tracing::info!("    Param Float({}) -> Decimal", f);
                                Box::new(decimal)
                            } else {
                                tracing::info!("    Param Float({}) -> f64 (fallback)", f);
                                Box::new(*f)
                            }
                        }
                        SqlParam::Text(s) => {
                            // Try to parse as UUID first - common for ID columns
                            // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                            if let Ok(uuid) = Uuid::parse_str(s) {
                                tracing::debug!("    Param Text('{}') -> UUID", s);
                                Box::new(uuid)
                            } 
                            // Try to parse as Decimal for precise numeric types (money, numeric, decimal)
                            else if let Ok(decimal) = s.parse::<rust_decimal::Decimal>() {
                                tracing::debug!("    Param Text('{}') -> Decimal (numeric string)", s);
                                Box::new(decimal)
                            }
                            else {
                                tracing::debug!("    Param Text('{}') -> String", s);
                                Box::new(s.clone())
                            }
                        }
                        SqlParam::Json(v) => Box::new(v.clone()),
                    }
                })
                .collect();

            let param_refs: Vec<&(dyn ToSql + Sync)> =
                params.iter().map(|p| p.as_ref() as &(dyn ToSql + Sync)).collect();

            let rows_affected = transaction
                .execute(&stmt.sql, &param_refs)
                .await
                .map_err(|e| {
                    AppError::DatabaseError(format!(
                        "Transaction failed on SQL '{}': {}",
                        stmt.sql, e
                    ))
                })?;
            results.push(rows_affected);
        }

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

        // Initialize components with pool
        let executor = Arc::new(FastPostgresQueryExecutor::new_with_pool(pool.clone()));

        self.pool = Some(pool);
        self.query_executor = Some(executor);

        Ok(())
    }

    async fn disconnect(&mut self) -> Result<()> {
        // Drop pool and components
        self.pool = None;
        self.query_executor = None;

        // Cancel connection task
        if let Some(handle) = self.connection_handle.take() {
            handle.abort();
        }

        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult> {
        // Use pool if available (new connection pooling), otherwise fall back to client
        if let Some(pool) = &self.pool {
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
            })
        } else {
            Err(AppError::ConnectionClosed("Not connected".into()))
        }
    }

    async fn is_connected(&self) -> bool {
        if let Some(pool) = &self.pool {
            // Try to get a connection from the pool and run a simple query
            if let Ok(conn) = pool.get().await {
                return conn.query_one("SELECT 1", &[]).await.is_ok();
            }
            false
        } else {
            false
        }
    }

    async fn query(&self, sql: &str) -> Result<QueryResult> {
        let executor = self
            .query_executor
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let (rows, columns, _execution_time) = executor.execute_single_fetch(sql).await?;

        Ok(QueryResult { columns, rows })
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
