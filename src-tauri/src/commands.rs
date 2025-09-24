use tauri::{State, Emitter, Window, AppHandle, Manager};
use std::sync::Arc;
use std::path::{Path, PathBuf};
use tokio::process::Command as TokioCommand;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::{timeout, Duration};
use serde::Deserialize;

use crate::core::ConnectionManager;
use crate::types::*;

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
pub async fn get_index_usage_stats(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<IndexUsageStats>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.get_index_usage_stats(&table).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_supported_index_types(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<String>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.get_supported_index_types().await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_supported_column_types(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<String>, String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.get_supported_column_types().await
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
    _workspace_id: Option<String>,
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

// ============================================================================
// Window-Aware Connection Commands
// ============================================================================

#[tauri::command]
pub async fn set_active_connection(
    window: Window,
    connection_id: String,
    state: State<'_, crate::state::AppState>,
    app_handle: AppHandle,
) -> std::result::Result<(), String> {
    let window_label = window.label().to_string();
    
    // Set the active connection for this window
    state.window_states.set_active_connection(window_label.clone(), connection_id.clone())
        .map_err(|e| e.to_string())?;
    
    // Focus the window
    window.set_focus()
        .map_err(|e| format!("Failed to focus window: {}", e))?;
    
    // Emit event for other windows to know about the change
    app_handle.emit("active_connection_changed", serde_json::json!({
        "window": window_label,
        "connection_id": connection_id
    }))
    .map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn get_active_connection(
    window: Window,
    state: State<'_, crate::state::AppState>,
) -> std::result::Result<Option<String>, String> {
    let window_label = window.label();
    Ok(state.window_states.get_active_connection(window_label))
}

#[tauri::command]
pub async fn switch_to_connection_window(
    connection_id: String,
    state: State<'_, crate::state::AppState>,
    app_handle: AppHandle,
) -> std::result::Result<(), String> {
    // Find window with this connection
    if let Some(window_label) = state.window_states.get_window_for_connection(&connection_id) {
        if let Some(window) = app_handle.get_webview_window(&window_label) {
            window.set_focus()
                .map_err(|e| format!("Failed to focus window: {}", e))?;
            return Ok(());
        }
    }
    
    Err(format!("No window found with connection {}", connection_id))
}

#[tauri::command]
pub async fn get_window_states(
    state: State<'_, crate::state::AppState>,
) -> std::result::Result<serde_json::Value, String> {
    let states = state.window_states.get_all_states()
        .map_err(|e| e.to_string())?;
    
    serde_json::to_value(&states)
        .map_err(|e| format!("Failed to serialize window states: {}", e))
}

#[tauri::command]
pub async fn remove_window_connection(
    window: Window,
    state: State<'_, crate::state::AppState>,
) -> std::result::Result<(), String> {
    let window_label = window.label();
    state.window_states.remove_window(window_label)
        .map_err(|e| e.to_string())
}

// Enhanced storage commands with event emission
#[tauri::command]
pub async fn store_connection_with_event(
    connection: ConnectionProfile,
    tags: Option<Vec<String>>,
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
    app_handle: AppHandle,
) -> std::result::Result<String, String> {
    let id = storage.store_connection(connection).await
        .map_err(|e| e.to_string())?;

    // Add tags if provided
    if let Some(tags) = tags {
        storage.update_tags(&id, tags).await
            .map_err(|e| e.to_string())?;
    }

    // Emit event to all windows
    app_handle.emit("connections_changed", ())
        .map_err(|e| format!("Failed to emit event: {}", e))?;

    Ok(id)
}

#[tauri::command]
pub async fn delete_connection_with_event(
    connection_id: String,
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
    state: State<'_, crate::state::AppState>,
    app_handle: AppHandle,
) -> std::result::Result<(), String> {
    // Delete the connection
    storage.delete_connection(&connection_id).await
        .map_err(|e| e.to_string())?;
    
    // Clear from any windows using this connection
    let affected_windows = state.window_states.clear_connection(&connection_id)
        .map_err(|e| e.to_string())?;
    
    // Emit events
    app_handle.emit("connections_changed", ())
        .map_err(|e| format!("Failed to emit event: {}", e))?;
    
    if !affected_windows.is_empty() {
        app_handle.emit("connection_deleted", serde_json::json!({
            "connection_id": connection_id,
            "affected_windows": affected_windows
        }))
        .map_err(|e| format!("Failed to emit event: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn update_connection_with_event(
    connection_id: String,
    profile: ConnectionProfile,
    tags: Option<Vec<String>>,
    storage: State<'_, Arc<crate::storage::SecureStorage>>,
    app_handle: AppHandle,
) -> std::result::Result<(), String> {
    println!("DEBUG: Starting update_connection_with_event for {}", connection_id);

    println!("DEBUG: Updating connection profile...");
    storage.update_connection(&connection_id, profile).await
        .map_err(|e| e.to_string())?;
    println!("DEBUG: Connection profile updated successfully");

    // Update tags if provided
    if let Some(tags) = tags {
        println!("DEBUG: Updating tags: {:?}", tags);
        storage.update_tags(&connection_id, tags).await
            .map_err(|e| e.to_string())?;
        println!("DEBUG: Tags updated successfully");
    }

    // Emit event to all windows
    println!("DEBUG: Emitting connections_changed event");
    app_handle.emit("connections_changed", ())
        .map_err(|e| format!("Failed to emit event: {}", e))?;
    println!("DEBUG: Event emitted successfully");

    println!("DEBUG: update_connection_with_event completed successfully");
    Ok(())
}

// =============================================================================
// AI Sidecars: versions
// =============================================================================

#[derive(serde::Serialize)]
pub struct AISidecarVersion {
    pub tool: String,
    pub version: Option<String>,
    pub error: Option<String>,
    pub source: Option<String>, // "cli" | "manifest"
}

fn resolve_sidecar_path(app: &AppHandle, name: &str) -> Option<PathBuf> {
    // Map sidecar names to custom binary names for process naming
    let binary_name = match name {
        "opencode" => "devdb-opencode",
        "codex" => "devdb-openai-codex",
        _ => name,
    };

    // Try resource directory (packaged)
    if let Ok(p) = app
        .path()
        .resolve(&format!("sidecars/{}/{}", name, binary_name), tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return Some(p);
        }
    }

    // Try alongside executable (dev packaging variants)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(binary_name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    // Try project tree commonly used during dev
    if let Ok(current_dir) = std::env::current_dir() {
        let cand = current_dir
            .join("src-tauri")
            .join("sidecars")
            .join(name)
            .join(binary_name);
        if cand.exists() {
            return Some(cand);
        }
    }

    // Optional PATH fallback for debugging only
    if matches!(std::env::var("DEVDB_AI_USE_PATH_TOOLS").ok().as_deref(), Some("1" | "true" | "yes")) {
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(':') {
                let candidate = Path::new(dir).join(binary_name);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

async fn get_version_from_binary(bin: &Path) -> anyhow::Result<String> {
    let candidates: [&[&str]; 3] = [&["--version"], &["version"], &["-V"]];
    for args in candidates.into_iter() {
        let mut cmd = TokioCommand::new(bin);
        cmd.args(args);
        // Keep env minimal; version shouldn't need HOME but set for consistency
        if let Some(home) = dirs::home_dir() {
            let devdb = home.join(".devdb");
            cmd.env("HOME", &devdb);
            cmd.env("XDG_CONFIG_HOME", &devdb);
        }
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        match cmd.output().await {
            Ok(out) if out.status.success() => {
                let mut s = String::new();
                if !out.stdout.is_empty() {
                    s = String::from_utf8_lossy(&out.stdout).to_string();
                } else if !out.stderr.is_empty() {
                    s = String::from_utf8_lossy(&out.stderr).to_string();
                }
                let line = s.lines().next().unwrap_or("").trim().to_string();
                if !line.is_empty() {
                    return Ok(line);
                }
            }
            _ => {}
        }
    }
    anyhow::bail!("no version output")
}

fn read_manifest_version(app: &AppHandle, tool: &str) -> Option<String> {
    // Check packaged resource manifest
    if let Ok(p) = app
        .path()
        .resolve("sidecars/manifest.json", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            if let Ok(data) = std::fs::read_to_string(&p) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                    return json.get(tool).and_then(|v| v.get("tag")).and_then(|t| t.as_str()).map(|s| s.to_string());
                }
            }
        }
    }

    // Check workspace manifest in dev tree
    if let Ok(current_dir) = std::env::current_dir() {
        let p = current_dir.join("src-tauri").join("sidecars").join("manifest.json");
        if p.exists() {
            if let Ok(data) = std::fs::read_to_string(&p) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                    return json.get(tool).and_then(|v| v.get("tag")).and_then(|t| t.as_str()).map(|s| s.to_string());
                }
            }
        }
    }

    None
}

#[tauri::command]
pub async fn get_ai_sidecar_versions(app: AppHandle) -> std::result::Result<Vec<AISidecarVersion>, String> {
    let mut results: Vec<AISidecarVersion> = Vec::new();

    for tool in ["opencode", "codex"] {
        let mut version: Option<String> = None;
        let mut error: Option<String> = None;
        let mut source: Option<String> = None;

        if let Some(path) = resolve_sidecar_path(&app, tool) {
            match get_version_from_binary(&path).await {
                Ok(v) => { version = Some(v); source = Some("cli".to_string()); },
                Err(e) => {
                    error = Some(format!("{} ({} )", e, path.display()));
                }
            }
        }

        if version.is_none() {
            version = read_manifest_version(&app, tool);
            if version.is_some() { source = Some("manifest".to_string()); }
        }

        let entry = AISidecarVersion { tool: tool.to_string(), version, error, source };
        results.push(entry);
    }

    Ok(results)
}

// =============================================================================
// AI Sidecars: auth helpers
// =============================================================================

#[derive(serde::Serialize)]
pub struct OpencodeLoginStart {
    pub status: String,          // "started" | "url" | "error"
    pub url: Option<String>,
    pub message: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct OpencodeSubmitCode {
    pub code: String,
}

fn devdb_home() -> Option<PathBuf> {
    // 1) Respect DEVDB_HOME override
    if let Ok(p) = std::env::var("DEVDB_HOME") {
        let path = PathBuf::from(p);
        let _ = std::fs::create_dir_all(&path);
        return Some(path);
    }
    // 2) Use project-local .devdb directory
    if let Ok(cwd) = std::env::current_dir() {
        // Look for the project root (where package.json exists)
        let mut current = cwd.clone();
        loop {
            if current.join("package.json").exists() {
                let devdb_path = current.join(".devdb");
                let _ = std::fs::create_dir_all(&devdb_path);
                return Some(devdb_path);
            }
            if !current.pop() {
                break;
            }
        }
        // Fallback to cwd/.devdb if no package.json found
        let p = cwd.join(".devdb");
        let _ = std::fs::create_dir_all(&p);
        return Some(p);
    }
    // 3) Final fallback: ~/.devdb (sandbox root)
    dirs::home_dir().map(|h| {
        let p = h.join(".devdb");
        let _ = std::fs::create_dir_all(&p);
        p
    })
}

#[tauri::command]
pub async fn ai_opencode_is_authenticated(_app: AppHandle) -> std::result::Result<bool, String> {
    let Some(home) = devdb_home() else { return Err("HOME not found".to_string()); };

    // Check the actual auth.json location that opencode uses
    let auth_file = home.join(".local/share/opencode/auth.json");
    if auth_file.exists() {
        // Try to read and verify it contains anthropic auth
        if let Ok(contents) = std::fs::read_to_string(&auth_file) {
            let has_anthropic = contents.contains("anthropic") || contents.contains("Anthropic");
            return Ok(has_anthropic);
        }
    }
    Ok(false)
}


#[tauri::command]
pub async fn ai_opencode_login_claude(app: AppHandle, state: tauri::State<'_, crate::state::AppState>) -> std::result::Result<OpencodeLoginStart, String> {
    // Resolve binary
    let Some(bin) = resolve_sidecar_path(&app, "opencode") else {
        return Err("opencode sidecar not found".to_string());
    };

    // Prefer running under a PTY so the TUI receives proper key events.
    // On macOS, use /usr/bin/script to allocate a pseudo-terminal.
    let script_path = std::path::Path::new("/usr/bin/script");
    let use_script = script_path.exists();

    // Prepare command
    let mut cmd = if use_script {
        let mut c = TokioCommand::new(script_path);
        c.arg("-q");
        c.arg("/dev/null");
        c.arg(&bin);
        c.arg("auth");
        c.arg("login");
        c
    } else {
        let mut c = TokioCommand::new(&bin);
        c.arg("auth").arg("login");
        c
    };
    if let Some(home) = devdb_home() {
        cmd.env("HOME", &home);
        cmd.env("XDG_CONFIG_HOME", &home);
    }
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
    // Notify UI that login started
    let _ = app.emit("ai:opencode-login-started", serde_json::json!({ "status": "started" }));

    // Try to drive the interactive TUI by typing search+enter sequences.
    let mut shared_stdin_opt: Option<std::sync::Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>> = None;
    if let Some(stdin) = child.stdin.take() {
        let shared_stdin = std::sync::Arc::new(tokio::sync::Mutex::new(stdin));
        // store for later code submission
        {
            let mut guard = state.ai_opencode_stdin.lock().await;
            *guard = Some(shared_stdin.clone());
        }
        shared_stdin_opt = Some(shared_stdin.clone());
        tokio::spawn(async move {
            let mut stdin = shared_stdin.lock().await;
            // Initial delay to allow TUI to fully render
            let _ = tokio::time::sleep(Duration::from_millis(500)).await;

            // Type "Anthropic" to filter providers
            let _ = stdin.write_all(b"Anthropic").await;
            let _ = stdin.flush().await; // Flush after typing
            let _ = tokio::time::sleep(Duration::from_millis(500)).await; // Increased delay for filter processing

            // Press Enter to confirm Anthropic selection
            let _ = stdin.write_all(b"\r").await; // use CR to mimic terminal Enter
            let _ = stdin.flush().await; // Flush after Enter
            let _ = tokio::time::sleep(Duration::from_millis(1000)).await; // Increased delay for selection confirmation

            // Press Enter again to proceed to method selection
            let _ = stdin.write_all(b"\r").await;
            let _ = stdin.flush().await; // Flush after Enter
            let _ = tokio::time::sleep(Duration::from_millis(1500)).await; // Increased delay for screen transition

            // Press Enter to select default auth method
            let _ = stdin.write_all(b"\r").await;
            let _ = stdin.flush().await; // Flush after Enter
        });
    }

    // Setup background readers to emit URL when it appears
    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();
    // Share stdin handle for reactive key presses
    let stdin_for_stdout = shared_stdin_opt.clone();
    let stdin_for_stderr = shared_stdin_opt.clone();
    use std::sync::atomic::{AtomicBool, Ordering};
    let sent_select = std::sync::Arc::new(AtomicBool::new(false));
    let sent_method = std::sync::Arc::new(AtomicBool::new(false));
    let status_emitted = std::sync::Arc::new(AtomicBool::new(false));
    let sent_select_stdout = sent_select.clone();
    let sent_method_stdout = sent_method.clone();
    let sent_select_stderr = sent_select.clone();
    let sent_method_stderr = sent_method.clone();
    let status_emitted_stdout = status_emitted.clone();
    let status_emitted_stderr = status_emitted.clone();
    let stdin_store_for_stdout = state.ai_opencode_stdin.clone();
    let stdin_store_for_stderr = state.ai_opencode_stdin.clone();
    let url_regex_stdout = regex::Regex::new(r"https?://[^\s]+\b").unwrap();
    let url_regex_stderr = regex::Regex::new(r"https?://[^\s]+\b").unwrap();
    // Separate instances for each task to avoid move issues
    let ansi_regex_stdout = regex::Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").unwrap();
    let ansi_regex_stderr = regex::Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").unwrap();

    // Debounce and open latest URL once (backend-controlled)
    let last_url = std::sync::Arc::new(tokio::sync::Mutex::new(None::<String>));
    let url_tick = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let url_timer_active = std::sync::Arc::new(AtomicBool::new(false));
    let url_opened_once = std::sync::Arc::new(AtomicBool::new(false));

    if let Some(stdout) = child.stdout.take() {
        // Clone URL debounce/open state for this task
        let last_url_stdout = last_url.clone();
        let url_tick_stdout = url_tick.clone();
        let url_timer_active_stdout = url_timer_active.clone();
        let url_opened_once_stdout = url_opened_once.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            let mut buf = String::new();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_for_stdout.emit("ai:opencode-login-line", serde_json::json!({ "stream": "stdout", "line": line }));
                let clean = ansi_regex_stdout.replace_all(&line, "");
                buf.push_str(&clean);
                buf.push('\n');
                // Trim to last N chars safely on char boundaries
                let char_count = buf.chars().count();
                if char_count > 4096 {
                    let excess = char_count - 4096;
                    let trimmed: String = buf.chars().skip(excess).collect();
                    buf = trimmed;
                }
                // If we see the instruction hint, send Enter key to proceed
                if clean.contains("Enter: confirm") && !sent_select_stdout.swap(true, Ordering::SeqCst) {
                    if let Some(lock) = stdin_for_stdout.as_ref() {
                        if let Ok(mut s) = lock.try_lock() {
                            let _ = s.write_all(b"\r").await;
                            let _ = s.flush().await;
                        }
                    }
                }
                if clean.contains("Login method") && !sent_method_stdout.swap(true, Ordering::SeqCst) {
                    if let Some(lock) = stdin_for_stdout.as_ref() {
                        if let Ok(mut s) = lock.try_lock() {
                            let _ = s.write_all(b"\r").await;
                            let _ = s.flush().await;
                        }
                    }
                }
                if !status_emitted_stdout.load(Ordering::SeqCst) {
                    if clean.contains("Login successful") {
                        status_emitted_stdout.store(true, Ordering::SeqCst);
                        let _ = app_for_stdout.emit("ai:opencode-login-status", serde_json::json!({ "status": "success" }));
                        // Clear stored stdin
                        let store = stdin_store_for_stdout.clone();
                        tokio::spawn(async move { let mut g = store.lock().await; *g = None; });
                    } else if clean.contains("Failed to authorize") {
                        status_emitted_stdout.store(true, Ordering::SeqCst);
                        let _ = app_for_stdout.emit("ai:opencode-login-status", serde_json::json!({ "status": "failed" }));
                        let store = stdin_store_for_stdout.clone();
                        tokio::spawn(async move { let mut g = store.lock().await; *g = None; });
                    }
                }
                // Capture URLs continuously; open the latest after short debounce
                if let Some(m) = url_regex_stdout.find(&clean).or_else(|| url_regex_stdout.find(&buf)) {
                    let detected = m.as_str().to_string();
                    let last_url = last_url_stdout.clone();
                    let app_for_emit = app_for_stdout.clone();
                    let url_tick = url_tick_stdout.clone();
                    let url_timer_active = url_timer_active_stdout.clone();
                    let url_opened_once = url_opened_once_stdout.clone();
                    tokio::spawn(async move {
                        {
                            let mut g = last_url.lock().await;
                            *g = Some(detected.clone());
                        }
                        let seq = url_tick.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = app_for_emit.emit("ai:opencode-login-url", serde_json::json!({ "url": detected }));
                        if !url_timer_active.swap(true, Ordering::SeqCst) {
                            // first arm timer loop
                            tokio::spawn(async move {
                                loop {
                                    let current = url_tick.load(Ordering::SeqCst);
                                    tokio::time::sleep(Duration::from_millis(1500)).await;
                                    let after = url_tick.load(Ordering::SeqCst);
                                    if after == current {
                                        // Stable; open latest if not yet opened
                                        if !url_opened_once.swap(true, Ordering::SeqCst) {
                                            if let Some(url) = last_url.lock().await.clone() {
                                                let _ = app_for_emit.emit("ai:opencode-login-url-latest", serde_json::json!({ "url": url }));
                                                // try to open from backend directly
                                                let _ = ai_open_system_url(app_for_emit.clone(), url).await;
                                            }
                                        }
                                        url_timer_active.store(false, Ordering::SeqCst);
                                        break;
                                    }
                                }
                            });
                        }
                    });
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        // Clone URL debounce/open state for this task
        let last_url_stderr = last_url.clone();
        let url_tick_stderr = url_tick.clone();
        let url_timer_active_stderr = url_timer_active.clone();
        let url_opened_once_stderr = url_opened_once.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            let mut buf = String::new();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_for_stderr.emit("ai:opencode-login-line", serde_json::json!({ "stream": "stderr", "line": line }));
                let clean = ansi_regex_stderr.replace_all(&line, "");
                buf.push_str(&clean);
                buf.push('\n');
                let char_count = buf.chars().count();
                if char_count > 4096 {
                    let excess = char_count - 4096;
                    let trimmed: String = buf.chars().skip(excess).collect();
                    buf = trimmed;
                }
                if clean.contains("Enter: confirm") && !sent_select_stderr.swap(true, Ordering::SeqCst) {
                    if let Some(lock) = stdin_for_stderr.as_ref() {
                        if let Ok(mut s) = lock.try_lock() {
                            let _ = s.write_all(b"\r").await;
                            let _ = s.flush().await;
                        }
                    }
                }
                if clean.contains("Login method") && !sent_method_stderr.swap(true, Ordering::SeqCst) {
                    if let Some(lock) = stdin_for_stderr.as_ref() {
                        if let Ok(mut s) = lock.try_lock() {
                            let _ = s.write_all(b"\r").await;
                            let _ = s.flush().await;
                        }
                    }
                }
                if !status_emitted_stderr.load(Ordering::SeqCst) {
                    if clean.contains("Login successful") {
                        status_emitted_stderr.store(true, Ordering::SeqCst);
                        let _ = app_for_stderr.emit("ai:opencode-login-status", serde_json::json!({ "status": "success" }));
                        let store = stdin_store_for_stderr.clone();
                        tokio::spawn(async move { let mut g = store.lock().await; *g = None; });
                    } else if clean.contains("Failed to authorize") {
                        status_emitted_stderr.store(true, Ordering::SeqCst);
                        let _ = app_for_stderr.emit("ai:opencode-login-status", serde_json::json!({ "status": "failed" }));
                        let store = stdin_store_for_stderr.clone();
                        tokio::spawn(async move { let mut g = store.lock().await; *g = None; });
                    }
                }
                if let Some(m) = url_regex_stderr.find(&clean).or_else(|| url_regex_stderr.find(&buf)) {
                    let detected = m.as_str().to_string();
                    let last_url = last_url_stderr.clone();
                    let app_for_emit = app_for_stderr.clone();
                    let url_tick = url_tick_stderr.clone();
                    let url_timer_active = url_timer_active_stderr.clone();
                    let url_opened_once = url_opened_once_stderr.clone();
                    tokio::spawn(async move {
                        {
                            let mut g = last_url.lock().await;
                            *g = Some(detected.clone());
                        }
                        let _ = app_for_emit.emit("ai:opencode-login-url", serde_json::json!({ "url": detected }));
                        url_tick.fetch_add(1, Ordering::SeqCst);
                        if !url_timer_active.swap(true, Ordering::SeqCst) {
                            tokio::spawn(async move {
                                loop {
                                    let current = url_tick.load(Ordering::SeqCst);
                                    tokio::time::sleep(Duration::from_millis(1500)).await;
                                    let after = url_tick.load(Ordering::SeqCst);
                                    if after == current {
                                        if !url_opened_once.swap(true, Ordering::SeqCst) {
                                            if let Some(url) = last_url.lock().await.clone() {
                                                let _ = app_for_emit.emit("ai:opencode-login-url-latest", serde_json::json!({ "url": url }));
                                                let _ = ai_open_system_url(app_for_emit.clone(), url).await;
                                            }
                                        }
                                        url_timer_active.store(false, Ordering::SeqCst);
                                        break;
                                    }
                                }
                            });
                        }
                    });
                }
            }
        });
    }

    // Try fast-path: read one line for up to 10s before returning
    // If not found, frontend will receive an event later
    // Create a oneshot receiver via reading from stderr or stdout quickly is complex; we just return started now.
    Ok(OpencodeLoginStart { status: "started".into(), url: None, message: None })
}

// Submit auth code back to the running TUI (best-effort; will target the most recent process)
#[tauri::command]
pub async fn ai_opencode_submit_code(_app: AppHandle, state: tauri::State<'_, crate::state::AppState>, code: String) -> std::result::Result<(), String> {
    let guard = state.ai_opencode_stdin.lock().await;
    if let Some(shared) = guard.as_ref() {
        let mut stdin = shared.lock().await;
        let trimmed = code.trim();
        stdin.write_all(trimmed.as_bytes()).await.map_err(|e| e.to_string())?;
        // Use CR to simulate Enter in TTY, send twice with tiny delays
        stdin.write_all(b"\r").await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        stdin.write_all(b"\r").await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("No active login session".to_string())
}

// Open a URL in the system default browser (robust fallback)
#[tauri::command]
pub async fn ai_open_system_url(_app: AppHandle, url: String) -> std::result::Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = TokioCommand::new("open");
        cmd.arg(url);
        cmd.spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let mut cmd = TokioCommand::new("xdg-open");
        cmd.arg(url);
        cmd.spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = TokioCommand::new("cmd");
        cmd.arg("/C").arg("start").arg("").arg(url);
        cmd.spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
}

// =============================================================================
// AI Sidecars: opencode server & SDK-driven auth
// =============================================================================

#[derive(serde::Serialize)]
pub struct OpencodeServerStart {
    pub url: String,
}

#[tauri::command]
pub async fn ai_opencode_start_server(app: AppHandle, state: tauri::State<'_, crate::state::AppState>) -> std::result::Result<OpencodeServerStart, String> {
    // resolve opencode binary
    let Some(bin) = resolve_sidecar_path(&app, "opencode") else { return Err("opencode sidecar not found".into()); };

    // Serialize startup across concurrent calls using both locks
    let mut server_lock = state.ai_opencode_server.lock().await;
    let mut url_lock = state.ai_opencode_server_url.lock().await;

    // If already have a URL and it's responsive, return it
    if let Some(url) = url_lock.as_ref() {
        if let Ok(response) = reqwest::Client::new()
            .get(format!("{}/health", url))
            .timeout(Duration::from_secs(1))
            .send()
            .await
        {
            if response.status().is_success() || response.status().as_u16() == 404 {
                return Ok(OpencodeServerStart { url: url.clone() });
            }
        }
    }

    // Kill any existing child we own
    if let Some(mut child) = server_lock.take() {
        tracing::info!(target: "devdb.ai", "Killing existing opencode server process");
        let _ = child.kill().await;
    }

    // Also kill any orphaned processes from previous runs using new binary names
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("pkill")
            .args(&["-f", "devdb-opencode"])
            .output();
        let _ = std::process::Command::new("pkill")
            .args(&["-f", "opencode serve"])
            .output();
    }

    // Host/port selection with env overrides; prefer 4599 if unspecified
    let hostname = std::env::var("DEVDB_OPENCODE_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let mut candidates: Vec<u16> = Vec::new();
    if let Ok(s) = std::env::var("DEVDB_OPENCODE_PORT").or_else(|_| std::env::var("OPENCODE_PORT")) {
        if let Ok(p) = s.parse::<u16>() { candidates.push(p); }
    }
    for p in [4599u16, 4096, 4097, 4100] { if !candidates.contains(&p) { candidates.push(p); } }

    // Spawn
    let mut child_opt = None;
    let mut chosen_port: u16 = 0;
    for p in candidates {
        let mut cmd = TokioCommand::new(&bin);
        cmd.arg("serve");
        cmd.arg("--port").arg(p.to_string());
        cmd.arg("--hostname").arg(&hostname);
        if let Some(home) = devdb_home() {
            let op_dir = home.join("opencode");
            let _ = std::fs::create_dir_all(&op_dir);
            cmd.env("HOME", &home);
            cmd.env("XDG_CONFIG_HOME", &home.join(".config"));
            cmd.env("XDG_DATA_HOME", &home.join(".local/share"));
            cmd.env("XDG_CACHE_HOME", &home.join(".cache"));
            cmd.env("OPENCODE_DIR", &op_dir);
            cmd.env("OPENCODE_HOME", &op_dir);
            let auth_dir = home.join(".local/share/opencode");
            let _ = std::fs::create_dir_all(&auth_dir);
        }
        cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        match cmd.spawn() {
            Ok(child) => { child_opt = Some(child); chosen_port = p; break; },
            Err(_) => continue,
        }
    }
    let mut child = child_opt.ok_or_else(|| "failed to spawn opencode server".to_string())?;

    // Emit starting event with PID
    let pid = child.id();
    let _ = app.emit("ai:opencode-server-starting", serde_json::json!({ "pid": pid }));
    tracing::info!(target: "devdb.ai", pid = pid, "opencode server starting");

    // Read a few lines to detect readiness; fallback to selected port
    let mut url = format!("http://{}:{}", hostname, chosen_port);
    let mut stdout_lines_opt: Option<tokio::io::Lines<BufReader<tokio::process::ChildStdout>>> = None;
    let mut stderr_lines_opt: Option<tokio::io::Lines<BufReader<tokio::process::ChildStderr>>> = None;
    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        // wait up to 3s for a line containing http://, but don't block on next_line
        let start = std::time::Instant::now();
        let url_regex = regex::Regex::new(r"http://[^\s]+").unwrap();
        while start.elapsed() < Duration::from_secs(3) {
            match tokio::time::timeout(Duration::from_millis(250), lines.next_line()).await {
                Ok(Ok(Some(line))) => {
                    if let Some(m) = url_regex.find(&line) { url = m.as_str().to_string(); break; }
                },
                Ok(Ok(None)) => { break; },
                Ok(Err(_)) => { break; },
                Err(_) => {},
            }
        }
        stdout_lines_opt = Some(lines);
    }
    if let Some(stderr) = child.stderr.take() {
        stderr_lines_opt = Some(BufReader::new(stderr).lines());
    }

    // store process and url while holding locks to ensure singleton
    *server_lock = Some(child);
    *url_lock = Some(url.clone());

    // Emit ready event and continue streaming logs in background
    let _ = app.emit("ai:opencode-server-ready", serde_json::json!({ "pid": pid, "url": url }));
    tracing::info!(target: "devdb.ai", pid = pid, url = %url, "opencode server ready");

    if let Some(mut lines) = stdout_lines_opt {
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_clone.emit("ai:opencode-server-log", serde_json::json!({ "stream": "stdout", "line": line }));
            }
        });
    }
    if let Some(mut lines) = stderr_lines_opt {
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_clone.emit("ai:opencode-server-log", serde_json::json!({ "stream": "stderr", "line": line }));
            }
        });
    }

    Ok(OpencodeServerStart { url })
}

#[derive(serde::Serialize)]
pub struct OpencodeAuthList {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

// Run `opencode auth ls` under the same sandboxed HOME/OPENCODE_DIR and return output
#[tauri::command]
pub async fn ai_opencode_auth_ls(app: AppHandle) -> std::result::Result<OpencodeAuthList, String> {
    let Some(bin) = resolve_sidecar_path(&app, "opencode") else { return Err("opencode sidecar not found".into()); };
    let mut cmd = TokioCommand::new(&bin);
    cmd.arg("auth").arg("list");  // Use 'list' instead of 'ls' for clarity

    if let Some(home) = devdb_home() {
        let op_dir = home.join("opencode");
        let _ = std::fs::create_dir_all(&op_dir);

        // Set all XDG directories to use our custom location
        // XDG_DATA_HOME should be the parent of where .local/share will be created
        cmd.env("HOME", &home);
        cmd.env("XDG_CONFIG_HOME", &home.join(".config"));
        cmd.env("XDG_DATA_HOME", &home.join(".local/share"));
        cmd.env("XDG_CACHE_HOME", &home.join(".cache"));
        cmd.env("OPENCODE_DIR", &op_dir);
        cmd.env("OPENCODE_HOME", &op_dir);

        // Create the .local/share/opencode directory for auth.json
        let auth_dir = home.join(".local/share/opencode");
        let _ = std::fs::create_dir_all(&auth_dir);
    }

    // Ensure stdin is null to prevent hanging
    cmd.stdin(std::process::Stdio::null())
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());

    // Add timeout for the command execution
    let timeout_duration = tokio::time::Duration::from_secs(5);
    let out = tokio::time::timeout(timeout_duration, cmd.output())
        .await
        .map_err(|_| "opencode auth list timed out after 5 seconds".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(OpencodeAuthList {
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        success: out.status.success(),
    })
}

// Helper to manually save auth.json since opencode server might not respect our env vars
fn save_opencode_auth(access: &str, refresh: &str, expires: i64) -> std::result::Result<(), String> {
    let Some(home) = devdb_home() else { return Err("HOME not found".to_string()); };
    let auth_dir = home.join(".local/share/opencode");
    let _ = std::fs::create_dir_all(&auth_dir);
    let auth_file = auth_dir.join("auth.json");

    let auth_json = serde_json::json!({
        "anthropic": {
            "type": "oauth",
            "access": access,
            "refresh": refresh,
            "expires": expires
        }
    });

    std::fs::write(&auth_file, serde_json::to_string_pretty(&auth_json).unwrap())
        .map_err(|e| format!("Failed to write auth.json: {}", e))?;

    Ok(())
}

// Exchange OAuth code with Anthropic on the backend to avoid CORS
#[derive(Deserialize)]
pub struct AnthropicTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(serde::Serialize)]
pub struct ExchangeResult {
    pub access: String,
    pub refresh: String,
    pub expires: i64,
}

#[tauri::command]
pub async fn ai_anthropic_exchange_code(
    _app: AppHandle,
    code: String,
    verifier: String,
) -> std::result::Result<ExchangeResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("devdb-studio/ai-auth")
        .build()
        .map_err(|e| e.to_string())?;
    let splits: Vec<&str> = code.split('#').collect();
    let raw_code = splits.get(0).copied().unwrap_or(&code);
    let state = splits.get(1).copied().unwrap_or("");

    let body = serde_json::json!({
        "code": raw_code,
        "state": state,
        "grant_type": "authorization_code",
        "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        "redirect_uri": "https://console.anthropic.com/oauth/code/callback",
        "code_verifier": verifier,
    });

    // headers
    let resp = client
        .post("https://console.anthropic.com/v1/oauth/token")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("token exchange failed: {} — {}", status, text));
    }
    let json: AnthropicTokenResponse = resp.json().await.map_err(|e| e.to_string())?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let expires = now_ms + (json.expires_in * 1000);

    // Also manually save the auth.json file since opencode server might not respect our env vars
    let _ = save_opencode_auth(&json.access_token, &json.refresh_token, expires);

    Ok(ExchangeResult {
        access: json.access_token,
        refresh: json.refresh_token,
        expires,
    })
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.create_index(&schema, &table, &index).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn drop_index(
    conn_id: String,
    schema: String,
    index_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.drop_index(&schema, &index_name).await
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.rename_index(&schema, &old_name, &new_name).await
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.alter_table_add_column(&schema, &table, &column).await
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.alter_table_drop_column(&schema, &table, &column_name).await
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.alter_table_modify_column(&schema, &table, &column).await
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.alter_table_rename_column(&schema, &table, &old_name, &new_name).await
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.alter_table_add_foreign_key(&schema, &table, &fk).await
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
    let conn = manager.get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.alter_table_drop_foreign_key(&schema, &table, &constraint_name).await
        .map_err(|e| e.to_string())
}
