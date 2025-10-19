use std::fs; // needed for reset_vault_vault
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

use crate::core::ConnectionManager;
use crate::types::*;
use serde::Serialize;
use serde_json::Value as JsonValue;
use tokio_postgres::Row;

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
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .test_connection()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_databases(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Database>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_databases()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_schemas(
    conn_id: String,
    database: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Schema>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_schemas(&database)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tables(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Table>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_tables(&schema)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_views(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<View>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_views(&schema)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_functions(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Function>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_functions(&schema)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_indexes(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Index>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_indexes(&table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_index_usage_stats(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<IndexUsageStats>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_index_usage_stats(&table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_supported_index_types(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<String>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_supported_index_types()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_supported_column_types(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<String>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_supported_column_types()
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct TypeInfo {
    pub type_name: String,
    pub type_category: String,
    pub enum_values: Option<Vec<String>>,
    pub base_type: Option<String>,
}

#[tauri::command]
pub async fn get_type_info(
    conn_id: String,
    type_name: String,
    schema: Option<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TypeInfo, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // For PostgreSQL, query type information
    if matches!(conn.profile.db_type, DbType::PostgreSQL) {
        let schema = schema.unwrap_or_else(|| "public".to_string());

        let query_sql = format!(
            "SELECT \
                t.typname as type_name, \
                t.typtype as type_category, \
                CASE WHEN t.typtype = 'e' THEN ( \
                    SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) \
                    FROM pg_enum e WHERE e.enumtypid = t.oid \
                ) ELSE NULL END as enum_values, \
                CASE WHEN t.typtype = 'd' THEN \
                    pg_catalog.format_type(t.typbasetype, t.typtypmod) \
                ELSE NULL END as base_type \
            FROM pg_type t \
            JOIN pg_namespace n ON t.typnamespace = n.oid \
            WHERE t.typname = '{}' AND n.nspname = '{}'",
            type_name, schema
        );

        // Use direct query instead of cursor
        let result = conn
            .adapter
            .query(&query_sql)
            .await
            .map_err(|e| e.to_string())?;

        if result.rows.is_empty() {
            return Err(format!(
                "Type '{}' not found in schema '{}'",
                type_name, schema
            ));
        }

        let row = &result.rows[0];
        let type_category = if let Some(cat_value) = &row.get(1).and_then(|v| {
            let s = v.to_string();
            if !s.is_empty() {
                s.chars().next()
            } else {
                None
            }
        }) {
            match cat_value {
                'e' => "enum",
                'd' => "domain",
                'c' => "composite",
                'b' => "base",
                'r' => "range",
                'm' => "multirange",
                _ => "unknown",
            }
        } else {
            "unknown"
        };

        let enum_values = row.get(2).and_then(|v| {
            let s = v.to_string();
            if !s.is_empty() {
                Some(s.split(',').map(|s| s.to_string()).collect())
            } else {
                None
            }
        });

        let base_type = row.get(3).map(|v| v.to_string());

        Ok(TypeInfo {
            type_name: type_name.clone(),
            type_category: type_category.to_string(),
            enum_values,
            base_type,
        })
    } else {
        Err("get_type_info is only supported for PostgreSQL".to_string())
    }
}

#[tauri::command]
pub async fn get_constraints(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Constraint>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_constraints(&table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_columns(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<ColumnMeta>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_table_columns(&schema, &table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_triggers(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Trigger>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_triggers(&schema, &table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_object_definition(
    conn_id: String,
    database: String,
    schema: String,
    object_name: String,
    object_type: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<String, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_object_definition(&database, &schema, &object_name, &object_type)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_count(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<i64, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_table_count(&schema, &table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection_health(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionHealth, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

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
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    let start = Instant::now();
    let is_connected = conn.adapter.is_connected().await;
    let elapsed = start.elapsed().as_millis() as u64;

    if is_connected {
        Ok(elapsed)
    } else {
        Err("Connection is not active".to_string())
    }
}

/// Extract LIMIT value from SQL query (simple regex-based parser)
fn extract_limit_from_sql(sql: &str) -> Option<usize> {
    use regex::Regex;

    // Match LIMIT clause at end of query (case-insensitive)
    // Handles: LIMIT 1000, LIMIT 1000;, LIMIT 1000 OFFSET 50
    let re = Regex::new(r"(?i)\bLIMIT\s+(\d+)").ok()?;
    let caps = re.captures(sql)?;
    caps.get(1)?.as_str().parse::<usize>().ok()
}

/// Execute query with TRUE streaming (rows arrive as they're fetched from PostgreSQL)
async fn execute_single_fetch_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    use futures::StreamExt;

    // Try to get FastPostgresQueryExecutor
    let executor = conn
        .adapter
        .as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
        .and_then(|adapter| adapter.get_query_executor())
        .ok_or_else(|| "Fast query executor not available".to_string())?;

    // Get pool for raw streaming
    let pool = executor.get_pool();

    // Get connection from pool FIRST
    let conn_start = std::time::Instant::now();
    let pool_conn = pool
        .get()
        .await
        .map_err(|e| format!("Failed to get connection from pool: {}", e))?;
    let conn_elapsed = conn_start.elapsed().as_millis();
    tracing::info!("  ⏱ Got connection from pool: {}ms", conn_elapsed);

    // Get backend PID for cancellation (query it since we're using pooled connections)
    let pid_row = pool_conn
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .map_err(|e| format!("Failed to get backend PID: {}", e))?;
    let backend_pid: i32 = pid_row.get(0);
    tracing::info!(
        "  🔍 Query running on PostgreSQL backend PID: {}",
        backend_pid
    );

    // PREPARE statement - this is where the slowness happens on remote connections!
    let prepare_start = std::time::Instant::now();
    let stmt = pool_conn
        .prepare(&sql)
        .await
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    let prepare_elapsed = prepare_start.elapsed().as_millis();
    tracing::info!("  ⏱ PREPARE statement: {}ms ⚠️", prepare_elapsed);

    // Execute query with prepared statement
    let query_start = std::time::Instant::now();
    let row_stream = pool_conn
        .query_raw(&stmt, std::iter::empty::<i32>())
        .await
        .map_err(|e| e.to_string())?;
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
    let mut json_buffer: Vec<Vec<JsonValue>> = Vec::new(); // Final JSON output buffer
    let mut row_buffer: Vec<Row> = Vec::new(); // Temporary Row buffer for batch conversion
    const MICRO_BATCH_SIZE: usize = 500; // Convert this many rows in parallel (optimal for cache)

    // Incremental batch sizes: start small for instant feedback, then go big
    const FIRST_BATCH_SIZE: usize = 32; // Ultra-fast first render (~4ms IPC)
    const SECOND_BATCH_SIZE: usize = 512; // Quick second batch (~25ms IPC)
    const LARGE_BATCH_SIZE: usize = 4096; // Large bulk transfer (~80-100ms IPC but fewer calls)

    let mut first_row_elapsed_ms: Option<u64> = None;

    // Performance tracking
    let mut conversion_time_ms = 0u64;
    let mut send_time_ms = 0u64;
    let mut send_count = 0usize;

    // Dynamic batch sizing - determines when to send based on rows seen
    let get_send_threshold = |rows_sent: usize| -> usize {
        if rows_sent == 0 {
            FIRST_BATCH_SIZE // First batch: 32 rows for instant feedback
        } else if rows_sent == FIRST_BATCH_SIZE {
            SECOND_BATCH_SIZE // Second batch: 512 rows
        } else {
            LARGE_BATCH_SIZE // Rest: 2048 rows for efficiency
        }
    };

    let mut rows_sent = 0usize;

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
                tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);

                // Cancel the running query in PostgreSQL
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

                let _ = metadata_channel.send(StreamMessage::Interrupted {
                    resumable: false,
                    message: "Query cancelled by user".to_string(),
                });
                return Err("Query cancelled by user".to_string());
            }
        }

        match row_result {
            Ok(row) => {
                // Mark when first row arrives
                if first_row_elapsed_ms.is_none() {
                    let elapsed = query_start.elapsed().as_millis() as u64;
                    first_row_elapsed_ms = Some(elapsed);
                    tracing::info!("  ⏱ First row arrived: {}ms", elapsed);
                }

                row_buffer.push(row);
                total_rows += 1;

                // Micro-batch: Convert rows in parallel when buffer is full
                if row_buffer.len() >= MICRO_BATCH_SIZE {
                    let convert_start = std::time::Instant::now();
                    let converted = crate::adapters::postgres::fast_converter::FastPostgresConverter::rows_to_json(&row_buffer)
                        .map_err(|e| e.to_string())?;
                    conversion_time_ms += convert_start.elapsed().as_millis() as u64;
                    json_buffer.extend(converted);
                    row_buffer.clear();
                }

                // Send chunk to frontend when output buffer reaches dynamic threshold
                let current_threshold = get_send_threshold(rows_sent);
                if json_buffer.len() >= current_threshold {
                    let batch_size = json_buffer.len();

                    // Serialize to MessagePack RAW bytes (no base64!)
                    let serialize_start = std::time::Instant::now();
                    let rows_msgpack =
                        rmp_serde::to_vec(&json_buffer).unwrap_or_else(|_| Vec::new());
                    conversion_time_ms += serialize_start.elapsed().as_millis() as u64;
                    json_buffer.clear();

                    // Send raw binary via Response (ZERO serialization overhead!)
                    let send_start = std::time::Instant::now();
                    let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
                    send_time_ms += send_start.elapsed().as_millis() as u64;
                    send_count += 1;
                    rows_sent += batch_size;

                    // Check if channel closed (user cancelled) - stop streaming early
                    if send_result.is_err() {
                        tracing::info!(
                            "  ⚠️  Channel closed (user cancelled), stopping stream early"
                        );
                        tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);

                        // Cancel the running query in PostgreSQL
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

    // Convert any remaining rows in row_buffer
    if !row_buffer.is_empty() {
        let convert_start = std::time::Instant::now();
        let converted =
            crate::adapters::postgres::fast_converter::FastPostgresConverter::rows_to_json(
                &row_buffer,
            )
            .map_err(|e| e.to_string())?;
        conversion_time_ms += convert_start.elapsed().as_millis() as u64;
        json_buffer.extend(converted);
    }

    // Send any remaining JSON rows
    if !json_buffer.is_empty() {
        let batch_size = json_buffer.len();
        let offset = total_rows - batch_size;

        // Serialize to MessagePack RAW bytes
        let serialize_start = std::time::Instant::now();
        let rows_msgpack = rmp_serde::to_vec(&json_buffer).unwrap_or_else(|_| Vec::new());
        conversion_time_ms += serialize_start.elapsed().as_millis() as u64;

        // Send raw binary via Response (ZERO serialization overhead!)
        let send_start = std::time::Instant::now();
        let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
        send_time_ms += send_start.elapsed().as_millis() as u64;
        send_count += 1;

        // Check if channel closed (user cancelled) - stop streaming early
        if send_result.is_err() {
            tracing::info!("  ⚠️  Channel closed (user cancelled), stopping stream early");
            tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);

            // Cancel the running query in PostgreSQL
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

            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Query cancelled by user".to_string(),
            });
            return Err("Query cancelled by user".to_string());
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
        "  └─ Batch sizes: 32→512→4096 (incremental), micro: {} | Format: msgpack",
        MICRO_BATCH_SIZE
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
        tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);

        // Cancel the running query in PostgreSQL (might already be done, but be safe)
        let cancel_pool = pool.clone();
        tokio::spawn(async move {
            if let Ok(cancel_conn) = cancel_pool.get().await {
                let cancel_sql = format!("SELECT pg_cancel_backend({})", backend_pid);
                let _ = cancel_conn.execute(&cancel_sql, &[]).await;
            }
        });

        return Err("Query cancelled by user".to_string());
    }

    Ok(())
}

/// Stream query results with smart limit detection
/// Automatically applies LIMIT if query doesn't have one (unless user disabled it)
#[tauri::command]
pub async fn stream_query(
    conn_id: String,
    sql: String,
    _batch_size: Option<usize>,
    user_limit_preference: Option<usize>,
    metadata_channel: tauri::ipc::Channel<StreamMessage>,
    data_channel: tauri::ipc::Channel<tauri::ipc::Response>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Check if query has LIMIT clause
    let has_limit = extract_limit_from_sql(&sql).is_some();

    // Apply smart limit only if:
    // 1. Query doesn't have LIMIT
    // 2. User has a preference set (Some(limit)) - if None, user chose "No limit"
    let applied_limit = if !has_limit {
        user_limit_preference // Returns Some(limit) or None based on user preference
    } else {
        None
    };

    // Apply limit if needed
    let final_sql = if let Some(limit) = applied_limit {
        format!("{} LIMIT {}", sql.trim().trim_end_matches(';'), limit)
    } else {
        sql.clone()
    };

    // Send metadata about limit application before starting query
    if let Some(limit) = applied_limit {
        let _ = metadata_channel.send(StreamMessage::LimitApplied {
            original_sql: sql.clone(),
            applied_limit: limit,
        });
    }

    tracing::info!("==========================================");
    tracing::info!("FAST PATH (query_raw streaming): sql={}", final_sql);
    if let Some(limit) = applied_limit {
        tracing::info!("Auto-applied LIMIT {}", limit);
    } else if !has_limit {
        tracing::info!("No auto-limit (user preference: no limit)");
    }
    tracing::info!("==========================================");

    execute_single_fetch_stream(&final_sql, &metadata_channel, &data_channel, &conn).await
}

// Index operation commands
#[tauri::command]
pub async fn create_index(
    conn_id: String,
    schema: String,
    table: String,
    index: CreateIndexRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Guard against indefinite hangs: enforce a 30s timeout
    match timeout(
        Duration::from_secs(30),
        conn.adapter.create_index(&schema, &table, &index),
    )
    .await
    {
        Ok(res) => res.map_err(|e| e.to_string()),
        Err(_) => Err("Timed out creating index after 30s".to_string()),
    }
}

#[tauri::command]
pub async fn drop_index(
    conn_id: String,
    schema: String,
    index_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .drop_index(&schema, &index_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_index(
    conn_id: String,
    schema: String,
    old_name: String,
    new_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .rename_index(&schema, &old_name, &new_name)
        .await
        .map_err(|e| e.to_string())
}

// Table structure operation commands
#[tauri::command]
pub async fn alter_table_add_column(
    conn_id: String,
    schema: String,
    table: String,
    column: AddColumnRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_add_column(&schema, &table, &column)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_drop_column(
    conn_id: String,
    schema: String,
    table: String,
    column_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_drop_column(&schema, &table, &column_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_modify_column(
    conn_id: String,
    schema: String,
    table: String,
    column: ModifyColumnRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_modify_column(&schema, &table, &column)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_rename_column(
    conn_id: String,
    schema: String,
    table: String,
    old_name: String,
    new_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_rename_column(&schema, &table, &old_name, &new_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_add_foreign_key(
    conn_id: String,
    schema: String,
    table: String,
    fk: AddForeignKeyRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_add_foreign_key(&schema, &table, &fk)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_drop_foreign_key(
    conn_id: String,
    schema: String,
    table: String,
    constraint_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_drop_foreign_key(&schema, &table, &constraint_name)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// vault maintenance helpers
// ============================================================================

#[tauri::command]
pub async fn reset_vault_vault(app_handle: AppHandle) -> std::result::Result<(), String> {
    let data_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let vault_path = data_dir.join("vault.hold");
    let salt_path = data_dir.join("salt.txt");

    if vault_path.exists() {
        if let Err(err) = fs::remove_file(&vault_path) {
            tracing::warn!(
                "Failed to remove vault vault file {}: {}",
                vault_path.display(),
                err
            );
        } else {
            tracing::info!("Removed vault vault file at {}", vault_path.display());
        }
    }

    if salt_path.exists() {
        if let Err(err) = fs::remove_file(&salt_path) {
            tracing::warn!(
                "Failed to remove vault salt file {}: {}",
                salt_path.display(),
                err
            );
        } else {
            tracing::info!("Removed vault salt file at {}", salt_path.display());
        }
    }

    if let Err(err) = crate::keychain::delete_vault_password() {
        tracing::warn!("Failed to delete vault password from keychain: {}", err);
    }

    Ok(())
}

// Trigger operation commands
#[tauri::command]
pub async fn create_trigger(
    conn_id: String,
    schema: String,
    table: String,
    trigger: CreateTriggerRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .create_trigger(&schema, &table, &trigger)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn drop_trigger(
    conn_id: String,
    schema: String,
    table: String,
    trigger_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .drop_trigger(&schema, &table, &trigger_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn enable_disable_trigger(
    conn_id: String,
    schema: String,
    table: String,
    trigger_name: String,
    enabled: bool,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .enable_disable_trigger(&schema, &table, &trigger_name, enabled)
        .await
        .map_err(|e| e.to_string())
}

/// Pre-warm schema tables after schema loads (smart table pre-warming)
#[tauri::command]
pub async fn prewarm_schema_tables(
    connection_id: String,
    schema: String,
    tables: Vec<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    tracing::debug!(
        "prewarm_schema_tables called: connection_id={}, schema={}, table_count={}",
        connection_id,
        schema,
        tables.len()
    );

    let conn = manager.get_connection(&connection_id).ok_or_else(|| {
        let err = format!("Connection not found: {}", connection_id);
        tracing::warn!("{}", err);
        err
    })?;

    // Try to get PostgresAdapter
    if let Some(postgres_adapter) = conn
        .adapter
        .as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
    {
        tracing::debug!("Calling prewarm_tables for schema: {}", schema);
        postgres_adapter
            .prewarm_tables(&schema, tables)
            .await
            .map_err(|e| {
                let err_msg = format!("Pre-warming failed: {}", e);
                tracing::warn!("{}", err_msg);
                err_msg
            })?;
    } else {
        tracing::debug!("Not a PostgreSQL connection, skipping pre-warming");
    }

    Ok(())
}

/// Pre-warm statement cache by preparing a query in background
/// This is fire-and-forget, errors are logged but not returned to caller
/// Used to eliminate cold start delays on first query execution
#[tauri::command]
pub async fn prewarm_query(
    connection_id: String,
    sql: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    // Get connection
    let conn = manager.get_connection(&connection_id).ok_or_else(|| {
        tracing::debug!("Pre-warm failed: connection {} not found", connection_id);
        "Connection not found".to_string()
    })?;

    // Try to get FastPostgresQueryExecutor (PostgreSQL only)
    let executor = conn
        .adapter
        .as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
        .and_then(|adapter| adapter.get_query_executor())
        .ok_or_else(|| {
            tracing::debug!("Pre-warm skipped: fast query executor not available");
            "Fast query executor not available".to_string()
        })?;

    // Prepare statement with timeout (10s max)
    let prepare_result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        executor.prepare_streaming_query(&sql),
    )
    .await;

    match prepare_result {
        Ok(Ok(_)) => {
            tracing::info!("✅ Pre-warmed statement: {}", sql);
            Ok(())
        }
        Ok(Err(e)) => {
            tracing::debug!("Pre-warm failed: {}", e);
            Err(e.to_string())
        }
        Err(_) => {
            tracing::warn!("Pre-warm timeout after 10s: {}", sql);
            Err("Statement preparation timeout".to_string())
        }
    }
}
