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
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found after reconnect".to_string())?;

    let sql_adapter = conn
        .adapter
        .as_sql()
        .ok_or_else(|| "switch_database is only supported for SQL databases".to_string())?;

    let result = sql_adapter
        .execute_query("SELECT current_database()")
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
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    // Safe mode guard
    let op_kind = crate::core::safe_mode::classify_sql(&sql);
    crate::core::safe_mode::check_safe_mode(conn.profile.safe_mode, op_kind, &format!("{:?}", op_kind))?;

    // Default timeout: 5 minutes (300 seconds)
    // Can be overridden per-query via timeout_secs parameter
    let timeout_duration = std::time::Duration::from_secs(timeout_secs.unwrap_or(300));

    let sql_adapter = conn
        .adapter
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

// ============================================================================
// Streaming Query Execution
// ============================================================================

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
            execute_mysql_stream(sql, metadata_channel, data_channel, conn).await
        }
        DbType::SQLite => execute_generic_stream(sql, metadata_channel, data_channel, conn).await,
        DbType::SQLServer => execute_mssql_stream(sql, metadata_channel, data_channel, conn).await,
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

    let sql_adapter = conn
        .adapter
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

    send_query_results(&result, start_time, query_elapsed, metadata_channel, data_channel)
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

/// MySQL/MariaDB streaming implementation with cancellation support.
/// Uses the same connection for both CONNECTION_ID() retrieval and query execution,
/// ensuring the correct query gets killed on cancellation.
async fn execute_mysql_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    use mysql_async::prelude::*;

    let mysql_adapter = conn
        .adapter
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

    // Execute the query on the SAME connection we got the ID from
    let query_future = async {
        let mut result = query_conn
            .query_iter(&sql_owned)
            .await
            .map_err(|e| format!("Query failed: {}", e))?;

        let columns_ref = result.columns_ref();
        let columns: Vec<crate::core::capabilities::CapabilityColumnMeta> = columns_ref
            .iter()
            .map(|col| crate::core::capabilities::CapabilityColumnMeta {
                name: col.name_str().to_string(),
                data_type: crate::adapters::mysql::types::MySqlTypeConverter::column_type_to_string(
                    col.column_type(),
                ),
            })
            .collect();

        let rows: Vec<mysql_async::Row> = result
            .collect()
            .await
            .map_err(|e| format!("Failed to collect rows: {}", e))?;

        let json_rows =
            crate::adapters::mysql::simple_converter::SimpleConverter::rows_to_json(&rows);
        Ok::<_, String>(crate::core::capabilities::CapabilityQueryResult {
            columns,
            rows: json_rows,
        })
    };

    let cap_result = tokio::select! {
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

    let result = capability_result_to_query_result(cap_result);
    let query_elapsed = start_time.elapsed().as_millis();
    tracing::info!(
        "  ⏱ MySQL query execution: {}ms, {} rows",
        query_elapsed,
        result.rows.len()
    );

    send_query_results(&result, start_time, query_elapsed, metadata_channel, data_channel)
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
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    use futures::FutureExt;
    use std::panic::AssertUnwindSafe;

    let mssql_adapter = conn
        .adapter
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
            Some(r) => r.get::<i16, _>(0).unwrap_or(0),
            None => 0,
        }
    };
    tracing::info!("  🔍 MSSQL query running on SPID: {}", spid);

    let start_time = std::time::Instant::now();
    let sql_owned = sql.to_string();

    // Execute the query on the SAME connection we got the SPID from
    let query_future = async {
        let query_result = AssertUnwindSafe(async {
            let mut result = query_conn
                .simple_query(sql_owned.as_str())
                .await
                .map_err(|e| format!("Query failed: {}", e))?;

            let columns_opt = result
                .columns()
                .await
                .map_err(|e| format!("Failed to get columns: {}", e))?;

            let columns: Vec<crate::core::capabilities::CapabilityColumnMeta> = columns_opt
                .map(|cols| {
                    cols.iter()
                        .map(|col| crate::core::capabilities::CapabilityColumnMeta {
                            name: col.name().to_string(),
                            data_type:
                                crate::adapters::mssql::types::MssqlTypeConverter::column_type_to_string(
                                    &col.column_type(),
                                ),
                        })
                        .collect()
                })
                .unwrap_or_default();

            let rows: Vec<tiberius::Row> = result
                .into_first_result()
                .await
                .map_err(|e| format!("Failed to collect rows: {}", e))?;

            let json_rows: Vec<Vec<serde_json::Value>> = rows
                .iter()
                .map(crate::adapters::mssql::simple_converter::SimpleConverter::row_to_json)
                .collect();

            Ok::<_, String>(crate::core::capabilities::CapabilityQueryResult {
                columns,
                rows: json_rows,
            })
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

    let cap_result = tokio::select! {
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

    let result = capability_result_to_query_result(cap_result);
    let query_elapsed = start_time.elapsed().as_millis();
    tracing::info!(
        "  ⏱ MSSQL query execution: {}ms, {} rows",
        query_elapsed,
        result.rows.len()
    );

    send_query_results(&result, start_time, query_elapsed, metadata_channel, data_channel)
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

    let sql_adapter = conn
        .adapter
        .as_sql()
        .ok_or_else(|| "execute_sqlite_query only supports SQL databases".to_string())?;

    let cap_result = sql_adapter
        .execute_query(sql)
        .await
        .map_err(|e| e.to_string())?;
    let result = capability_result_to_query_result(cap_result);

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

    let msgpack_bytes =
        rmp_serde::to_vec(&rows_data).map_err(|e| format!("MessagePack encoding failed: {}", e))?;

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
    let postgres_adapter = conn
        .adapter
        .as_postgres()
        .ok_or_else(|| "PostgreSQL adapter not available".to_string())?;
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

        // Reset any pending failed transaction state before executing
        // This handles cases where a previous operation failed and left the connection dirty
        if let Err(e) = pool_conn.batch_execute("ROLLBACK").await {
            tracing::debug!(
                "  ℹ️ ROLLBACK before batch (expected if no active transaction): {}",
                e
            );
        }

        // Use simple_query for multi-statement support (no prepared statements)
        let simple_start = std::time::Instant::now();
        let batch_result = pool_conn.batch_execute(sql).await;

        if let Err(e) = &batch_result {
            tracing::error!("❌ batch_execute failed: {:?}", e);
            // ROLLBACK to clean up the failed transaction and reset connection state
            if let Err(rollback_err) = pool_conn.batch_execute("ROLLBACK").await {
                tracing::debug!(
                    "  ℹ️ ROLLBACK after failure (may already be rolled back): {}",
                    rollback_err
                );
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
            tracing::debug!(
                "  ℹ️ ROLLBACK before execute (expected if no active transaction): {}",
                e
            );
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

    // Safe mode guard
    let op_kind = crate::core::safe_mode::classify_sql(&sql);
    crate::core::safe_mode::check_safe_mode(conn.profile.safe_mode, op_kind, &format!("{:?}", op_kind))?;

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
        crate::types::DbType::SQLite => tokio::time::timeout(
            timeout_duration,
            execute_sqlite_query(&sql, &metadata_channel, &data_channel, &conn),
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
                execute_single_fetch_stream(&sql, &metadata_channel, &data_channel, &conn),
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
}
