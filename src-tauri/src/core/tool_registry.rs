//! Tool registry for managing external CLI tools required by database adapters.
//!
//! PostgreSQL, MySQL, and MongoDB require external CLI tools for backup/restore
//! operations (pg_dump, mariadb-dump, mongodump, etc.). This module provides a
//! registry to track tool requirements, detect installations, and provide
//! download URLs for missing tools.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Information about an external tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    /// Tool binary name (e.g., "pg_dump").
    pub name: String,
    /// Human-readable description of the tool.
    pub description: String,
    /// Command-line argument to get version (e.g., "--version").
    pub version_command: String,
    /// URL where the tool can be downloaded.
    pub download_url: Option<String>,
    /// Approximate download size in MB (0 if bundled with another tool).
    pub download_size_mb: u32,
}

/// Status of a tool on the system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCheckStatus {
    /// Tool binary name.
    pub name: String,
    /// Whether the tool is installed and accessible.
    pub installed: bool,
    /// Full path to the tool binary, if found.
    pub path: Option<PathBuf>,
    /// Version string reported by the tool, if available.
    pub version: Option<String>,
}

/// Tool registry for managing external CLI tools.
///
/// This is a stateless utility struct providing methods to query tool
/// requirements and check tool availability on the system.
pub struct ToolRegistry;

impl ToolRegistry {
    /// Get tool information for a database type.
    ///
    /// Returns a list of tools required for backup/restore operations
    /// for the specified database type.
    ///
    /// # Arguments
    ///
    /// * `db_type` - Database type string (e.g., "PostgreSQL", "MySQL", "MongoDB")
    ///
    /// # Returns
    ///
    /// Vector of `ToolInfo` describing required tools. Empty for database types
    /// that use native backup implementations (SQLite, MSSQL, Redis).
    pub fn get_tools_for_db(db_type: &str) -> Vec<ToolInfo> {
        match db_type {
            "PostgreSQL" => vec![
                ToolInfo {
                    name: "pg_dump".to_string(),
                    description: "PostgreSQL backup utility".to_string(),
                    version_command: "--version".to_string(),
                    download_url: Some("https://www.postgresql.org/download/".to_string()),
                    download_size_mb: 50,
                },
                ToolInfo {
                    name: "pg_restore".to_string(),
                    description: "PostgreSQL restore utility".to_string(),
                    version_command: "--version".to_string(),
                    download_url: Some("https://www.postgresql.org/download/".to_string()),
                    download_size_mb: 0, // Included with pg_dump
                },
            ],
            // MySQL/MariaDB: Support both mysqldump/mysql AND mariadb-dump/mariadb
            // We only need ONE of each pair to be installed
            "MySQL" | "MariaDB" => vec![
                ToolInfo {
                    name: "mysqldump".to_string(),
                    description: "MySQL/MariaDB backup utility (or mariadb-dump)".to_string(),
                    version_command: "--version".to_string(),
                    download_url: Some("https://dev.mysql.com/downloads/mysql/".to_string()),
                    download_size_mb: 15,
                },
            ],
            "MongoDB" => vec![
                ToolInfo {
                    name: "mongodump".to_string(),
                    description: "MongoDB backup utility".to_string(),
                    version_command: "--version".to_string(),
                    download_url: Some(
                        "https://www.mongodb.com/try/download/database-tools".to_string(),
                    ),
                    download_size_mb: 60,
                },
                ToolInfo {
                    name: "mongorestore".to_string(),
                    description: "MongoDB restore utility".to_string(),
                    version_command: "--version".to_string(),
                    download_url: Some(
                        "https://www.mongodb.com/try/download/database-tools".to_string(),
                    ),
                    download_size_mb: 0, // Included with mongodump
                },
            ],
            // Native implementations don't require external tools
            _ => vec![],
        }
    }

    /// Check if a tool is available on the system.
    ///
    /// Attempts to locate the tool using system path lookup commands
    /// (`which` on Unix, `where` on Windows) and retrieves version information.
    ///
    /// # Arguments
    ///
    /// * `name` - Tool binary name to check
    ///
    /// # Returns
    ///
    /// `ToolCheckStatus` with installation status, path, and version info.
    pub async fn check_tool(name: &str) -> ToolCheckStatus {
        let path = Self::find_tool_path(name).await;
        let version = if let Some(ref p) = path {
            Self::get_tool_version(p).await
        } else {
            None
        };

        ToolCheckStatus {
            name: name.to_string(),
            installed: path.is_some(),
            path,
            version,
        }
    }

    /// Find tool path using system commands.
    ///
    /// Uses `which` on Unix-like systems or `where` on Windows to locate
    /// the tool binary in the system PATH. Also checks common Homebrew
    /// keg-only locations on macOS.
    async fn find_tool_path(name: &str) -> Option<PathBuf> {
        #[cfg(unix)]
        let result = tokio::process::Command::new("which")
            .arg(name)
            .output()
            .await;

        #[cfg(windows)]
        let result = tokio::process::Command::new("where")
            .arg(name)
            .output()
            .await;

        match result {
            Ok(output) if output.status.success() => {
                let path_str = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .lines()
                    .next()?
                    .to_string();
                return Some(PathBuf::from(path_str));
            }
            _ => {}
        }

        // Check Homebrew keg-only locations on macOS
        #[cfg(target_os = "macos")]
        {
            if let Some(path) = Self::find_in_homebrew_kegs(name) {
                return Some(path);
            }
        }

        None
    }

    /// Check Homebrew keg-only package locations for a tool.
    ///
    /// Homebrew installs some packages as "keg-only" meaning they're not
    /// symlinked to /usr/local/bin or /opt/homebrew/bin. This checks common
    /// keg locations for database client tools.
    #[cfg(target_os = "macos")]
    fn find_in_homebrew_kegs(name: &str) -> Option<PathBuf> {
        // Map tool names to their Homebrew package names
        let keg_names = match name {
            "mysqldump" | "mysql" => vec!["mysql-client", "mysql", "mariadb"],
            "mariadb-dump" | "mariadb" => vec!["mariadb", "mysql-client", "mysql"],
            "pg_dump" | "pg_restore" | "psql" => vec!["libpq", "postgresql@16", "postgresql@15", "postgresql@14", "postgresql"],
            "mongodump" | "mongorestore" => vec!["mongodb-database-tools"],
            _ => return None,
        };

        // Check both Apple Silicon and Intel Homebrew locations
        let homebrew_prefixes = ["/opt/homebrew/opt", "/usr/local/opt"];

        for prefix in homebrew_prefixes {
            for keg in &keg_names {
                let path = PathBuf::from(format!("{}/{}/bin/{}", prefix, keg, name));
                if path.exists() {
                    return Some(path);
                }
            }
        }

        None
    }

    /// Get tool version by running the version command.
    ///
    /// Executes the tool with `--version` flag and parses the output.
    /// Version information may appear in stdout or stderr depending on the tool.
    async fn get_tool_version(path: &PathBuf) -> Option<String> {
        let result = tokio::process::Command::new(path)
            .arg("--version")
            .output()
            .await;

        match result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                // Version info might be in stdout or stderr depending on the tool
                let version_str = if !stdout.is_empty() { stdout } else { stderr };
                // Extract first line as version
                version_str.lines().next().map(|s| s.trim().to_string())
            }
            _ => None,
        }
    }

    /// Check all tools required for a database type.
    ///
    /// Convenience method that retrieves tool requirements for a database type
    /// and checks the availability of each tool. For MySQL/MariaDB, also checks
    /// for alternative tools (mysqldump vs mariadb-dump).
    ///
    /// # Arguments
    ///
    /// * `db_type` - Database type string (e.g., "PostgreSQL", "MySQL", "MongoDB")
    ///
    /// # Returns
    ///
    /// Vector of `ToolCheckStatus` for each required tool.
    pub async fn check_tools_for_db(db_type: &str) -> Vec<ToolCheckStatus> {
        let tools = Self::get_tools_for_db(db_type);
        let mut statuses = Vec::new();

        for tool in tools {
            let mut status = Self::check_tool(&tool.name).await;

            // For MySQL tools, check alternatives if primary not found
            if !status.installed {
                if tool.name == "mysqldump" {
                    // Try mariadb-dump as alternative
                    let alt = Self::check_tool("mariadb-dump").await;
                    if alt.installed {
                        status = alt;
                        status.name = "mysqldump".to_string(); // Keep original name for consistency
                    }
                } else if tool.name == "mysql" {
                    // Try mariadb as alternative
                    let alt = Self::check_tool("mariadb").await;
                    if alt.installed {
                        status = alt;
                        status.name = "mysql".to_string();
                    }
                }
            }

            statuses.push(status);
        }
        statuses
    }

    /// Check if a specific tool is available.
    ///
    /// Simple helper that returns true if the tool is found in the system PATH.
    pub async fn is_tool_available(name: &str) -> bool {
        Self::find_tool_path(name).await.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_tools_for_postgresql() {
        let tools = ToolRegistry::get_tools_for_db("PostgreSQL");
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "pg_dump");
        assert_eq!(tools[1].name, "pg_restore");
    }

    #[test]
    fn test_get_tools_for_mysql() {
        let tools = ToolRegistry::get_tools_for_db("MySQL");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "mysqldump");
    }

    #[test]
    fn test_get_tools_for_mariadb() {
        let tools = ToolRegistry::get_tools_for_db("MariaDB");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "mysqldump");
    }

    #[test]
    fn test_get_tools_for_mongodb() {
        let tools = ToolRegistry::get_tools_for_db("MongoDB");
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "mongodump");
        assert_eq!(tools[1].name, "mongorestore");
    }

    #[test]
    fn test_get_tools_for_native_dbs() {
        // Native implementations should return empty tool list
        assert!(ToolRegistry::get_tools_for_db("SQLite").is_empty());
        assert!(ToolRegistry::get_tools_for_db("SQLServer").is_empty());
        assert!(ToolRegistry::get_tools_for_db("Redis").is_empty());
    }

    #[test]
    fn test_tool_info_serialization() {
        let info = ToolInfo {
            name: "pg_dump".to_string(),
            description: "PostgreSQL backup utility".to_string(),
            version_command: "--version".to_string(),
            download_url: Some("https://www.postgresql.org/download/".to_string()),
            download_size_mb: 50,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"name\":\"pg_dump\""));
        assert!(json.contains("\"downloadUrl\""));
        assert!(json.contains("\"downloadSizeMb\""));
    }

    #[test]
    fn test_tool_check_status_serialization() {
        let status = ToolCheckStatus {
            name: "pg_dump".to_string(),
            installed: true,
            path: Some(PathBuf::from("/usr/bin/pg_dump")),
            version: Some("pg_dump (PostgreSQL) 15.2".to_string()),
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"installed\":true"));
        assert!(json.contains("\"path\""));
    }
}
