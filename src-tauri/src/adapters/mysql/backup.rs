//! MySQL/MariaDB backup implementation using mariadb-dump/mariadb CLI tools.
//!
//! MySQL/MariaDB requires external CLI tools for backup/restore operations.
//! We use MariaDB client tools (LGPL licensed) for compatibility with both
//! MySQL and MariaDB servers.

use async_trait::async_trait;
use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader as TokioBufReader};
use tokio::process::Command;

use crate::core::backup_capability::{
    BackupCapable, BackupConfig, BackupFormat, BackupObject, BackupObjectType,
    BackupOptionsSchema, BackupPreview, BackupPreviewObject, BackupProgress, FieldType,
    OptionField, ProgressSender, RestoreConfig, RestoreOptionsSchema, ToolPurpose, ToolRequirement,
};
use crate::error::AppError;

use super::MySqlAdapter;

/// Connection info extracted from the adapter for subprocess execution
struct ConnectionInfo {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    database: String,
}

impl MySqlAdapter {
    /// Find the available dump tool (mysqldump or mariadb-dump).
    async fn find_dump_tool() -> Result<String, AppError> {
        // Try mysqldump first (more common)
        if let Ok(output) = tokio::process::Command::new("which")
            .arg("mysqldump")
            .output()
            .await
        {
            if output.status.success() {
                return Ok("mysqldump".to_string());
            }
        }

        // Try mariadb-dump as fallback
        if let Ok(output) = tokio::process::Command::new("which")
            .arg("mariadb-dump")
            .output()
            .await
        {
            if output.status.success() {
                return Ok("mariadb-dump".to_string());
            }
        }

        Err(AppError::Internal(
            "Neither mysqldump nor mariadb-dump found. Install MySQL client tools: brew install mysql-client".to_string()
        ))
    }

    /// Find the available MySQL client tool (mysql or mariadb).
    async fn find_client_tool() -> Result<String, AppError> {
        // Try mysql first (more common)
        if let Ok(output) = tokio::process::Command::new("which")
            .arg("mysql")
            .output()
            .await
        {
            if output.status.success() {
                return Ok("mysql".to_string());
            }
        }

        // Try mariadb as fallback
        if let Ok(output) = tokio::process::Command::new("which")
            .arg("mariadb")
            .output()
            .await
        {
            if output.status.success() {
                return Ok("mariadb".to_string());
            }
        }

        Err(AppError::Internal(
            "Neither mysql nor mariadb client found. Install MySQL client tools: brew install mysql-client".to_string()
        ))
    }

    /// Get connection info from the adapter's current connection.
    /// This requires the adapter to be connected with stored profile info.
    async fn get_connection_info(&self) -> Result<ConnectionInfo, AppError> {
        let mut conn = self.get_conn().await?;

        // Query connection variables to get host, port, user, database
        use mysql_async::prelude::*;

        let row: Option<(String, String, String, u16)> = conn
            .query_first(
                "SELECT DATABASE(), USER(), @@hostname, @@port",
            )
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get connection info: {}", e)))?;

        match row {
            Some((database, user, _host, port)) => {
                // Extract username from user@host format
                let username = user.split('@').next().unwrap_or(&user).to_string();

                // Note: We can't retrieve the password from the connection.
                // The caller must provide it through the profile.
                // For now, we'll return None for password and handle it in execute_backup/restore.
                Ok(ConnectionInfo {
                    host: "localhost".to_string(), // Default, will be overridden by profile
                    port,
                    username,
                    password: None,
                    database,
                })
            }
            None => Err(AppError::DatabaseError(
                "Failed to get connection info".into(),
            )),
        }
    }
}

#[async_trait]
impl BackupCapable for MySqlAdapter {
    /// MySQL/MariaDB supports both mysqldump/mysql AND mariadb-dump/mariadb.
    /// Only one tool is required - we use whichever is available.
    fn tool_requirements(&self) -> Vec<ToolRequirement> {
        vec![
            ToolRequirement {
                name: "mysqldump".to_string(),
                purpose: ToolPurpose::Backup,
                download_size_mb: 15,
            },
        ]
    }

    /// MySQL/MariaDB only supports SQL dump format.
    fn supported_formats(&self) -> Vec<BackupFormat> {
        vec![BackupFormat {
            id: "sql".to_string(),
            name: "SQL Dump".to_string(),
            extension: "sql".to_string(),
            description: "SQL dump file containing CREATE and INSERT statements. Compatible with MySQL and MariaDB.".to_string(),
        }]
    }

    /// Backup options for mariadb-dump.
    fn backup_options(&self) -> BackupOptionsSchema {
        BackupOptionsSchema {
            common: vec![
                OptionField {
                    key: "single_transaction".to_string(),
                    label: "Single Transaction".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Dump tables in a single transaction for consistent backup. Recommended for InnoDB tables.".to_string(),
                },
                OptionField {
                    key: "routines".to_string(),
                    label: "Include Routines".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Include stored procedures and functions in the dump.".to_string(),
                },
                OptionField {
                    key: "triggers".to_string(),
                    label: "Include Triggers".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Include triggers for each dumped table.".to_string(),
                },
            ],
            advanced: vec![
                OptionField {
                    key: "events".to_string(),
                    label: "Include Events".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Include Event Scheduler events in the dump.".to_string(),
                },
                OptionField {
                    key: "add_drop_database".to_string(),
                    label: "Add DROP DATABASE".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Add DROP DATABASE statement before each CREATE DATABASE.".to_string(),
                },
                OptionField {
                    key: "add_drop_table".to_string(),
                    label: "Add DROP TABLE".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Add DROP TABLE statement before each CREATE TABLE.".to_string(),
                },
                OptionField {
                    key: "complete_insert".to_string(),
                    label: "Complete INSERT Statements".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Use complete INSERT statements including column names.".to_string(),
                },
                OptionField {
                    key: "extended_insert".to_string(),
                    label: "Extended INSERT".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Use multiple-row INSERT syntax for faster imports.".to_string(),
                },
                OptionField {
                    key: "quick".to_string(),
                    label: "Quick Mode".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Don't buffer results, dump directly from server. Useful for large tables.".to_string(),
                },
                OptionField {
                    key: "lock_tables".to_string(),
                    label: "Lock Tables".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Lock all tables before dumping. Disable for InnoDB with single-transaction.".to_string(),
                },
            ],
        }
    }

    /// Restore options - mariadb client has minimal options.
    fn restore_options(&self) -> RestoreOptionsSchema {
        RestoreOptionsSchema {
            common: vec![],
            advanced: vec![
                OptionField {
                    key: "force".to_string(),
                    label: "Force (Ignore Errors)".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Continue even if SQL errors occur during restore.".to_string(),
                },
            ],
        }
    }

    /// List tables and views in the current database.
    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError> {
        let mut conn = self.get_conn().await?;

        use mysql_async::prelude::*;

        // Get current database
        let db_name: Option<String> = conn
            .query_first("SELECT DATABASE()")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get database: {}", e)))?;

        let db_name = db_name.ok_or_else(|| {
            AppError::DatabaseError("No database selected".into())
        })?;

        let mut objects = Vec::new();

        // Query tables with row counts and sizes
        let table_query = format!(
            r#"
            SELECT
                TABLE_NAME,
                TABLE_TYPE,
                TABLE_ROWS,
                DATA_LENGTH + INDEX_LENGTH AS total_size
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = '{}'
            ORDER BY TABLE_TYPE, TABLE_NAME
            "#,
            db_name.replace('\'', "''")
        );

        let rows: Vec<(String, String, Option<u64>, Option<u64>)> = conn
            .query(table_query)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to list tables: {}", e)))?;

        for (name, table_type, row_count, estimated_size) in rows {
            let object_type = if table_type.contains("VIEW") {
                BackupObjectType::View
            } else {
                BackupObjectType::Table
            };

            objects.push(BackupObject {
                id: name.clone(),
                name,
                object_type,
                parent_id: Some(db_name.clone()),
                estimated_size,
                row_count,
            });
        }

        Ok(objects)
    }

    /// Parse a SQL dump file to preview its contents.
    async fn parse_backup_preview(&self, path: &Path) -> Result<BackupPreview, AppError> {
        let path = path.to_path_buf();

        tokio::task::spawn_blocking(move || {
            let file_name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let metadata = fs::metadata(&path)
                .map_err(|e| AppError::Io(format!("Failed to read file metadata: {}", e)))?;

            let file_size = metadata.len();

            // Parse SQL dump to extract table/view names
            let objects = parse_mysql_sql_dump(&path)?;

            // Try to extract creation date from dump header
            let created_at = extract_dump_date(&path);

            Ok(BackupPreview {
                file_name,
                file_size,
                database_type: "MySQL/MariaDB".to_string(),
                created_at,
                objects,
            })
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    /// Execute backup using mariadb-dump.
    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        // Get connection info
        let conn_info = self.get_connection_info().await?;

        // Send started message
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Find available dump tool
        let dump_tool = Self::find_dump_tool().await?;

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Starting backup of database '{}' using {}...", conn_info.database, dump_tool),
                is_error: false,
            })
            .await;

        // Build dump command (mysqldump or mariadb-dump)
        let mut cmd = Command::new(&dump_tool);

        // Connection options
        cmd.arg("-h").arg(&conn_info.host);
        cmd.arg("-P").arg(conn_info.port.to_string());
        cmd.arg("-u").arg(&conn_info.username);

        // Password handling - use environment variable for security
        if let Some(ref password) = conn_info.password {
            cmd.env("MYSQL_PWD", password);
        }

        // Parse backup options
        let single_transaction = config
            .options
            .get("single_transaction")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let routines = config
            .options
            .get("routines")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let triggers = config
            .options
            .get("triggers")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let events = config
            .options
            .get("events")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let add_drop_database = config
            .options
            .get("add_drop_database")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let add_drop_table = config
            .options
            .get("add_drop_table")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let complete_insert = config
            .options
            .get("complete_insert")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let extended_insert = config
            .options
            .get("extended_insert")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let quick = config
            .options
            .get("quick")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let lock_tables = config
            .options
            .get("lock_tables")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Apply options
        if single_transaction {
            cmd.arg("--single-transaction");
        }
        if routines {
            cmd.arg("--routines");
        }
        if triggers {
            cmd.arg("--triggers");
        }
        if events {
            cmd.arg("--events");
        }
        if add_drop_database {
            cmd.arg("--add-drop-database");
        }
        if add_drop_table {
            cmd.arg("--add-drop-table");
        }
        if complete_insert {
            cmd.arg("--complete-insert");
        }
        if extended_insert {
            cmd.arg("--extended-insert");
        } else {
            cmd.arg("--skip-extended-insert");
        }
        if quick {
            cmd.arg("--quick");
        }
        if lock_tables {
            cmd.arg("--lock-tables");
        } else {
            cmd.arg("--skip-lock-tables");
        }

        // Add result file option
        cmd.arg("--result-file").arg(&config.destination_path);

        // Add database name
        cmd.arg(&conn_info.database);

        // Add specific tables if selected
        if let Some(ref selected) = config.selected_objects {
            if !selected.is_empty() {
                for table in selected {
                    cmd.arg(table);
                }
            }
        }

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Destination: {}", config.destination_path),
                is_error: false,
            })
            .await;

        // Configure process for output capture
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to start {}: {}", dump_tool, e)))?;

        // Stream stderr for progress
        if let Some(stderr) = child.stderr.take() {
            let progress_clone = progress.clone();
            tokio::spawn(async move {
                let reader = TokioBufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = progress_clone
                        .send(BackupProgress::Output {
                            line,
                            is_error: true,
                        })
                        .await;
                }
            });
        }

        // Wait for process to complete
        let status = child
            .wait()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to wait for {}: {}", dump_tool, e)))?;

        if !status.success() {
            let code = status.code().unwrap_or(-1);
            return Err(AppError::DatabaseError(format!(
                "{} exited with code {}",
                dump_tool, code
            )));
        }

        // Get final file size for completion message
        let file_size = fs::metadata(&config.destination_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let _ = progress
            .send(BackupProgress::Progress {
                current: 100,
                total: 100,
                message: "Backup completed".to_string(),
            })
            .await;

        if progress
            .send(BackupProgress::Completed {
                message: format!(
                    "Backup completed successfully. Database '{}' backed up to {} ({} bytes)",
                    conn_info.database, config.destination_path, file_size
                ),
            })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        Ok(())
    }

    /// Execute restore using mariadb client.
    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        // Get connection info
        let conn_info = self.get_connection_info().await?;

        // Send started message
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Find available client tool
        let client_tool = Self::find_client_tool().await?;

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Starting restore to database '{}' using {}...", conn_info.database, client_tool),
                is_error: false,
            })
            .await;

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Source: {}", config.source_path),
                is_error: false,
            })
            .await;

        // Build client command (mysql or mariadb)
        let mut cmd = Command::new(&client_tool);

        // Connection options
        cmd.arg("-h").arg(&conn_info.host);
        cmd.arg("-P").arg(conn_info.port.to_string());
        cmd.arg("-u").arg(&conn_info.username);

        // Password handling - use environment variable for security
        if let Some(ref password) = conn_info.password {
            cmd.env("MYSQL_PWD", password);
        }

        // Parse restore options
        let force = config
            .options
            .get("force")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if force {
            cmd.arg("--force");
        }

        // Database name
        cmd.arg(&conn_info.database);

        // Open the SQL file for stdin
        let file = fs::File::open(&config.source_path)
            .map_err(|e| AppError::Io(format!("Failed to open backup file: {}", e)))?;

        let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);

        // Configure process
        cmd.stdin(Stdio::from(file));
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to start {}: {}", client_tool, e)))?;

        // Stream stderr for progress
        if let Some(stderr) = child.stderr.take() {
            let progress_clone = progress.clone();
            tokio::spawn(async move {
                let reader = TokioBufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = progress_clone
                        .send(BackupProgress::Output {
                            line,
                            is_error: true,
                        })
                        .await;
                }
            });
        }

        // Wait for process to complete
        let status = child
            .wait()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to wait for {}: {}", client_tool, e)))?;

        if !status.success() {
            let code = status.code().unwrap_or(-1);
            return Err(AppError::DatabaseError(format!(
                "{} exited with code {}",
                client_tool, code
            )));
        }

        let _ = progress
            .send(BackupProgress::Progress {
                current: 100,
                total: 100,
                message: "Restore completed".to_string(),
            })
            .await;

        if progress
            .send(BackupProgress::Completed {
                message: format!(
                    "Restore completed successfully. {} bytes restored to database '{}'",
                    file_size, conn_info.database
                ),
            })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        Ok(())
    }
}

// ============ Helper Functions ============

/// Parse a MySQL/MariaDB SQL dump file to extract object names.
fn parse_mysql_sql_dump(path: &Path) -> Result<Vec<BackupPreviewObject>, AppError> {
    let file =
        fs::File::open(path).map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;

    let reader = BufReader::new(file);
    let mut objects = Vec::new();
    let mut seen_names = HashSet::new();

    for line in reader.lines() {
        let line = line.map_err(|e| AppError::Io(format!("Failed to read line: {}", e)))?;
        let trimmed = line.trim();

        // Look for CREATE TABLE statements
        if trimmed.to_uppercase().starts_with("CREATE TABLE") {
            if let Some(name) = extract_mysql_table_name(trimmed) {
                if seen_names.insert(name.clone()) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "table".to_string(),
                        row_count: None,
                    });
                }
            }
        }
        // Look for CREATE VIEW statements
        else if trimmed.to_uppercase().starts_with("CREATE")
            && trimmed.to_uppercase().contains("VIEW")
        {
            if let Some(name) = extract_mysql_view_name(trimmed) {
                if seen_names.insert(name.clone()) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "view".to_string(),
                        row_count: None,
                    });
                }
            }
        }
        // Look for CREATE PROCEDURE statements
        else if trimmed.to_uppercase().starts_with("CREATE")
            && trimmed.to_uppercase().contains("PROCEDURE")
        {
            if let Some(name) = extract_mysql_routine_name(trimmed, "PROCEDURE") {
                if seen_names.insert(name.clone()) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "procedure".to_string(),
                        row_count: None,
                    });
                }
            }
        }
        // Look for CREATE FUNCTION statements
        else if trimmed.to_uppercase().starts_with("CREATE")
            && trimmed.to_uppercase().contains("FUNCTION")
        {
            if let Some(name) = extract_mysql_routine_name(trimmed, "FUNCTION") {
                if seen_names.insert(name.clone()) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "function".to_string(),
                        row_count: None,
                    });
                }
            }
        }
    }

    Ok(objects)
}

/// Extract table name from CREATE TABLE statement.
/// Handles: CREATE TABLE `name`, CREATE TABLE IF NOT EXISTS `name`
fn extract_mysql_table_name(line: &str) -> Option<String> {
    let upper = line.to_uppercase();
    let start = upper.find("CREATE TABLE")?;
    let rest = &line[start + 12..].trim_start();

    // Handle IF NOT EXISTS
    let rest = if rest.to_uppercase().starts_with("IF NOT EXISTS") {
        rest[13..].trim_start()
    } else {
        rest
    };

    extract_mysql_identifier(rest)
}

/// Extract view name from CREATE VIEW statement.
/// Handles: CREATE VIEW `name`, CREATE OR REPLACE VIEW `name`, CREATE ALGORITHM=... VIEW `name`
fn extract_mysql_view_name(line: &str) -> Option<String> {
    let upper = line.to_uppercase();

    // Find VIEW keyword
    let view_pos = upper.find(" VIEW ")?;
    let rest = &line[view_pos + 6..].trim_start();

    // Handle IF NOT EXISTS after VIEW
    let rest = if rest.to_uppercase().starts_with("IF NOT EXISTS") {
        rest[13..].trim_start()
    } else {
        rest
    };

    extract_mysql_identifier(rest)
}

/// Extract routine name from CREATE PROCEDURE/FUNCTION statement.
fn extract_mysql_routine_name(line: &str, keyword: &str) -> Option<String> {
    let upper = line.to_uppercase();
    let keyword_upper = format!(" {} ", keyword);

    let pos = upper.find(&keyword_upper)?;
    let rest = &line[pos + keyword.len() + 2..].trim_start();

    extract_mysql_identifier(rest)
}

/// Extract a MySQL identifier from the start of a string.
/// Handles backtick-quoted (`name`) and unquoted identifiers.
fn extract_mysql_identifier(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    if s.starts_with('`') {
        // Backtick-quoted identifier
        let end = s[1..].find('`')?;
        Some(s[1..=end].to_string())
    } else if s.starts_with('"') {
        // Double-quote identifier (ANSI SQL mode)
        let end = s[1..].find('"')?;
        Some(s[1..=end].to_string())
    } else {
        // Unquoted identifier - ends at whitespace or (
        let end = s
            .find(|c: char| c.is_whitespace() || c == '(' || c == ';')
            .unwrap_or(s.len());
        if end > 0 {
            Some(s[..end].to_string())
        } else {
            None
        }
    }
}

/// Extract dump creation date from MySQL dump header.
fn extract_dump_date(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    // Read first 50 lines looking for date comment
    for line in reader.lines().take(50) {
        let line = line.ok()?;

        // Look for patterns like:
        // -- Dump completed on 2024-01-15 10:30:45
        // -- Server version: 8.0.32
        if line.contains("Dump completed on") {
            if let Some(date_start) = line.find("on ") {
                let date_str = line[date_start + 3..].trim();
                return Some(date_str.to_string());
            }
        }

        // Also check for mariadb-dump date format
        // -- Dumped by mariadb-dump on 2024-01-15
        if line.contains("mariadb-dump") && line.contains(" on ") {
            if let Some(date_start) = line.rfind(" on ") {
                let date_str = line[date_start + 4..].trim();
                return Some(date_str.to_string());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_formats() {
        let adapter = MySqlAdapter::new();
        let formats = adapter.supported_formats();

        assert_eq!(formats.len(), 1);
        assert_eq!(formats[0].id, "sql");
        assert_eq!(formats[0].extension, "sql");
    }

    #[test]
    fn test_tool_requirements() {
        let adapter = MySqlAdapter::new();
        let requirements = adapter.tool_requirements();

        assert_eq!(requirements.len(), 1);
        assert_eq!(requirements[0].name, "mysqldump");
        assert_eq!(requirements[0].purpose, ToolPurpose::Backup);
    }

    #[test]
    fn test_backup_options() {
        let adapter = MySqlAdapter::new();
        let options = adapter.backup_options();

        // Should have single_transaction, routines, triggers in common
        assert!(options.common.iter().any(|o| o.key == "single_transaction"));
        assert!(options.common.iter().any(|o| o.key == "routines"));
        assert!(options.common.iter().any(|o| o.key == "triggers"));

        // Should have events, add_drop_table, etc. in advanced
        assert!(options.advanced.iter().any(|o| o.key == "events"));
        assert!(options.advanced.iter().any(|o| o.key == "add_drop_table"));
        assert!(options.advanced.iter().any(|o| o.key == "extended_insert"));
    }

    #[test]
    fn test_restore_options() {
        let adapter = MySqlAdapter::new();
        let options = adapter.restore_options();

        // Should have force option in advanced
        assert!(options.advanced.iter().any(|o| o.key == "force"));
    }

    #[test]
    fn test_extract_mysql_table_name() {
        assert_eq!(
            extract_mysql_table_name("CREATE TABLE `users` ("),
            Some("users".to_string())
        );
        assert_eq!(
            extract_mysql_table_name("CREATE TABLE IF NOT EXISTS `orders` ("),
            Some("orders".to_string())
        );
        assert_eq!(
            extract_mysql_table_name("CREATE TABLE products ("),
            Some("products".to_string())
        );
        assert_eq!(
            extract_mysql_table_name("CREATE TABLE \"quoted\" ("),
            Some("quoted".to_string())
        );
    }

    #[test]
    fn test_extract_mysql_view_name() {
        assert_eq!(
            extract_mysql_view_name("CREATE VIEW `user_summary` AS"),
            Some("user_summary".to_string())
        );
        assert_eq!(
            extract_mysql_view_name("CREATE OR REPLACE VIEW `stats` AS"),
            Some("stats".to_string())
        );
        assert_eq!(
            extract_mysql_view_name("CREATE ALGORITHM=MERGE VIEW active_users AS"),
            Some("active_users".to_string())
        );
    }

    #[test]
    fn test_extract_mysql_identifier() {
        assert_eq!(
            extract_mysql_identifier("`my_table` ("),
            Some("my_table".to_string())
        );
        assert_eq!(
            extract_mysql_identifier("plain_name ("),
            Some("plain_name".to_string())
        );
        assert_eq!(
            extract_mysql_identifier("\"ansi_quoted\""),
            Some("ansi_quoted".to_string())
        );
    }
}
