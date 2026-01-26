//! SQLite backup implementation using native rusqlite backup API.
//!
//! SQLite is a "native" implementation - it uses the `rusqlite::backup::Backup` API
//! directly rather than shelling out to external tools.

use async_trait::async_trait;
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde_json::json;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::time::Duration;

use crate::core::backup_capability::{
    BackupCapable, BackupConfig, BackupFormat, BackupObject, BackupObjectType,
    BackupOptionsSchema, BackupPreview, BackupPreviewObject, FieldType, OptionField,
    ProgressSender, RestoreConfig, RestoreOptionsSchema, ToolRequirement,
};
use crate::core::backup_capability::BackupProgress;
use crate::error::AppError;

use super::SqliteAdapter;

#[async_trait]
impl BackupCapable for SqliteAdapter {
    /// SQLite uses native Rust implementation, no external tools required.
    fn tool_requirements(&self) -> Vec<ToolRequirement> {
        vec![]
    }

    /// SQLite supports binary (.db) and SQL (.sql) backup formats.
    fn supported_formats(&self) -> Vec<BackupFormat> {
        vec![
            BackupFormat {
                id: "binary".to_string(),
                name: "Binary Database".to_string(),
                extension: "db".to_string(),
                description: "Native SQLite binary format. Fast, compact, preserves all data types exactly.".to_string(),
            },
            BackupFormat {
                id: "sql".to_string(),
                name: "SQL Dump".to_string(),
                extension: "sql".to_string(),
                description: "Human-readable SQL statements. Portable across SQLite versions.".to_string(),
            },
        ]
    }

    /// Backup options schema - SQLite has minimal options.
    fn backup_options(&self) -> BackupOptionsSchema {
        BackupOptionsSchema {
            common: vec![],
            advanced: vec![OptionField {
                key: "pages_per_step".to_string(),
                label: "Pages per Step".to_string(),
                field_type: FieldType::Number {
                    min: Some(1.0),
                    max: Some(1000.0),
                },
                default: json!(100),
                description: "Number of pages to copy per backup step. Higher values are faster but use more memory.".to_string(),
            }],
        }
    }

    /// Restore options - SQLite restore has no additional options.
    fn restore_options(&self) -> RestoreOptionsSchema {
        RestoreOptionsSchema {
            common: vec![],
            advanced: vec![],
        }
    }

    /// List tables and views that can be backed up.
    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError> {
        let conn = self.get_connection();

        tokio::task::spawn_blocking(move || {
            let guard = conn.blocking_lock();
            let conn = guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

            let mut objects = Vec::new();

            // Query sqlite_master for tables
            let mut stmt = conn
                .prepare(
                    "SELECT name, type FROM sqlite_master
                     WHERE type IN ('table', 'view')
                     AND name NOT LIKE 'sqlite_%'
                     ORDER BY type, name",
                )
                .map_err(|e| AppError::DatabaseError(format!("Failed to query objects: {}", e)))?;

            let rows = stmt
                .query_map([], |row: &rusqlite::Row| {
                    let name: String = row.get(0)?;
                    let obj_type: String = row.get(1)?;
                    Ok((name, obj_type))
                })
                .map_err(|e| AppError::DatabaseError(format!("Failed to query objects: {}", e)))?;

            for row in rows {
                let (name, obj_type): (String, String) =
                    row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?;

                // Get row count for tables (not views)
                let (row_count, estimated_size) = if obj_type == "table" {
                    // Try to get row count
                    let count: Option<u64> = conn
                        .query_row(
                            &format!("SELECT COUNT(*) FROM \"{}\"", name.replace('"', "\"\"")),
                            [],
                            |r: &rusqlite::Row| r.get(0),
                        )
                        .ok();

                    // Estimate size based on page count (if available)
                    let size: Option<u64> = conn
                        .query_row(
                            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
                            [],
                            |r: &rusqlite::Row| r.get(0),
                        )
                        .ok();

                    (count, size)
                } else {
                    (None, None)
                };

                let object_type = match obj_type.as_str() {
                    "table" => BackupObjectType::Table,
                    "view" => BackupObjectType::View,
                    _ => BackupObjectType::Table,
                };

                objects.push(BackupObject {
                    id: name.clone(),
                    name,
                    object_type,
                    parent_id: None, // SQLite doesn't have schemas
                    estimated_size,
                    row_count,
                });
            }

            Ok(objects)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    /// Parse a backup file to preview its contents.
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

            // Determine format by extension
            let extension = path
                .extension()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            let objects = match extension.as_str() {
                "db" | "sqlite" | "sqlite3" => {
                    // Binary SQLite file - open and list tables
                    parse_binary_backup(&path)?
                }
                "sql" => {
                    // SQL dump - parse CREATE TABLE statements
                    parse_sql_backup(&path)?
                }
                _ => {
                    // Try binary first, fall back to SQL
                    parse_binary_backup(&path).or_else(|_| parse_sql_backup(&path))?
                }
            };

            Ok(BackupPreview {
                file_name,
                file_size,
                database_type: "SQLite".to_string(),
                created_at: None, // SQLite doesn't store creation time in the file
                objects,
            })
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    /// Execute backup using rusqlite's native backup API.
    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let conn = self.get_connection();
        let destination_path = config.destination_path.clone();
        let format = config.format.clone();
        let selected_objects = config.selected_objects.clone();

        // Parse options
        let pages_per_step = config
            .options
            .get("pages_per_step")
            .and_then(|v| v.as_u64())
            .unwrap_or(100) as i32;

        tokio::task::spawn_blocking(move || {
            let guard = conn.blocking_lock();
            let source_conn = guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

            // Send started message - check for cancellation
            if progress
                .blocking_send(BackupProgress::Started { total_steps: None })
                .is_err()
            {
                return Err(AppError::InvalidInput("Operation cancelled".into()));
            }

            match format.as_str() {
                "binary" => {
                    execute_binary_backup(source_conn, &destination_path, pages_per_step, &progress)
                }
                "sql" => execute_sql_backup(
                    source_conn,
                    &destination_path,
                    selected_objects.as_deref(),
                    &progress,
                ),
                _ => Err(AppError::InvalidInput(format!(
                    "Unsupported backup format: {}",
                    format
                ))),
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    /// Execute restore using rusqlite's native backup API.
    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let conn = self.get_connection();
        let db_path = self.get_db_path();
        let source_path = config.source_path.clone();

        tokio::task::spawn_blocking(move || {
            // Determine format by extension
            let path = Path::new(&source_path);
            let extension = path
                .extension()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            // Send started message - check for cancellation
            if progress
                .blocking_send(BackupProgress::Started { total_steps: None })
                .is_err()
            {
                return Err(AppError::InvalidInput("Operation cancelled".into()));
            }

            match extension.as_str() {
                "db" | "sqlite" | "sqlite3" => {
                    // Binary restore using backup API (restore from file to connected db)
                    // Get the destination path from the adapter's db_path
                    let db_path_guard = db_path.blocking_lock();
                    let dest_path = db_path_guard
                        .as_ref()
                        .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?
                        .clone();

                    // We don't need the connection for binary restore - we open fresh connections
                    drop(db_path_guard);

                    execute_binary_restore(&source_path, &dest_path, &progress)
                }
                "sql" => {
                    // SQL restore - execute SQL statements
                    let guard = conn.blocking_lock();
                    let dest_conn = guard
                        .as_ref()
                        .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

                    execute_sql_restore(&source_path, dest_conn, &progress)
                }
                _ => {
                    // Try binary first, fall back to SQL
                    // Get the destination path from the adapter's db_path for binary restore
                    let db_path_guard = db_path.blocking_lock();
                    let dest_path = db_path_guard
                        .as_ref()
                        .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?
                        .clone();
                    drop(db_path_guard);

                    execute_binary_restore(&source_path, &dest_path, &progress).or_else(|_| {
                        let guard = conn.blocking_lock();
                        let dest_conn = guard
                            .as_ref()
                            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

                        execute_sql_restore(&source_path, dest_conn, &progress)
                    })
                }
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }
}

// ============ Helper Functions ============

/// Parse a binary SQLite backup file to list its contents.
fn parse_binary_backup(path: &Path) -> Result<Vec<BackupPreviewObject>, AppError> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| AppError::Io(format!("Failed to open backup file: {}", e)))?;

    let mut stmt = conn
        .prepare(
            "SELECT name, type FROM sqlite_master
             WHERE type IN ('table', 'view')
             AND name NOT LIKE 'sqlite_%'
             ORDER BY type, name",
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to query backup: {}", e)))?;

    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            let obj_type: String = row.get(1)?;
            Ok((name, obj_type))
        })
        .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

    let mut objects = Vec::new();
    for row in rows {
        let (name, obj_type) =
            row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?;

        // Try to get row count for tables
        let row_count = if obj_type == "table" {
            conn.query_row(
                &format!("SELECT COUNT(*) FROM \"{}\"", name.replace('"', "\"\"")),
                [],
                |r| r.get(0),
            )
            .ok()
        } else {
            None
        };

        objects.push(BackupPreviewObject {
            name,
            object_type: obj_type,
            row_count,
        });
    }

    Ok(objects)
}

/// Parse a SQL dump file to extract table names from CREATE TABLE statements.
fn parse_sql_backup(path: &Path) -> Result<Vec<BackupPreviewObject>, AppError> {
    let file =
        fs::File::open(path).map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;

    let reader = BufReader::new(file);
    let mut objects = Vec::new();
    let mut seen_tables = std::collections::HashSet::new();

    for line in reader.lines() {
        let line = line.map_err(|e| AppError::Io(format!("Failed to read line: {}", e)))?;
        let upper = line.to_uppercase();

        // Look for CREATE TABLE statements
        if upper.contains("CREATE TABLE") {
            if let Some(name) = extract_table_name(&line) {
                if !name.starts_with("sqlite_") && seen_tables.insert(name.clone()) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "table".to_string(),
                        row_count: None,
                    });
                }
            }
        }
        // Look for CREATE VIEW statements
        else if upper.contains("CREATE VIEW") {
            if let Some(name) = extract_view_name(&line) {
                if seen_tables.insert(name.clone()) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "view".to_string(),
                        row_count: None,
                    });
                }
            }
        }
    }

    Ok(objects)
}

/// Extract table name from a CREATE TABLE statement.
fn extract_table_name(line: &str) -> Option<String> {
    // Patterns: CREATE TABLE name, CREATE TABLE "name", CREATE TABLE IF NOT EXISTS name
    let upper = line.to_uppercase();
    let start = upper.find("CREATE TABLE")?;
    let rest = &line[start + 12..].trim_start();

    // Handle IF NOT EXISTS
    let rest = if rest.to_uppercase().starts_with("IF NOT EXISTS") {
        rest[13..].trim_start()
    } else {
        rest
    };

    // Extract name (handles quoted identifiers)
    extract_identifier(rest)
}

/// Extract view name from a CREATE VIEW statement.
fn extract_view_name(line: &str) -> Option<String> {
    let upper = line.to_uppercase();
    let start = upper.find("CREATE VIEW")?;
    let rest = &line[start + 11..].trim_start();

    // Handle IF NOT EXISTS
    let rest = if rest.to_uppercase().starts_with("IF NOT EXISTS") {
        rest[13..].trim_start()
    } else {
        rest
    };

    extract_identifier(rest)
}

/// Extract an identifier (table/view name) from the start of a string.
fn extract_identifier(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    if s.starts_with('"') {
        // Quoted identifier
        let end = s[1..].find('"')?;
        Some(s[1..=end].to_string())
    } else if s.starts_with('[') {
        // Bracket-quoted identifier (SQL Server style, sometimes used in SQLite)
        let end = s[1..].find(']')?;
        Some(s[1..=end].to_string())
    } else if s.starts_with('`') {
        // Backtick-quoted identifier (MySQL style)
        let end = s[1..].find('`')?;
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

/// Execute binary backup using rusqlite's Backup API.
fn execute_binary_backup(
    source_conn: &Connection,
    destination_path: &str,
    pages_per_step: i32,
    progress: &ProgressSender,
) -> Result<(), AppError> {
    use rusqlite::backup::StepResult;

    // Create/open destination database
    let mut dest_conn = Connection::open(destination_path)
        .map_err(|e| AppError::Io(format!("Failed to create backup file: {}", e)))?;

    // Create backup object
    let backup = Backup::new(source_conn, &mut dest_conn)
        .map_err(|e| AppError::DatabaseError(format!("Failed to initialize backup: {}", e)))?;

    let _ = progress.blocking_send(BackupProgress::Output {
        line: "Starting binary backup...".to_string(),
        is_error: false,
    });

    // Perform backup in steps
    loop {
        let result = backup
            .step(pages_per_step)
            .map_err(|e| AppError::DatabaseError(format!("Backup step failed: {}", e)))?;

        // Get progress info
        let prog = backup.progress();
        let total = prog.pagecount;
        let remaining = prog.remaining;

        if total > 0 {
            let current = (total - remaining) as u32;
            // Check for cancellation on progress updates
            if progress
                .blocking_send(BackupProgress::Progress {
                    current,
                    total: total as u32,
                    message: format!("Copied {} pages", current),
                })
                .is_err()
            {
                return Err(AppError::InvalidInput("Operation cancelled".into()));
            }
        }

        match result {
            StepResult::Done => break,
            StepResult::More => {
                // Small sleep to avoid overwhelming the progress channel
                std::thread::sleep(Duration::from_millis(10));
            }
            StepResult::Busy | StepResult::Locked => {
                // Database is busy or locked, wait and retry
                std::thread::sleep(Duration::from_millis(100));
            }
            _ => {
                // Handle any future variants
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }

    let prog = backup.progress();
    // Check for cancellation on completion
    if progress
        .blocking_send(BackupProgress::Completed {
            message: format!(
                "Backup completed successfully: {} pages copied",
                prog.pagecount
            ),
        })
        .is_err()
    {
        return Err(AppError::InvalidInput("Operation cancelled".into()));
    }

    Ok(())
}

/// Execute SQL dump backup.
fn execute_sql_backup(
    conn: &Connection,
    destination_path: &str,
    selected_objects: Option<&[String]>,
    progress: &ProgressSender,
) -> Result<(), AppError> {
    let mut file = fs::File::create(destination_path)
        .map_err(|e| AppError::Io(format!("Failed to create backup file: {}", e)))?;

    let _ = progress.blocking_send(BackupProgress::Output {
        line: "Starting SQL dump...".to_string(),
        is_error: false,
    });

    // Write header
    writeln!(file, "-- SQLite SQL Dump").map_err(|e| AppError::Io(e.to_string()))?;
    writeln!(file, "-- Generated by Query Pilot").map_err(|e| AppError::Io(e.to_string()))?;
    writeln!(file, "PRAGMA foreign_keys=OFF;").map_err(|e| AppError::Io(e.to_string()))?;
    writeln!(file, "BEGIN TRANSACTION;").map_err(|e| AppError::Io(e.to_string()))?;
    writeln!(file).map_err(|e| AppError::Io(e.to_string()))?;

    // Get list of tables
    let mut stmt = conn
        .prepare(
            "SELECT name, sql FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name",
        )
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let tables: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    let total_tables = tables.len();
    let mut current_table = 0;

    for (name, create_sql) in tables {
        // Skip if not in selected objects (if selection is provided)
        if let Some(selected) = selected_objects {
            if !selected.iter().any(|s| s == &name) {
                continue;
            }
        }

        current_table += 1;

        // Check for cancellation on progress updates
        if progress
            .blocking_send(BackupProgress::Progress {
                current: current_table as u32,
                total: total_tables as u32,
                message: format!("Dumping table: {}", name),
            })
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Write CREATE TABLE statement
        writeln!(file, "-- Table: {}", name).map_err(|e| AppError::Io(e.to_string()))?;
        writeln!(file, "DROP TABLE IF EXISTS \"{}\";", name.replace('"', "\"\""))
            .map_err(|e| AppError::Io(e.to_string()))?;
        writeln!(file, "{};", create_sql).map_err(|e| AppError::Io(e.to_string()))?;

        // Dump data
        let row_count = dump_table_data(conn, &name, &mut file)?;

        let _ = progress.blocking_send(BackupProgress::Output {
            line: format!("Table {}: {} rows dumped", name, row_count),
            is_error: false,
        });

        writeln!(file).map_err(|e| AppError::Io(e.to_string()))?;
    }

    // Dump views
    let mut stmt = conn
        .prepare(
            "SELECT name, sql FROM sqlite_master
             WHERE type = 'view' AND name NOT LIKE 'sqlite_%'
             ORDER BY name",
        )
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let views: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    for (name, create_sql) in views {
        if let Some(selected) = selected_objects {
            if !selected.iter().any(|s| s == &name) {
                continue;
            }
        }

        writeln!(file, "-- View: {}", name).map_err(|e| AppError::Io(e.to_string()))?;
        writeln!(file, "DROP VIEW IF EXISTS \"{}\";", name.replace('"', "\"\""))
            .map_err(|e| AppError::Io(e.to_string()))?;
        writeln!(file, "{};", create_sql).map_err(|e| AppError::Io(e.to_string()))?;
        writeln!(file).map_err(|e| AppError::Io(e.to_string()))?;
    }

    // Dump indexes
    let mut stmt = conn
        .prepare(
            "SELECT name, sql FROM sqlite_master
             WHERE type = 'index' AND sql IS NOT NULL
             ORDER BY name",
        )
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let indexes: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    if !indexes.is_empty() {
        writeln!(file, "-- Indexes").map_err(|e| AppError::Io(e.to_string()))?;
        for (_name, create_sql) in indexes {
            writeln!(file, "{};", create_sql).map_err(|e| AppError::Io(e.to_string()))?;
        }
        writeln!(file).map_err(|e| AppError::Io(e.to_string()))?;
    }

    // Dump triggers
    let mut stmt = conn
        .prepare(
            "SELECT name, sql FROM sqlite_master
             WHERE type = 'trigger' AND sql IS NOT NULL
             ORDER BY name",
        )
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let triggers: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    if !triggers.is_empty() {
        writeln!(file, "-- Triggers").map_err(|e| AppError::Io(e.to_string()))?;
        for (_name, create_sql) in triggers {
            writeln!(file, "{};", create_sql).map_err(|e| AppError::Io(e.to_string()))?;
        }
        writeln!(file).map_err(|e| AppError::Io(e.to_string()))?;
    }

    // Write footer
    writeln!(file, "COMMIT;").map_err(|e| AppError::Io(e.to_string()))?;
    writeln!(file, "PRAGMA foreign_keys=ON;").map_err(|e| AppError::Io(e.to_string()))?;

    // Check for cancellation on completion
    if progress
        .blocking_send(BackupProgress::Completed {
            message: "SQL dump completed successfully".to_string(),
        })
        .is_err()
    {
        return Err(AppError::InvalidInput("Operation cancelled".into()));
    }

    Ok(())
}

/// Dump table data as INSERT statements.
fn dump_table_data(
    conn: &Connection,
    table_name: &str,
    file: &mut fs::File,
) -> Result<u64, AppError> {
    let quoted_name = format!("\"{}\"", table_name.replace('"', "\"\""));
    let query = format!("SELECT * FROM {}", quoted_name);

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let column_count = stmt.column_count();
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();

    let mut rows = stmt
        .query([])
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut row_count = 0u64;

    while let Some(row) = rows
        .next()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
    {
        let mut values = Vec::with_capacity(column_count);

        for i in 0..column_count {
            let value = row.get_ref(i).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            values.push(format_sql_value(value));
        }

        writeln!(
            file,
            "INSERT INTO {} ({}) VALUES ({});",
            quoted_name,
            column_names
                .iter()
                .map(|n| format!("\"{}\"", n.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(", "),
            values.join(", ")
        )
        .map_err(|e| AppError::Io(e.to_string()))?;

        row_count += 1;
    }

    Ok(row_count)
}

/// Format a SQLite value for SQL output.
fn format_sql_value(value: rusqlite::types::ValueRef) -> String {
    use rusqlite::types::ValueRef;

    match value {
        ValueRef::Null => "NULL".to_string(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Text(s) => {
            let s = String::from_utf8_lossy(s);
            format!("'{}'", s.replace('\'', "''"))
        }
        ValueRef::Blob(b) => {
            // Format as X'hexstring'
            let hex: String = b.iter().map(|byte| format!("{:02X}", byte)).collect();
            format!("X'{}'", hex)
        }
    }
}

/// Execute binary restore using rusqlite's Backup API.
/// Opens fresh connections to both source (backup file) and destination (adapter's db).
/// This avoids race conditions with the adapter's active connection.
fn execute_binary_restore(
    source_path: &str,
    dest_path: &std::path::PathBuf,
    progress: &ProgressSender,
) -> Result<(), AppError> {
    use rusqlite::backup::StepResult;

    // Validate destination path
    let dest_path_str = dest_path.to_string_lossy();
    if dest_path_str.is_empty() || dest_path_str == ":memory:" {
        return Err(AppError::InvalidInput(
            "Cannot restore to in-memory database".to_string(),
        ));
    }

    // Open source database (the backup file) - read only
    let source_conn = Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| AppError::Io(format!("Failed to open backup file: {}", e)))?;

    let _ = progress.blocking_send(BackupProgress::Output {
        line: "Starting binary restore...".to_string(),
        is_error: false,
    });

    // Open a fresh mutable connection to the destination database
    let mut dest_conn = Connection::open(dest_path)
        .map_err(|e| AppError::Io(format!("Failed to open destination database: {}", e)))?;

    // Create backup object (source -> dest)
    let backup = Backup::new(&source_conn, &mut dest_conn)
        .map_err(|e| AppError::DatabaseError(format!("Failed to initialize restore: {}", e)))?;

    loop {
        let result = backup
            .step(100)
            .map_err(|e| AppError::DatabaseError(format!("Restore step failed: {}", e)))?;

        let prog = backup.progress();
        let total = prog.pagecount;
        let remaining = prog.remaining;

        if total > 0 {
            let current = (total - remaining) as u32;
            // Check for cancellation on progress updates
            if progress
                .blocking_send(BackupProgress::Progress {
                    current,
                    total: total as u32,
                    message: format!("Restored {} pages", current),
                })
                .is_err()
            {
                return Err(AppError::InvalidInput("Operation cancelled".into()));
            }
        }

        match result {
            StepResult::Done => break,
            StepResult::More => {
                std::thread::sleep(Duration::from_millis(10));
            }
            StepResult::Busy | StepResult::Locked => {
                std::thread::sleep(Duration::from_millis(100));
            }
            _ => {
                // Handle any future variants
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }

    let prog = backup.progress();
    // Check for cancellation on completion
    if progress
        .blocking_send(BackupProgress::Completed {
            message: format!(
                "Restore completed successfully: {} pages restored",
                prog.pagecount
            ),
        })
        .is_err()
    {
        return Err(AppError::InvalidInput("Operation cancelled".into()));
    }

    Ok(())
}

/// Execute SQL restore by executing SQL statements from file.
fn execute_sql_restore(
    source_path: &str,
    conn: &Connection,
    progress: &ProgressSender,
) -> Result<(), AppError> {
    let content = fs::read_to_string(source_path)
        .map_err(|e| AppError::Io(format!("Failed to read backup file: {}", e)))?;

    let _ = progress.blocking_send(BackupProgress::Output {
        line: "Starting SQL restore...".to_string(),
        is_error: false,
    });

    // Count statements for progress
    let statements: Vec<&str> = content
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && !s.starts_with("--"))
        .collect();

    let total = statements.len();

    // Execute as a batch for better performance and atomicity
    conn.execute_batch(&content)
        .map_err(|e| AppError::DatabaseError(format!("SQL restore failed: {}", e)))?;

    let _ = progress.blocking_send(BackupProgress::Progress {
        current: total as u32,
        total: total as u32,
        message: format!("Executed {} statements", total),
    });

    // Check for cancellation on completion
    if progress
        .blocking_send(BackupProgress::Completed {
            message: format!(
                "SQL restore completed successfully: {} statements executed",
                total
            ),
        })
        .is_err()
    {
        return Err(AppError::InvalidInput("Operation cancelled".into()));
    }

    Ok(())
}
