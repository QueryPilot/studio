use tauri::State;
use serde_json::Value as JsonValue;
use crate::storage::{SecureStorage, ConnectionConfig};
use std::sync::Arc;
use tokio::sync::Mutex;

pub type SecureStorageState = Arc<Mutex<Option<SecureStorage>>>;

// Initialize secure storage is now handled in app setup

/// Store a connection configuration
#[tauri::command]
pub async fn store_connection(
    connection: ConnectionConfig,
    state: State<'_, SecureStorageState>,
) -> Result<String, String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    storage.store_connection(connection)
        .await
        .map_err(|e| format!("Failed to store connection: {}", e))
}

/// Get a connection configuration
#[tauri::command]
pub async fn get_connection(
    connection_id: String,
    state: State<'_, SecureStorageState>,
) -> Result<ConnectionConfig, String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    storage.get_connection(&connection_id)
        .await
        .map_err(|e| format!("Failed to get connection: {}", e))
}

/// List connections with pagination
#[tauri::command]
pub async fn list_connections_paginated(
    page: u32,
    page_size: u32,
    state: State<'_, SecureStorageState>,
) -> Result<(Vec<ConnectionConfig>, u32), String> {
    let storage = state.lock().await;
    let storage = storage.as_ref().ok_or("Secure storage not initialized")?;
    storage.list_connections_paginated(page, page_size)
        .await
        .map_err(|e| format!("Failed to list connections: {}", e))
}

/// List all connections (backwards compatibility)
#[tauri::command]
pub async fn list_connections(
    state: State<'_, SecureStorageState>,
) -> Result<Vec<ConnectionConfig>, String> {
    let storage = state.lock().await;
    let storage = storage.as_ref().ok_or("Secure storage not initialized")?;
    storage.list_connections()
        .await
        .map_err(|e| format!("Failed to list connections: {}", e))
}

/// Update a connection
#[tauri::command]
pub async fn update_connection(
    connection_id: String,
    connection: ConnectionConfig,
    state: State<'_, SecureStorageState>,
) -> Result<(), String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    storage.update_connection(&connection_id, connection)
        .await
        .map_err(|e| format!("Failed to update connection: {}", e))
}

/// Delete a connection
#[tauri::command]
pub async fn delete_connection(
    connection_id: String,
    state: State<'_, SecureStorageState>,
) -> Result<(), String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    storage.delete_connection(&connection_id)
        .await
        .map_err(|e| format!("Failed to delete connection: {}", e))
}

/// Store arbitrary secure data
#[tauri::command]
pub async fn secure_set(
    key: String,
    value: String,
    state: State<'_, SecureStorageState>,
) -> Result<(), String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    storage.store_secure_data(&key, &value)
        .await
        .map_err(|e| format!("Failed to store secure data: {}", e))
}

/// Get secure data
#[tauri::command]
pub async fn secure_get(
    key: String,
    state: State<'_, SecureStorageState>,
) -> Result<Option<String>, String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    storage.get_secure_data(&key)
        .await
        .map_err(|e| format!("Failed to get secure data: {}", e))
}

/// Delete secure data
#[tauri::command]
pub async fn secure_delete(
    key: String,
    state: State<'_, SecureStorageState>,
) -> Result<(), String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    storage.delete_secure_data(&key)
        .await
        .map_err(|e| format!("Failed to delete secure data: {}", e))
}

/// List secure storage keys
#[tauri::command]
pub async fn secure_list_keys(
    prefix: Option<String>,
    state: State<'_, SecureStorageState>,
) -> Result<Vec<String>, String> {
    let storage = state.lock().await;
    let storage = storage.as_ref().ok_or("Secure storage not initialized")?;
    storage.list_secure_keys(prefix.as_deref())
        .await
        .map_err(|e| format!("Failed to list keys: {}", e))
}

/// Rotate encryption keys
#[tauri::command]
pub async fn rotate_keys(
    state: State<'_, SecureStorageState>,
) -> Result<(), String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    storage.rotate_keys()
        .await
        .map_err(|e| format!("Failed to rotate keys: {}", e))
}

/// Get audit log events
#[tauri::command]
pub async fn get_audit_log(
    limit: Option<i64>,
    state: State<'_, SecureStorageState>,
) -> Result<JsonValue, String> {
    // This would need access to the audit logger
    // For now, return empty array
    Ok(JsonValue::Array(vec![]))
}

/// Clean up test connections (those with TEST_ prefix)
#[tauri::command]
pub async fn cleanup_test_connections(
    state: State<'_, SecureStorageState>,
) -> Result<u32, String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    
    // Get all connections
    let connections = storage.list_connections()
        .await
        .map_err(|e| format!("Failed to list connections: {}", e))?;
    
    let mut cleaned = 0;
    for conn in connections {
        // Check if it's a test connection (has TEST_ prefix in name)
        if conn.name.starts_with("TEST_") {
            if let Some(id) = conn.id {
                // Delete the test connection
                if let Ok(()) = storage.delete_connection(&id).await {
                    cleaned += 1;
                    println!("Cleaned up test connection: {}", id);
                }
            }
        }
    }
    
    Ok(cleaned)
}

/// Delete all connections
#[tauri::command]
pub async fn delete_all_connections(
    state: State<'_, SecureStorageState>,
) -> Result<u32, String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    
    // Get all connections
    let connections = storage.list_connections()
        .await
        .map_err(|e| format!("Failed to list connections: {}", e))?;
    
    let mut deleted = 0;
    for conn in connections {
        if let Some(id) = conn.id {
            // Delete the connection
            if let Ok(()) = storage.delete_connection(&id).await {
                deleted += 1;
                println!("Deleted connection: {} ({})", conn.name, id);
            }
        }
    }
    
    Ok(deleted)
}

/// Clear all secure storage (emergency reset)
#[tauri::command]
pub async fn clear_all_storage(
    confirmation: String,
    state: State<'_, SecureStorageState>,
) -> Result<(), String> {
    if confirmation != "CONFIRM_DELETE_ALL" {
        return Err("Invalid confirmation".to_string());
    }
    
    // This would need to be implemented in SecureStorage
    // For now, return error
    Err("Not implemented".to_string())
}