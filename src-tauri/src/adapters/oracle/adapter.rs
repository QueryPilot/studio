use async_trait::async_trait;
use oracle::pool::{CloseMode, Pool, PoolBuilder};
use oracle::sql_type::{OracleType, Timestamp};
use oracle::SqlValue;
use serde_json::Value;
use std::borrow::ToOwned;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;

use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityColumnMeta, CapabilityQueryResult,
    CapabilityTestResult, SqlQueryable,
};
use crate::error::AppError;
use crate::types::ConnectionProfile;

#[derive(Clone)]
pub struct OracleAdapter {
    pool: Arc<Mutex<Option<Pool>>>,
    session_schema: Arc<Mutex<Option<String>>>,
}

impl OracleAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(Mutex::new(None)),
            session_schema: Arc::new(Mutex::new(None)),
        }
    }

    async fn run_blocking<T, F>(&self, op: F) -> Result<T, AppError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, AppError> + Send + 'static,
    {
        tokio::task::spawn_blocking(op)
            .await
            .map_err(|err| AppError::Internal(format!("Oracle task failed: {}", err)))?
    }

    async fn with_connection<T, F>(&self, op: F) -> Result<T, AppError>
    where
        T: Send + 'static,
        F: FnOnce(&oracle::Connection) -> Result<T, AppError> + Send + 'static,
    {
        let pool = Arc::clone(&self.pool);
        let schema = self
            .session_schema
            .lock()
            .map_err(|_| AppError::Internal("Oracle session schema lock poisoned".into()))?
            .clone();

        self.run_blocking(move || {
            let guard = pool
                .lock()
                .map_err(|_| AppError::Internal("Oracle pool lock poisoned".into()))?;
            let pool = guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
            let mut conn = pool.get().map_err(map_oracle_error)?;
            conn.set_autocommit(true);
            if let Some(schema) = schema.as_deref() {
                conn.set_current_schema(schema).map_err(map_oracle_error)?;
            }
            op(&conn)
        })
        .await
    }

    /// Get a connection from the pool for direct streaming access.
    /// The caller is responsible for running this inside spawn_blocking.
    pub fn get_connection_blocking(&self) -> std::result::Result<oracle::Connection, AppError> {
        let guard = self
            .pool
            .lock()
            .map_err(|_| AppError::Internal("Oracle pool lock poisoned".into()))?;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let mut conn = pool.get().map_err(|e| {
            let message = e.to_string();
            if message.contains("ORA-") || message.contains("DPI-") {
                AppError::DatabaseError(message)
            } else {
                AppError::Driver(message)
            }
        })?;

        conn.set_autocommit(true);

        // Apply session schema if set
        if let Ok(schema_guard) = self.session_schema.lock() {
            if let Some(schema) = schema_guard.as_deref() {
                conn.set_current_schema(schema).map_err(|e| {
                    AppError::DatabaseError(format!("Failed to set schema '{}': {}", schema, e))
                })?;
            }
        }

        Ok(conn)
    }
}

impl Default for OracleAdapter {
    fn default() -> Self {
        Self::new()
    }
}

fn map_oracle_error(err: oracle::Error) -> AppError {
    let message = err.to_string();
    if message.contains("DPI-1047") {
        return AppError::Driver(
            "Oracle Instant Client is required but was not found.\n\n\
             Install it using one of the following methods:\n\n\
             macOS (Homebrew):\n  brew install instantclient-basic\n\n\
             macOS (manual):\n  Download from https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html\n\n\
             Linux (apt):\n  sudo apt-get install libaio1 && sudo apt-get install oracle-instantclient-basic\n\n\
             Linux (yum):\n  sudo yum install oracle-instantclient-release-el8 && sudo yum install oracle-instantclient-basic\n\n\
             Docker alternative:\n  Use the Oracle container from docker-compose (port 11521) which includes the client libraries.\n\n\
             After installation, ensure the OCI libraries are on your library path (DYLD_LIBRARY_PATH on macOS, LD_LIBRARY_PATH on Linux)."
                .into(),
        );
    }
    if message.contains("ORA-") || message.contains("DPI-") {
        return AppError::DatabaseError(message);
    }
    AppError::Driver(message)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>()
}

fn json_number(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn string_value(row: &oracle::Row, index: usize) -> Result<Value, AppError> {
    row.get::<usize, String>(index)
        .map(Value::String)
        .map_err(map_oracle_error)
}

fn fallback_display_value(value: &SqlValue<'_>) -> Value {
    Value::String(format!("{}", value))
}

fn sql_value_to_json(row: &oracle::Row, index: usize) -> Result<Value, AppError> {
    let sql_value = &row.sql_values()[index];
    if sql_value.is_null().map_err(map_oracle_error)? {
        return Ok(Value::Null);
    }

    let oracle_type = row.column_info()[index].oracle_type();
    match oracle_type {
        OracleType::BinaryFloat => row
            .get::<usize, f32>(index)
            .map(|value| json_number(f64::from(value)))
            .map_err(map_oracle_error),
        OracleType::BinaryDouble => row
            .get::<usize, f64>(index)
            .map(json_number)
            .map_err(map_oracle_error),
        OracleType::Number(_, scale) if *scale == 0 => match row.get::<usize, i64>(index) {
            Ok(value) => Ok(Value::from(value)),
            Err(_) => string_value(row, index),
        },
        OracleType::Number(_, _) | OracleType::Float(_) => match row.get::<usize, f64>(index) {
            Ok(value) => Ok(json_number(value)),
            Err(_) => string_value(row, index),
        },
        OracleType::Int64 => row
            .get::<usize, i64>(index)
            .map(Value::from)
            .map_err(map_oracle_error),
        OracleType::UInt64 => match row.get::<usize, u64>(index) {
            Ok(value) if value <= i64::MAX as u64 => Ok(Value::from(value as i64)),
            Ok(value) => Ok(Value::String(value.to_string())),
            Err(err) => Err(map_oracle_error(err)),
        },
        OracleType::Boolean => row
            .get::<usize, bool>(index)
            .map(Value::Bool)
            .map_err(map_oracle_error),
        OracleType::Json => match row.get::<usize, String>(index) {
            Ok(value) => Ok(serde_json::from_str(&value).unwrap_or(Value::String(value))),
            Err(_) => Ok(fallback_display_value(sql_value)),
        },
        OracleType::Raw(_) | OracleType::LongRaw => match row.get::<usize, Vec<u8>>(index) {
            Ok(bytes) => Ok(Value::String(bytes_to_hex(&bytes))),
            Err(_) => Ok(fallback_display_value(sql_value)),
        },
        OracleType::BLOB | OracleType::BFILE => Ok(fallback_display_value(sql_value)),

        // Date and Timestamp types - format consistently
        OracleType::Date
        | OracleType::Timestamp(_)
        | OracleType::TimestampTZ(_)
        | OracleType::TimestampLTZ(_) => match row.get::<usize, Timestamp>(index) {
            Ok(ts) => {
                let year = ts.year();
                let month = ts.month();
                let day = ts.day();
                let hour = ts.hour();
                let minute = ts.minute();
                let second = ts.second();
                let nano = ts.nanosecond();

                if *oracle_type == OracleType::Date
                    && hour == 0
                    && minute == 0
                    && second == 0
                    && nano == 0
                {
                    // Pure date with no time component
                    Ok(Value::String(format!(
                        "{:04}-{:02}-{:02}",
                        year, month, day
                    )))
                } else if nano == 0 {
                    Ok(Value::String(format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                        year, month, day, hour, minute, second
                    )))
                } else {
                    let micros = nano / 1000;
                    Ok(Value::String(format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
                        year, month, day, hour, minute, second, micros
                    )))
                }
            }
            Err(_) => string_value(row, index),
        },

        // Interval types - use string representation
        OracleType::IntervalYM(_) | OracleType::IntervalDS(_, _) => string_value(row, index),

        // CLOB/NCLOB - read as string directly
        OracleType::CLOB | OracleType::NCLOB => {
            string_value(row, index).or_else(|_| Ok(fallback_display_value(sql_value)))
        }

        _ => string_value(row, index).or_else(|_| Ok(fallback_display_value(sql_value))),
    }
}

fn row_to_json(row: &oracle::Row) -> Result<Vec<Value>, AppError> {
    let mut values = Vec::with_capacity(row.column_info().len());
    for index in 0..row.column_info().len() {
        values.push(sql_value_to_json(row, index)?);
    }
    Ok(values)
}

fn resolve_session_schema(options: &HashMap<String, String>) -> Option<String> {
    options
        .get("oracle_current_schema")
        .or_else(|| options.get("current_schema"))
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn apply_oracle_environment(options: &HashMap<String, String>) {
    if let Some(tns_admin) = options
        .get("oracle_wallet_dir")
        .or_else(|| options.get("oracle_tns_admin"))
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        std::env::set_var("TNS_ADMIN", tns_admin);
    }

    // Initialize the Oracle client library once per process.
    // On macOS, SIP strips DYLD_LIBRARY_PATH from GUI apps, so we use
    // InitParams::oracle_client_lib_dir to tell ODPI-C exactly where to find libclntsh.
    static INIT_ORACLE: Once = Once::new();
    INIT_ORACLE.call_once(|| match find_oracle_lib_dir() {
        Some(lib_dir) => {
            tracing::info!("Oracle: initializing client from {}", lib_dir);
            match oracle::InitParams::new().oracle_client_lib_dir(&lib_dir) {
                Ok(params) => match params.init() {
                    Ok(initialized) => {
                        tracing::info!("Oracle: InitParams.init() => {}", initialized);
                    }
                    Err(e) => {
                        tracing::error!("Oracle: InitParams.init() failed: {}", e);
                    }
                },
                Err(e) => {
                    tracing::error!("Oracle: oracle_client_lib_dir() failed: {}", e);
                }
            }
        }
        None => {
            tracing::warn!("Oracle: could not find client library directory");
        }
    });
}

/// Search for the directory containing the Oracle Instant Client shared library.
fn find_oracle_lib_dir() -> Option<String> {
    #[cfg(target_os = "macos")]
    let lib_name = "libclntsh.dylib";
    #[cfg(target_os = "linux")]
    let lib_name = "libclntsh.so";
    #[cfg(target_os = "windows")]
    let lib_name = "oci.dll";

    #[cfg(target_os = "macos")]
    let search_dirs: &[&str] = &[
        "/opt/homebrew/lib",
        "/usr/local/lib",
        "/opt/oracle/instantclient_19_8",
        "/opt/oracle/instantclient_21_0",
        "/opt/oracle/instantclient",
    ];
    #[cfg(target_os = "linux")]
    let search_dirs: &[&str] = &[
        "/usr/lib/oracle/21/client64/lib",
        "/usr/lib/oracle/19.8/client64/lib",
        "/opt/oracle/instantclient_21_0",
        "/opt/oracle/instantclient_19_8",
        "/usr/local/lib",
    ];
    #[cfg(target_os = "windows")]
    let search_dirs: &[&str] = &[
        "C:\\oracle\\instantclient_21_0",
        "C:\\oracle\\instantclient_19_8",
        "C:\\instantclient",
    ];

    // Check env var paths first
    #[cfg(target_os = "macos")]
    let path_var = "DYLD_LIBRARY_PATH";
    #[cfg(target_os = "linux")]
    let path_var = "LD_LIBRARY_PATH";
    #[cfg(target_os = "windows")]
    let path_var = "PATH";

    if let Ok(paths) = std::env::var(path_var) {
        for dir in std::env::split_paths(&paths) {
            if dir.join(lib_name).exists() {
                return Some(dir.to_string_lossy().to_string());
            }
        }
    }

    for dir in search_dirs {
        if std::path::Path::new(dir).join(lib_name).exists() {
            return Some(dir.to_string());
        }
    }

    None
}

fn build_connect_string(profile: &ConnectionProfile) -> Result<String, AppError> {
    if let Some(connect_string) = profile
        .options
        .get("oracle_connect_string")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(connect_string.to_string());
    }

    let mode = profile
        .options
        .get("oracle_connect_mode")
        .map(String::as_str)
        .unwrap_or("service_name");
    let host = if profile.host.trim().is_empty() {
        "localhost"
    } else {
        profile.host.trim()
    };
    let port = if profile.port == 0 {
        1521
    } else {
        profile.port
    };
    let database = profile.database.trim();

    match mode {
        "sid" => {
            let sid = profile
                .options
                .get("oracle_sid")
                .map(String::as_str)
                .unwrap_or(database)
                .trim();
            if sid.is_empty() {
                return Err(AppError::InvalidInput(
                    "Oracle SID is required for sid connection mode".into(),
                ));
            }
            Ok(format!("{host}:{port}:{sid}"))
        }
        "tns_alias" => {
            let alias = profile
                .options
                .get("oracle_tns_alias")
                .map(String::as_str)
                .unwrap_or(host)
                .trim();
            if alias.is_empty() {
                return Err(AppError::InvalidInput(
                    "Oracle TNS alias is required for tns_alias connection mode".into(),
                ));
            }
            Ok(alias.to_string())
        }
        _ => {
            if database.is_empty() {
                return Err(AppError::InvalidInput(
                    "Oracle service name is required".into(),
                ));
            }
            Ok(format!("//{host}:{port}/{database}"))
        }
    }
}

#[async_trait]
impl BaseCapability for OracleAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        let profile = profile.clone();
        let pool = Arc::clone(&self.pool);
        let session_schema = Arc::clone(&self.session_schema);

        self.run_blocking(move || {
            apply_oracle_environment(&profile.options);
            let connect_string = build_connect_string(&profile)?;
            let password = profile.password.clone().unwrap_or_default();

            let mut builder =
                PoolBuilder::new(profile.username.clone(), password, connect_string.clone());
            builder.min_connections(1);
            builder.max_connections(if profile.id.contains(':') { 1 } else { 4 });
            builder.connection_increment(1);
            builder
                .ping_interval(Some(Duration::from_secs(60)))
                .map_err(map_oracle_error)?;
            builder.driver_name("QueryPilot");
            builder.stmt_cache_size(20);

            let pool_instance = builder.build().map_err(map_oracle_error)?;
            let schema = resolve_session_schema(&profile.options);
            let conn = pool_instance.get().map_err(map_oracle_error)?;
            if let Some(schema_name) = schema.as_deref() {
                conn.set_current_schema(schema_name)
                    .map_err(map_oracle_error)?;
            }

            *session_schema
                .lock()
                .map_err(|_| AppError::Internal("Oracle session schema lock poisoned".into()))? =
                schema;
            *pool
                .lock()
                .map_err(|_| AppError::Internal("Oracle pool lock poisoned".into()))? =
                Some(pool_instance);
            Ok(())
        })
        .await
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        let pool = Arc::clone(&self.pool);
        let session_schema = Arc::clone(&self.session_schema);

        self.run_blocking(move || {
            let maybe_pool = pool
                .lock()
                .map_err(|_| AppError::Internal("Oracle pool lock poisoned".into()))?
                .take();
            *session_schema
                .lock()
                .map_err(|_| AppError::Internal("Oracle session schema lock poisoned".into()))? =
                None;

            if let Some(pool) = maybe_pool {
                pool.close(&CloseMode::Force).map_err(map_oracle_error)?;
            }
            Ok(())
        })
        .await
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        self.with_connection(|conn| {
            let (current_schema, session_user, service_name) =
                conn.query_row_as::<(String, String, String)>(
                    "SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'), SYS_CONTEXT('USERENV', 'SESSION_USER'), SYS_CONTEXT('USERENV', 'SERVICE_NAME') FROM dual",
                    &[],
                )
                .map_err(map_oracle_error)?;
            let version = conn
                .query_row_as::<String>(
                    "SELECT version FROM product_component_version WHERE product LIKE 'Oracle Database%'",
                    &[],
                )
                .ok();

            Ok(CapabilityTestResult {
                success: true,
                message: format!("Connected to {} as {}", service_name, session_user),
                latency_ms: None,
                server_version: version.or(Some(current_schema)),
            })
        })
        .await
    }

    fn is_connected(&self) -> bool {
        self.pool
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![AdapterCapability::SqlQueryable]
    }
}

#[async_trait]
impl SqlQueryable for OracleAdapter {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        // Oracle OCI rejects trailing semicolons — strip them
        let sql = sql.trim_end().trim_end_matches(';').to_string();
        self.with_connection(move |conn| {
            let mut stmt = conn.statement(&sql).build().map_err(map_oracle_error)?;
            if !stmt.is_query() {
                stmt.execute(&[]).map_err(map_oracle_error)?;
                return Ok(CapabilityQueryResult {
                    columns: vec![],
                    rows: vec![],
                });
            }

            let rows = stmt.query(&[]).map_err(map_oracle_error)?;
            let columns = rows
                .column_info()
                .iter()
                .map(|info| CapabilityColumnMeta {
                    name: info.name().to_string(),
                    data_type: info.oracle_type().to_string(),
                })
                .collect::<Vec<_>>();

            let mut json_rows = Vec::new();
            for row in rows {
                let row = row.map_err(map_oracle_error)?;
                json_rows.push(row_to_json(&row)?);
            }

            Ok(CapabilityQueryResult {
                columns,
                rows: json_rows,
            })
        })
        .await
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError> {
        // Oracle OCI rejects trailing semicolons — strip them
        let sql = sql.trim_end().trim_end_matches(';').to_string();
        self.with_connection(move |conn| {
            let stmt = conn.execute(&sql, &[]).map_err(map_oracle_error)?;
            stmt.row_count().map_err(map_oracle_error)
        })
        .await
    }
}
