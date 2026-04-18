use async_trait::async_trait;
use deadpool_postgres::{
    Config, ManagerConfig, Pool, PoolConfig, RecyclingMethod, Runtime, SslMode as PgSslMode,
};
use native_tls::{Certificate, TlsConnector};
use postgres_native_tls::MakeTlsConnector;
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use tokio::sync::RwLock;
use tokio_postgres::{
    types::{ToSql, Type},
    NoTls, Row,
};

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
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(RwLock::new(None)),
            pooler_mode: Arc::new(StdRwLock::new(None)),
        }
    }

    fn is_pooler_mode_error(error: &tokio_postgres::Error) -> bool {
        let message = error.to_string().to_lowercase();
        message.contains("pgbouncer")
            || message.contains("transaction pooling")
            || message.contains("prepared statement")
    }

    fn should_pin_single_session(profile: &ConnectionProfile) -> bool {
        is_tab_scoped_connection_id(&profile.id)
    }

    pub fn pooler_mode(&self) -> Option<bool> {
        self.pooler_mode.read().ok().and_then(|guard| *guard)
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

    pub async fn get_client(&self) -> Result<deadpool_postgres::Client, AppError> {
        let pool = self
            .get_pool()
            .await
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        // Use a timeout to prevent indefinite blocking when the pool is exhausted.
        // Tab-scoped connections use max_size=1, so concurrent queries queue up here.
        // 150s is generous — slow ORDER BY on large tables can legitimately hold a
        // connection for 60s+, and the next query must wait for it to finish.
        let client = tokio::time::timeout(std::time::Duration::from_secs(300), pool.get())
            .await
            .map_err(|_| {
                AppError::Internal(
                    "Timed out waiting for a database connection (pool exhausted after 300s). \
                     Another query may be holding the connection."
                        .to_string(),
                )
            })?
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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

    async fn execute_simple_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        let client = self.get_client().await?;
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

    async fn execute_typed_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        let client = self.get_client().await?;

        let typed_params: Vec<(&(dyn ToSql + Sync), Type)> = Vec::new();
        let rows = client
            .query_typed(sql, &typed_params)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Pooler-safe query failed: {}", e)))?;
        let columns = rows
            .first()
            .map(capability_columns_from_row)
            .unwrap_or_default();
        let json_rows = SimpleConverter::rows_to_json(&rows);

        Ok(CapabilityQueryResult {
            columns,
            rows: json_rows,
        })
    }

    async fn execute_simple_statement(&self, sql: &str) -> Result<u64, AppError> {
        let client = self.get_client().await?;
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

fn capability_columns_from_row(row: &Row) -> Vec<CapabilityColumnMeta> {
    row.columns()
        .iter()
        .map(|col| CapabilityColumnMeta {
            name: col.name().to_string(),
            data_type: col.type_().name().to_string(),
        })
        .collect()
}

fn strip_sql_comments(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let bytes = sql.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'\'' {
            result.push('\'');
            i += 1;
            while i < len {
                if bytes[i] == b'\'' && i + 1 < len && bytes[i + 1] == b'\'' {
                    result.push_str("''");
                    i += 2;
                } else if bytes[i] == b'\'' {
                    result.push('\'');
                    i += 1;
                    break;
                } else {
                    result.push(bytes[i] as char);
                    i += 1;
                }
            }
            continue;
        }

        if bytes[i] == b'-' && i + 1 < len && bytes[i + 1] == b'-' {
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        if bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2;
            }
            continue;
        }

        result.push(bytes[i] as char);
        i += 1;
    }

    result
}

fn is_multi_statement_sql(sql: &str) -> bool {
    let without_comments = strip_sql_comments(sql);
    let trimmed = without_comments.trim();
    let upper = trimmed.to_uppercase();

    if upper.contains("BEGIN;") || upper.contains("COMMIT;") || upper.contains("ROLLBACK;") {
        return true;
    }

    let semicolon_count = trimmed.matches(';').count();
    if semicolon_count > 1 {
        return true;
    }

    semicolon_count == 1 && !trimmed.trim_end().ends_with(';')
}

fn find_main_statement_keyword(sql: &str) -> Option<String> {
    let upper = sql.to_uppercase();
    let keywords = ["SELECT", "INSERT", "UPDATE", "DELETE", "TABLE", "VALUES"];
    let mut first_keyword_pos: Option<(usize, &str)> = None;

    for keyword in &keywords {
        let mut search_start = 0;
        while let Some(pos) = upper[search_start..].find(keyword) {
            let abs_pos = search_start + pos;
            let before_ok = abs_pos == 0 || !upper.as_bytes()[abs_pos - 1].is_ascii_alphanumeric();
            let after_ok = abs_pos + keyword.len() >= upper.len()
                || !upper.as_bytes()[abs_pos + keyword.len()].is_ascii_alphanumeric();

            if before_ok && after_ok {
                let depth = sql[..abs_pos].chars().fold(0i32, |depth, ch| match ch {
                    '(' => depth + 1,
                    ')' => depth - 1,
                    _ => depth,
                });

                if depth == 0 && first_keyword_pos.is_none_or(|(pos, _)| abs_pos < pos) {
                    first_keyword_pos = Some((abs_pos, keyword));
                }
            }

            search_start = abs_pos + 1;
        }
    }

    first_keyword_pos.map(|(_, keyword)| keyword.to_string())
}

fn is_row_returning_query(sql: &str) -> bool {
    let trimmed = sql.trim();
    let without_comments = trimmed
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");
    let cleaned = regex::Regex::new(r"/\*.*?\*/")
        .unwrap_or_else(|_| regex::Regex::new(r"a^").unwrap())
        .replace_all(&without_comments, "");
    let first_keyword = cleaned
        .split_whitespace()
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .to_uppercase();

    if first_keyword == "WITH" {
        return find_main_statement_keyword(&cleaned)
            .map(|keyword| matches!(keyword.as_str(), "SELECT" | "TABLE" | "VALUES"))
            .unwrap_or(false)
            || cleaned.to_uppercase().contains(" RETURNING ");
    }

    matches!(
        first_keyword.as_str(),
        "SELECT" | "EXPLAIN" | "SHOW" | "TABLE" | "VALUES"
    ) || cleaned.to_uppercase().contains(" RETURNING ")
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
                        AppError::DatabaseError("PostgreSQL test query returned no row".to_string())
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
            if is_multi_statement_sql(sql) || !is_row_returning_query(sql) {
                return self.execute_simple_query(sql).await;
            }

            return self.execute_typed_query(sql).await;
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
    fn pooler_mode_uses_default_pool_size() {
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
            databases: vec![],
            default_schema: None,
            trino_catalogs: None,
            trino_schema_filters: None,
        };

        // Pooler mode should NOT pin to single session — allows parallel queries
        assert!(!PostgresAdapter::should_pin_single_session(&profile));
    }

    #[test]
    fn returning_queries_are_treated_as_row_producing() {
        assert!(super::is_row_returning_query(
            "UPDATE users SET name = 'alice' RETURNING id"
        ));
        assert!(super::is_row_returning_query(
            "WITH updated AS (UPDATE users SET name = 'alice' RETURNING id) SELECT * FROM updated"
        ));
        assert!(!super::is_row_returning_query(
            "UPDATE users SET name = 'alice'"
        ));
    }

    #[test]
    fn multi_statement_detection_ignores_commented_semicolons() {
        assert!(!super::is_multi_statement_sql("-- ROLLBACK;\nSELECT 1"));
        assert!(super::is_multi_statement_sql("BEGIN; SELECT 1; COMMIT;"));
    }
}
