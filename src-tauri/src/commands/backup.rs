//! Backup and restore commands for database adapters.
//!
//! These commands provide the IPC interface for the frontend to interact with
//! the backup/restore system. They delegate to the BackupCapable trait
//! implementations on database adapters.

use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::mpsc;

use crate::core::{
    BackupConfig, BackupFormat, BackupOptionsSchema, BackupPreview, BackupProgress,
    ConnectionManager, RestoreConfig, RestoreOptionsSchema, ToolCheckStatus, ToolInfo,
    ToolRegistry, ToolRequirement,
};
use crate::types::DbType;

/// Tool availability status for a database type.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    /// Information about tools required by this database type.
    pub required_tools: Vec<ToolInfo>,
    /// Detailed status of each required tool.
    pub tool_statuses: Vec<ToolCheckStatus>,
    /// Names of tools that are available on the system.
    pub available: Vec<String>,
    /// Names of tools that are missing (required but not available).
    pub missing: Vec<String>,
}

/// Complete backup capability information for a connection.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCapabilityInfo {
    /// External tools required for backup/restore (empty for native implementations).
    pub tool_requirements: Vec<ToolRequirement>,
    /// Available backup formats (e.g., binary, SQL dump).
    pub supported_formats: Vec<BackupFormat>,
    /// Schema describing available backup options.
    pub backup_options: BackupOptionsSchema,
    /// Schema describing available restore options.
    pub restore_options: RestoreOptionsSchema,
}

/// Get backup capability info for a connection.
///
/// Returns information about what backup/restore features are available for
/// the specified connection, including required tools, supported formats,
/// and configurable options.
#[tauri::command]
pub async fn get_backup_capability(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<BackupCapabilityInfo, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let backup_adapter = conn
        .adapter
        .as_backup()
        .ok_or_else(|| format!("Connection '{}' does not support backup/restore", conn_id))?;

    Ok(BackupCapabilityInfo {
        tool_requirements: backup_adapter.tool_requirements(),
        supported_formats: backup_adapter.supported_formats(),
        backup_options: backup_adapter.backup_options(),
        restore_options: backup_adapter.restore_options(),
    })
}

/// Get tool status for a database type.
///
/// Checks whether the required external tools for backup/restore are installed
/// on the system. For native implementations (SQLite, MSSQL, Redis), returns
/// empty lists since no external tools are needed.
///
/// For tool-based implementations (PostgreSQL, MySQL, MongoDB), checks if the
/// required tools (pg_dump, mariadb-dump, mongodump, etc.) are available.
#[tauri::command]
pub async fn get_tool_status(db_type: DbType) -> Result<ToolStatus, String> {
    // Convert DbType to string for registry lookup
    let db_type_str = match db_type {
        DbType::PostgreSQL => "PostgreSQL",
        DbType::MySQL => "MySQL",
        DbType::MariaDB => "MariaDB",
        DbType::MongoDB => "MongoDB",
        DbType::SQLite => "SQLite",
        DbType::SQLServer => "SQLServer",
        DbType::Redis => "Redis",
    };

    // Get tool requirements from registry
    let required_tools = ToolRegistry::get_tools_for_db(db_type_str);

    // Check status of each required tool
    let tool_statuses = ToolRegistry::check_tools_for_db(db_type_str).await;

    // Build available and missing lists from statuses
    let available: Vec<String> = tool_statuses
        .iter()
        .filter(|s| s.installed)
        .map(|s| s.name.clone())
        .collect();

    let missing: Vec<String> = tool_statuses
        .iter()
        .filter(|s| !s.installed)
        .map(|s| s.name.clone())
        .collect();

    Ok(ToolStatus {
        required_tools,
        tool_statuses,
        available,
        missing,
    })
}

/// Get backup preview for a file.
///
/// Parses the specified backup file and returns a preview of its contents,
/// including the objects (tables, collections, etc.) contained in the backup
/// and their metadata.
#[tauri::command]
pub async fn get_backup_preview(
    conn_id: String,
    file_path: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<BackupPreview, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let backup_adapter = conn
        .adapter
        .as_backup()
        .ok_or_else(|| format!("Connection '{}' does not support backup/restore", conn_id))?;

    let path = PathBuf::from(&file_path);
    backup_adapter
        .parse_backup_preview(&path)
        .await
        .map_err(|e| e.to_string())
}

/// Start a backup operation.
///
/// Initiates a backup using the specified configuration and streams progress
/// updates via the provided Tauri channel. The backup runs asynchronously
/// and sends progress events as it executes.
#[tauri::command]
pub async fn start_backup(
    conn_id: String,
    config: BackupConfig,
    channel: tauri::ipc::Channel<BackupProgress>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let backup_adapter = conn
        .adapter
        .as_backup()
        .ok_or_else(|| format!("Connection '{}' does not support backup/restore", conn_id))?;

    // Create an mpsc channel to receive progress from the adapter
    let (tx, mut rx) = mpsc::channel::<BackupProgress>(100);

    // Spawn a task to forward progress from mpsc to Tauri channel
    let channel_clone = channel.clone();
    tokio::spawn(async move {
        while let Some(progress) = rx.recv().await {
            if channel_clone.send(progress).is_err() {
                // Channel closed, stop forwarding
                break;
            }
        }
    });

    // Execute the backup
    // Note: We need to clone the config and execute in the current scope
    // because the adapter reference cannot be sent across threads
    let result = backup_adapter.execute_backup(config, tx).await;

    result.map_err(|e| e.to_string())
}

/// Start a restore operation.
///
/// Initiates a restore using the specified configuration and streams progress
/// updates via the provided Tauri channel. The restore runs asynchronously
/// and sends progress events as it executes.
#[tauri::command]
pub async fn start_restore(
    conn_id: String,
    config: RestoreConfig,
    channel: tauri::ipc::Channel<BackupProgress>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let backup_adapter = conn
        .adapter
        .as_backup()
        .ok_or_else(|| format!("Connection '{}' does not support backup/restore", conn_id))?;

    // Create an mpsc channel to receive progress from the adapter
    let (tx, mut rx) = mpsc::channel::<BackupProgress>(100);

    // Spawn a task to forward progress from mpsc to Tauri channel
    let channel_clone = channel.clone();
    tokio::spawn(async move {
        while let Some(progress) = rx.recv().await {
            if channel_clone.send(progress).is_err() {
                // Channel closed, stop forwarding
                break;
            }
        }
    });

    // Execute the restore
    let result = backup_adapter.execute_restore(config, tx).await;

    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_status_serialization() {
        use crate::core::{ToolCheckStatus, ToolInfo};
        use std::path::PathBuf;

        let status = ToolStatus {
            required_tools: vec![ToolInfo {
                name: "pg_dump".to_string(),
                description: "PostgreSQL backup utility".to_string(),
                version_command: "--version".to_string(),
                download_url: Some("https://www.postgresql.org/download/".to_string()),
                download_size_mb: 50,
            }],
            tool_statuses: vec![ToolCheckStatus {
                name: "pg_dump".to_string(),
                installed: true,
                path: Some(PathBuf::from("/usr/bin/pg_dump")),
                version: Some("pg_dump (PostgreSQL) 15.2".to_string()),
            }],
            available: vec!["pg_dump".to_string()],
            missing: vec![],
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"requiredTools\""));
        assert!(json.contains("\"toolStatuses\""));
        assert!(json.contains("\"available\""));
        assert!(json.contains("\"missing\""));
    }

    #[test]
    fn test_backup_capability_info_serialization() {
        let info = BackupCapabilityInfo {
            tool_requirements: vec![],
            supported_formats: vec![],
            backup_options: BackupOptionsSchema {
                common: vec![],
                advanced: vec![],
            },
            restore_options: RestoreOptionsSchema {
                common: vec![],
                advanced: vec![],
            },
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"toolRequirements\""));
        assert!(json.contains("\"supportedFormats\""));
        assert!(json.contains("\"backupOptions\""));
        assert!(json.contains("\"restoreOptions\""));
    }
}
