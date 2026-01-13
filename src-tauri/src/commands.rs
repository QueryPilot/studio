use std::sync::Arc;
use std::time::Instant;
use tauri::State;
use tokio::time::{timeout, Duration};

use crate::adapters::postgres::DirectMsgPackEncoder;
use rmp_serde;
use crate::core::ConnectionManager;
use crate::ssh;
use crate::state::AppState;
use crate::types::*;
use serde::Serialize;
use tokio_postgres::Row;


/// Extract clean error message from PostgreSQL error
fn extract_db_error_message(e: &tokio_postgres::Error) -> String {
    // Try to get the DbError with the message
    if let Some(db_err) = e.as_db_error() {
        // Return just the message, optionally with detail/hint
        let mut msg = db_err.message().to_string();

        if let Some(detail) = db_err.detail() {
            msg.push_str(&format!("\nDetail: {}", detail));
        }

        if let Some(hint) = db_err.hint() {
            msg.push_str(&format!("\nHint: {}", hint));
        }

        // Add helpful hint for multiple commands error
        if msg.contains("cannot insert multiple commands into a prepared statement") {
            msg.push_str("\n\nTip: To execute multiple statements:");
            msg.push_str("\n  • Place your cursor on one statement and press Cmd/Ctrl+Enter");
            msg.push_str("\n  • Or execute them one at a time");
        }

        return msg;
    }

    // Fallback to Display format for non-DB errors
    e.to_string()
}

#[derive(Serialize)]
pub struct SshTestResult {
    pub success: bool,
    pub latency_ms: u64,
}

#[tauri::command]
pub async fn connect(
    profile: ConnectionProfile,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionInfo, String> {
    let conn_id = manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ConnectionInfo {
        id: conn_id,
        db_type: profile.db_type,
        database: profile.database,
        version: None,
    })
}

#[tauri::command]
pub async fn test_ssh_connection(
    config: SshTunnelConfig,
    app_state: State<'_, AppState>,
) -> std::result::Result<SshTestResult, String> {
    if !app_state
        .ssh_test_rate_limiter
        .check_rate_limit(&config.host)
        .await
    {
        return Err("Too many SSH test attempts. Please wait before trying again.".to_string());
    }

    let start = Instant::now();
    let verify_future = ssh::verify_connection(&config);

    timeout(Duration::from_secs(10), verify_future)
        .await
        .map_err(|_| "SSH connection test timed out after 10 seconds".to_string())?
        .map_err(|e| e.to_string())?;

    Ok(SshTestResult {
        success: true,
        latency_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn disconnect(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    manager
        .disconnect(&conn_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn switch_database(
    conn_id: String,
    new_database: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    tracing::info!(
        "Switching connection {} to database: {}",
        conn_id,
        new_database
    );

    // Get current connection profile
    let mut profile = manager
        .get_stored_profile(&conn_id)
        .ok_or_else(|| format!("Connection {} not found", conn_id))?;

    // Disconnect current connection
    manager
        .disconnect(&conn_id)
        .await
        .map_err(|e| e.to_string())?;

    // Update profile with new database
    profile.database = new_database.clone();

    // Reconnect with new database
    manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    // Verify we're connected to the correct database
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found after reconnect".to_string())?;

    let result = conn
        .adapter
        .query("SELECT current_database()")
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = result.rows.first() {
        if let Some(cell) = row.first() {
            let current_db = cell.to_string();
            if current_db != new_database {
                return Err(format!(
                    "Database verification failed: expected {}, got {}",
                    new_database, current_db
                ));
            }
        }
    }

    tracing::info!("Successfully switched to database: {}", new_database);
    Ok(())
}

#[tauri::command]
pub async fn disconnect_all(
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    manager.disconnect_all().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionTestResult, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    conn.adapter
        .test_connection()
        .await
        .map_err(|e| e.to_string())
}

// NOTE: Introspection commands (get_databases, get_schemas, get_tables, etc.) have been
// removed. The frontend now uses IntrospectionService which generates dialect-specific SQL
// and executes via the `query` command. See: src/services/introspectionService.ts

/// Execute a SQL query and return results directly (Path 1: Direct Query)
///
/// This command is optimized for small result sets (< 1000 rows) and provides a simple
/// invoke-based API. Results are encoded as JSON using SimpleConverter.
///
/// # Use Cases
/// - Schema metadata queries (tables, columns, constraints)
/// - System catalog queries (information_schema, pg_catalog)
/// - AI HTTP server endpoints
/// - Any query with known small result size
///
/// # Performance
/// - Low latency: ~5-10ms overhead
/// - Suitable for up to 1000 rows
/// - Entire result set loaded into memory
///
/// # When NOT to Use
/// For large result sets or user-facing data display, use `execute_query` instead,
/// which provides streaming with MessagePack encoding for 3-5x better performance.
///
/// See: `docs/query-execution-architecture.md` for architecture details.
/// See also: [`execute_query`] for high-performance streaming queries.
#[tauri::command]
pub async fn query(
    conn_id: String,
    sql: String,
    timeout_secs: Option<u64>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<crate::types::QueryResult, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    // Default timeout: 5 minutes (300 seconds)
    // Can be overridden per-query via timeout_secs parameter
    let timeout_duration = std::time::Duration::from_secs(timeout_secs.unwrap_or(300));

    tokio::time::timeout(timeout_duration, conn.adapter.query(&sql))
        .await
        .map_err(|_| format!("Query timed out after {} seconds", timeout_duration.as_secs()))?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection_health(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionHealth, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    // Test the connection
    let test_result = conn
        .adapter
        .test_connection()
        .await
        .map_err(|e| e.to_string())?;

    Ok(ConnectionHealth {
        connection_id: conn_id,
        status: if test_result.success {
            "ready".to_string()
        } else {
            "error".to_string()
        },
        healthy: test_result.success,
        rtt_ms: None,
        error: if !test_result.success {
            Some(test_result.message)
        } else {
            None
        },
    })
}

#[tauri::command]
pub async fn ping(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<u64, String> {
    use std::time::Instant;

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let start = Instant::now();
    let is_connected = conn.adapter.is_connected().await;
    let elapsed = start.elapsed().as_millis() as u64;

    if is_connected {
        Ok(elapsed)
    } else {
        Err("Connection is not active".to_string())
    }
}

/// Check if SQL query is a SELECT statement or other query that returns rows
fn is_select_query(sql: &str) -> bool {
    // Trim whitespace and comments, get first significant SQL keyword
    let trimmed = sql.trim();

    // Remove leading comments (-- and /* */)
    let without_comments = trimmed
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");

    // Remove block comments
    let re = regex::Regex::new(r"/\*.*?\*/").unwrap_or_else(|_| regex::Regex::new(r"a^").unwrap());
    let cleaned = re.replace_all(&without_comments, "");

    // Get first word
    let first_keyword = cleaned
        .trim()
        .split_whitespace()
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .to_uppercase();

    // For CTEs (WITH), we need to find the main statement after the CTE definitions
    // WITH ... SELECT returns rows, but WITH ... UPDATE/INSERT/DELETE does not
    if first_keyword == "WITH" {
        return find_main_statement_keyword(&cleaned)
            .map(|kw| matches!(kw.as_str(), "SELECT" | "TABLE" | "VALUES"))
            .unwrap_or(false);
    }

    // Check if it's a query that returns rows:
    // - SELECT: standard select query
    // - EXPLAIN: query plan output (returns rows with plan text)
    // - SHOW: PostgreSQL config/status queries
    // - TABLE: PostgreSQL shorthand for SELECT * FROM
    // - VALUES: literal values as rows
    matches!(
        first_keyword.as_str(),
        "SELECT" | "EXPLAIN" | "SHOW" | "TABLE" | "VALUES"
    )
}

/// Find the main statement keyword in a CTE query (after WITH ... AS (...))
/// Returns the keyword of the main statement (SELECT, INSERT, UPDATE, DELETE)
fn find_main_statement_keyword(sql: &str) -> Option<String> {
    let upper = sql.to_uppercase();

    // Main DML keywords that can follow CTEs
    let keywords = ["SELECT", "INSERT", "UPDATE", "DELETE", "TABLE", "VALUES"];

    // Find the FIRST main statement keyword at depth 0 (after CTE definitions)
    // We need the first one because "INSERT INTO ... SELECT" has SELECT after INSERT
    let mut first_keyword_pos: Option<(usize, &str)> = None;

    for keyword in &keywords {
        let mut search_start = 0;
        while let Some(pos) = upper[search_start..].find(keyword) {
            let abs_pos = search_start + pos;

            // Check if this keyword is at word boundary
            let before_ok = abs_pos == 0
                || !upper.as_bytes()[abs_pos - 1].is_ascii_alphanumeric();
            let after_ok = abs_pos + keyword.len() >= upper.len()
                || !upper.as_bytes()[abs_pos + keyword.len()].is_ascii_alphanumeric();

            if before_ok && after_ok {
                // Count parenthesis depth up to this position
                let depth = sql[..abs_pos].chars().fold(0i32, |d, c| match c {
                    '(' => d + 1,
                    ')' => d - 1,
                    _ => d,
                });

                // Only consider keywords at depth 0 (not inside CTE definitions)
                // Track the FIRST (leftmost) keyword at depth 0
                if depth == 0 {
                    if first_keyword_pos.map_or(true, |(p, _)| abs_pos < p) {
                        first_keyword_pos = Some((abs_pos, keyword));
                    }
                }
            }

            search_start = abs_pos + 1;
        }
    }

    first_keyword_pos.map(|(_, kw)| kw.to_string())
}

/// Execute query with TRUE streaming (rows arrive as they're fetched from PostgreSQL)
/// Check if SQL contains multiple statements (simple heuristic)
fn is_multi_statement_query(sql: &str) -> bool {
    // Count semicolons that are likely statement terminators
    // This is a simple check - ignore semicolons in strings/comments for now
    let trimmed = sql.trim();

    // Check for transaction control keywords followed by semicolon
    let sql_upper = trimmed.to_uppercase();
    if sql_upper.contains("BEGIN;")
        || sql_upper.contains("COMMIT;")
        || sql_upper.contains("ROLLBACK;")
    {
        return true;
    }

    // Count semicolons (simple check - may have false positives but that's okay)
    let semicolon_count = trimmed.matches(';').count();

    // If there's more than one semicolon, or one semicolon not at the end, it's multi-statement
    if semicolon_count > 1 {
        return true;
    }

    if semicolon_count == 1 && !trimmed.trim_end().ends_with(';') {
        return true;
    }

    false
}

async fn execute_single_fetch_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    // Dispatch to database-specific streaming implementation
    match conn.profile.db_type {
        DbType::PostgreSQL => {
            execute_postgres_stream(sql, metadata_channel, data_channel, conn).await
        }
        DbType::MySQL | DbType::MariaDB => {
            execute_generic_stream(sql, metadata_channel, data_channel, conn).await
        }
        DbType::SQLite => {
            execute_generic_stream(sql, metadata_channel, data_channel, conn).await
        }
        DbType::SQLServer => {
            execute_generic_stream(sql, metadata_channel, data_channel, conn).await
        }
        // Non-SQL databases don't use SQL streaming - handled by their own commands
        DbType::MongoDB | DbType::Redis => {
            Err("SQL streaming not supported for non-SQL databases".to_string())
        }
    }
}

/// Generic streaming implementation using the adapter's query method
/// Works for MySQL, SQLite, and SQL Server
async fn execute_generic_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    let start_time = std::time::Instant::now();
    
    // Use the adapter's query method which works for all database types
    let result = conn.adapter.query(sql).await.map_err(|e| e.to_string())?;
    
    let query_elapsed = start_time.elapsed().as_millis();
    tracing::info!("  ⏱ Query execution: {}ms, {} rows", query_elapsed, result.rows.len());
    
    // Send column metadata
    let _ = metadata_channel.send(StreamMessage::Started {
        columns: result.columns.clone(),
        estimated_rows: Some(result.rows.len() as i64),
    });
    
    // Convert rows to MessagePack and send in batches
    let encode_start = std::time::Instant::now();
    
    // For smaller result sets, send all at once
    if !result.rows.is_empty() {
        // Use rmp_serde to serialize the rows as MessagePack
        let msgpack_data = rmp_serde::to_vec(&result.rows)
            .map_err(|e| format!("Failed to encode rows: {}", e))?;
        
        let _ = data_channel.send(tauri::ipc::Response::new(msgpack_data));
    }
    
    let encode_elapsed = encode_start.elapsed().as_millis();
    let total_elapsed = start_time.elapsed().as_millis();
    
    // Send success message
    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows: result.rows.len(),
        execution_time_ms: total_elapsed as u64,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_elapsed as u64),
        fetch_count: Some(1),
        network_ms: Some(query_elapsed as u64),
        conversion_ms: Some(encode_elapsed as u64),
        ipc_send_ms: Some(0),
    });
    
    Ok(())
}

/// SQLite-specific query execution using the adapter's query() method
/// SQLite doesn't support the same streaming protocol as PostgreSQL,
/// so we use a simpler approach: execute via adapter and stream results
async fn execute_sqlite_query(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    let start = std::time::Instant::now();

    // Use the adapter's query method which handles multi-statement and transactions
    let result = conn
        .adapter
        .query(sql)
        .await
        .map_err(|e| e.to_string())?;

    let query_elapsed = start.elapsed().as_millis();

    // Send metadata (columns) via Started message
    let _ = metadata_channel.send(StreamMessage::Started {
        columns: result.columns.clone(),
        estimated_rows: Some(result.rows.len() as i64),
    });

    // Encode rows to MessagePack
    let encode_start = std::time::Instant::now();
    let row_count = result.rows.len();
    
    // Convert rows to the expected format (Vec<Vec<Value>>)
    let rows_data: Vec<Vec<serde_json::Value>> = result.rows.into_iter().collect();
    
    let msgpack_bytes = rmp_serde::to_vec(&rows_data)
        .map_err(|e| format!("MessagePack encoding failed: {}", e))?;

    let encode_elapsed = encode_start.elapsed().as_millis();

    // Send data via binary channel
    let _ = data_channel.send(tauri::ipc::Response::new(msgpack_bytes));

    let total_elapsed = start.elapsed().as_millis();

    // Send completion message via Success
    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows: row_count,
        execution_time_ms: total_elapsed as u64,
        cursor_setup_ms: Some(0),
        total_streaming_ms: Some(total_elapsed as u64),
        fetch_count: Some(1),
        network_ms: Some(query_elapsed as u64),
        conversion_ms: Some(encode_elapsed as u64),
        ipc_send_ms: Some(0),
    });

    Ok(())
}

/// PostgreSQL-specific streaming implementation with optimized binary protocol
async fn execute_postgres_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    use futures::StreamExt;

    // Get pool from PostgresAdapter
    let pool = conn
        .adapter
        .as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
        .and_then(|adapter| adapter.get_pool())
        .ok_or_else(|| "PostgreSQL pool not available".to_string())?;

    // Check if this is a SELECT query (needs streaming) or mutation (needs execute)
    // Queries with RETURNING clause also return rows, so treat them like SELECT
    let is_select = is_select_query(sql);
    let has_returning = sql.to_uppercase().contains(" RETURNING ");

    // Get connection from pool FIRST
    let conn_start = std::time::Instant::now();
    let pool_conn = pool
        .get()
        .await
        .map_err(|e| format!("Failed to get connection from pool: {}", e))?;
    let conn_elapsed = conn_start.elapsed().as_millis();
    tracing::info!("  ⏱ Got connection from pool: {}ms", conn_elapsed);

    // Check if this is a multi-statement query (transactions, multiple commands)
    // Do this BEFORE getting backend PID since batch_execute doesn't need it
    if is_multi_statement_query(sql) {
        tracing::info!("  🔀 Detected multi-statement query, using simple_query protocol");

        // Reset any pending failed transaction state before executing
        // This handles cases where a previous operation failed and left the connection dirty
        if let Err(e) = pool_conn.batch_execute("ROLLBACK").await {
            tracing::debug!("  ℹ️ ROLLBACK before batch (expected if no active transaction): {}", e);
        }

        // Use simple_query for multi-statement support (no prepared statements)
        let simple_start = std::time::Instant::now();
        let batch_result = pool_conn.batch_execute(sql).await;

        if let Err(e) = &batch_result {
            tracing::error!("❌ batch_execute failed: {:?}", e);
            // ROLLBACK to clean up the failed transaction and reset connection state
            if let Err(rollback_err) = pool_conn.batch_execute("ROLLBACK").await {
                tracing::debug!("  ℹ️ ROLLBACK after failure (may already be rolled back): {}", rollback_err);
            }
            return Err(extract_db_error_message(e));
        }
        let exec_elapsed = simple_start.elapsed().as_millis();
        tracing::info!("  ⏱ Executed multi-statement batch: {}ms", exec_elapsed);

        // For batch execution, we don't have row results to stream
        // Send empty column set and success message
        let _ = metadata_channel.send(StreamMessage::Started {
            columns: vec![],
            estimated_rows: Some(0),
        });

        let _ = metadata_channel.send(StreamMessage::Success {
            total_rows: 0,
            execution_time_ms: exec_elapsed as u64,
            cursor_setup_ms: None,
            total_streaming_ms: Some(exec_elapsed as u64),
            fetch_count: None,
            network_ms: Some(0),
            conversion_ms: Some(0),
            ipc_send_ms: Some(0),
        });

        return Ok(());
    }

    // For non-SELECT queries (UPDATE, INSERT, DELETE, etc.) without RETURNING,
    // use execute to get affected rows count. Queries with RETURNING need streaming.
    if !is_select && !has_returning {
        tracing::info!("  🔀 Non-SELECT query, using execute() for affected rows count");

        // Reset any pending failed transaction state before executing
        if let Err(e) = pool_conn.batch_execute("ROLLBACK").await {
            tracing::debug!("  ℹ️ ROLLBACK before execute (expected if no active transaction): {}", e);
        }

        let exec_start = std::time::Instant::now();
        let rows_affected = pool_conn.execute(sql, &[]).await.map_err(|e| {
            tracing::error!("❌ execute failed: {:?}", e);
            extract_db_error_message(&e)
        })?;
        let exec_elapsed = exec_start.elapsed().as_millis();

        tracing::info!(
            "  ⏱ Executed mutation: {}ms, {} rows affected",
            exec_elapsed,
            rows_affected
        );

        // Send empty columns (no result set for mutations without RETURNING)
        let _ = metadata_channel.send(StreamMessage::Started {
            columns: vec![],
            estimated_rows: Some(rows_affected as i64),
        });

        let _ = metadata_channel.send(StreamMessage::Success {
            total_rows: rows_affected as usize,
            execution_time_ms: exec_elapsed as u64,
            cursor_setup_ms: None,
            total_streaming_ms: Some(exec_elapsed as u64),
            fetch_count: None,
            network_ms: Some(exec_elapsed as u64),
            conversion_ms: Some(0),
            ipc_send_ms: Some(0),
        });

        return Ok(());
    }

    // Get backend PID for cancellation (only needed for SELECT queries that stream)
    // Query it since we're using pooled connections
    let backend_pid: i32 = match pool_conn
        .query_one("SELECT pg_backend_pid()", &[])
        .await
    {
        Ok(row) => {
            let pid: i32 = row.get(0);
            tracing::info!("  🔍 Query running on PostgreSQL backend PID: {}", pid);
            pid
        }
        Err(e) => {
            tracing::warn!("  ⚠️ Could not get backend PID (cancellation disabled): {}", e);
            0 // Use 0 as sentinel - cancellation won't work but query will proceed
        }
    };

    // PREPARE statement - this is where the slowness happens on remote connections!
    let prepare_start = std::time::Instant::now();
    let stmt = pool_conn.prepare(&sql).await.map_err(|e| {
        // Log the full error details for debugging
        tracing::error!("❌ PREPARE failed: {:?}", e);
        // Return clean error message
        extract_db_error_message(&e)
    })?;
    let prepare_elapsed = prepare_start.elapsed().as_millis();
    tracing::info!("  ⏱ PREPARE statement: {}ms ⚠️", prepare_elapsed);

    // Execute query with prepared statement
    let query_start = std::time::Instant::now();
    let row_stream = pool_conn
        .query_raw(&stmt, std::iter::empty::<i32>())
        .await
        .map_err(|e| {
            tracing::error!("❌ query_raw failed: {:?}", e);
            extract_db_error_message(&e)
        })?;
    let exec_elapsed = query_start.elapsed().as_millis();
    tracing::info!("  ⏱ Started query_raw: {}ms", exec_elapsed);

    // Extract column metadata from prepared statement
    let columns = stmt
        .columns()
        .iter()
        .map(|col| crate::types::ColumnMeta {
            name: col.name().to_string(),
            data_type: crate::adapters::postgres::types::PostgresTypeConverter::type_to_cell_type(
                col.type_(),
            ),
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
        .collect::<Vec<_>>();

    // Send column metadata immediately
    let _ = metadata_channel.send(StreamMessage::Started {
        columns: columns.clone(),
        estimated_rows: None,
    });

    let mut row_stream = Box::pin(row_stream);

    tracing::info!("TRUE STREAMING: Query executing, rows will arrive progressively...");

    let mut total_rows = 0;
    let mut row_buffer: Vec<Row> = Vec::new(); // Row buffer for batch conversion

    // Progressive batch sizes: start tiny for instant feedback, scale up
    const BATCH_SIZES: [usize; 5] = [16, 64, 256, 1024, 2048];

    // Initialize encoder lazily (need column types from first row)
    let mut encoder: Option<DirectMsgPackEncoder> = None;

    let mut first_row_elapsed_ms: Option<u64> = None;

    // Performance tracking
    let mut conversion_time_ms = 0u64;
    let mut send_time_ms = 0u64;
    let mut send_count = 0usize;

    // Dynamic batch sizing - progressive increase for faster first render
    let mut batch_index = 0usize;

    // Stream rows as they arrive from PostgreSQL
    // Track iterations for periodic cancellation checks (every 100 rows)
    let mut check_interval = 0u32;

    while let Some(row_result) = row_stream.next().await {
        // CRITICAL: Check for cancellation periodically (every 100 rows)
        // This ensures we detect cancellation even if no batches have been sent yet
        check_interval += 1;
        if check_interval % 100 == 0 {
            // Attempt to send to data channel - if it fails, user cancelled
            if data_channel
                .send(tauri::ipc::Response::new(vec![]))
                .is_err()
            {
                tracing::info!("  ⚠️  Channel closed during row fetch (user cancelled early)");

                // Cancel the running query in PostgreSQL (only if we have a valid PID)
                if backend_pid > 0 {
                    tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
                    let cancel_pool = pool.clone();
                    tokio::spawn(async move {
                        if let Ok(cancel_conn) = cancel_pool.get().await {
                            let cancel_sql = format!("SELECT pg_cancel_backend({})", backend_pid);
                            match cancel_conn.execute(&cancel_sql, &[]).await {
                                Ok(_) => tracing::info!("  ✅ Successfully cancelled backend query"),
                                Err(e) => tracing::warn!("  ⚠️  Failed to cancel backend: {}", e),
                            }
                        }
                    });
                }

                let _ = metadata_channel.send(StreamMessage::Interrupted {
                    resumable: false,
                    message: "Query cancelled by user".to_string(),
                });
                return Err("Query cancelled by user".to_string());
            }
        }

        match row_result {
            Ok(row) => {
                // Mark when first row arrives and initialize encoder
                if first_row_elapsed_ms.is_none() {
                    let elapsed = query_start.elapsed().as_millis() as u64;
                    first_row_elapsed_ms = Some(elapsed);
                    tracing::info!("  ⏱ First row arrived: {}ms", elapsed);

                    // Initialize encoder with column types from first row
                    encoder = Some(DirectMsgPackEncoder::from_row(&row));
                }

                row_buffer.push(row);
                total_rows += 1;

                // Send chunk to frontend when buffer reaches current batch size
                let current_threshold = BATCH_SIZES[batch_index.min(BATCH_SIZES.len() - 1)];
                if row_buffer.len() >= current_threshold {
                    let _batch_size = row_buffer.len();

                    // Direct encode to MessagePack (no JSON intermediate!)
                    let convert_start = std::time::Instant::now();
                    let rows_msgpack = encoder
                        .as_ref()
                        .unwrap()
                        .encode_batch(&row_buffer)
                        .unwrap_or_else(|_| Vec::new());
                    conversion_time_ms += convert_start.elapsed().as_millis() as u64;
                    row_buffer.clear();
                    batch_index += 1;

                    // Send raw binary via Response (ZERO serialization overhead!)
                    let send_start = std::time::Instant::now();
                    let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
                    send_time_ms += send_start.elapsed().as_millis() as u64;
                    send_count += 1;

                    // Check if channel closed (user cancelled) - stop streaming early
                    if send_result.is_err() {
                        tracing::info!(
                            "  ⚠️  Channel closed (user cancelled), stopping stream early"
                        );

                        // Cancel the running query in PostgreSQL (only if we have a valid PID)
                        if backend_pid > 0 {
                            tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
                            let cancel_pool = pool.clone();
                            tokio::spawn(async move {
                                if let Ok(cancel_conn) = cancel_pool.get().await {
                                    let cancel_sql =
                                        format!("SELECT pg_cancel_backend({})", backend_pid);
                                    match cancel_conn.execute(&cancel_sql, &[]).await {
                                        Ok(_) => {
                                            tracing::info!("  ✅ Successfully cancelled backend query")
                                        }
                                        Err(e) => {
                                            tracing::warn!("  ⚠️  Failed to cancel backend: {}", e)
                                        }
                                    }
                                }
                            });
                        }

                        let _ = metadata_channel.send(StreamMessage::Interrupted {
                            resumable: false,
                            message: "Query cancelled by user".to_string(),
                        });
                        return Err("Query cancelled by user".to_string());
                    }
                }
            }
            Err(e) => {
                let _ = metadata_channel.send(StreamMessage::Error {
                    code: "FETCH_ERROR".to_string(),
                    message: e.to_string(),
                });
                return Err(e.to_string());
            }
        }
    }

    // Send any remaining rows directly
    if !row_buffer.is_empty() {
        if let Some(ref enc) = encoder {
            // Direct encode to MessagePack (no JSON intermediate!)
            let convert_start = std::time::Instant::now();
            let rows_msgpack = enc.encode_batch(&row_buffer).unwrap_or_else(|_| Vec::new());
            conversion_time_ms += convert_start.elapsed().as_millis() as u64;

            // Send raw binary via Response
            let send_start = std::time::Instant::now();
            let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
            send_time_ms += send_start.elapsed().as_millis() as u64;
            send_count += 1;

            // Check if channel closed (user cancelled)
            if send_result.is_err() {
                tracing::info!("  ⚠️  Channel closed (user cancelled), stopping stream early");

                // Cancel the running query in PostgreSQL (only if we have a valid PID)
                if backend_pid > 0 {
                    tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
                    let cancel_pool = pool.clone();
                    tokio::spawn(async move {
                        if let Ok(cancel_conn) = cancel_pool.get().await {
                            let cancel_sql = format!("SELECT pg_cancel_backend({})", backend_pid);
                            match cancel_conn.execute(&cancel_sql, &[]).await {
                                Ok(_) => tracing::info!("  ✅ Successfully cancelled backend query"),
                                Err(e) => tracing::warn!("  ⚠️  Failed to cancel backend: {}", e),
                            }
                        }
                    });
                }

                let _ = metadata_channel.send(StreamMessage::Interrupted {
                    resumable: false,
                    message: "Query cancelled by user".to_string(),
                });
                return Err("Query cancelled by user".to_string());
            }
        }
    }

    let total_time = query_start.elapsed().as_millis() as u64;
    let first_row_ms = first_row_elapsed_ms.unwrap_or(0);

    // NOTE: send_time_ms shows queue time only (channel.send is non-blocking)
    // Real IPC overhead is async/overlapped with conversion & network time
    let network_time_ms = total_time.saturating_sub(conversion_time_ms);

    tracing::info!("==========================================");
    tracing::info!("TRUE STREAMING COMPLETE: {} rows", total_rows);
    tracing::info!("  First row: {}ms", first_row_ms);
    tracing::info!("  Total time: {}ms", total_time);
    tracing::info!(
        "  Rows/sec: {:.0}",
        (total_rows as f64 / total_time as f64) * 1000.0
    );
    tracing::info!("  ┌─ Performance Breakdown:");
    tracing::info!(
        "  │  Network/DB: {}ms ({:.1}%)",
        network_time_ms,
        (network_time_ms as f64 / total_time as f64) * 100.0
    );
    tracing::info!(
        "  │  Conversion+Serialization: {}ms ({:.1}%)",
        conversion_time_ms,
        (conversion_time_ms as f64 / total_time as f64) * 100.0
    );
    tracing::info!(
        "  │  IPC: Overlapped/async ({}ms queue, {} batches) - Response bypasses JSON!",
        send_time_ms,
        send_count
    );
    tracing::info!(
        "  └─ Batch sizes: 16→64→256→1024→2048 (progressive) | Format: direct msgpack"
    );
    tracing::info!("==========================================");

    // CRITICAL: Check if channel was closed before sending success
    // User might have cancelled while we were processing the last batch
    let test_send = metadata_channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: total_time,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_time),
        fetch_count: Some(send_count as u64),
        network_ms: Some(network_time_ms),
        conversion_ms: Some(conversion_time_ms),
        ipc_send_ms: Some(send_time_ms),
    });

    // If channel closed, it means user cancelled - don't return success
    if test_send.is_err() {
        tracing::info!("  ⚠️  Channel closed before sending success (user cancelled)");

        // Cancel the running query in PostgreSQL (only if we have a valid PID)
        if backend_pid > 0 {
            tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
            let cancel_pool = pool.clone();
            tokio::spawn(async move {
                if let Ok(cancel_conn) = cancel_pool.get().await {
                    let cancel_sql = format!("SELECT pg_cancel_backend({})", backend_pid);
                    let _ = cancel_conn.execute(&cancel_sql, &[]).await;
                }
            });
        }

        return Err("Query cancelled by user".to_string());
    }

    Ok(())
}

/// Execute query with high-performance streaming (Path 2: Streaming Query)
///
/// This command is optimized for large result sets and provides progressive rendering
/// via IPC channels. Results are encoded as MessagePack using DirectMsgPackEncoder.
///
/// # Use Cases
/// - Data grids and table browsing (any size, optimized for 1K+ rows)
/// - User-written queries with unknown result sizes
/// - Operations requiring progressive rendering
/// - Queries that need cancellation support
///
/// # Performance
/// - Initial setup: ~50ms (IPC channels + cursor)
/// - Throughput: 3-5x faster than JSON for large datasets
/// - Streaming: Progressive batches (16-2048 rows)
/// - Memory: Bounded regardless of result size
/// - Cancellable: Can be interrupted mid-stream
///
/// # Architecture
/// Results are streamed via two IPC channels:
/// - `metadata_channel`: Column metadata and status updates
/// - `data_channel`: MessagePack-encoded row batches
///
/// The frontend uses `queryStreamClient` to consume these streams and provide
/// progressive rendering with cancellation support.
///
/// # When NOT to Use
/// For small metadata queries (< 1000 rows), use `query` instead for lower latency
/// and simpler API.
///
/// See: `docs/query-execution-architecture.md` for architecture details.
/// See also: [`query`] for simple direct queries.
#[tauri::command]
pub async fn execute_query(
    conn_id: String,
    tab_id: String,
    sql: String,
    _batch_size: Option<usize>,
    timeout_secs: Option<u64>,
    metadata_channel: tauri::ipc::Channel<StreamMessage>,
    data_channel: tauri::ipc::Channel<tauri::ipc::Response>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    // Use composite key for tab-specific connection (transaction isolation)
    let connection_key = format!("{}:{}", conn_id, tab_id);

    let conn = manager
        .get_connection_with_retry(&connection_key, 3)
        .await
        .map_err(|e| e.to_string())?;

    tracing::info!("==========================================");
    tracing::info!("FAST PATH (query_raw streaming)");
    tracing::info!("  connection_key: {}", connection_key);
    tracing::info!("  sql: {}", sql);
    tracing::info!("==========================================");

    // Default timeout: 5 minutes (300 seconds)
    // Can be overridden per-query via timeout_secs parameter
    let timeout_duration = std::time::Duration::from_secs(timeout_secs.unwrap_or(300));

    // Route based on database type
    // SQLite uses the adapter's query() method, PostgreSQL uses streaming
    match conn.profile.db_type {
        crate::types::DbType::SQLite => {
            tokio::time::timeout(
                timeout_duration,
                execute_sqlite_query(&sql, &metadata_channel, &data_channel, &conn),
            )
            .await
            .map_err(|_| format!("Query timed out after {} seconds", timeout_duration.as_secs()))?
        }
        _ => {
            // PostgreSQL and other databases use the streaming path
            tokio::time::timeout(
                timeout_duration,
                execute_single_fetch_stream(&sql, &metadata_channel, &data_channel, &conn),
            )
            .await
            .map_err(|_| format!("Query timed out after {} seconds", timeout_duration.as_secs()))?
        }
    }
}

// ============================================================================
// DDL Operations
// ============================================================================
// DDL operations (CREATE, ALTER, DROP) are handled via execute_query with
// frontend adapter SQL generation. See: src/adapters/ for the TypeScript adapter system.

// ============================================================================
// Window Menu Management
// ============================================================================

/// Update the Window menu to reflect current open windows
/// Called by frontend when workspace windows are opened or closed
#[tauri::command]
pub async fn update_window_menu(app: tauri::AppHandle) -> Result<(), String> {
    crate::menu::update_window_menu(&app).map_err(|e: tauri::Error| e.to_string())
}

// ============================================================================
// MongoDB Commands
// ============================================================================

/// List all databases in MongoDB
#[tauri::command]
pub async fn mongo_list_databases(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<crate::core::capabilities::DatabaseInfo>, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.list_databases().await.map_err(|e| e.to_string())
}

/// List collections in the current MongoDB database
#[tauri::command]
pub async fn mongo_list_collections(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<crate::core::capabilities::CollectionInfo>, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.list_collections().await.map_err(|e| e.to_string())
}

/// Find documents in a MongoDB collection
#[tauri::command]
pub async fn mongo_find_documents(
    conn_id: String,
    collection: String,
    filter: serde_json::Value,
    skip: Option<u64>,
    limit: Option<u64>,
    sort: Option<serde_json::Value>,
    projection: Option<serde_json::Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<serde_json::Value>, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    let options = crate::core::capabilities::FindOptions {
        skip,
        limit: limit.or(Some(100)),
        sort,
        projection,
    };
    
    adapter.find_documents(&collection, filter, options).await.map_err(|e| e.to_string())
}

/// Insert a document into a MongoDB collection
#[tauri::command]
pub async fn mongo_insert_document(
    conn_id: String,
    collection: String,
    document: serde_json::Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<crate::core::capabilities::InsertResult, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.insert_document(&collection, document).await.map_err(|e| e.to_string())
}

/// Update a document in a MongoDB collection
#[tauri::command]
pub async fn mongo_update_document(
    conn_id: String,
    collection: String,
    filter: serde_json::Value,
    update: serde_json::Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<crate::core::capabilities::UpdateResult, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.update_document(&collection, filter, update).await.map_err(|e| e.to_string())
}

/// Delete a document from a MongoDB collection
#[tauri::command]
pub async fn mongo_delete_document(
    conn_id: String,
    collection: String,
    filter: serde_json::Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<crate::core::capabilities::DeleteResult, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.delete_document(&collection, filter).await.map_err(|e| e.to_string())
}

/// Run an aggregation pipeline on a MongoDB collection
#[tauri::command]
pub async fn mongo_aggregate(
    conn_id: String,
    collection: String,
    pipeline: Vec<serde_json::Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<serde_json::Value>, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.aggregate(&collection, pipeline).await.map_err(|e| e.to_string())
}

/// Count documents in a MongoDB collection
#[tauri::command]
pub async fn mongo_count_documents(
    conn_id: String,
    collection: String,
    filter: Option<serde_json::Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.count_documents(&collection, filter).await.map_err(|e| e.to_string())
}

/// List indexes for a MongoDB collection
#[tauri::command]
pub async fn mongo_list_indexes(
    conn_id: String,
    collection: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<serde_json::Value>, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.list_indexes(&collection).await.map_err(|e| e.to_string())
}

/// Create an index on a MongoDB collection
#[tauri::command]
pub async fn mongo_create_index(
    conn_id: String,
    collection: String,
    keys: serde_json::Value,
    options: Option<serde_json::Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.create_index(&collection, keys, options).await.map_err(|e| e.to_string())
}

/// Drop an index from a MongoDB collection
#[tauri::command]
pub async fn mongo_drop_index(
    conn_id: String,
    collection: String,
    index_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let mongo_adapters = manager.mongo_adapters.read().await;
    let adapter = mongo_adapters.get(&conn_id)
        .ok_or_else(|| "MongoDB adapter not found for this connection".to_string())?;
    
    adapter.drop_index(&collection, &index_name).await.map_err(|e| e.to_string())
}

// ============================================================================
// Redis Commands
// ============================================================================

/// Get a string value from Redis
#[tauri::command]
pub async fn redis_get(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Option<String>, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.get_string(&key).await.map_err(|e| e.to_string())
}

/// Set a string value in Redis
#[tauri::command]
pub async fn redis_set(
    conn_id: String,
    key: String,
    value: String,
    ttl_seconds: Option<u64>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.set_string(&key, &value, ttl_seconds).await.map_err(|e| e.to_string())
}

/// Delete a key from Redis
#[tauri::command]
pub async fn redis_delete(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.delete_key(&key).await.map_err(|e| e.to_string())
}

/// Get TTL of a key in Redis
#[tauri::command]
pub async fn redis_ttl(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.key_ttl(&key).await.map_err(|e| e.to_string())
}

/// Set TTL on a key in Redis
#[tauri::command]
pub async fn redis_expire(
    conn_id: String,
    key: String,
    seconds: u64,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.set_key_ttl(&key, seconds).await.map_err(|e| e.to_string())
}

/// Check if a key exists in Redis
#[tauri::command]
pub async fn redis_exists(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.key_exists(&key).await.map_err(|e| e.to_string())
}

/// Get database size (number of keys)
#[tauri::command]
pub async fn redis_dbsize(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.dbsize().await.map_err(|e| e.to_string())
}

/// Get server info
#[tauri::command]
pub async fn redis_info(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.get_server_info_raw().await.map_err(|e| e.to_string())
}

/// Get all hash fields and values
#[tauri::command]
pub async fn redis_hgetall(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.hash_get_all(&key).await.map_err(|e| e.to_string())
}

/// Set a hash field
#[tauri::command]
pub async fn redis_hset(
    conn_id: String,
    key: String,
    field: String,
    value: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.hash_set_field(&key, &field, &value).await.map_err(|e| e.to_string())
}

/// Get list range
#[tauri::command]
pub async fn redis_lrange(
    conn_id: String,
    key: String,
    start: i64,
    stop: i64,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<String>, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.list_range(&key, start, stop).await.map_err(|e| e.to_string())
}

/// Get set members
#[tauri::command]
pub async fn redis_smembers(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<String>, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.set_members(&key).await.map_err(|e| e.to_string())
}

/// Get key type
#[tauri::command]
pub async fn redis_type(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    let redis_adapters = manager.redis_adapters.read().await;
    let adapter = redis_adapters.get(&conn_id)
        .ok_or_else(|| "Redis adapter not found for this connection".to_string())?;
    
    adapter.key_type(&key).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_select_query_simple_select() {
        assert!(is_select_query("SELECT * FROM users"));
        assert!(is_select_query("select id from users"));
        assert!(is_select_query("  SELECT * FROM users  "));
    }

    #[test]
    fn test_is_select_query_mutations() {
        assert!(!is_select_query("UPDATE users SET name = 'test'"));
        assert!(!is_select_query("INSERT INTO users (name) VALUES ('test')"));
        assert!(!is_select_query("DELETE FROM users WHERE id = 1"));
    }

    #[test]
    fn test_is_select_query_cte_with_select() {
        let sql = "WITH cte AS (SELECT id FROM users) SELECT * FROM cte";
        assert!(is_select_query(sql));
    }

    #[test]
    fn test_is_select_query_cte_with_update() {
        let sql = r#"
            WITH mismatch AS (
                SELECT s.id, s.code FROM sales s
            )
            UPDATE campaigns SET code = m.code FROM mismatch m WHERE id = m.id
        "#;
        assert!(!is_select_query(sql));
    }

    #[test]
    fn test_is_select_query_cte_with_insert() {
        let sql = "WITH data AS (SELECT 1 as id) INSERT INTO users (id) SELECT id FROM data";
        assert!(!is_select_query(sql));
    }

    #[test]
    fn test_is_select_query_cte_with_delete() {
        let sql = "WITH old AS (SELECT id FROM users WHERE age > 100) DELETE FROM users WHERE id IN (SELECT id FROM old)";
        assert!(!is_select_query(sql));
    }

    #[test]
    fn test_is_select_query_explain() {
        assert!(is_select_query("EXPLAIN SELECT * FROM users"));
        assert!(is_select_query("EXPLAIN ANALYZE SELECT * FROM users"));
    }

    #[test]
    fn test_is_select_query_show() {
        assert!(is_select_query("SHOW search_path"));
        assert!(is_select_query("SHOW ALL"));
    }

    #[test]
    fn test_find_main_statement_keyword() {
        assert_eq!(
            find_main_statement_keyword("WITH cte AS (SELECT 1) SELECT * FROM cte"),
            Some("SELECT".to_string())
        );
        assert_eq!(
            find_main_statement_keyword("WITH cte AS (SELECT 1) UPDATE t SET x = 1"),
            Some("UPDATE".to_string())
        );
        assert_eq!(
            find_main_statement_keyword("WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"),
            Some("INSERT".to_string())
        );
    }
}
