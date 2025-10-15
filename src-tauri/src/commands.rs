use std::sync::Arc;
use std::fs; // needed for reset_vault_vault
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

use crate::core::ConnectionManager;
use crate::types::*;
use serde::Serialize;

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
    manager
        .disconnect_all()
        .await
        .map_err(|e| e.to_string())
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

        let handle = conn
            .adapter
            .open_query(&query_sql)
            .await
            .map_err(|e| e.to_string())?;
        let chunk = conn
            .adapter
            .fetch_page(&handle, 1)
            .await
            .map_err(|e| e.to_string())?;
        let _ = conn.adapter.close_query(&handle).await;

        if chunk.rows.is_empty() {
            return Err(format!(
                "Type '{}' not found in schema '{}'",
                type_name, schema
            ));
        }

        let row = &chunk.rows[0];
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
    channel: &tauri::ipc::Channel<StreamMessage>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    use futures::StreamExt;
    
    let query_start = std::time::Instant::now();
    
    // Try to get FastPostgresQueryExecutor
    let executor = conn.adapter.as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
        .and_then(|adapter| adapter.get_query_executor())
        .ok_or_else(|| "Fast query executor not available".to_string())?;
    
    // Prepare statement and get columns
    let (stmt, columns) = executor.prepare_streaming_query(&sql).await
        .map_err(|e| e.to_string())?;
    
    // Send started message immediately
    let _ = channel.send(StreamMessage::Started {
        columns: columns.clone(),
        estimated_rows: None, // Unknown until we start fetching
    });
    
    // Get pool for raw streaming
    let pool = executor.get_pool();
    
    // Execute query with TRUE streaming - rows arrive as PostgreSQL sends them
    let conn = pool.get().await
        .map_err(|e| format!("Failed to get connection from pool: {}", e))?;
    let row_stream = conn.query_raw(stmt.as_ref(), std::iter::empty::<i32>())
        .await
        .map_err(|e| e.to_string())?;
    
    let mut row_stream = Box::pin(row_stream);
    
    tracing::info!("TRUE STREAMING: Query executing, rows will arrive progressively...");
    
    let mut total_rows = 0;
    let mut chunk_buffer = Vec::new();
    const CHUNK_SIZE: usize = 50; // Send rows in batches of 50 for efficiency
    let mut first_row_elapsed_ms: Option<u64> = None;
    
    // Stream rows as they arrive from PostgreSQL
    while let Some(row_result) = row_stream.next().await {
        match row_result {
            Ok(row) => {
                // Mark when first row arrives
                if first_row_elapsed_ms.is_none() {
                    let elapsed = query_start.elapsed().as_millis() as u64;
                    first_row_elapsed_ms = Some(elapsed);
                    tracing::info!("  First row arrived in {}ms", elapsed);
                }
                
                // Convert row to JSON
                let json_row = crate::adapters::postgres::fast_converter::FastPostgresConverter::convert_row(&row)
                    .map_err(|e| e.to_string())?;
                
                chunk_buffer.push(json_row);
                total_rows += 1;
                
                // Send chunk when buffer is full
                if chunk_buffer.len() >= CHUNK_SIZE {
                    let _ = channel.send(StreamMessage::Batch {
                        rows: chunk_buffer.clone(),
                        row_offset: total_rows - chunk_buffer.len(),
                        has_more: true,
                    });
                    chunk_buffer.clear();
                }
            }
            Err(e) => {
                let _ = channel.send(StreamMessage::Error {
                    code: "FETCH_ERROR".to_string(),
                    message: e.to_string(),
                });
                return Err(e.to_string());
            }
        }
    }
    
    // Send any remaining rows
    if !chunk_buffer.is_empty() {
        let offset = total_rows - chunk_buffer.len();
        let _ = channel.send(StreamMessage::Batch {
            rows: chunk_buffer,
            row_offset: offset,
            has_more: false,
        });
    }
    
    let total_time = query_start.elapsed().as_millis() as u64;
    let first_row_ms = first_row_elapsed_ms.unwrap_or(0);
    
    tracing::info!("==========================================");
    tracing::info!("TRUE STREAMING COMPLETE: {} rows", total_rows);
    tracing::info!("  First row: {}ms", first_row_ms);
    tracing::info!("  Total time: {}ms", total_time);
    tracing::info!("  Rows/sec: {:.0}", (total_rows as f64 / total_time as f64) * 1000.0);
    tracing::info!("==========================================");
    
    // Send success
    let _ = channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: total_time,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_time),
        fetch_count: Some(((total_rows + CHUNK_SIZE - 1) / CHUNK_SIZE) as u64),
    });
    
    Ok(())
}

/// Stream query results via cursor-based streaming (exponential progressive loading)
/// Strategy: Single fetch for small datasets (<10K rows), cursor streaming for large datasets
#[tauri::command]
pub async fn stream_query(
    conn_id: String,
    sql: String,
    batch_size: Option<usize>,
    channel: tauri::ipc::Channel<StreamMessage>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let query_start = std::time::Instant::now();
    
    // Get connection
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    // SMART PATH SELECTION: Detect LIMIT clause for small datasets
    let limit_threshold = 10_000;
    let detected_limit = extract_limit_from_sql(&sql);
    
    // Use fast single-fetch path for small datasets (like TablePlus does)
    if let Some(limit) = detected_limit {
        if limit <= limit_threshold {
            tracing::info!("==========================================");
            tracing::info!("FAST PATH (single fetch): sql={}", sql);
            tracing::info!("Detected LIMIT {}, using execute_single_fetch", limit);
            tracing::info!("==========================================");
            
            return execute_single_fetch_stream(&sql, &channel, &conn).await;
        }
    }
    
    // Use cursor streaming for large datasets
    let max_batch_size = batch_size.unwrap_or(1024);

    tracing::info!("==========================================");
    tracing::info!("CURSOR STREAM (progressive): sql={}", sql);
    tracing::info!("Strategy: 16→32→64→128→256→512→{}(max)", max_batch_size);
    tracing::info!("==========================================");

    // Open cursor (BEGIN + DECLARE CURSOR)
    let cursor_start = std::time::Instant::now();
    let handle = match conn.adapter.open_query(&sql).await {
        Ok(h) => h,
        Err(e) => {
            let _ = channel.send(StreamMessage::Error {
                code: "QUERY_ERROR".to_string(),
                message: e.to_string(),
            });
            return Err(e.to_string());
        }
    };
    let cursor_time_ms = cursor_start.elapsed().as_millis() as u64;
    tracing::info!("Cursor opened in {}ms", cursor_time_ms);

    // Send started message with column metadata
    let _ = channel.send(StreamMessage::Started {
        columns: handle.columns.clone(),
        estimated_rows: handle.estimated_rows,
    });

    let mut total_rows = 0;
    let mut fetch_count = 0;
    let mut execution_time_ms = None;
    let mut current_batch_size = 16; // Start with 16 rows

    // Exponential fetching loop: 16, 32, 64, 128, 256, 512, 1024, 1024, ...
    loop {
        fetch_count += 1;
        let fetch_start = std::time::Instant::now();

        match conn.adapter.fetch_page(&handle, current_batch_size).await {
            Ok(chunk) => {
                let row_count = chunk.rows.len();
                let fetch_ms = fetch_start.elapsed().as_millis() as u64;

                // Track execution time from first fetch only
                if fetch_count == 1 {
                    execution_time_ms = chunk.execution_time_ms;
                }

                // Check if we're done
                let is_complete = !chunk.has_more || row_count == 0;

                // Send batch with has_more flag
                let _ = channel.send(StreamMessage::Batch {
                    rows: chunk.rows,
                    row_offset: total_rows,
                    has_more: !is_complete,
                });

                total_rows += row_count;

                tracing::info!(
                    "Batch #{}: fetched {} rows in {}ms (batch_size={}, total={}, has_more={})",
                    fetch_count,
                    row_count,
                    fetch_ms,
                    current_batch_size,
                    total_rows,
                    !is_complete
                );

                // Break if complete
                if is_complete {
                    break;
                }

                // Double the batch size for next fetch, cap at max_batch_size
                current_batch_size = (current_batch_size * 2).min(max_batch_size);
            }
            Err(e) => {
                let _ = channel.send(StreamMessage::Error {
                    code: "FETCH_ERROR".to_string(),
                    message: e.to_string(),
                });
                let _ = conn.adapter.close_query(&handle).await;
                return Err(e.to_string());
            }
        }
    }

    // Close cursor
    let _ = conn.adapter.close_query(&handle).await;

    let total_time_ms = query_start.elapsed().as_millis() as u64;

    tracing::info!("==========================================");
    tracing::info!("EXPONENTIAL STREAM COMPLETE: {} rows in {} fetches", total_rows, fetch_count);
    tracing::info!("  Cursor setup: {}ms", cursor_time_ms);
    tracing::info!("  Query execution: {:?}ms", execution_time_ms);
    tracing::info!("  Total streaming: {}ms", total_time_ms);
    tracing::info!("  Avg per fetch: {}ms", if fetch_count > 0 { total_time_ms / fetch_count as u64 } else { 0 });
    tracing::info!("==========================================");

    // Send success message with detailed timing metrics
    let _ = channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: execution_time_ms.unwrap_or(total_time_ms),
        cursor_setup_ms: Some(cursor_time_ms),
        total_streaming_ms: Some(total_time_ms),
        fetch_count: Some(fetch_count as u64),
    });

    Ok(())
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
        tracing::warn!(
            "Failed to delete vault password from keychain: {}",
            err
        );
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
    let conn = manager
        .get_connection(&connection_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    // Try to get PostgresAdapter
    if let Some(postgres_adapter) = conn.adapter.as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
    {
        postgres_adapter.prewarm_tables(&schema, tables)
            .await
            .map_err(|e| e.to_string())?;
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
    let conn = manager
        .get_connection(&connection_id)
        .ok_or_else(|| {
            tracing::debug!("Pre-warm failed: connection {} not found", connection_id);
            "Connection not found".to_string()
        })?;
    
    // Try to get FastPostgresQueryExecutor (PostgreSQL only)
    let executor = conn.adapter.as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
        .and_then(|adapter| adapter.get_query_executor())
        .ok_or_else(|| {
            tracing::debug!("Pre-warm skipped: fast query executor not available");
            "Fast query executor not available".to_string()
        })?;
    
    // Prepare statement with timeout (10s max)
    let prepare_result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        executor.prepare_streaming_query(&sql)
    ).await;
    
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
