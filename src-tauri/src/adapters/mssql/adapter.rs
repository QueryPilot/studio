use async_trait::async_trait;
use bb8::Pool;
use bb8_tiberius::ConnectionManager;
use futures::FutureExt;
use regex::Regex;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use tiberius::{AuthMethod, Config, EncryptionLevel};
use tokio::sync::RwLock;

use super::simple_converter::SimpleConverter;
use super::types::MssqlTypeConverter;
use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityColumnMeta, CapabilityQueryResult,
    CapabilityTestResult, SqlQueryable,
};
use crate::error::AppError;
use crate::types::*;

/// SQL Server adapter using tiberius with bb8 connection pooling.
pub struct MssqlAdapter {
    pool: Arc<RwLock<Option<Pool<ConnectionManager>>>>,
}

impl MssqlAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(RwLock::new(None)),
        }
    }

    /// Best-effort reset of per-session plan options that can leak from prior tabs/queries.
    /// When SHOWPLAN is left ON, SQL Server returns plan rows instead of query rows.
    pub async fn reset_session_state(conn: &mut bb8::PooledConnection<'_, ConnectionManager>) {
        const RESET_SQL: [&str; 3] = [
            "SET SHOWPLAN_TEXT OFF",
            "SET SHOWPLAN_ALL OFF",
            "SET SHOWPLAN_XML OFF",
        ];

        for statement in RESET_SQL {
            match conn.simple_query(statement).await {
                Ok(result) => {
                    if let Err(e) = result.into_first_result().await {
                        tracing::warn!(
                            "Failed to drain MSSQL session reset result for '{}': {}",
                            statement,
                            e
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "Failed to reset MSSQL session option with '{}': {}",
                        statement,
                        e
                    );
                }
            }
        }
    }

    /// Get the pool
    async fn get_pool_ref(&self) -> Result<Pool<ConnectionManager>, AppError> {
        let pool_guard = self.pool.read().await;
        pool_guard
            .clone()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))
    }

    /// Get the pool for streaming queries
    pub async fn get_pool(&self) -> Option<Pool<ConnectionManager>> {
        self.pool.read().await.clone()
    }

    fn build_config(profile: &ConnectionProfile) -> Result<Config, AppError> {
        let mut config = Config::new();

        config.host(&profile.host);
        config.port(profile.port);
        config.database(&profile.database);
        let mut trust_server_certificate_override: Option<bool> = None;

        // Authentication - check for Windows auth option
        let use_windows_auth = profile
            .options
            .get("trusted_connection")
            .map(|v| v.to_lowercase() == "true" || v == "1")
            .unwrap_or(false);

        if use_windows_auth {
            #[cfg(target_os = "windows")]
            {
                config.authentication(AuthMethod::Integrated);
            }
            #[cfg(not(target_os = "windows"))]
            {
                return Err(AppError::Internal(
                    "Windows Authentication is only supported on Windows".into(),
                ));
            }
        } else {
            config.authentication(AuthMethod::sql_server(
                &profile.username,
                profile.password.as_deref().unwrap_or(""),
            ));
        }

        // Apply connection options
        for (key, value) in &profile.options {
            match key.to_lowercase().as_str() {
                "application_name" | "applicationname" | "app" => {
                    config.application_name(value);
                }
                "instance" | "instance_name" => {
                    config.instance_name(value);
                }
                "trust_cert" | "trustservercertificate" => {
                    let normalized = value.to_lowercase();
                    if normalized == "true" || value == "1" {
                        trust_server_certificate_override = Some(true);
                    } else if normalized == "false" || value == "0" {
                        trust_server_certificate_override = Some(false);
                    }
                }
                _ => {
                    tracing::debug!("Ignoring unknown MSSQL option: {}={}", key, value);
                }
            }
        }

        // SSL/TLS configuration
        match profile.ssl_mode {
            Some(SslMode::Disable) => {
                config.encryption(EncryptionLevel::NotSupported);
            }
            Some(SslMode::Allow) | Some(SslMode::Prefer) => {
                // SQL Server uses opportunistic encryption when level is Off.
                config.encryption(EncryptionLevel::Off);
            }
            Some(SslMode::Require) | Some(SslMode::VerifyCa) | Some(SslMode::VerifyFull) => {
                config.encryption(EncryptionLevel::Required);
            }
            None => {
                // Default to opportunistic encryption
                config.encryption(EncryptionLevel::Off);
            }
        }

        let default_trust_server_cert = !matches!(
            profile.ssl_mode,
            Some(SslMode::VerifyCa) | Some(SslMode::VerifyFull)
        );
        if trust_server_certificate_override.unwrap_or(default_trust_server_cert) {
            config.trust_cert();
        }

        Ok(config)
    }

    fn quote_identifier(name: &str) -> String {
        format!("[{}]", name.replace(']', "]]"))
    }

    fn unquote_identifier(name: &str) -> String {
        let trimmed = name.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
            return trimmed[1..trimmed.len() - 1].replace("]]", "]");
        }
        trimmed.to_string()
    }

    fn parse_table_ref(table_ref: &str) -> Option<(String, String)> {
        let token = table_ref.split_whitespace().next()?;
        let parts: Vec<&str> = token.split('.').collect();
        match parts.len() {
            1 => Some(("dbo".to_string(), Self::unquote_identifier(parts[0]))),
            2 => Some((
                Self::unquote_identifier(parts[0]),
                Self::unquote_identifier(parts[1]),
            )),
            _ => None,
        }
    }

    async fn rewrite_select_star_with_casts(
        conn: &mut bb8::PooledConnection<'_, ConnectionManager>,
        sql: &str,
    ) -> Result<Option<String>, AppError> {
        let re = Regex::new(r"(?is)^\s*select\s+(top\s+\d+\s+)?\*\s+from\s+([^\s;]+)(.*)$")
            .map_err(|e| AppError::Internal(format!("Regex error: {}", e)))?;
        let caps = match re.captures(sql) {
            Some(caps) => caps,
            None => return Ok(None),
        };

        let top_clause = caps.get(1).map(|m| m.as_str().trim().to_string());
        let table_ref = caps.get(2).map(|m| m.as_str()).unwrap_or_default();
        let tail = caps.get(3).map(|m| m.as_str()).unwrap_or_default();

        let (schema_name, table_name) = match Self::parse_table_ref(table_ref) {
            Some(names) => names,
            None => return Ok(None),
        };

        let schema_escaped = schema_name.replace('\'', "''");
        let table_escaped = table_name.replace('\'', "''");
        let columns_sql = format!(
            "SELECT c.name, t.name as type_name \
             FROM sys.columns c \
             JOIN sys.types t ON c.user_type_id = t.user_type_id \
             JOIN sys.objects obj ON c.object_id = obj.object_id \
             JOIN sys.schemas s ON obj.schema_id = s.schema_id \
             WHERE s.name = '{}' AND obj.name = '{}' AND obj.type IN ('U', 'V') \
             ORDER BY c.column_id",
            schema_escaped, table_escaped
        );

        let result = conn
            .simple_query(columns_sql.as_str())
            .await
            .map_err(|e| AppError::DatabaseError(format!("Column query failed: {}", e)))?;
        let rows = result
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Column query failed: {}", e)))?;

        if rows.is_empty() {
            return Ok(None);
        }

        let mut column_exprs = Vec::with_capacity(rows.len());
        for row in rows {
            let column_name: Option<&str> = row.try_get(0).ok().flatten();
            let type_name: Option<&str> = row.try_get(1).ok().flatten();
            let column_name = match column_name {
                Some(name) => name,
                None => continue,
            };
            let quoted = Self::quote_identifier(column_name);
            let type_name = type_name.unwrap_or("").to_ascii_lowercase();
            let expr = match type_name.as_str() {
                "sql_variant" => format!(
                    "CONVERT(NVARCHAR(MAX), {}) AS [converted_{}]",
                    quoted, column_name
                ),
                "geography" | "geometry" => {
                    format!("{}.STAsText() AS [text_{}]", quoted, column_name)
                }
                "hierarchyid" => format!("{}.ToString() AS [string_{}]", quoted, column_name),
                _ => quoted,
            };
            column_exprs.push(expr);
        }

        if column_exprs.is_empty() {
            return Ok(None);
        }

        let mut rewritten = String::new();
        rewritten.push_str("SELECT ");
        if let Some(top) = top_clause {
            rewritten.push_str(&top);
            rewritten.push(' ');
        }
        rewritten.push_str(&column_exprs.join(", "));
        rewritten.push_str(" FROM ");
        rewritten.push_str(&format!(
            "{}.{}",
            Self::quote_identifier(&schema_name),
            Self::quote_identifier(&table_name)
        ));
        rewritten.push_str(tail);

        Ok(Some(rewritten))
    }

    /// Rewrite explicit column queries (SELECT col1, col2, ... FROM table) to cast unsupported types
    async fn rewrite_explicit_columns_with_casts(
        conn: &mut bb8::PooledConnection<'_, ConnectionManager>,
        sql: &str,
    ) -> Result<Option<String>, AppError> {
        // Match SELECT [TOP N] <columns> FROM <table> [rest]
        // Note: Rust regex doesn't support lookahead, so we check for SELECT * programmatically
        let re = Regex::new(r"(?is)^\s*select\s+(top\s+\d+\s+)?(.+?)\s+from\s+([^\s;(]+)(.*)$")
            .map_err(|e| AppError::Internal(format!("Regex error: {}", e)))?;
        let caps = match re.captures(sql) {
            Some(caps) => caps,
            None => return Ok(None),
        };

        let top_clause = caps.get(1).map(|m| m.as_str().trim().to_string());
        let columns_part = caps.get(2).map(|m| m.as_str()).unwrap_or_default();

        // Skip if this is a SELECT * query - let rewrite_select_star_with_casts handle it
        let columns_trimmed = columns_part.trim();
        if columns_trimmed == "*" || columns_trimmed.starts_with("* ") {
            return Ok(None);
        }
        let table_ref = caps.get(3).map(|m| m.as_str()).unwrap_or_default();
        let tail = caps.get(4).map(|m| m.as_str()).unwrap_or_default();

        let (schema_name, table_name) = match Self::parse_table_ref(table_ref) {
            Some(names) => names,
            None => return Ok(None),
        };

        // Get column metadata for the table
        let schema_escaped = schema_name.replace('\'', "''");
        let table_escaped = table_name.replace('\'', "''");
        let columns_sql = format!(
            "SELECT c.name, t.name as type_name \
             FROM sys.columns c \
             JOIN sys.types t ON c.user_type_id = t.user_type_id \
             JOIN sys.objects obj ON c.object_id = obj.object_id \
             JOIN sys.schemas s ON obj.schema_id = s.schema_id \
             WHERE s.name = '{}' AND obj.name = '{}' AND obj.type IN ('U', 'V')",
            schema_escaped, table_escaped
        );

        let result = conn
            .simple_query(columns_sql.as_str())
            .await
            .map_err(|e| AppError::DatabaseError(format!("Column query failed: {}", e)))?;
        let rows = result
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Column query failed: {}", e)))?;

        if rows.is_empty() {
            return Ok(None);
        }

        // Build a map of column name (lowercase) -> type name
        let mut col_types: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for row in rows {
            let column_name: Option<&str> = row.try_get(0).ok().flatten();
            let type_name: Option<&str> = row.try_get(1).ok().flatten();
            if let (Some(name), Some(typ)) = (column_name, type_name) {
                col_types.insert(name.to_ascii_lowercase(), typ.to_ascii_lowercase());
            }
        }

        // Parse and rewrite columns - simple comma-split with parenthesis awareness
        let columns = Self::split_columns(columns_part);
        let mut any_rewritten = false;
        let mut new_columns = Vec::with_capacity(columns.len());

        for col_expr in columns {
            let trimmed = col_expr.trim();
            // Try to extract simple column name (handles: col, [col], table.col, table.[col])
            if let Some(col_name) = Self::extract_simple_column_name(trimmed) {
                let col_lower = col_name.to_ascii_lowercase();
                if let Some(type_name) = col_types.get(&col_lower) {
                    let quoted = Self::quote_identifier(&col_name);
                    let rewritten = match type_name.as_str() {
                        "sql_variant" => {
                            any_rewritten = true;
                            format!("CONVERT(NVARCHAR(MAX), {}) AS {}", quoted, quoted)
                        }
                        "geography" | "geometry" => {
                            any_rewritten = true;
                            format!("{}.STAsText() AS {}", quoted, quoted)
                        }
                        "hierarchyid" => {
                            any_rewritten = true;
                            format!("{}.ToString() AS {}", quoted, quoted)
                        }
                        _ => trimmed.to_string(),
                    };
                    new_columns.push(rewritten);
                    continue;
                }
            }
            // Keep as-is if not a simple column or not a problematic type
            new_columns.push(trimmed.to_string());
        }

        if !any_rewritten {
            return Ok(None);
        }

        let mut rewritten = String::new();
        rewritten.push_str("SELECT ");
        if let Some(top) = top_clause {
            rewritten.push_str(&top);
            rewritten.push(' ');
        }
        rewritten.push_str(&new_columns.join(", "));
        rewritten.push_str(" FROM ");
        rewritten.push_str(&format!(
            "{}.{}",
            Self::quote_identifier(&schema_name),
            Self::quote_identifier(&table_name)
        ));
        rewritten.push_str(tail);

        Ok(Some(rewritten))
    }

    /// Split column list by commas, respecting parentheses
    fn split_columns(columns_part: &str) -> Vec<&str> {
        let mut result = Vec::new();
        let mut depth: i32 = 0;
        let mut start = 0;

        for (i, ch) in columns_part.char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => depth = depth.saturating_sub(1),
                ',' if depth == 0 => {
                    result.push(&columns_part[start..i]);
                    start = i + 1;
                }
                _ => {}
            }
        }
        if start < columns_part.len() {
            result.push(&columns_part[start..]);
        }
        result
    }

    /// Rewrite SQL to handle unsupported column types (sql_variant, geography, geometry, hierarchyid).
    /// Performs a preflight check using sys.dm_exec_describe_first_result_set, then rewrites
    /// SELECT queries to cast/convert unsupported types. Returns the (possibly rewritten) SQL.
    pub async fn rewrite_for_unsupported_types(
        conn: &mut bb8::PooledConnection<'_, bb8_tiberius::ConnectionManager>,
        sql: &str,
    ) -> Result<String, AppError> {
        let escaped_sql = sql.replace('\'', "''");
        let describe_sql = format!(
            "SELECT column_ordinal, name, system_type_name, error_number, error_message \
             FROM sys.dm_exec_describe_first_result_set(N'{}', NULL, 1)",
            escaped_sql
        );
        let mut unsupported_columns: Vec<String> = Vec::new();
        let mut preflight_ok = false;

        if let Ok(describe_result) = conn.simple_query(describe_sql.as_str()).await {
            if let Ok(rows) = describe_result.into_first_result().await {
                preflight_ok = true;
                for row in rows {
                    let error_number: Option<i32> = row.try_get(3).ok().flatten();
                    if error_number.is_some() {
                        preflight_ok = false;
                        unsupported_columns.clear();
                        break;
                    }

                    let system_type_name: Option<&str> = row.try_get(2).ok().flatten();
                    let type_name = system_type_name.unwrap_or("").to_ascii_lowercase();
                    let is_variant = type_name.starts_with("sql_variant");
                    let is_clr_udt =
                        matches!(type_name.as_str(), "geography" | "geometry" | "hierarchyid");

                    if is_variant || is_clr_udt {
                        let column_name: Option<&str> = row.try_get(1).ok().flatten();
                        let ordinal: Option<i32> = row.try_get(0).ok().flatten();
                        let label = column_name
                            .map(|name| name.to_string())
                            .or_else(|| ordinal.map(|idx| format!("column_{}", idx)))
                            .unwrap_or_else(|| "column".to_string());
                        let display_type = system_type_name.unwrap_or("UNKNOWN");
                        unsupported_columns.push(format!("{} ({})", label, display_type));
                    }
                }
            }
        }

        let mut sql = sql.to_string();

        if !preflight_ok {
            if let Some(rewritten) =
                Self::rewrite_select_star_with_casts(conn, sql.as_str()).await?
            {
                sql = rewritten;
            } else if let Some(rewritten) =
                Self::rewrite_explicit_columns_with_casts(conn, sql.as_str()).await?
            {
                sql = rewritten;
            }
        } else if !unsupported_columns.is_empty() {
            if let Some(rewritten) =
                Self::rewrite_select_star_with_casts(conn, sql.as_str()).await?
            {
                sql = rewritten;
            } else if let Some(rewritten) =
                Self::rewrite_explicit_columns_with_casts(conn, sql.as_str()).await?
            {
                sql = rewritten;
            } else {
                return Err(AppError::Unsupported(format!(
                    "Unsupported SQL Server column types detected: {}. Cast them to NVARCHAR/VARBINARY or exclude them from the query.",
                    unsupported_columns.join(", ")
                )));
            }
        }

        Ok(sql)
    }

    /// Extract simple column name from expression (handles col, [col], table.col, etc.)
    fn extract_simple_column_name(expr: &str) -> Option<String> {
        let trimmed = expr.trim();

        // Skip if it contains operators, function calls, or AS keyword
        let upper = trimmed.to_ascii_uppercase();
        if upper.contains(" AS ")
            || trimmed.contains('(')
            || trimmed.contains('+')
            || trimmed.contains('-')
            || trimmed.contains('*')
            || trimmed.contains('/')
        {
            return None;
        }

        // Handle qualified names: schema.table.col or table.col or col
        let parts: Vec<&str> = trimmed.split('.').collect();
        let last = parts.last()?;
        Some(Self::unquote_identifier(last))
    }
}

impl Default for MssqlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseCapability for MssqlAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        // Disconnect if already connected
        if self.pool.read().await.is_some() {
            self.disconnect().await?;
        }

        let config = Self::build_config(profile)?;

        // Create connection manager
        let mgr = ConnectionManager::new(config);

        // Build pool
        let pool = Pool::builder()
            .max_size(50)
            .connection_timeout(std::time::Duration::from_secs(10))
            .build(mgr)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create pool: {}", e)))?;

        // Test connection by getting a connection and dropping it immediately
        {
            let _conn = pool
                .get()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to connect: {}", e)))?;
            // _conn dropped here
        }

        *self.pool.write().await = Some(pool);

        Ok(())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        // Take the pool and drop it - bb8 doesn't have an explicit close method
        // but dropping the pool will close all connections
        let _ = self.pool.write().await.take();
        Ok(())
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let start = std::time::Instant::now();
        // Use timeout to avoid hanging on dead connections
        let test = async {
            let pool = self.get_pool_ref().await?;
            let mut conn = pool
                .get()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

            // Get SQL Server version
            let row = conn
                .simple_query("SELECT @@VERSION, DB_NAME(), SUSER_NAME()")
                .await
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?
                .into_first_result()
                .await
                .map_err(|e| AppError::DatabaseError(format!("Failed to get result: {}", e)))?
                .into_iter()
                .next();

            match row {
                Some(row) => {
                    let version: Option<&str> = row.try_get(0).ok().flatten();
                    let database: Option<&str> = row.try_get(1).ok().flatten();
                    let user: Option<&str> = row.try_get(2).ok().flatten();

                    Ok(CapabilityTestResult {
                        success: true,
                        message: format!(
                            "Connected to {} as {}",
                            database.unwrap_or("unknown"),
                            user.unwrap_or("unknown")
                        ),
                        latency_ms: Some(start.elapsed().as_millis() as u64),
                        server_version: version.map(|s| s.to_string()),
                    })
                }
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
impl SqlQueryable for MssqlAdapter {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        let pool = self.get_pool_ref().await?;
        let mut conn = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        Self::reset_session_state(&mut conn).await;

        let sql = Self::rewrite_for_unsupported_types(&mut conn, sql).await?;

        let query_result =
            AssertUnwindSafe(async move {
                let mut result = conn
                    .simple_query(sql.as_str())
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

                // Get column metadata - columns() is async
                let columns_opt = result.columns().await.map_err(|e| {
                    AppError::DatabaseError(format!("Failed to get columns: {}", e))
                })?;

                let columns: Vec<CapabilityColumnMeta> = columns_opt
                    .map(|cols| {
                        cols.iter()
                            .map(|col| CapabilityColumnMeta {
                                name: col.name().to_string(),
                                data_type: MssqlTypeConverter::column_type_to_string(
                                    &col.column_type(),
                                ),
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                // Collect rows
                let rows: Vec<tiberius::Row> = result.into_first_result().await.map_err(|e| {
                    AppError::DatabaseError(format!("Failed to collect rows: {}", e))
                })?;

                // Convert to JSON
                let json_rows: Vec<Vec<serde_json::Value>> =
                    rows.iter().map(SimpleConverter::row_to_json).collect();

                Ok(CapabilityQueryResult {
                    columns,
                    rows: json_rows,
                })
            })
            .catch_unwind()
            .await;

        match query_result {
            Ok(result) => result,
            Err(panic_info) => {
                let msg = if let Some(s) = panic_info.downcast_ref::<String>() {
                    s.clone()
                } else if let Some(s) = panic_info.downcast_ref::<&str>() {
                    s.to_string()
                } else {
                    "Unknown panic in query execution".to_string()
                };
                tracing::warn!(
                    "MSSQL query panic caught (likely unsupported column type): {}",
                    msg
                );
                Err(AppError::Unsupported(format!(
                    "Query contains unsupported SQL Server column type: {}. Try selecting specific columns to exclude unsupported types.",
                    msg
                )))
            }
        }
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError> {
        let pool = self.get_pool_ref().await?;
        let mut conn = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        Self::reset_session_state(&mut conn).await;

        let result = conn
            .execute(sql, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;

        Ok(result.rows_affected().iter().sum())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_table_ref() {
        assert_eq!(
            MssqlAdapter::parse_table_ref("dbo.activity_logs"),
            Some(("dbo".to_string(), "activity_logs".to_string()))
        );
        assert_eq!(
            MssqlAdapter::parse_table_ref("[dbo].[activity_logs]"),
            Some(("dbo".to_string(), "activity_logs".to_string()))
        );
        assert_eq!(
            MssqlAdapter::parse_table_ref("activity_logs"),
            Some(("dbo".to_string(), "activity_logs".to_string()))
        );
        // Test spaces
        assert_eq!(
            MssqlAdapter::parse_table_ref("  dbo.activity_logs  "),
            Some(("dbo".to_string(), "activity_logs".to_string()))
        );
    }

    #[test]
    fn test_regex_matching() {
        let re =
            Regex::new(r"(?is)^\s*select\s+(top\s+\d+\s+)?\*\s+from\s+([^\s;]+)(.*)$").unwrap();

        let sql = "SELECT * FROM dbo.activity_logs";
        let caps = re.captures(sql).unwrap();
        assert_eq!(caps.get(2).map(|m| m.as_str()), Some("dbo.activity_logs"));

        let sql = "select * from [dbo].[activity_logs] order by id";
        let caps = re.captures(sql).unwrap();
        assert_eq!(
            caps.get(2).map(|m| m.as_str()),
            Some("[dbo].[activity_logs]")
        );

        let sql = "SELECT TOP 100 * FROM dbo.activity_logs";
        let caps = re.captures(sql).unwrap();
        assert_eq!(caps.get(1).map(|m| m.as_str().trim()), Some("TOP 100"));
        assert_eq!(caps.get(2).map(|m| m.as_str()), Some("dbo.activity_logs"));
    }
}
