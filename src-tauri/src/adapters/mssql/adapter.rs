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
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
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

    /// Get the pool
    async fn get_pool_ref(&self) -> Result<Pool<ConnectionManager>> {
        let pool_guard = self.pool.read().await;
        pool_guard
            .clone()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))
    }

    /// Get the pool for streaming queries
    pub async fn get_pool(&self) -> Option<Pool<ConnectionManager>> {
        self.pool.read().await.clone()
    }

    fn build_config(profile: &ConnectionProfile) -> Result<Config> {
        let mut config = Config::new();

        config.host(&profile.host);
        config.port(profile.port);
        config.database(&profile.database);

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
                    if value.to_lowercase() == "true" || value == "1" {
                        config.trust_cert();
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
            Some(SslMode::Require) | Some(SslMode::VerifyCa) | Some(SslMode::VerifyFull) => {
                config.encryption(EncryptionLevel::Required);
            }
            None => {
                // Default to opportunistic encryption
                config.encryption(EncryptionLevel::Off);
            }
        }

        // Trust the server certificate by default (useful for development)
        // Can be overridden via options above
        config.trust_cert();

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
        let token = table_ref.trim().split_whitespace().next()?;
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
    ) -> Result<Option<String>> {
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
             JOIN sys.tables tbl ON c.object_id = tbl.object_id \
             JOIN sys.schemas s ON tbl.schema_id = s.schema_id \
             WHERE s.name = '{}' AND tbl.name = '{}' \
             ORDER BY c.column_id",
            schema_escaped, table_escaped
        );

        let mut result = conn
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
            let column_name: Option<&str> = row.get(0);
            let type_name: Option<&str> = row.get(1);
            let column_name = match column_name {
                Some(name) => name,
                None => continue,
            };
            let quoted = Self::quote_identifier(column_name);
            let type_name = type_name.unwrap_or("").to_ascii_lowercase();
            let expr = match type_name.as_str() {
                "sql_variant" => format!("CONVERT(NVARCHAR(MAX), {}) AS {}", quoted, quoted),
                "geography" | "geometry" => format!("{}.STAsText() AS {}", quoted, quoted),
                "hierarchyid" => format!("{}.ToString() AS {}", quoted, quoted),
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
}

impl Default for MssqlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DbAdapter for MssqlAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
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

    async fn disconnect(&mut self) -> Result<()> {
        *self.pool.write().await = None;
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult> {
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
                    let version: Option<&str> = row.get(0);
                    let database: Option<&str> = row.get(1);
                    let user: Option<&str> = row.get(2);

                    Ok(ConnectionTestResult {
                        success: true,
                        message: format!(
                            "Connected to {} as {}",
                            database.unwrap_or("unknown"),
                            user.unwrap_or("unknown")
                        ),
                        version: version.map(|s| s.to_string()),
                        warnings: vec![],
                        detected_db_type: None,
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

    async fn is_connected(&self) -> bool {
        // Use timeout to avoid hanging on dead connections
        let check = async {
            let pool = self.get_pool_ref().await.ok()?;
            let mut conn = pool.get().await.ok()?;
            conn.simple_query("SELECT 1").await.ok()?;
            Some(())
        };
        
        // 5 second timeout - long enough for slow connections, short enough to not freeze UI
        tokio::time::timeout(std::time::Duration::from_secs(5), check)
            .await
            .map(|r| r.is_some())
            .unwrap_or(false)
    }

    async fn query(&self, sql: &str) -> Result<QueryResult> {
        let pool = self.get_pool_ref().await?;
        let mut conn = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;
        let escaped_sql = sql.replace('\'', "''");
        let describe_sql = format!(
            "SELECT column_ordinal, name, system_type_name, error_number, error_message \
             FROM sys.dm_exec_describe_first_result_set(N'{}', NULL, 1)",
            escaped_sql
        );
        let mut unsupported_columns: Vec<String> = Vec::new();
        let mut preflight_ok = false;

        if let Ok(mut describe_result) = conn.simple_query(describe_sql.as_str()).await {
            if let Ok(rows) = describe_result.into_first_result().await {
                preflight_ok = true;
                for row in rows {
                    let error_number: Option<i32> = row.get(3);
                    if error_number.is_some() {
                        preflight_ok = false;
                        unsupported_columns.clear();
                        break;
                    }

                    let system_type_name: Option<&str> = row.get(2);
                    let type_name = system_type_name.unwrap_or("").to_ascii_lowercase();
                    let is_variant = type_name.starts_with("sql_variant");
                    let is_clr_udt = matches!(
                        type_name.as_str(),
                        "geography" | "geometry" | "hierarchyid"
                    );

                    if is_variant || is_clr_udt {
                        let column_name: Option<&str> = row.get(1);
                        let ordinal: Option<i32> = row.get(0);
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
            if let Some(rewritten) = Self::rewrite_select_star_with_casts(&mut conn, sql.as_str()).await? {
                sql = rewritten;
            }
        } else if !unsupported_columns.is_empty() {
            match Self::rewrite_select_star_with_casts(&mut conn, sql.as_str()).await? {
                Some(rewritten) => {
                    sql = rewritten;
                }
                None => {
                    return Err(AppError::Unsupported(format!(
                        "Unsupported SQL Server column types detected: {}. Cast them to NVARCHAR/VARBINARY or exclude them from the query.",
                        unsupported_columns.join(", ")
                    )));
                }
            }
        }

        let query_result = AssertUnwindSafe(async move {
            let mut result = conn
                .simple_query(sql.as_str())
                .await
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

            // Get column metadata - columns() is async
            let columns_opt = result
                .columns()
                .await
                .map_err(|e| AppError::DatabaseError(format!("Failed to get columns: {}", e)))?;

            let columns: Vec<ColumnMeta> = columns_opt
                .map(|cols| {
                    cols.iter()
                        .map(|col| ColumnMeta {
                            name: col.name().to_string(),
                            data_type: MssqlTypeConverter::column_type_to_cell_type(
                                &col.column_type(),
                            ),
                            nullable: true, // SQL Server doesn't provide this in TDS column metadata
                            primary_key: false,
                            db_type: MssqlTypeConverter::column_type_to_string(&col.column_type()),
                            type_oid: None,
                            default_value: None,
                            comment: None,
                            enum_values: None,
                            type_category: None,
                            precision: None,
                            scale: None,
                        })
                        .collect()
                })
                .unwrap_or_default();

            // Collect rows
            let rows: Vec<tiberius::Row> = result
                .into_first_result()
                .await
                .map_err(|e| AppError::DatabaseError(format!("Failed to collect rows: {}", e)))?;

            // Convert to JSON
            let json_rows: Vec<Vec<serde_json::Value>> =
                rows.iter().map(SimpleConverter::row_to_json).collect();

            Ok(QueryResult {
                columns,
                rows: json_rows,
            })
        })
        .catch_unwind()
        .await;

        match query_result {
            Ok(result) => result,
            Err(_) => Err(AppError::Unsupported(
                "SQL_VARIANT columns or CLR UDTs are not supported by the MSSQL driver. Cast them to NVARCHAR/VARBINARY or exclude them from the query.".into(),
            )),
        }
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        let pool = self.get_pool_ref().await?;
        let mut conn = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let result = conn
            .execute(sql, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;

        Ok(result.rows_affected().iter().sum())
    }

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
            CellValueType::Uuid,
            CellValueType::Xml,
            CellValueType::Money,
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
