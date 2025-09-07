use tauri::{State, Emitter};
use std::sync::Arc;

use crate::core::ConnectionManager;
use crate::types::*;
use crate::error::Result;

#[tauri::command]
pub async fn connect(
    profile: ConnectionProfile,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionInfo, String> {
    let conn_id = manager.get_or_create_connection(&profile).await
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
    manager.disconnect(&conn_id).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionTestResult, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.test_connection().await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn execute_query(
    conn_id: String,
    sql: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<QueryHandle, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.open_query(&sql).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_results(
    conn_id: String,
    query_handle: QueryHandle,
    max_rows: usize,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<PageChunk, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.fetch_page(&query_handle, max_rows).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_databases(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Database>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_databases().await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_schemas(
    conn_id: String,
    database: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Schema>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_schemas(&database).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tables(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Table>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_tables(&schema).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_views(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<View>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_views(&schema).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_functions(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Function>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_functions(&schema).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_indexes(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Index>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_indexes(&table).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_constraints(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Constraint>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_constraints(&table).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_columns(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<ColumnMeta>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_table_columns(&schema, &table).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_triggers(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Trigger>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_triggers(&schema, &table).await
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_object_definition(&database, &schema, &object_name, &object_type).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_data(
    conn_id: String,
    schema: String,
    table: String,
    limit: usize,
    offset: usize,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TableDataResult, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_table_data(&schema, &table, limit, offset).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_data_filtered(
    conn_id: String,
    schema: String,
    table: String,
    limit: usize,
    offset: usize,
    filters: Option<FilterConfig>,
    sorts: Option<Vec<SortConfig>>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TableDataResult, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_table_data_filtered(&schema, &table, limit, offset, filters, sorts).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_count(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<i64, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    conn.adapter.get_table_count(&schema, &table).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection_health(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionHealth, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    
    // Test the connection
    let test_result = conn.adapter.test_connection().await
        .map_err(|e| e.to_string())?;
    
    Ok(ConnectionHealth {
        connection_id: conn_id,
        status: if test_result.success { "ready".to_string() } else { "error".to_string() },
        healthy: test_result.success,
        rtt_ms: None,
        error: if !test_result.success { Some(test_result.message) } else { None },
    })
}

#[tauri::command]
pub async fn ping(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<u64, String> {
    use std::time::Instant;
    
    let conn = manager.get_connection(&conn_id)
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

#[tauri::command]
pub async fn stream_query(
    conn_id: String,
    sql: String,
    page_size: Option<usize>,
    window: tauri::Window,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<String, String> {
    use uuid::Uuid;
    use tokio::time::Instant;
    
    let stream_id = Uuid::new_v4().to_string();
    let page_size = page_size.unwrap_or(1000);
    
    // Clone for async task
    let manager = manager.inner().clone();
    let stream_id_clone = stream_id.clone();
    
    // Spawn async streaming task
    tokio::spawn(async move {
        let start_time = Instant::now();
        let mut total_rows = 0usize;
        
        // Get connection
        let conn = match manager.get_connection(&conn_id) {
            Some(conn) => conn,
            None => {
                let _ = window.emit(&format!("query-stream-{}", stream_id_clone), StreamEvent::Error {
                    message: "Connection not found".to_string(),
                    code: Some("CONNECTION_NOT_FOUND".to_string()),
                });
                return;
            }
        };
        
        // Open query
        let handle = match conn.adapter.open_query(&sql).await {
            Ok(handle) => {
                // Emit started event
                let _ = window.emit(&format!("query-stream-{}", stream_id_clone), StreamEvent::Started {
                    columns: handle.columns.clone(),
                    estimated_rows: handle.estimated_rows,
                });
                handle
            },
            Err(e) => {
                let _ = window.emit(&format!("query-stream-{}", stream_id_clone), StreamEvent::Error {
                    message: e.to_string(),
                    code: None,
                });
                return;
            }
        };
        
        // Stream pages
        loop {
            match conn.adapter.fetch_page(&handle, page_size).await {
                Ok(chunk) => {
                    let rows_in_chunk = chunk.rows.len();
                    
                    // Emit data event
                    let _ = window.emit(&format!("query-stream-{}", stream_id_clone), StreamEvent::Data {
                        rows: chunk.rows,
                        row_offset: total_rows,
                    });
                    
                    total_rows += rows_in_chunk;
                    
                    // Emit progress if we have an estimate
                    if let Some(estimated) = handle.estimated_rows {
                        let percentage = (total_rows as f32 / estimated as f32 * 100.0).min(100.0);
                        let _ = window.emit(&format!("query-stream-{}", stream_id_clone), StreamEvent::Progress {
                            rows_fetched: total_rows,
                            percentage: Some(percentage),
                        });
                    }
                    
                    // Check if done
                    if !chunk.has_more || rows_in_chunk == 0 {
                        break;
                    }
                },
                Err(e) => {
                    let _ = window.emit(&format!("query-stream-{}", stream_id_clone), StreamEvent::Error {
                        message: e.to_string(),
                        code: None,
                    });
                    let _ = conn.adapter.close_query(&handle).await;
                    return;
                }
            }
        }
        
        // Close query
        let _ = conn.adapter.close_query(&handle).await;
        
        // Emit completed event
        let _ = window.emit(&format!("query-stream-{}", stream_id_clone), StreamEvent::Completed {
            total_rows,
            execution_time_ms: start_time.elapsed().as_millis() as u64,
        });
    });
    
    Ok(stream_id)
}

// Storage commands
#[tauri::command]
pub async fn store_connection(
    connection: ConnectionProfile,
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
) -> std::result::Result<String, String> {
    storage.store_connection(connection).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_connect_by_id(
    connection_id: String,
    workspace_id: Option<String>,
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionInfo, String> {
    // Get stored connection
    let stored = storage.get_connection(&connection_id).await
        .map_err(|e| e.to_string())?;
    
    // Mark as used
    let _ = storage.mark_as_used(&connection_id).await;
    
    // Connect using the stored profile
    let conn_id = manager.get_or_create_connection(&stored.profile).await
        .map_err(|e| e.to_string())?;
    
    Ok(ConnectionInfo {
        id: conn_id,
        db_type: stored.profile.db_type,
        database: stored.profile.database,
        version: None,
    })
}

#[tauri::command]
pub async fn list_connections(
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
) -> std::result::Result<Vec<crate::storage::StoredConnection>, String> {
    storage.list_connections().await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(
    connection_id: String,
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
) -> std::result::Result<(), String> {
    storage.delete_connection(&connection_id).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_connection(
    connection_id: String,
    profile: ConnectionProfile,
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
) -> std::result::Result<(), String> {
    storage.update_connection(&connection_id, profile).await
        .map_err(|e| e.to_string())
}