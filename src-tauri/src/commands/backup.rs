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
use crate::types::{ConnectionProfile, DbType};

/// Progress updates during tool download.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DownloadProgress {
    /// Download has started.
    Started { total_bytes: u64 },
    /// Download progress update.
    Progress { downloaded: u64, total: u64 },
    /// Extracting the downloaded archive.
    Extracting { message: String },
    /// Download and installation completed successfully.
    Completed { path: String },
    /// Download or installation failed.
    Failed { error: String },
}

/// Platform-specific download information for a tool.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDownload {
    /// Target platform (macos, windows, linux).
    pub platform: String,
    /// Architecture (x64, arm64).
    pub arch: String,
    /// Download URL.
    pub url: String,
    /// Expected file format (zip, tar.gz, dmg, msi).
    pub format: String,
}

/// Installation instructions for a tool.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInstructions {
    /// Package manager name (homebrew, chocolatey, apt, etc.).
    pub package_manager: String,
    /// Installation command.
    pub command: String,
    /// Notes about the installation.
    pub notes: Option<String>,
}

/// Complete download information for a tool.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDownloadInfo {
    /// Tool binary name.
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// Official download page URL.
    pub official_url: String,
    /// Platform-specific direct download links (if available).
    pub downloads: Vec<PlatformDownload>,
    /// Package manager installation instructions.
    pub install_instructions: Vec<InstallInstructions>,
    /// Common installation paths to check.
    pub common_paths: Vec<String>,
    /// Whether automatic download is supported.
    pub auto_download_supported: bool,
}

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
///
/// Accepts a full ConnectionProfile to create/reuse a connection.
#[tauri::command]
pub async fn get_backup_capability(
    profile: ConnectionProfile,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<BackupCapabilityInfo, String> {
    // Create or get existing connection using the profile
    let conn_id = manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let backup_adapter = adapter.as_backup().ok_or_else(|| {
        format!(
            "Connection '{}' does not support backup/restore",
            profile.name
        )
    })?;

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
        DbType::DuckDB => "DuckDB",
        DbType::SQLServer => "SQLServer",
        DbType::Oracle => "Oracle",
        DbType::Redis => "Redis",
        DbType::Trino => "Trino",
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
    profile: ConnectionProfile,
    file_path: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<BackupPreview, String> {
    // Create or get existing connection using the profile
    let conn_id = manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let backup_adapter = adapter.as_backup().ok_or_else(|| {
        format!(
            "Connection '{}' does not support backup/restore",
            profile.name
        )
    })?;

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
    profile: ConnectionProfile,
    config: BackupConfig,
    channel: tauri::ipc::Channel<BackupProgress>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    // Create or get existing connection using the profile
    let conn_id = manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let backup_adapter = adapter.as_backup().ok_or_else(|| {
        format!(
            "Connection '{}' does not support backup/restore",
            profile.name
        )
    })?;

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
    profile: ConnectionProfile,
    config: RestoreConfig,
    channel: tauri::ipc::Channel<BackupProgress>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    // Create or get existing connection using the profile
    let conn_id = manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    // Safe mode guard (synchronous lookup — no DashMap lock held across await)
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        crate::core::safe_mode::OperationKind::Ddl,
        "Restore",
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let backup_adapter = adapter.as_backup().ok_or_else(|| {
        format!(
            "Connection '{}' does not support backup/restore",
            profile.name
        )
    })?;

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

/// Get download information for a backup tool.
///
/// Returns detailed information about how to download and install a specific
/// backup tool, including official download URLs, package manager commands,
/// and common installation paths.
#[tauri::command]
pub async fn get_tool_download_info(tool_name: String) -> Result<ToolDownloadInfo, String> {
    let info = match tool_name.as_str() {
        "pg_dump" | "pg_restore" => ToolDownloadInfo {
            name: tool_name.clone(),
            description: "PostgreSQL client tools for backup and restore".to_string(),
            official_url: "https://www.postgresql.org/download/".to_string(),
            downloads: vec![
                PlatformDownload {
                    platform: "macos".to_string(),
                    arch: "universal".to_string(),
                    url: "https://www.enterprisedb.com/downloads/postgres-postgresql-downloads"
                        .to_string(),
                    format: "dmg".to_string(),
                },
                PlatformDownload {
                    platform: "windows".to_string(),
                    arch: "x64".to_string(),
                    url: "https://www.enterprisedb.com/downloads/postgres-postgresql-downloads"
                        .to_string(),
                    format: "exe".to_string(),
                },
                PlatformDownload {
                    platform: "linux".to_string(),
                    arch: "x64".to_string(),
                    url: "https://www.postgresql.org/download/linux/".to_string(),
                    format: "package".to_string(),
                },
            ],
            install_instructions: vec![
                InstallInstructions {
                    package_manager: "Homebrew (macOS)".to_string(),
                    command: "brew install libpq".to_string(),
                    notes: Some(
                        "Lightweight client. Tools are installed to /opt/homebrew/opt/libpq/bin/".to_string(),
                    ),
                },
                InstallInstructions {
                    package_manager: "Chocolatey (Windows)".to_string(),
                    command: "choco install postgresql".to_string(),
                    notes: Some(
                        "Tools are installed to C:\\Program Files\\PostgreSQL\\16\\bin\\"
                            .to_string(),
                    ),
                },
                InstallInstructions {
                    package_manager: "apt (Debian/Ubuntu)".to_string(),
                    command: "sudo apt install postgresql-client".to_string(),
                    notes: None,
                },
                InstallInstructions {
                    package_manager: "dnf (Fedora/RHEL)".to_string(),
                    command: "sudo dnf install postgresql".to_string(),
                    notes: None,
                },
            ],
            common_paths: get_common_paths_for_tool(&tool_name),
            auto_download_supported: false,
        },
        "mysqldump" | "mysql" | "mariadb-dump" | "mariadb" => ToolDownloadInfo {
            name: tool_name.clone(),
            description: "MySQL/MariaDB client tools for backup and restore".to_string(),
            official_url: "https://dev.mysql.com/downloads/mysql/".to_string(),
            downloads: vec![
                PlatformDownload {
                    platform: "macos".to_string(),
                    arch: "universal".to_string(),
                    url: "https://dev.mysql.com/downloads/mysql/".to_string(),
                    format: "dmg".to_string(),
                },
                PlatformDownload {
                    platform: "windows".to_string(),
                    arch: "x64".to_string(),
                    url: "https://dev.mysql.com/downloads/mysql/".to_string(),
                    format: "msi".to_string(),
                },
                PlatformDownload {
                    platform: "linux".to_string(),
                    arch: "x64".to_string(),
                    url: "https://dev.mysql.com/downloads/mysql/".to_string(),
                    format: "package".to_string(),
                },
            ],
            install_instructions: vec![
                InstallInstructions {
                    package_manager: "Homebrew (macOS)".to_string(),
                    command: "brew install mysql-client".to_string(),
                    notes: Some("Lightweight client. Tools are installed to /opt/homebrew/opt/mysql-client/bin/".to_string()),
                },
                InstallInstructions {
                    package_manager: "Chocolatey (Windows)".to_string(),
                    command: "choco install mysql-cli".to_string(),
                    notes: None,
                },
                InstallInstructions {
                    package_manager: "apt (Debian/Ubuntu)".to_string(),
                    command: "sudo apt install mysql-client".to_string(),
                    notes: None,
                },
                InstallInstructions {
                    package_manager: "dnf (Fedora/RHEL)".to_string(),
                    command: "sudo dnf install mysql".to_string(),
                    notes: None,
                },
            ],
            common_paths: get_common_paths_for_tool(&tool_name),
            auto_download_supported: false,
        },
        "mongodump" | "mongorestore" => ToolDownloadInfo {
            name: tool_name.clone(),
            description: "MongoDB Database Tools for backup and restore".to_string(),
            official_url: "https://www.mongodb.com/try/download/database-tools".to_string(),
            downloads: vec![
                PlatformDownload {
                    platform: "macos".to_string(),
                    arch: "arm64".to_string(),
                    url: "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-macos-arm64-100.9.4.zip".to_string(),
                    format: "zip".to_string(),
                },
                PlatformDownload {
                    platform: "macos".to_string(),
                    arch: "x64".to_string(),
                    url: "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-macos-x86_64-100.9.4.zip".to_string(),
                    format: "zip".to_string(),
                },
                PlatformDownload {
                    platform: "windows".to_string(),
                    arch: "x64".to_string(),
                    url: "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-windows-x86_64-100.9.4.zip".to_string(),
                    format: "zip".to_string(),
                },
                PlatformDownload {
                    platform: "linux".to_string(),
                    arch: "x64".to_string(),
                    url: "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.9.4.tgz".to_string(),
                    format: "tar.gz".to_string(),
                },
            ],
            install_instructions: vec![
                InstallInstructions {
                    package_manager: "Homebrew (macOS)".to_string(),
                    command: "brew install mongodb-database-tools".to_string(),
                    notes: Some("Tools are installed to /opt/homebrew/bin/".to_string()),
                },
                InstallInstructions {
                    package_manager: "Chocolatey (Windows)".to_string(),
                    command: "choco install mongodb-database-tools".to_string(),
                    notes: None,
                },
                InstallInstructions {
                    package_manager: "apt (Debian/Ubuntu)".to_string(),
                    command: "sudo apt install mongodb-database-tools".to_string(),
                    notes: Some("May need to add MongoDB repository first".to_string()),
                },
            ],
            common_paths: get_common_paths_for_tool(&tool_name),
            auto_download_supported: true, // MongoDB tools have stable direct download URLs
        },
        _ => {
            return Err(format!("Unknown tool: {}", tool_name));
        }
    };

    Ok(info)
}

/// Get common installation paths for a tool based on the current platform.
fn get_common_paths_for_tool(tool_name: &str) -> Vec<String> {
    let mut paths = Vec::new();

    #[cfg(target_os = "macos")]
    {
        match tool_name {
            "pg_dump" | "pg_restore" | "psql" => {
                // libpq (recommended - lightweight, client only)
                paths.push("/opt/homebrew/opt/libpq/bin".to_string());
                paths.push("/usr/local/opt/libpq/bin".to_string());
                // Homebrew full PostgreSQL paths (Apple Silicon and Intel)
                paths.push("/opt/homebrew/opt/postgresql@16/bin".to_string());
                paths.push("/opt/homebrew/opt/postgresql@15/bin".to_string());
                paths.push("/opt/homebrew/opt/postgresql/bin".to_string());
                paths.push("/usr/local/opt/postgresql@16/bin".to_string());
                paths.push("/usr/local/opt/postgresql@15/bin".to_string());
                paths.push("/usr/local/opt/postgresql/bin".to_string());
                // Postgres.app
                paths.push("/Applications/Postgres.app/Contents/Versions/latest/bin".to_string());
                // EDB installer
                paths.push("/Library/PostgreSQL/16/bin".to_string());
                paths.push("/Library/PostgreSQL/15/bin".to_string());
            }
            "mysqldump" | "mysql" | "mariadb-dump" | "mariadb" => {
                // mysql-client (recommended - lightweight, no server)
                paths.push("/opt/homebrew/opt/mysql-client/bin".to_string());
                paths.push("/usr/local/opt/mysql-client/bin".to_string());
                // Full MySQL installation
                paths.push("/opt/homebrew/opt/mysql/bin".to_string());
                paths.push("/usr/local/opt/mysql/bin".to_string());
                paths.push("/usr/local/mysql/bin".to_string());
                // MariaDB installation
                paths.push("/opt/homebrew/opt/mariadb/bin".to_string());
                paths.push("/usr/local/opt/mariadb/bin".to_string());
            }
            "mongodump" | "mongorestore" => {
                paths.push("/opt/homebrew/bin".to_string());
                paths.push("/usr/local/bin".to_string());
            }
            _ => {}
        }
    }

    #[cfg(target_os = "windows")]
    {
        match tool_name {
            "pg_dump" | "pg_restore" => {
                paths.push("C:\\Program Files\\PostgreSQL\\16\\bin".to_string());
                paths.push("C:\\Program Files\\PostgreSQL\\15\\bin".to_string());
                paths.push("C:\\Program Files\\PostgreSQL\\14\\bin".to_string());
            }
            "mariadb-dump" | "mariadb" => {
                paths.push("C:\\Program Files\\MariaDB 11.2\\bin".to_string());
                paths.push("C:\\Program Files\\MariaDB 10.11\\bin".to_string());
                paths.push("C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin".to_string());
            }
            "mongodump" | "mongorestore" => {
                paths.push("C:\\Program Files\\MongoDB\\Tools\\100\\bin".to_string());
            }
            _ => {}
        }
    }

    #[cfg(target_os = "linux")]
    {
        match tool_name {
            "pg_dump" | "pg_restore" => {
                paths.push("/usr/bin".to_string());
                paths.push("/usr/lib/postgresql/16/bin".to_string());
                paths.push("/usr/lib/postgresql/15/bin".to_string());
            }
            "mariadb-dump" | "mariadb" => {
                paths.push("/usr/bin".to_string());
            }
            "mongodump" | "mongorestore" => {
                paths.push("/usr/bin".to_string());
                paths.push("/usr/local/bin".to_string());
            }
            _ => {}
        }
    }

    paths
}

/// Search for a tool in common installation paths.
///
/// Checks both the system PATH and known installation directories for the tool.
#[tauri::command]
pub async fn search_tool_paths(tool_name: String) -> Result<Vec<String>, String> {
    let mut found_paths = Vec::new();

    // First check if tool is in PATH
    if let Some(path) = ToolRegistry::check_tool(&tool_name).await.path {
        found_paths.push(path.to_string_lossy().to_string());
    }

    // Then check common installation paths
    let common_paths = get_common_paths_for_tool(&tool_name);
    for dir in common_paths {
        let tool_path = PathBuf::from(&dir).join(&tool_name);

        #[cfg(target_os = "windows")]
        let tool_path = tool_path.with_extension("exe");

        if tool_path.exists() {
            let path_str = tool_path.to_string_lossy().to_string();
            if !found_paths.contains(&path_str) {
                found_paths.push(path_str);
            }
        }
    }

    Ok(found_paths)
}

/// Download and install a backup tool.
///
/// Currently supports automatic download for MongoDB Database Tools.
/// For other tools, returns an error with instructions for manual installation.
///
/// Progress updates are streamed via the provided channel.
#[tauri::command]
pub async fn download_tool(
    tool_name: String,
    channel: tauri::ipc::Channel<DownloadProgress>,
) -> Result<String, String> {
    // Get download info for the tool
    let info = get_tool_download_info(tool_name.clone()).await?;

    if !info.auto_download_supported {
        let _ = channel.send(DownloadProgress::Failed {
            error: format!(
                "Automatic download is not supported for {}. Please install manually using one of these methods:\n{}",
                tool_name,
                info.install_instructions
                    .iter()
                    .map(|i| format!("  {} - {}", i.package_manager, i.command))
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        });
        return Err(format!(
            "Automatic download not supported for {}. Visit {} for installation instructions.",
            tool_name, info.official_url
        ));
    }

    // Get platform-specific download URL
    let current_platform = get_current_platform();
    let current_arch = get_current_arch();

    let download = info
        .downloads
        .iter()
        .find(|d| d.platform == current_platform && d.arch == current_arch)
        .or_else(|| {
            // Fallback: try to find any download for current platform
            info.downloads
                .iter()
                .find(|d| d.platform == current_platform)
        })
        .ok_or_else(|| {
            format!(
                "No download available for {} on {}/{}",
                tool_name, current_platform, current_arch
            )
        })?;

    // For now, return the download URL and instructions
    // Full automatic download implementation would require:
    // 1. HTTP client for downloading
    // 2. Archive extraction (zip/tar.gz)
    // 3. File permission handling
    // 4. App data directory management
    let _ = channel.send(DownloadProgress::Failed {
        error: format!(
            "Automatic download is not yet fully implemented. Please download manually from: {}",
            download.url
        ),
    });

    Err(format!(
        "Please download {} manually from: {}\n\nOr use package manager:\n{}",
        tool_name,
        download.url,
        info.install_instructions
            .iter()
            .filter(|i| i.package_manager.to_lowercase().contains(&current_platform))
            .map(|i| format!("  {}", i.command))
            .collect::<Vec<_>>()
            .join("\n")
    ))
}

/// Install a tool using Homebrew.
///
/// Runs `brew install <package>` and returns the output.
/// Only available on macOS.
#[tauri::command]
pub async fn install_tool_via_brew(package_name: String) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("Homebrew installation is only available on macOS".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use tokio::process::Command;

        let output = Command::new("brew")
            .arg("install")
            .arg(&package_name)
            .output()
            .await
            .map_err(|e| format!("Failed to run brew: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(format!("{}\n{}", stdout, stderr).trim().to_string())
        } else {
            Err(format!("brew install failed:\n{}\n{}", stdout, stderr))
        }
    }
}

/// Get the current platform identifier.
fn get_current_platform() -> String {
    #[cfg(target_os = "macos")]
    return "macos".to_string();

    #[cfg(target_os = "windows")]
    return "windows".to_string();

    #[cfg(target_os = "linux")]
    return "linux".to_string();

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return "unknown".to_string();
}

/// Get the current architecture identifier.
fn get_current_arch() -> String {
    #[cfg(target_arch = "aarch64")]
    return "arm64".to_string();

    #[cfg(target_arch = "x86_64")]
    return "x64".to_string();

    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    return "unknown".to_string();
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

    #[test]
    fn test_download_progress_serialization() {
        let progress = DownloadProgress::Started { total_bytes: 1024 };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"type\":\"started\""));
        // Note: field name is snake_case inside the variant, but the enum tag is camelCase
        assert!(json.contains("\"total_bytes\":1024"));

        let progress = DownloadProgress::Progress {
            downloaded: 512,
            total: 1024,
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"type\":\"progress\""));
        assert!(json.contains("\"downloaded\":512"));

        let progress = DownloadProgress::Extracting {
            message: "Extracting files...".to_string(),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"type\":\"extracting\""));

        let progress = DownloadProgress::Completed {
            path: "/usr/bin/tool".to_string(),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"type\":\"completed\""));

        let progress = DownloadProgress::Failed {
            error: "Download failed".to_string(),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"type\":\"failed\""));
    }

    #[test]
    fn test_tool_download_info_serialization() {
        let info = ToolDownloadInfo {
            name: "pg_dump".to_string(),
            description: "PostgreSQL backup utility".to_string(),
            official_url: "https://postgresql.org".to_string(),
            downloads: vec![PlatformDownload {
                platform: "macos".to_string(),
                arch: "arm64".to_string(),
                url: "https://example.com/download".to_string(),
                format: "dmg".to_string(),
            }],
            install_instructions: vec![InstallInstructions {
                package_manager: "Homebrew".to_string(),
                command: "brew install postgresql".to_string(),
                notes: Some("Test note".to_string()),
            }],
            common_paths: vec!["/usr/bin".to_string()],
            auto_download_supported: false,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"name\":\"pg_dump\""));
        assert!(json.contains("\"officialUrl\""));
        assert!(json.contains("\"downloads\""));
        assert!(json.contains("\"installInstructions\""));
        assert!(json.contains("\"commonPaths\""));
        assert!(json.contains("\"autoDownloadSupported\":false"));
    }

    #[test]
    fn test_get_common_paths_for_tool() {
        // Test PostgreSQL tools
        let paths = get_common_paths_for_tool("pg_dump");
        #[cfg(target_os = "macos")]
        {
            assert!(paths.iter().any(|p| p.contains("postgresql")));
            assert!(paths.iter().any(|p| p.contains("Postgres.app")));
        }

        // Test MariaDB tools
        let paths = get_common_paths_for_tool("mariadb-dump");
        #[cfg(target_os = "macos")]
        {
            assert!(paths.iter().any(|p| p.contains("mariadb")));
        }

        // Test MongoDB tools
        let paths = get_common_paths_for_tool("mongodump");
        #[cfg(target_os = "macos")]
        {
            assert!(paths.iter().any(|p| p.contains("/opt/homebrew/bin")));
        }

        // Test unknown tool returns empty
        let paths = get_common_paths_for_tool("unknown_tool");
        assert!(paths.is_empty());
    }

    #[test]
    fn test_platform_detection() {
        let platform = get_current_platform();
        #[cfg(target_os = "macos")]
        assert_eq!(platform, "macos");
        #[cfg(target_os = "windows")]
        assert_eq!(platform, "windows");
        #[cfg(target_os = "linux")]
        assert_eq!(platform, "linux");
    }

    #[test]
    fn test_arch_detection() {
        let arch = get_current_arch();
        #[cfg(target_arch = "aarch64")]
        assert_eq!(arch, "arm64");
        #[cfg(target_arch = "x86_64")]
        assert_eq!(arch, "x64");
    }

    #[tokio::test]
    async fn test_get_tool_download_info_postgresql() {
        let info = get_tool_download_info("pg_dump".to_string()).await.unwrap();
        assert_eq!(info.name, "pg_dump");
        assert!(!info.downloads.is_empty());
        assert!(!info.install_instructions.is_empty());
        assert!(!info.auto_download_supported);
    }

    #[tokio::test]
    async fn test_get_tool_download_info_mongodb() {
        let info = get_tool_download_info("mongodump".to_string())
            .await
            .unwrap();
        assert_eq!(info.name, "mongodump");
        assert!(info.auto_download_supported);
        assert!(info.downloads.iter().any(|d| d.format == "zip"));
    }

    #[tokio::test]
    async fn test_get_tool_download_info_unknown() {
        let result = get_tool_download_info("unknown_tool".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown tool"));
    }
}
