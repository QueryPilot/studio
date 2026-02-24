//! Unified connection lifecycle commands.
//!
//! These commands are paradigm-agnostic and work with all database types.

use std::sync::Arc;
use std::time::Instant;
use tauri::State;
use tokio::time::{timeout, Duration};

use crate::core::ConnectionManager;
use crate::ssh;
use crate::state::AppState;
use crate::types::*;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let result = adapter.test_connection().await.map_err(|e| e.to_string())?;

    Ok(ConnectionTestResult {
        success: result.success,
        message: result.message,
        version: result.server_version,
        warnings: vec![],
        detected_db_type: Some(adapter.db_type()),
    })
}

#[tauri::command]
pub async fn get_connection_health(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionHealth, String> {
    // Use borrow_adapter to avoid holding DashMap read lock across the
    // async test_connection call — holding the lock would block concurrent
    // reconnection attempts.
    let adapter = match manager.borrow_adapter(&conn_id) {
        Some(a) => a,
        None => {
            return Ok(ConnectionHealth {
                connection_id: conn_id,
                status: "connecting".to_string(),
                healthy: false,
                rtt_ms: None,
                error: None,
            });
        }
    };

    let test_result = adapter.test_connection().await.map_err(|e| e.to_string())?;

    Ok(ConnectionHealth {
        connection_id: conn_id,
        status: if test_result.success {
            "ready".to_string()
        } else {
            "error".to_string()
        },
        healthy: test_result.success,
        rtt_ms: test_result.latency_ms,
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
    let start = Instant::now();
    let is_connected = manager
        .ping_connection(&conn_id)
        .await
        .map_err(|e| e.to_string())?;
    let elapsed = start.elapsed().as_millis() as u64;

    if is_connected {
        Ok(elapsed)
    } else {
        Err("Connection is not active".to_string())
    }
}

/// Update the safe mode level on a live connection.
/// The frontend calls this after persisting the change to the vault so that the
/// backend's in-memory connection also reflects the new level.
#[tauri::command]
pub async fn update_safe_mode(
    conn_id: String,
    safe_mode: SafeMode,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    manager
        .update_safe_mode(&conn_id, safe_mode)
        .map_err(|e| e.to_string())
}

/// Update the Window menu to reflect current open windows
/// Called by frontend when workspace windows are opened or closed
#[tauri::command]
pub async fn update_window_menu(app: tauri::AppHandle) -> Result<(), String> {
    crate::menu::update_window_menu(&app).map_err(|e: tauri::Error| e.to_string())
}
