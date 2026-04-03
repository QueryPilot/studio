//! SQL-specific database commands.
//!
//! Commands for SQL databases (PostgreSQL, MySQL, SQLite, SQL Server).
//! Includes query execution, streaming, and database switching.

use std::sync::Arc;
use tauri::State;
use tokio_postgres::Row;

use crate::adapters::postgres::DirectMsgPackEncoder;
use crate::core::capabilities::CapabilityQueryResult;
use crate::core::ConnectionManager;
use crate::types::*;

/// Convert CapabilityQueryResult to QueryResult for backward compatibility
pub(crate) fn capability_result_to_query_result(cap_result: CapabilityQueryResult) -> QueryResult {
    QueryResult {
        columns: cap_result
            .columns
            .into_iter()
            .map(|c| ColumnMeta {
                name: c.name,
                data_type: CellValueType::Text, // Default, actual type parsing happens in frontend
                nullable: true,
                primary_key: false,
                db_type: c.data_type,
                type_oid: None,
                default_value: None,
                comment: None,
                enum_values: None,
                type_category: None,
                precision: None,
                scale: None,
            })
            .collect(),
        rows: cap_result.rows,
    }
}

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
    let adapter = manager
        .borrow_adapter(&conn_id)
        .ok_or_else(|| "Connection not found after reconnect".to_string())?;

    let sql_adapter = adapter
        .as_sql()
        .ok_or_else(|| "switch_database is only supported for SQL databases".to_string())?;

    let verify_sql = match profile.db_type {
        DbType::PostgreSQL => "SELECT current_database()",
        DbType::MySQL | DbType::MariaDB => "SELECT DATABASE()",
        DbType::SQLServer => "SELECT DB_NAME()",
        DbType::Oracle => "SELECT SYS_CONTEXT('USERENV', 'SERVICE_NAME') FROM dual",
        _ => "SELECT 1",
    };

    let result = sql_adapter
        .execute_query(verify_sql)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = result.rows.first() {
        if let Some(cell) = row.first() {
            let current_db = cell.as_str().unwrap_or_default().to_string();
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
    // Safe mode guard (synchronous lookup — no DashMap lock held across await)
    let op_kind = crate::core::safe_mode::classify_sql(&sql);
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        op_kind,
        &format!("{:?}", op_kind),
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    // Default timeout: 5 minutes (300 seconds)
    // Can be overridden per-query via timeout_secs parameter
    let timeout_duration = std::time::Duration::from_secs(timeout_secs.unwrap_or(300));

    let sql_adapter = adapter
        .as_sql()
        .ok_or_else(|| "query command only supports SQL databases".to_string())?;

    let cap_result = tokio::time::timeout(timeout_duration, sql_adapter.execute_query(&sql))
        .await
        .map_err(|_| {
            format!(
                "Query timed out after {} seconds",
                timeout_duration.as_secs()
            )
        })?
        .map_err(|e| e.to_string())?;

    Ok(capability_result_to_query_result(cap_result))
}

// ============================================================================
// Query Parsing Helpers
// ============================================================================

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
            let before_ok = abs_pos == 0 || !upper.as_bytes()[abs_pos - 1].is_ascii_alphanumeric();
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
                if depth == 0 && first_keyword_pos.is_none_or(|(p, _)| abs_pos < p) {
                    first_keyword_pos = Some((abs_pos, keyword));
                }
            }

            search_start = abs_pos + 1;
        }
    }

    first_keyword_pos.map(|(_, kw)| kw.to_string())
}

/// Strip SQL comments (line comments `--` and block comments `/* */`)
/// while preserving content inside single-quoted strings.
fn strip_sql_comments(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let bytes = sql.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // Single-quoted string — copy verbatim
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

        // Line comment — skip to end of line
        if bytes[i] == b'-' && i + 1 < len && bytes[i + 1] == b'-' {
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        // Block comment — skip to closing */
        if bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2; // skip */
            }
            continue;
        }

        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

/// Check if SQL contains multiple statements (simple heuristic)
fn is_multi_statement_query(sql: &str) -> bool {
    // Strip comments first so commented-out semicolons/keywords don't cause
    // false positives (e.g., `-- ROLLBACK;\nSELECT 1` is a single statement).
    let without_comments = strip_sql_comments(sql);
    let trimmed = without_comments.trim();

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

// ============================================================================
// Streaming Query Execution
// ============================================================================

async fn execute_single_fetch_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    adapter: &crate::core::manager::UnifiedAdapter,
) -> std::result::Result<(), String> {
    // Dispatch to database-specific streaming implementation
    match adapter.db_type() {
        DbType::PostgreSQL => {
            execute_postgres_stream(sql, metadata_channel, data_channel, adapter).await
        }
        DbType::MySQL | DbType::MariaDB => {
            execute_mysql_stream(sql, metadata_channel, data_channel, adapter).await
        }
        DbType::SQLite => {
            execute_generic_stream(sql, metadata_channel, data_channel, adapter).await
        }
        DbType::Oracle => {
            execute_oracle_stream(sql, metadata_channel, data_channel, adapter).await
        }
        DbType::DuckDB => {
            execute_duckdb_stream(sql, metadata_channel, data_channel, adapter).await
        }
        DbType::SQLServer => {
            execute_mssql_stream(sql, metadata_channel, data_channel, adapter).await
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
    adapter: &crate::core::manager::UnifiedAdapter,
) -> std::result::Result<(), String> {
    let start_time = std::time::Instant::now();

    let sql_adapter = adapter
        .as_sql()
        .ok_or_else(|| "execute_generic_stream only supports SQL databases".to_string())?;

    let cap_result = sql_adapter
        .execute_query(sql)
        .await
        .map_err(|e| e.to_string())?;
    let result = capability_result_to_query_result(cap_result);

    let query_elapsed = start_time.elapsed().as_millis();
    tracing::info!(
        "  ⏱ Query execution: {}ms, {} rows",
        query_elapsed,
        result.rows.len()
    );

    send_query_results(
        &result,
        start_time,
        query_elapsed,
        metadata_channel,
        data_channel,
    )
}

/// Poll the IPC data channel by sending empty payloads every 100ms.
/// Returns when the channel closes (frontend cancelled). The frontend
/// ignores empty batches (checks `rawRows.length === 0`).
async fn wait_for_channel_close(data_channel: &tauri::ipc::Channel<tauri::ipc::Response>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if data_channel
            .send(tauri::ipc::Response::new(vec![]))
            .is_err()
        {
            return;
        }
    }
}

/// Send query results (columns + rows + timing) to the frontend channels.
/// Shared by MySQL, MSSQL, and other single-fetch streaming implementations.
fn send_query_results(
    result: &QueryResult,
    start_time: std::time::Instant,
    query_elapsed_ms: u128,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
) -> std::result::Result<(), String> {
    let _ = metadata_channel.send(StreamMessage::Started {
        columns: result.columns.clone(),
        estimated_rows: Some(result.rows.len() as i64),
    });

    let encode_start = std::time::Instant::now();
    if !result.rows.is_empty() {
        let msgpack_data =
            rmp_serde::to_vec(&result.rows).map_err(|e| format!("Failed to encode rows: {}", e))?;
        let _ = data_channel.send(tauri::ipc::Response::new(msgpack_data));
    }
    let encode_elapsed = encode_start.elapsed().as_millis();
    let total_elapsed = start_time.elapsed().as_millis();

    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows: result.rows.len(),
        execution_time_ms: total_elapsed as u64,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_elapsed as u64),
        fetch_count: Some(1),
        network_ms: Some(query_elapsed_ms as u64),
        conversion_ms: Some(encode_elapsed as u64),
        ipc_send_ms: Some(0),
    });

    Ok(())
}

/// DuckDB chunked streaming implementation.
/// Uses progressive batch sizes (16, 64, 256, 1024, 2048) for fast initial
/// rendering while maintaining throughput for large result sets.
async fn execute_duckdb_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    adapter: &crate::core::manager::UnifiedAdapter,
) -> std::result::Result<(), String> {
    let start_time = std::time::Instant::now();

    let duckdb_adapter = adapter
        .as_duckdb()
        .ok_or_else(|| "execute_duckdb_stream requires a DuckDB connection".to_string())?;

    let (columns, chunks) = duckdb_adapter
        .execute_query_chunked(sql)
        .await
        .map_err(|e| e.to_string())?;

    let query_elapsed = start_time.elapsed().as_millis();
    let total_rows: usize = chunks.iter().map(|c| c.len()).sum();

    tracing::info!(
        "  ⏱ DuckDB chunked query: {}ms, {} rows in {} chunks",
        query_elapsed,
        total_rows,
        chunks.len()
    );

    // Convert columns to ColumnMeta for StreamMessage
    let stream_columns: Vec<ColumnMeta> = columns
        .iter()
        .map(|c| ColumnMeta {
            name: c.name.clone(),
            data_type: CellValueType::Text,
            nullable: true,
            primary_key: false,
            db_type: c.data_type.clone(),
            type_oid: None,
            default_value: None,
            comment: None,
            enum_values: None,
            type_category: None,
            precision: None,
            scale: None,
        })
        .collect();

    let _ = metadata_channel.send(StreamMessage::Started {
        columns: stream_columns,
        estimated_rows: Some(total_rows as i64),
    });

    let encode_start = std::time::Instant::now();
    let mut sent_chunks: u64 = 0;
    for chunk in &chunks {
        if chunk.is_empty() {
            continue;
        }
        let msgpack_data =
            rmp_serde::to_vec(chunk).map_err(|e| format!("Failed to encode chunk: {}", e))?;
        if data_channel
            .send(tauri::ipc::Response::new(msgpack_data))
            .is_err()
        {
            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Frontend cancelled the stream".to_string(),
            });
            return Ok(());
        }
        sent_chunks += 1;
    }
    let encode_elapsed = encode_start.elapsed().as_millis();
    let total_elapsed = start_time.elapsed().as_millis();

    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: total_elapsed as u64,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_elapsed as u64),
        fetch_count: Some(sent_chunks),
        network_ms: Some(query_elapsed as u64),
        conversion_ms: Some(encode_elapsed as u64),
        ipc_send_ms: Some(0),
    });

    Ok(())
}

/// MySQL/MariaDB streaming implementation with cancellation support.
/// Uses the same connection for both CONNECTION_ID() retrieval and query execution,
/// ensuring the correct query gets killed on cancellation.
///
/// Optimized path: mysql_async::Row → DirectMsgPackEncoder → progressive IPC batches
async fn execute_mysql_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    adapter: &crate::core::manager::UnifiedAdapter,
) -> std::result::Result<(), String> {
    use crate::adapters::mysql::DirectMsgPackEncoder;
    use mysql_async::prelude::*;

    let mysql_adapter = adapter
        .as_mysql()
        .ok_or_else(|| "MySQL adapter not available".to_string())?;
    let pool = mysql_adapter
        .get_pool()
        .await
        .ok_or_else(|| "MySQL pool not available".to_string())?;

    // Get the query connection and its connection ID (same connection for both)
    let mut query_conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Failed to get MySQL connection: {}", e))?;

    let conn_id: u32 = query_conn
        .query_first("SELECT CONNECTION_ID()")
        .await
        .map_err(|e| format!("Failed to get CONNECTION_ID: {}", e))?
        .unwrap_or(0);
    tracing::info!("  🔍 MySQL query running on connection ID: {}", conn_id);

    let start_time = std::time::Instant::now();
    let sql_owned = sql.to_string();

    // Execute the query on the SAME connection we got the ID from.
    // Collect rows eagerly then process in progressive batches.
    let query_future = async {
        let mut result = query_conn
            .query_iter(&sql_owned)
            .await
            .map_err(|e| format!("Query failed: {}", e))?;

        // Extract column metadata directly into ColumnMeta (bypassing CapabilityColumnMeta)
        let columns_ref = result.columns_ref();
        let columns: Vec<ColumnMeta> = columns_ref
            .iter()
            .map(|col| {
                let col_type = col.column_type();
                let is_unsigned = col
                    .flags()
                    .contains(mysql_async::consts::ColumnFlags::UNSIGNED_FLAG);
                ColumnMeta {
                    name: col.name_str().to_string(),
                    data_type:
                        crate::adapters::mysql::types::MySqlTypeConverter::column_type_to_cell_type(
                            col_type,
                            is_unsigned,
                        ),
                    db_type:
                        crate::adapters::mysql::types::MySqlTypeConverter::column_type_to_string(
                            col_type,
                        ),
                    nullable: true,
                    primary_key: false,
                    type_oid: None,
                    default_value: None,
                    comment: None,
                    enum_values: None,
                    type_category: None,
                    precision: None,
                    scale: None,
                }
            })
            .collect();

        let column_count = columns.len();

        let rows: Vec<mysql_async::Row> = result
            .collect()
            .await
            .map_err(|e| format!("Failed to collect rows: {}", e))?;

        Ok::<_, String>((columns, column_count, rows))
    };

    let (columns, column_count, rows) = tokio::select! {
        result = query_future => result?,
        _ = wait_for_channel_close(data_channel) => {
            tracing::info!("  ⚠️  Channel closed (user cancelled MySQL query)");
            if conn_id > 0 {
                tracing::info!("  🛑 Sending KILL QUERY {} to MySQL", conn_id);
                let kill_pool = pool.clone();
                tokio::spawn(async move {
                    match kill_pool.get_conn().await {
                        Ok(mut kill_conn) => {
                            let kill_sql = format!("KILL QUERY {}", conn_id);
                            match kill_conn.query_drop(&kill_sql).await {
                                Ok(_) => tracing::info!("  ✅ Successfully killed MySQL query"),
                                Err(e) => tracing::warn!("  ⚠️  Failed to kill MySQL query: {}", e),
                            }
                        }
                        Err(e) => tracing::warn!("  ⚠️  Failed to get kill connection: {}", e),
                    }
                });
            }
            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Query cancelled by user".to_string(),
            });
            return Err("Query cancelled by user".to_string());
        }
    };

    let query_elapsed = start_time.elapsed().as_millis();
    let total_rows = rows.len();
    tracing::info!(
        "  ⏱ MySQL query execution: {}ms, {} rows",
        query_elapsed,
        total_rows
    );

    // Send column metadata immediately
    let _ = metadata_channel.send(StreamMessage::Started {
        columns,
        estimated_rows: Some(total_rows as i64),
    });

    // Direct encode to MessagePack with progressive batching
    let encoder = DirectMsgPackEncoder::new(column_count);

    const BATCH_SIZES: [usize; 5] = [16, 64, 256, 1024, 2048];

    let mut conversion_time_ms = 0u64;
    let mut send_time_ms = 0u64;
    let mut send_count = 0usize;
    let mut offset = 0usize;
    let mut batch_index = 0usize;

    while offset < total_rows {
        let batch_size = BATCH_SIZES[batch_index.min(BATCH_SIZES.len() - 1)];
        let end = (offset + batch_size).min(total_rows);
        let batch = &rows[offset..end];

        let convert_start = std::time::Instant::now();
        let rows_msgpack = encoder.encode_batch(batch).unwrap_or_else(|e| {
            tracing::error!(
                "  ❌ MySQL batch encode failed (rows {}-{}): {}",
                offset,
                end,
                e
            );
            vec![0x90] // valid empty msgpack array
        });
        conversion_time_ms += convert_start.elapsed().as_millis() as u64;

        let send_start = std::time::Instant::now();
        let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
        send_time_ms += send_start.elapsed().as_millis() as u64;
        send_count += 1;

        if send_result.is_err() {
            tracing::info!("  ⚠️  Channel closed (user cancelled), stopping stream early");

            if conn_id > 0 {
                tracing::info!("  🛑 Sending KILL QUERY {} to MySQL", conn_id);
                let kill_pool = pool.clone();
                tokio::spawn(async move {
                    match kill_pool.get_conn().await {
                        Ok(mut kill_conn) => {
                            let kill_sql = format!("KILL QUERY {}", conn_id);
                            match kill_conn.query_drop(&kill_sql).await {
                                Ok(_) => tracing::info!("  ✅ Successfully killed MySQL query"),
                                Err(e) => {
                                    tracing::warn!("  ⚠️  Failed to kill MySQL query: {}", e)
                                }
                            }
                        }
                        Err(e) => tracing::warn!("  ⚠️  Failed to get kill connection: {}", e),
                    }
                });
            }

            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Query cancelled by user".to_string(),
            });
            return Err("Query cancelled by user".to_string());
        }

        offset = end;
        batch_index += 1;
    }

    let total_time = start_time.elapsed().as_millis() as u64;
    let network_time_ms = total_time.saturating_sub(conversion_time_ms);

    tracing::info!("==========================================");
    tracing::info!("MYSQL STREAMING COMPLETE: {} rows", total_rows);
    tracing::info!("  Total time: {}ms", total_time);
    if total_time > 0 {
        tracing::info!(
            "  Rows/sec: {:.0}",
            (total_rows as f64 / total_time as f64) * 1000.0
        );
    }
    tracing::info!("  ┌─ Performance Breakdown:");
    tracing::info!(
        "  │  Network/DB: {}ms ({:.1}%)",
        network_time_ms,
        if total_time > 0 {
            (network_time_ms as f64 / total_time as f64) * 100.0
        } else {
            0.0
        }
    );
    tracing::info!(
        "  │  Conversion+Serialization: {}ms ({:.1}%)",
        conversion_time_ms,
        if total_time > 0 {
            (conversion_time_ms as f64 / total_time as f64) * 100.0
        } else {
            0.0
        }
    );
    tracing::info!(
        "  │  IPC: {}ms queue, {} batches | Format: direct msgpack",
        send_time_ms,
        send_count
    );
    tracing::info!("  └─ Batch sizes: 16→64→256→1024→2048 (progressive)");
    tracing::info!("==========================================");

    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: total_time,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_time),
        fetch_count: Some(send_count as u64),
        network_ms: Some(network_time_ms),
        conversion_ms: Some(conversion_time_ms),
        ipc_send_ms: Some(send_time_ms),
    });

    Ok(())
}

/// Oracle-specific streaming implementation.
///
/// Oracle's OCI driver is synchronous, so we run the entire query + encoding
/// inside spawn_blocking. Rows are encoded to MessagePack as they come off the
/// server-side cursor in progressive batches, then sent to the frontend via IPC.
async fn execute_oracle_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    adapter: &crate::core::manager::UnifiedAdapter,
) -> std::result::Result<(), String> {
    use crate::adapters::oracle::oracle_type_to_cell_type;

    let oracle_adapter = adapter
        .as_oracle()
        .ok_or_else(|| "Oracle adapter not available".to_string())?;

    // Clone the adapter so we can move it into spawn_blocking
    let oracle_adapter = oracle_adapter.clone();
    let sql_owned = sql.to_string();
    let start_time = std::time::Instant::now();

    // Use mpsc to stream encoded batches out of spawn_blocking
    let (batch_tx, mut batch_rx) =
        tokio::sync::mpsc::channel::<OracleBatchMessage>(8);

    let blocking_handle = tokio::task::spawn_blocking(move || {
        // Get connection inside spawn_blocking to avoid blocking the async executor
        let conn = oracle_adapter
            .get_connection_blocking()
            .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .statement(&sql_owned)
            .build()
            .map_err(|e| e.to_string())?;

        if !stmt.is_query() {
            stmt.execute(&[]).map_err(|e| e.to_string())?;
            let _ = batch_tx.blocking_send(OracleBatchMessage::Metadata {
                columns: vec![],
            });
            return Ok::<_, String>(());
        }

        let result_set = stmt.query(&[]).map_err(|e| e.to_string())?;

        // Extract column metadata
        let columns: Vec<ColumnMeta> = result_set
            .column_info()
            .iter()
            .map(|info| {
                let otype = info.oracle_type();
                ColumnMeta {
                    name: info.name().to_string(),
                    data_type: oracle_type_to_cell_type(otype),
                    db_type: otype.to_string(),
                    nullable: info.nullable(),
                    primary_key: false,
                    type_oid: None,
                    default_value: None,
                    comment: None,
                    enum_values: None,
                    type_category: None,
                    precision: None,
                    scale: None,
                }
            })
            .collect();

        let column_count = columns.len();

        // Send metadata immediately
        if batch_tx
            .blocking_send(OracleBatchMessage::Metadata {
                columns,
            })
            .is_err()
        {
            return Ok(());
        }

        // Progressive batch sizes
        const BATCH_SIZES: [usize; 5] = [16, 64, 256, 1024, 2048];
        let mut batch_index = 0usize;
        let mut rows_in_batch = 0usize;
        let mut total_rows = 0usize;

        // Accumulate encoded row bytes into a batch buffer.
        // The buffer holds raw encoded rows (no outer array wrapper yet).
        let mut batch_buf: Vec<u8> = Vec::with_capacity(64 * 1024);

        for row_result in result_set {
            let row = match row_result {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!("Oracle row fetch error: {}", e);
                    continue;
                }
            };

            // Encode the row directly into the batch buffer
            let row_start = batch_buf.len();
            rmp::encode::write_array_len(&mut batch_buf, column_count as u32)
                .map_err(|e| e.to_string())?;
            for i in 0..column_count {
                if let Err(e) = crate::adapters::oracle::direct_msgpack::encode_oracle_cell(
                    &mut batch_buf,
                    &row,
                    i,
                ) {
                    tracing::warn!("Oracle cell encode failed (col {}): {}", i, e);
                    // Truncate partial row and write null row as fallback
                    batch_buf.truncate(row_start);
                    let _ = rmp::encode::write_array_len(&mut batch_buf, column_count as u32);
                    for _ in 0..column_count {
                        let _ = rmp::encode::write_nil(&mut batch_buf);
                    }
                    break;
                }
            }

            rows_in_batch += 1;
            total_rows += 1;

            let target_batch_size = BATCH_SIZES[batch_index.min(BATCH_SIZES.len() - 1)];
            if rows_in_batch >= target_batch_size {
                // Wrap accumulated rows in an outer array header
                let mut final_buf =
                    Vec::with_capacity(5 + batch_buf.len());
                rmp::encode::write_array_len(&mut final_buf, rows_in_batch as u32)
                    .map_err(|e| e.to_string())?;
                final_buf.extend_from_slice(&batch_buf);

                if batch_tx
                    .blocking_send(OracleBatchMessage::Data(final_buf))
                    .is_err()
                {
                    // Channel closed (user cancelled)
                    return Ok(());
                }

                batch_buf.clear();
                rows_in_batch = 0;
                batch_index += 1;
            }
        }

        // Send remaining rows
        if rows_in_batch > 0 {
            let mut final_buf = Vec::with_capacity(5 + batch_buf.len());
            rmp::encode::write_array_len(&mut final_buf, rows_in_batch as u32)
                .map_err(|e| e.to_string())?;
            final_buf.extend_from_slice(&batch_buf);
            let _ = batch_tx.blocking_send(OracleBatchMessage::Data(final_buf));
        }

        // Signal completion with total row count
        let _ = batch_tx.blocking_send(OracleBatchMessage::Done {
            total_rows,
        });

        Ok(())
    });

    // Async side: receive batches and send to IPC channels
    let mut columns_sent = false;
    let mut total_rows = 0usize;
    let mut send_count = 0usize;
    let mut send_time_ms = 0u64;

    while let Some(msg) = batch_rx.recv().await {
        match msg {
            OracleBatchMessage::Metadata { columns, .. } => {
                let _ = metadata_channel.send(StreamMessage::Started {
                    columns,
                    estimated_rows: None,
                });
                columns_sent = true;
            }
            OracleBatchMessage::Data(data) => {
                if !columns_sent {
                    continue;
                }
                let send_start = std::time::Instant::now();
                if data_channel
                    .send(tauri::ipc::Response::new(data))
                    .is_err()
                {
                    let _ = metadata_channel.send(StreamMessage::Interrupted {
                        resumable: false,
                        message: "Query cancelled by user".to_string(),
                    });
                    return Err("Query cancelled by user".to_string());
                }
                send_time_ms += send_start.elapsed().as_millis() as u64;
                send_count += 1;
            }
            OracleBatchMessage::Done { total_rows: rows } => {
                total_rows = rows;
            }
        }
    }

    // Wait for the blocking task to finish
    blocking_handle
        .await
        .map_err(|e| format!("Oracle streaming task panicked: {}", e))??;

    let total_time = start_time.elapsed().as_millis() as u64;
    let query_elapsed = total_time.saturating_sub(send_time_ms);

    tracing::info!("==========================================");
    tracing::info!("ORACLE STREAMING COMPLETE: {} rows", total_rows);
    tracing::info!("  Total time: {}ms", total_time);
    tracing::info!(
        "  Batches: {}, IPC send: {}ms",
        send_count,
        send_time_ms
    );
    tracing::info!("==========================================");

    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: total_time,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_time),
        fetch_count: Some(send_count as u64),
        network_ms: Some(query_elapsed),
        conversion_ms: Some(0),
        ipc_send_ms: Some(send_time_ms),
    });

    Ok(())
}

/// Messages sent from Oracle's synchronous cursor iteration (spawn_blocking)
/// to the async streaming handler via mpsc channel.
enum OracleBatchMessage {
    /// Column metadata, sent first
    Metadata {
        columns: Vec<ColumnMeta>,
    },
    /// A batch of MessagePack-encoded rows
    Data(Vec<u8>),
    /// Cursor iteration complete
    Done { total_rows: usize },
}

fn parse_mssql_spid_text(value: Option<&str>) -> Option<i16> {
    value.and_then(|raw| raw.trim().parse::<i16>().ok())
}

fn extract_mssql_spid(row: &tiberius::Row) -> i16 {
    row.try_get::<i16, _>(0)
        .ok()
        .flatten()
        .or_else(|| {
            row.try_get::<i32, _>(0)
                .ok()
                .flatten()
                .and_then(|v| i16::try_from(v).ok())
        })
        .or_else(|| {
            row.try_get::<i64, _>(0)
                .ok()
                .flatten()
                .and_then(|v| i16::try_from(v).ok())
        })
        .or_else(|| parse_mssql_spid_text(row.try_get::<&str, _>(0).ok().flatten()))
        .unwrap_or(0)
}

/// SQL Server streaming implementation with cancellation support.
/// Uses the same connection for both @@SPID retrieval and query execution,
/// ensuring the correct query gets killed on cancellation.
///
/// NOTE: MSSQL `KILL {spid}` terminates the entire session (not just the query).
/// Unlike MySQL's `KILL QUERY`, there is no query-only kill in SQL Server.
/// After the KILL, the pooled connection is dead. bb8 detects broken connections
/// via `ManageConnection::is_valid()` and will replace them on the next checkout.
async fn execute_mssql_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    adapter: &crate::core::manager::UnifiedAdapter,
) -> std::result::Result<(), String> {
    use crate::adapters::mssql::DirectMsgPackEncoder;
    use futures::FutureExt;
    use std::panic::AssertUnwindSafe;

    let mssql_adapter = adapter
        .as_mssql()
        .ok_or_else(|| "MSSQL adapter not available".to_string())?;
    let pool = mssql_adapter
        .get_pool()
        .await
        .ok_or_else(|| "MSSQL pool not available".to_string())?;

    // Get the query connection and its SPID (same connection for both)
    let mut query_conn = pool
        .get()
        .await
        .map_err(|e| format!("Failed to get MSSQL connection: {}", e))?;

    let is_showplan = crate::adapters::mssql::MssqlAdapter::is_showplan_batch(sql);

    if !is_showplan {
        crate::adapters::mssql::MssqlAdapter::reset_session_state(&mut query_conn).await;
    }

    let spid: i16 = {
        let result = query_conn
            .simple_query("SELECT @@SPID")
            .await
            .map_err(|e| format!("Failed to query @@SPID: {}", e))?;
        let row = result
            .into_row()
            .await
            .map_err(|e| format!("Failed to get SPID row: {}", e))?;
        match row {
            Some(r) => extract_mssql_spid(&r),
            None => 0,
        }
    };
    tracing::info!("  🔍 MSSQL query running on SPID: {}", spid);

    let start_time = std::time::Instant::now();

    // Rewrite SQL to handle unsupported column types (sql_variant, geography, geometry, hierarchyid)
    let sql_owned = if is_showplan {
        sql.to_string()
    } else {
        crate::adapters::mssql::MssqlAdapter::rewrite_for_unsupported_types(&mut query_conn, sql)
            .await
            .map_err(|e| e.to_string())?
    };

    // Execute the query on the SAME connection we got the SPID from.
    // Collect rows eagerly (tiberius limitation) then process in progressive batches.
    let query_future = async {
        let query_result = AssertUnwindSafe(async {
            if is_showplan {
                // SQL Server requires SET SHOWPLAN to be the only statement in its batch.
                // Execute as 3 separate queries on the same connection.
                let (set_on, inner_query, set_off) =
                    crate::adapters::mssql::MssqlAdapter::parse_showplan_batch(
                        sql_owned.as_str(),
                    )
                    .ok_or_else(|| "Invalid SHOWPLAN batch format".to_string())?;

                // Step 1: SET SHOWPLAN ON
                let on_result = query_conn
                    .simple_query(set_on.as_str())
                    .await
                    .map_err(|e| format!("Failed to enable SHOWPLAN: {}", e))?;
                let _ = on_result.into_first_result().await;

                // Step 2: Execute query
                let plan_result = query_conn
                    .simple_query(inner_query.as_str())
                    .await
                    .map_err(|e| format!("SHOWPLAN query failed: {}", e))?;

                // STATISTICS formats return data + plan; plan is LAST result set.
                // SHOWPLAN formats return plan only; plan is FIRST result set.
                let is_statistics =
                    crate::adapters::mssql::MssqlAdapter::is_statistics_batch(sql_owned.as_str());

                let all_results: Vec<Vec<tiberius::Row>> = plan_result
                    .into_results()
                    .await
                    .map_err(|e| format!("Failed to collect plan results: {}", e))?;

                let plan_rows = if is_statistics {
                    all_results
                        .into_iter()
                        .rev()
                        .find(|rs| !rs.is_empty())
                        .unwrap_or_default()
                } else {
                    all_results
                        .into_iter()
                        .find(|rs| !rs.is_empty())
                        .unwrap_or_default()
                };

                let columns: Vec<ColumnMeta> = plan_rows
                    .first()
                    .map(|row| {
                        row.columns()
                            .iter()
                            .map(|col| ColumnMeta {
                                name: col.name().to_string(),
                                data_type:
                                    crate::adapters::mssql::types::MssqlTypeConverter::column_type_to_cell_type(
                                        &col.column_type(),
                                    ),
                                db_type:
                                    crate::adapters::mssql::types::MssqlTypeConverter::column_type_to_string(
                                        &col.column_type(),
                                    ),
                                nullable: true,
                                primary_key: false,
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

                let column_count = columns.len();

                // Step 3: SET SHOWPLAN/STATISTICS OFF (cleanup)
                if let Ok(off_result) = query_conn.simple_query(set_off.as_str()).await {
                    let _ = off_result.into_first_result().await;
                }

                Ok::<_, String>((columns, column_count, plan_rows))
            } else {
                // Standard path: use columns() + into_first_result()
                let mut result = query_conn
                    .simple_query(sql_owned.as_str())
                    .await
                    .map_err(|e| format!("Query failed: {}", e))?;

                // Extract column metadata directly into ColumnMeta (bypassing CapabilityColumnMeta)
                let columns_opt = result
                    .columns()
                    .await
                    .map_err(|e| format!("Failed to get columns: {}", e))?;

                let columns: Vec<ColumnMeta> = columns_opt
                    .map(|cols| {
                        cols.iter()
                            .map(|col| ColumnMeta {
                                name: col.name().to_string(),
                                data_type:
                                    crate::adapters::mssql::types::MssqlTypeConverter::column_type_to_cell_type(
                                        &col.column_type(),
                                    ),
                                db_type:
                                    crate::adapters::mssql::types::MssqlTypeConverter::column_type_to_string(
                                        &col.column_type(),
                                    ),
                                nullable: true,
                                primary_key: false,
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

                let column_count = columns.len();

                // Collect all rows (tiberius doesn't support row-by-row streaming)
                let rows: Vec<tiberius::Row> = result
                    .into_first_result()
                    .await
                    .map_err(|e| format!("Failed to collect rows: {}", e))?;

                Ok::<_, String>((columns, column_count, rows))
            }
        })
        .catch_unwind()
        .await;

        match query_result {
            Ok(result) => result,
            Err(_) => Err(
                "SQL_VARIANT columns or CLR UDTs are not supported. Cast them to NVARCHAR/VARBINARY or exclude them."
                    .to_string(),
            ),
        }
    };

    let (columns, column_count, rows) = tokio::select! {
        result = query_future => result?,
        _ = wait_for_channel_close(data_channel) => {
            tracing::info!("  ⚠️  Channel closed (user cancelled MSSQL query)");
            if spid > 0 {
                tracing::info!("  🛑 Sending KILL {} to MSSQL", spid);
                let kill_pool = pool.clone();
                tokio::spawn(async move {
                    match kill_pool.get().await {
                        Ok(mut kill_conn) => {
                            let kill_sql = format!("KILL {}", spid);
                            match kill_conn.simple_query(&kill_sql).await {
                                Ok(_) => tracing::info!("  ✅ Successfully killed MSSQL query"),
                                Err(e) => tracing::warn!("  ⚠️  Failed to kill MSSQL query: {}", e),
                            }
                        }
                        Err(e) => tracing::warn!("  ⚠️  Failed to get kill connection: {}", e),
                    }
                });
            }
            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Query cancelled by user".to_string(),
            });
            return Err("Query cancelled by user".to_string());
        }
    };

    let query_elapsed = start_time.elapsed().as_millis();
    let total_rows = rows.len();
    tracing::info!(
        "  ⏱ MSSQL query execution: {}ms, {} rows",
        query_elapsed,
        total_rows
    );

    // Send column metadata immediately
    let _ = metadata_channel.send(StreamMessage::Started {
        columns,
        estimated_rows: Some(total_rows as i64),
    });

    // Direct encode to MessagePack with progressive batching
    let encoder = DirectMsgPackEncoder::new(column_count);

    // Progressive batch sizes: start tiny for instant feedback, scale up
    const BATCH_SIZES: [usize; 5] = [16, 64, 256, 1024, 2048];

    let mut conversion_time_ms = 0u64;
    let mut send_time_ms = 0u64;
    let mut send_count = 0usize;
    let mut offset = 0usize;
    let mut batch_index = 0usize;

    while offset < total_rows {
        let batch_size = BATCH_SIZES[batch_index.min(BATCH_SIZES.len() - 1)];
        let end = (offset + batch_size).min(total_rows);
        let batch = &rows[offset..end];

        // Direct encode to MessagePack (no JSON intermediate!)
        let convert_start = std::time::Instant::now();
        let rows_msgpack = encoder.encode_batch(batch).unwrap_or_else(|e| {
            tracing::error!(
                "  ❌ MSSQL batch encode failed (rows {}-{}): {}",
                offset,
                end,
                e
            );
            vec![0x90] // valid empty msgpack array
        });
        conversion_time_ms += convert_start.elapsed().as_millis() as u64;

        // Send raw binary via Response (ZERO serialization overhead!)
        let send_start = std::time::Instant::now();
        let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
        send_time_ms += send_start.elapsed().as_millis() as u64;
        send_count += 1;

        // Check if channel closed (user cancelled) - stop streaming early
        if send_result.is_err() {
            tracing::info!("  ⚠️  Channel closed (user cancelled), stopping stream early");

            if spid > 0 {
                tracing::info!("  🛑 Sending KILL {} to MSSQL", spid);
                let kill_pool = pool.clone();
                tokio::spawn(async move {
                    match kill_pool.get().await {
                        Ok(mut kill_conn) => {
                            let kill_sql = format!("KILL {}", spid);
                            match kill_conn.simple_query(&kill_sql).await {
                                Ok(_) => tracing::info!("  ✅ Successfully killed MSSQL query"),
                                Err(e) => {
                                    tracing::warn!("  ⚠️  Failed to kill MSSQL query: {}", e)
                                }
                            }
                        }
                        Err(e) => tracing::warn!("  ⚠️  Failed to get kill connection: {}", e),
                    }
                });
            }

            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Query cancelled by user".to_string(),
            });
            return Err("Query cancelled by user".to_string());
        }

        offset = end;
        batch_index += 1;
    }

    let total_time = start_time.elapsed().as_millis() as u64;
    let network_time_ms = total_time.saturating_sub(conversion_time_ms);

    tracing::info!("==========================================");
    tracing::info!("MSSQL STREAMING COMPLETE: {} rows", total_rows);
    tracing::info!("  Total time: {}ms", total_time);
    if total_time > 0 {
        tracing::info!(
            "  Rows/sec: {:.0}",
            (total_rows as f64 / total_time as f64) * 1000.0
        );
    }
    tracing::info!("  ┌─ Performance Breakdown:");
    tracing::info!(
        "  │  Network/DB: {}ms ({:.1}%)",
        network_time_ms,
        if total_time > 0 {
            (network_time_ms as f64 / total_time as f64) * 100.0
        } else {
            0.0
        }
    );
    tracing::info!(
        "  │  Conversion+Serialization: {}ms ({:.1}%)",
        conversion_time_ms,
        if total_time > 0 {
            (conversion_time_ms as f64 / total_time as f64) * 100.0
        } else {
            0.0
        }
    );
    tracing::info!(
        "  │  IPC: {}ms queue, {} batches | Format: direct msgpack",
        send_time_ms,
        send_count
    );
    tracing::info!("  └─ Batch sizes: 16→64→256→1024→2048 (progressive)");
    tracing::info!("==========================================");

    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: total_time,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_time),
        fetch_count: Some(send_count as u64),
        network_ms: Some(network_time_ms),
        conversion_ms: Some(conversion_time_ms),
        ipc_send_ms: Some(send_time_ms),
    });

    Ok(())
}

/// SQLite-specific query execution with direct MessagePack encoding,
/// rayon-parallel batch encoding, and progressive batch sending.
///
/// Optimized path:
///   1. rusqlite::Row → OwnedCell (sequential, Row is borrowed)
///   2. Vec<OwnedCell> batches → rayon parallel encode → MessagePack bytes
///   3. Progressive IPC batch sending (16→64→256→1024→2048)
async fn execute_sqlite_query(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    adapter: &crate::core::manager::UnifiedAdapter,
) -> std::result::Result<(), String> {
    use crate::adapters::sqlite::DirectMsgPackEncoder;

    let start_time = std::time::Instant::now();

    let sqlite_adapter = adapter
        .as_sqlite()
        .ok_or_else(|| "SQLite adapter not available".to_string())?;

    // Execute query and collect owned cell values + proper column metadata
    // OwnedCell values are Send+Sync, enabling rayon parallel encoding
    let (columns, owned_rows) = sqlite_adapter
        .execute_query_streaming(sql)
        .await
        .map_err(|e| e.to_string())?;

    let query_elapsed = start_time.elapsed().as_millis();
    let total_rows = owned_rows.len();
    let column_count = columns.len();
    tracing::info!(
        "  ⏱ SQLite query + collect: {}ms, {} rows, {} cols",
        query_elapsed,
        total_rows,
        column_count
    );

    // Send column metadata immediately
    let _ = metadata_channel.send(StreamMessage::Started {
        columns,
        estimated_rows: Some(total_rows as i64),
    });

    // Progressive batch encoding with rayon parallelism (>=64 rows)
    let encoder = DirectMsgPackEncoder::new(column_count);

    const BATCH_SIZES: [usize; 5] = [16, 64, 256, 1024, 2048];

    let mut conversion_time_ms = 0u64;
    let mut send_time_ms = 0u64;
    let mut send_count = 0usize;
    let mut offset = 0usize;
    let mut batch_index = 0usize;

    while offset < total_rows {
        let batch_size = BATCH_SIZES[batch_index.min(BATCH_SIZES.len() - 1)];
        let end = (offset + batch_size).min(total_rows);
        let batch = &owned_rows[offset..end];

        // Encode owned rows to msgpack (uses rayon for batches >= 64 rows)
        let convert_start = std::time::Instant::now();
        let rows_msgpack = encoder.encode_owned_batch(batch).unwrap_or_else(|e| {
            tracing::error!(
                "  ❌ SQLite batch encode failed (rows {}-{}): {}",
                offset,
                end,
                e
            );
            vec![0x90] // valid empty msgpack array
        });
        conversion_time_ms += convert_start.elapsed().as_millis() as u64;

        let send_start = std::time::Instant::now();
        let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
        send_time_ms += send_start.elapsed().as_millis() as u64;
        send_count += 1;

        if send_result.is_err() {
            tracing::info!("  ⚠️  Channel closed (user cancelled), stopping stream early");
            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Query cancelled by user".to_string(),
            });
            return Err("Query cancelled by user".to_string());
        }

        offset = end;
        batch_index += 1;
    }

    let total_time = start_time.elapsed().as_millis() as u64;
    let network_time_ms = total_time.saturating_sub(conversion_time_ms);

    tracing::info!("==========================================");
    tracing::info!("SQLITE STREAMING COMPLETE: {} rows", total_rows);
    tracing::info!("  Total time: {}ms", total_time);
    if total_time > 0 {
        tracing::info!(
            "  Rows/sec: {:.0}",
            (total_rows as f64 / total_time as f64) * 1000.0
        );
    }
    tracing::info!("  ┌─ Performance Breakdown:");
    tracing::info!(
        "  │  Query/Collect: {}ms ({:.1}%)",
        query_elapsed,
        if total_time > 0 {
            (query_elapsed as f64 / total_time as f64) * 100.0
        } else {
            0.0
        }
    );
    tracing::info!(
        "  │  Encode (rayon): {}ms ({:.1}%)",
        conversion_time_ms,
        if total_time > 0 {
            (conversion_time_ms as f64 / total_time as f64) * 100.0
        } else {
            0.0
        }
    );
    tracing::info!(
        "  │  IPC: {}ms queue, {} batches | Format: direct msgpack",
        send_time_ms,
        send_count
    );
    tracing::info!("  └─ Batch sizes: 16→64→256→1024→2048 (progressive, rayon ≥64)");
    tracing::info!("==========================================");

    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: total_time,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_time),
        fetch_count: Some(send_count as u64),
        network_ms: Some(network_time_ms),
        conversion_ms: Some(conversion_time_ms),
        ipc_send_ms: Some(send_time_ms),
    });

    Ok(())
}

/// PostgreSQL-specific streaming implementation with optimized binary protocol
fn postgres_text_column(name: &str) -> ColumnMeta {
    ColumnMeta {
        name: name.to_string(),
        data_type: CellValueType::Text,
        nullable: true,
        primary_key: false,
        db_type: "text".to_string(),
        type_oid: None,
        default_value: None,
        comment: None,
        enum_values: None,
        type_category: None,
        precision: None,
        scale: None,
    }
}

async fn execute_postgres_pooler_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    postgres_adapter: &crate::adapters::postgres::PostgresAdapter,
) -> std::result::Result<(), String> {
    use futures::StreamExt;

    let start_time = std::time::Instant::now();
    let pool = postgres_adapter
        .get_pool()
        .await
        .ok_or_else(|| "PostgreSQL pool not available".to_string())?;
    let client = postgres_adapter
        .get_client_with_schema()
        .await
        .map_err(|e| e.to_string())?;

    let backend_pid = client
        .simple_query("SELECT pg_backend_pid()")
        .await
        .ok()
        .and_then(|messages| {
            messages.into_iter().find_map(|message| match message {
                tokio_postgres::SimpleQueryMessage::Row(row) => row
                    .get(0)
                    .and_then(|value| value.parse::<i32>().ok()),
                _ => None,
            })
        })
        .unwrap_or(0);

    let stream_sql = postgres_adapter.decorate_simple_query_sql(sql);
    let query_start = std::time::Instant::now();
    let mut row_stream = Box::pin(
        client
            .simple_query_raw(&stream_sql)
            .await
            .map_err(|e| extract_db_error_message(&e))?,
    );

    let mut started = false;
    let mut total_rows = 0usize;
    let mut command_complete_count = 0u64;
    let mut row_buffer: Vec<Vec<Option<String>>> = Vec::new();
    let mut conversion_time_ms = 0u64;
    let mut send_time_ms = 0u64;
    let mut sent_batches = 0u64;

    while let Some(message) = row_stream.next().await {
        match message.map_err(|e| extract_db_error_message(&e))? {
            tokio_postgres::SimpleQueryMessage::RowDescription(description) => {
                let columns = description
                    .iter()
                    .map(|column| postgres_text_column(column.name()))
                    .collect::<Vec<_>>();
                if !started {
                    let _ = metadata_channel.send(StreamMessage::Started {
                        columns,
                        estimated_rows: None,
                    });
                    started = true;
                }
            }
            tokio_postgres::SimpleQueryMessage::Row(row) => {
                if !started {
                    let columns = row
                        .columns()
                        .iter()
                        .map(|column| postgres_text_column(column.name()))
                        .collect::<Vec<_>>();
                    let _ = metadata_channel.send(StreamMessage::Started {
                        columns,
                        estimated_rows: None,
                    });
                    started = true;
                }

                row_buffer.push(
                    (0..row.len())
                        .map(|index| row.get(index).map(|value| value.to_string()))
                        .collect(),
                );
                total_rows += 1;

                if row_buffer.len() >= 256 {
                    let encode_start = std::time::Instant::now();
                    let payload = rmp_serde::to_vec(&row_buffer)
                        .map_err(|e| format!("Failed to encode rows: {}", e))?;
                    conversion_time_ms += encode_start.elapsed().as_millis() as u64;
                    row_buffer.clear();

                    let send_start = std::time::Instant::now();
                    if data_channel
                        .send(tauri::ipc::Response::new(payload))
                        .is_err()
                    {
                        if backend_pid > 0 {
                            let cancel_pool = pool.clone();
                            tokio::spawn(async move {
                                if let Ok(cancel_conn) = cancel_pool.get().await {
                                    let cancel_sql =
                                        format!("SELECT pg_cancel_backend({})", backend_pid);
                                    let _ = cancel_conn.execute(&cancel_sql, &[]).await;
                                }
                            });
                        }
                        let _ = metadata_channel.send(StreamMessage::Interrupted {
                            resumable: false,
                            message: "Query cancelled by user".to_string(),
                        });
                        return Err("Query cancelled by user".to_string());
                    }
                    send_time_ms += send_start.elapsed().as_millis() as u64;
                    sent_batches += 1;
                }
            }
            tokio_postgres::SimpleQueryMessage::CommandComplete(count) => {
                command_complete_count = count;
            }
            _ => {}
        }
    }

    if !started {
        let estimated_rows = if command_complete_count > 0 {
            Some(command_complete_count as i64)
        } else {
            Some(0)
        };
        let _ = metadata_channel.send(StreamMessage::Started {
            columns: vec![],
            estimated_rows,
        });
    }

    if !row_buffer.is_empty() {
        let encode_start = std::time::Instant::now();
        let payload = rmp_serde::to_vec(&row_buffer)
            .map_err(|e| format!("Failed to encode rows: {}", e))?;
        conversion_time_ms += encode_start.elapsed().as_millis() as u64;
        row_buffer.clear();

        let send_start = std::time::Instant::now();
        if data_channel
            .send(tauri::ipc::Response::new(payload))
            .is_err()
        {
            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Query cancelled by user".to_string(),
            });
            return Err("Query cancelled by user".to_string());
        }
        send_time_ms += send_start.elapsed().as_millis() as u64;
        sent_batches += 1;
    }

    let execution_time_ms = start_time.elapsed().as_millis() as u64;
    let query_elapsed_ms = query_start.elapsed().as_millis() as u64;
    let final_row_count = total_rows.max(command_complete_count as usize);

    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows: final_row_count,
        execution_time_ms,
        cursor_setup_ms: None,
        total_streaming_ms: Some(execution_time_ms),
        fetch_count: Some(sent_batches),
        network_ms: Some(query_elapsed_ms),
        conversion_ms: Some(conversion_time_ms),
        ipc_send_ms: Some(send_time_ms),
    });

    Ok(())
}

async fn execute_postgres_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    adapter: &crate::core::manager::UnifiedAdapter,
) -> std::result::Result<(), String> {
    use futures::StreamExt;

    // Get pool from PostgresAdapter
    let postgres_adapter = adapter
        .as_postgres()
        .ok_or_else(|| "PostgreSQL adapter not available".to_string())?;

    if postgres_adapter.pooler_mode() == Some(true) {
        return execute_postgres_pooler_stream(
            sql,
            metadata_channel,
            data_channel,
            postgres_adapter,
        )
        .await;
    }

    let pool = postgres_adapter
        .get_pool()
        .await
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

        // Use simple_query for multi-statement support (no prepared statements)
        let simple_start = std::time::Instant::now();
        let batch_result = pool_conn.batch_execute(sql).await;

        if let Err(e) = &batch_result {
            tracing::error!("❌ batch_execute failed: {:?}", e);
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
    let backend_pid: i32 = match pool_conn.query_one("SELECT pg_backend_pid()", &[]).await {
        Ok(row) => {
            let pid: i32 = row.get(0);
            tracing::info!("  🔍 Query running on PostgreSQL backend PID: {}", pid);
            pid
        }
        Err(e) => {
            tracing::warn!(
                "  ⚠️ Could not get backend PID (cancellation disabled): {}",
                e
            );
            0 // Use 0 as sentinel - cancellation won't work but query will proceed
        }
    };

    // PREPARE statement - this is where the slowness happens on remote connections!
    let prepare_start = std::time::Instant::now();
    let stmt = pool_conn.prepare(sql).await.map_err(|e| {
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
        if check_interval.is_multiple_of(100) {
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
                                Ok(_) => {
                                    tracing::info!("  ✅ Successfully cancelled backend query")
                                }
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
                            tracing::info!(
                                "  🛑 Cancelling PostgreSQL backend PID: {}",
                                backend_pid
                            );
                            let cancel_pool = pool.clone();
                            tokio::spawn(async move {
                                if let Ok(cancel_conn) = cancel_pool.get().await {
                                    let cancel_sql =
                                        format!("SELECT pg_cancel_backend({})", backend_pid);
                                    match cancel_conn.execute(&cancel_sql, &[]).await {
                                        Ok(_) => {
                                            tracing::info!(
                                                "  ✅ Successfully cancelled backend query"
                                            )
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
                                Ok(_) => {
                                    tracing::info!("  ✅ Successfully cancelled backend query")
                                }
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
    tracing::info!("  └─ Batch sizes: 16→64→256→1024→2048 (progressive) | Format: direct msgpack");
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
#[allow(clippy::too_many_arguments)]
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

    // Safe mode guard (synchronous lookup — no DashMap lock held across await)
    let op_kind = crate::core::safe_mode::classify_sql(&sql);
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&connection_key),
        op_kind,
        &format!("{:?}", op_kind),
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&connection_key, 3)
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

    use futures::FutureExt;
    use std::panic::AssertUnwindSafe;

    // Route based on database type
    // SQLite uses the adapter's query() method, PostgreSQL uses streaming
    let stream_result = match AssertUnwindSafe(async {
        match adapter.db_type() {
            crate::types::DbType::SQLite => tokio::time::timeout(
                timeout_duration,
                execute_sqlite_query(&sql, &metadata_channel, &data_channel, &adapter),
            )
            .await
            .map_err(|_| {
                format!(
                    "Query timed out after {} seconds",
                    timeout_duration.as_secs()
                )
            })?,
            _ => {
                // PostgreSQL and other databases use the streaming path
                tokio::time::timeout(
                    timeout_duration,
                    execute_single_fetch_stream(&sql, &metadata_channel, &data_channel, &adapter),
                )
                .await
                .map_err(|_| {
                    format!(
                        "Query timed out after {} seconds",
                        timeout_duration.as_secs()
                    )
                })?
            }
        }
    })
    .catch_unwind()
    .await
    {
        Ok(result) => result,
        Err(_) => Err("Internal panic while executing query".to_string()),
    };

    // Guard against IPC race on channel close: when this command returns,
    // Tauri drops the channels.  If the last data batch is still in the IPC
    // transport buffer, the drop can replace it with an `undefined` close
    // notification, losing that batch's rows.
    //
    // Send a trailing sentinel empty buffer. The frontend ignores zero-length
    // payloads, and queryStreamClient now waits for invoke completion plus
    // decode-queue drain before finalizing success.
    let _ = data_channel.send(tauri::ipc::Response::new(vec![]));

    match stream_result {
        Ok(()) => Ok(()),
        Err(message) => {
            // Cancellation already emits StreamMessage::Interrupted from the worker path.
            if message == "Query cancelled by user" {
                return Err(message);
            }

            let send_result = metadata_channel.send(StreamMessage::Error {
                code: "QUERY_EXECUTION_ERROR".to_string(),
                message: message.clone(),
            });

            // If metadata channel is closed, fall back to invoke rejection.
            if send_result.is_err() {
                Err(message)
            } else {
                Ok(())
            }
        }
    }
}

// ============================================================================
// Integration probes
// ============================================================================

/// Check whether the Oracle Instant Client (OCI) libraries are available on this machine.
///
/// Searches for the OCI shared library on disk in common locations.
/// This approach works even after a fresh install without restarting the app,
/// unlike the pool-based probe which caches the library load result per-process.
#[tauri::command]
pub async fn check_oracle_client() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| {
        let found = find_oracle_client_library();
        match found {
            Some(path) => {
                // Verify the library architecture matches the running process
                if let Some(issue) = check_library_arch_mismatch(&path) {
                    return Ok(serde_json::json!({
                        "available": false,
                        "path": path,
                        "reason": issue,
                    }));
                }
                Ok(serde_json::json!({
                    "available": true,
                    "path": path,
                }))
            }
            None => Ok(serde_json::json!({
                "available": false,
                "reason": "Oracle Instant Client libraries not found on this system",
            })),
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// On macOS, check if the library's architecture matches the current process.
/// Returns Some(error_message) if there's a mismatch.
fn check_library_arch_mismatch(lib_path: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("file")
            .arg(lib_path)
            .output()
            .ok()?;
        let info = String::from_utf8_lossy(&output.stdout);
        let process_arch = std::env::consts::ARCH; // "aarch64" on Apple Silicon
        if process_arch == "aarch64" && !info.contains("arm64") {
            return Some(format!(
                "Installed Oracle Instant Client is x86_64 but this Mac requires arm64. \
                 Download the ARM64 version from oracle.com."
            ));
        }
        if process_arch == "x86_64" && !info.contains("x86_64") {
            return Some(
                "Installed Oracle Instant Client architecture does not match this system."
                    .to_string(),
            );
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = lib_path;
    None
}

/// Search for Oracle Instant Client shared library in common locations.
fn find_oracle_client_library() -> Option<String> {
    #[cfg(target_os = "macos")]
    let lib_name = "libclntsh.dylib";
    #[cfg(target_os = "linux")]
    let lib_name = "libclntsh.so";
    #[cfg(target_os = "windows")]
    let lib_name = "oci.dll";

    // 1. Check DYLD_LIBRARY_PATH / LD_LIBRARY_PATH / PATH
    #[cfg(target_os = "macos")]
    let path_var = "DYLD_LIBRARY_PATH";
    #[cfg(target_os = "linux")]
    let path_var = "LD_LIBRARY_PATH";
    #[cfg(target_os = "windows")]
    let path_var = "PATH";

    if let Ok(paths) = std::env::var(path_var) {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(lib_name);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    // 2. Check common install locations
    let search_dirs: Vec<&str> = {
        #[cfg(target_os = "macos")]
        {
            vec![
                "/opt/homebrew/lib",
                "/usr/local/lib",
                "/opt/oracle/instantclient_19_8",
                "/opt/oracle/instantclient_21_0",
                "/opt/oracle/instantclient",
            ]
        }
        #[cfg(target_os = "linux")]
        {
            vec![
                "/usr/lib/oracle/21/client64/lib",
                "/usr/lib/oracle/19.8/client64/lib",
                "/opt/oracle/instantclient_21_0",
                "/opt/oracle/instantclient_19_8",
                "/usr/local/lib",
            ]
        }
        #[cfg(target_os = "windows")]
        {
            vec![
                "C:\\oracle\\instantclient_21_0",
                "C:\\oracle\\instantclient_19_8",
                "C:\\instantclient",
            ]
        }
    };

    for dir in search_dirs {
        let candidate = std::path::Path::new(dir).join(lib_name);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    // 3. Try `which` / `where` to find via PATH
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = std::process::Command::new("find")
            .args(["/opt/homebrew", "-name", lib_name, "-maxdepth", "3"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let trimmed = first_line.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    None
}

/// Install Oracle Instant Client on macOS ARM64 by downloading the DMG,
/// mounting it, copying dylibs to /usr/local/lib, and unmounting.
#[tauri::command]
pub async fn install_oracle_client_dmg() -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("DMG installation is only available on macOS".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use tokio::process::Command;

        let dmg_url = "https://download.oracle.com/otn_software/mac/instantclient/233023/instantclient-basic-macos.arm64-23.3.0.23.09.dmg";
        let tmp_dir = std::env::temp_dir();
        let dmg_path = tmp_dir.join("oracle-instantclient.dmg");
        let mount_point = tmp_dir.join("oracle_dmg_mount");

        // Step 1: Download DMG
        let output = Command::new("curl")
            .args([
                "-L", "-o",
                dmg_path.to_str().unwrap(),
                "--progress-bar",
                dmg_url,
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to download: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Download failed: {}", stderr));
        }

        // Step 2: Mount DMG
        let _ = std::fs::create_dir_all(&mount_point);
        let output = Command::new("hdiutil")
            .args([
                "attach",
                dmg_path.to_str().unwrap(),
                "-mountpoint",
                mount_point.to_str().unwrap(),
                "-nobrowse",
                "-quiet",
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to mount DMG: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Mount failed: {}", stderr));
        }

        // Step 3: Find and copy dylibs
        let dest = std::path::Path::new("/usr/local/lib");
        if !dest.exists() {
            // Create /usr/local/lib if it doesn't exist (needs sudo on some systems)
            let output = Command::new("sudo")
                .args(["mkdir", "-p", "/usr/local/lib"])
                .output()
                .await
                .map_err(|e| format!("Failed to create /usr/local/lib: {}", e))?;

            if !output.status.success() {
                let _ = Command::new("hdiutil")
                    .args(["detach", mount_point.to_str().unwrap(), "-quiet"])
                    .output()
                    .await;
                return Err("Failed to create /usr/local/lib — you may need to grant permission".to_string());
            }
        }

        // Copy all .dylib and .dylib.* files
        let output = Command::new("sh")
            .args([
                "-c",
                &format!(
                    "sudo cp -f {}/*.dylib* /usr/local/lib/ 2>&1",
                    mount_point.to_str().unwrap()
                ),
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to copy libraries: {}", e))?;

        let copy_output = String::from_utf8_lossy(&output.stdout).to_string()
            + &String::from_utf8_lossy(&output.stderr);

        // Step 4: Unmount DMG
        let _ = Command::new("hdiutil")
            .args(["detach", mount_point.to_str().unwrap(), "-quiet"])
            .output()
            .await;

        // Step 5: Clean up downloaded DMG
        let _ = std::fs::remove_file(&dmg_path);

        if output.status.success() {
            Ok("Oracle Instant Client installed to /usr/local/lib/".to_string())
        } else {
            Err(format!(
                "Failed to copy libraries to /usr/local/lib/:\n{}",
                copy_output.trim()
            ))
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

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

    #[test]
    fn test_parse_mssql_spid_text_accepts_numeric_values() {
        assert_eq!(parse_mssql_spid_text(Some("52")), Some(52));
        assert_eq!(parse_mssql_spid_text(Some("  32767  ")), Some(32767));
    }

    #[test]
    fn test_parse_mssql_spid_text_rejects_non_numeric_values() {
        assert_eq!(parse_mssql_spid_text(Some("SELECT @@SPID")), None);
        assert_eq!(parse_mssql_spid_text(Some("abc")), None);
        assert_eq!(parse_mssql_spid_text(None), None);
    }
}
