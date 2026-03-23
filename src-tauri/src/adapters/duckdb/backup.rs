//! DuckDB backup implementation using file copy (binary) and EXPORT DATABASE (SQL).

use async_trait::async_trait;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::core::backup_capability::{
    BackupCapable, BackupConfig, BackupFormat, BackupObject, BackupObjectType, BackupOptionsSchema,
    BackupPreview, BackupPreviewObject, ProgressSender, RestoreConfig, RestoreOptionsSchema,
    ToolRequirement,
};
use crate::error::AppError;

use super::DuckDbAdapter;

impl DuckDbAdapter {
    /// Disconnect internal: clears the connection but preserves db_path
    /// so we can reconnect or copy files while knowing where the DB lives.
    async fn disconnect_internal(&self) -> Result<(), AppError> {
        let conn = self.connection.lock().await.take();
        if let Some(conn) = conn {
            tokio::task::spawn_blocking(move || {
                drop(conn);
            })
            .await
            .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?;
        }
        Ok(())
    }

    /// Reconnect to the database using the stored db_path.
    async fn reconnect_internal(&self) -> Result<(), AppError> {
        use duckdb::{AccessMode, Config, Connection};

        let db_path = {
            let guard = self.db_path.lock().await;
            guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("No db_path stored".into()))?
                .clone()
        };

        let conn = tokio::task::spawn_blocking(move || {
            let config = Config::default()
                .access_mode(AccessMode::ReadWrite)
                .map_err(|e| {
                    AppError::Internal(format!("Failed to set DuckDB access mode: {}", e))
                })?
                .enable_autoload_extension(true)
                .map_err(|e| {
                    AppError::Internal(format!("Failed to enable autoload extension: {}", e))
                })?;

            let conn = Connection::open_with_flags(db_path, config).map_err(|e| {
                AppError::DatabaseError(format!("Failed to reconnect DuckDB: {}", e))
            })?;

            Self::bootstrap_connection(&conn)?;
            Ok::<Connection, AppError>(conn)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))??;

        *self.connection.lock().await = Some(conn);
        Ok(())
    }
}

#[async_trait]
impl BackupCapable for DuckDbAdapter {
    fn tool_requirements(&self) -> Vec<ToolRequirement> {
        vec![]
    }

    fn supported_formats(&self) -> Vec<BackupFormat> {
        vec![
            BackupFormat {
                id: "binary".to_string(),
                name: "Binary Database".to_string(),
                extension: "duckdb".to_string(),
                description:
                    "Native DuckDB binary format. Fast file copy, preserves all data exactly."
                        .to_string(),
            },
            BackupFormat {
                id: "sql".to_string(),
                name: "SQL Export".to_string(),
                extension: "sql".to_string(),
                description:
                    "SQL schema + CSV data via EXPORT DATABASE. Portable across DuckDB versions."
                        .to_string(),
            },
        ]
    }

    fn backup_options(&self) -> BackupOptionsSchema {
        BackupOptionsSchema {
            common: vec![],
            advanced: vec![],
        }
    }

    fn restore_options(&self) -> RestoreOptionsSchema {
        RestoreOptionsSchema {
            common: vec![],
            advanced: vec![],
        }
    }

    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError> {
        let conn = self.connection.clone();

        tokio::task::spawn_blocking(move || {
            let guard = conn.blocking_lock();
            let conn = guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

            let mut objects = Vec::new();

            // Query tables
            let mut stmt = conn
                .prepare(
                    "SELECT schema_name, table_name, estimated_size, column_count
                     FROM duckdb_tables()
                     WHERE NOT internal
                     ORDER BY schema_name, table_name",
                )
                .map_err(|e| AppError::DatabaseError(format!("Failed to query tables: {}", e)))?;

            let table_rows = stmt
                .query_map([], |row| {
                    let schema_name: String = row.get(0)?;
                    let table_name: String = row.get(1)?;
                    let estimated_size: Option<i64> = row.get(2)?;
                    let _column_count: Option<i64> = row.get(3)?;
                    Ok((schema_name, table_name, estimated_size))
                })
                .map_err(|e| AppError::DatabaseError(format!("Failed to query tables: {}", e)))?;

            // Collect schemas we've seen
            let mut seen_schemas = std::collections::HashSet::new();

            for row in table_rows {
                let (schema_name, table_name, estimated_size) =
                    row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?;

                // Add schema as a parent object if first time seeing it
                if seen_schemas.insert(schema_name.clone()) {
                    objects.push(BackupObject {
                        id: schema_name.clone(),
                        name: schema_name.clone(),
                        object_type: BackupObjectType::Schema,
                        parent_id: None,
                        estimated_size: None,
                        row_count: None,
                    });
                }

                // Try to get row count
                let row_count: Option<u64> = conn
                    .query_row(
                        &format!(
                            "SELECT COUNT(*) FROM \"{}\".\"{}\"",
                            schema_name.replace('"', "\"\""),
                            table_name.replace('"', "\"\"")
                        ),
                        [],
                        |r| r.get(0),
                    )
                    .ok();

                objects.push(BackupObject {
                    id: format!("{}.{}", schema_name, table_name),
                    name: table_name,
                    object_type: BackupObjectType::Table,
                    parent_id: Some(schema_name),
                    estimated_size: estimated_size.map(|s| s as u64),
                    row_count,
                });
            }

            // Query views
            let mut stmt = conn
                .prepare(
                    "SELECT schema_name, view_name
                     FROM duckdb_views()
                     WHERE NOT internal
                     ORDER BY schema_name, view_name",
                )
                .map_err(|e| AppError::DatabaseError(format!("Failed to query views: {}", e)))?;

            let view_rows = stmt
                .query_map([], |row| {
                    let schema_name: String = row.get(0)?;
                    let view_name: String = row.get(1)?;
                    Ok((schema_name, view_name))
                })
                .map_err(|e| AppError::DatabaseError(format!("Failed to query views: {}", e)))?;

            for row in view_rows {
                let (schema_name, view_name) =
                    row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?;

                if seen_schemas.insert(schema_name.clone()) {
                    objects.push(BackupObject {
                        id: schema_name.clone(),
                        name: schema_name.clone(),
                        object_type: BackupObjectType::Schema,
                        parent_id: None,
                        estimated_size: None,
                        row_count: None,
                    });
                }

                objects.push(BackupObject {
                    id: format!("{}.{}", schema_name, view_name),
                    name: view_name,
                    object_type: BackupObjectType::View,
                    parent_id: Some(schema_name),
                    estimated_size: None,
                    row_count: None,
                });
            }

            Ok(objects)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

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

            let extension = path
                .extension()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            let objects = match extension.as_str() {
                "duckdb" | "db" => parse_binary_preview(&path)?,
                "sql" => parse_sql_preview(&path)?,
                _ => parse_binary_preview(&path).or_else(|_| parse_sql_preview(&path))?,
            };

            Ok(BackupPreview {
                file_name,
                file_size,
                database_type: "DuckDB".to_string(),
                created_at: None,
                objects,
            })
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        match config.format.as_str() {
            "binary" => self.execute_binary_backup(&config, &progress).await,
            "sql" => self.execute_sql_backup(&config, &progress).await,
            _ => Err(AppError::InvalidInput(format!(
                "Unsupported backup format: {}",
                config.format
            ))),
        }
    }

    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let extension = Path::new(&config.source_path)
            .extension()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        match extension.as_str() {
            "duckdb" | "db" => self.execute_binary_restore(&config, &progress).await,
            "sql" => self.execute_sql_restore(&config, &progress).await,
            _ => Err(AppError::InvalidInput(
                "Unknown backup format. Use .duckdb for binary or .sql for SQL backups."
                    .to_string(),
            )),
        }
    }
}

// ============ Backup Execution ============

impl DuckDbAdapter {
    async fn execute_binary_backup(
        &self,
        config: &BackupConfig,
        progress: &ProgressSender,
    ) -> Result<(), AppError> {
        // Send started
        let _ = progress.send(BackupProgress::Started { total_steps: Some(2) }).await;

        // Step 1: CHECKPOINT to flush WAL
        let _ = progress
            .send(BackupProgress::Progress {
                current: 1,
                total: 2,
                message: "Flushing WAL with CHECKPOINT...".to_string(),
            })
            .await;

        self.execute_blocking(|conn| {
            conn.execute_batch("CHECKPOINT")
                .map_err(|e| AppError::DatabaseError(format!("CHECKPOINT failed: {}", e)))?;
            Ok(())
        })
        .await?;

        // Step 2: Copy the database file
        let _ = progress
            .send(BackupProgress::Progress {
                current: 2,
                total: 2,
                message: "Copying database file...".to_string(),
            })
            .await;

        let db_path = {
            let guard = self.db_path.lock().await;
            guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("No db_path stored".into()))?
                .clone()
        };

        let destination = config.destination_path.clone();
        tokio::fs::copy(&db_path, &destination)
            .await
            .map_err(|e| AppError::Io(format!("Failed to copy database file: {}", e)))?;

        let _ = progress
            .send(BackupProgress::Completed {
                message: "Binary backup completed successfully".to_string(),
            })
            .await;

        Ok(())
    }

    async fn execute_sql_backup(
        &self,
        config: &BackupConfig,
        progress: &ProgressSender,
    ) -> Result<(), AppError> {
        let _ = progress.send(BackupProgress::Started { total_steps: Some(3) }).await;

        // Step 1: Create temp directory for EXPORT DATABASE
        let export_dir = std::env::temp_dir().join(format!(
            "qp-duckdb-export-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&export_dir)
            .map_err(|e| AppError::Io(format!("Failed to create temp directory: {}", e)))?;
        let export_dir_str = export_dir.to_string_lossy().to_string();

        let _ = progress
            .send(BackupProgress::Progress {
                current: 1,
                total: 3,
                message: "Exporting database...".to_string(),
            })
            .await;

        // Step 2: EXPORT DATABASE
        let export_sql = format!("EXPORT DATABASE '{}'", export_dir_str.replace('\'', "''"));
        self.execute_blocking(move |conn| {
            conn.execute_batch(&export_sql)
                .map_err(|e| AppError::DatabaseError(format!("EXPORT DATABASE failed: {}", e)))?;
            Ok(())
        })
        .await?;

        // Step 3: Combine schema.sql + load.sql into single output file
        let _ = progress
            .send(BackupProgress::Progress {
                current: 2,
                total: 3,
                message: "Combining export files...".to_string(),
            })
            .await;

        let destination = config.destination_path.clone();
        let schema_path = export_dir.join("schema.sql");
        let load_path = export_dir.join("load.sql");

        let mut output = String::new();
        output.push_str("-- DuckDB SQL Export\n");
        output.push_str("-- Generated by Query Pilot\n\n");

        if schema_path.exists() {
            let schema_sql = fs::read_to_string(&schema_path)
                .map_err(|e| AppError::Io(format!("Failed to read schema.sql: {}", e)))?;
            output.push_str("-- Schema\n");
            output.push_str(&schema_sql);
            output.push('\n');
        }

        if load_path.exists() {
            let load_sql = fs::read_to_string(&load_path)
                .map_err(|e| AppError::Io(format!("Failed to read load.sql: {}", e)))?;
            output.push_str("-- Data\n");
            output.push_str(&load_sql);
            output.push('\n');
        }

        fs::write(&destination, &output)
            .map_err(|e| AppError::Io(format!("Failed to write output file: {}", e)))?;

        let _ = progress
            .send(BackupProgress::Progress {
                current: 3,
                total: 3,
                message: "Cleaning up temp files...".to_string(),
            })
            .await;

        // Clean up temp directory
        let _ = fs::remove_dir_all(&export_dir);

        let _ = progress
            .send(BackupProgress::Completed {
                message: "SQL export completed successfully".to_string(),
            })
            .await;

        Ok(())
    }

    async fn execute_binary_restore(
        &self,
        config: &RestoreConfig,
        progress: &ProgressSender,
    ) -> Result<(), AppError> {
        let _ = progress.send(BackupProgress::Started { total_steps: Some(3) }).await;

        let db_path = {
            let guard = self.db_path.lock().await;
            guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("No db_path stored".into()))?
                .clone()
        };

        // Step 1: Disconnect (preserving db_path)
        let _ = progress
            .send(BackupProgress::Progress {
                current: 1,
                total: 3,
                message: "Disconnecting from database...".to_string(),
            })
            .await;

        self.disconnect_internal().await?;

        // Step 2: Copy backup file over the database
        let _ = progress
            .send(BackupProgress::Progress {
                current: 2,
                total: 3,
                message: "Restoring database file...".to_string(),
            })
            .await;

        let source = config.source_path.clone();
        tokio::fs::copy(&source, &db_path)
            .await
            .map_err(|e| AppError::Io(format!("Failed to copy backup file: {}", e)))?;

        // Step 3: Reconnect
        let _ = progress
            .send(BackupProgress::Progress {
                current: 3,
                total: 3,
                message: "Reconnecting to database...".to_string(),
            })
            .await;

        self.reconnect_internal().await?;

        let _ = progress
            .send(BackupProgress::Completed {
                message: "Binary restore completed successfully".to_string(),
            })
            .await;

        Ok(())
    }

    async fn execute_sql_restore(
        &self,
        config: &RestoreConfig,
        progress: &ProgressSender,
    ) -> Result<(), AppError> {
        let _ = progress.send(BackupProgress::Started { total_steps: Some(2) }).await;

        let _ = progress
            .send(BackupProgress::Progress {
                current: 1,
                total: 2,
                message: "Reading SQL file...".to_string(),
            })
            .await;

        let source_path = config.source_path.clone();
        let content = tokio::fs::read_to_string(&source_path)
            .await
            .map_err(|e| AppError::Io(format!("Failed to read backup file: {}", e)))?;

        let _ = progress
            .send(BackupProgress::Progress {
                current: 2,
                total: 2,
                message: "Executing SQL statements...".to_string(),
            })
            .await;

        self.execute_blocking(move |conn| {
            conn.execute_batch(&content)
                .map_err(|e| AppError::DatabaseError(format!("SQL restore failed: {}", e)))?;
            Ok(())
        })
        .await?;

        let _ = progress
            .send(BackupProgress::Completed {
                message: "SQL restore completed successfully".to_string(),
            })
            .await;

        Ok(())
    }
}

// ============ Preview Helpers ============

use crate::core::backup_capability::BackupProgress;

/// Parse a binary DuckDB file to list tables.
fn parse_binary_preview(path: &Path) -> Result<Vec<BackupPreviewObject>, AppError> {
    use duckdb::{AccessMode, Config, Connection};

    let config = Config::default()
        .access_mode(AccessMode::ReadOnly)
        .map_err(|e| AppError::Internal(format!("Config error: {}", e)))?;

    let conn = Connection::open_with_flags(path, config)
        .map_err(|e| AppError::Io(format!("Failed to open DuckDB backup file: {}", e)))?;

    let mut objects = Vec::new();

    // Query tables
    let mut stmt = conn
        .prepare(
            "SELECT table_name FROM duckdb_tables()
             WHERE NOT internal
             ORDER BY table_name",
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to query tables: {}", e)))?;

    let table_rows = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            Ok(name)
        })
        .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

    for row in table_rows {
        let name = row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?;

        let row_count: Option<u64> = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM \"{}\"",
                    name.replace('"', "\"\"")
                ),
                [],
                |r| r.get(0),
            )
            .ok();

        objects.push(BackupPreviewObject {
            name,
            object_type: "table".to_string(),
            row_count,
        });
    }

    // Query views
    let mut stmt = conn
        .prepare(
            "SELECT view_name FROM duckdb_views()
             WHERE NOT internal
             ORDER BY view_name",
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to query views: {}", e)))?;

    let view_rows = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            Ok(name)
        })
        .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

    for row in view_rows {
        let name = row.map_err(|e| AppError::DatabaseError(format!("Row error: {}", e)))?;
        objects.push(BackupPreviewObject {
            name,
            object_type: "view".to_string(),
            row_count: None,
        });
    }

    Ok(objects)
}

/// Parse a SQL dump to extract table/view names from CREATE statements.
fn parse_sql_preview(path: &Path) -> Result<Vec<BackupPreviewObject>, AppError> {
    let file =
        fs::File::open(path).map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;

    let reader = BufReader::new(file);
    let mut objects = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in reader.lines() {
        let line = line.map_err(|e| AppError::Io(format!("Failed to read line: {}", e)))?;
        let upper = line.to_uppercase();

        if upper.contains("CREATE TABLE") {
            if let Some(name) = extract_identifier_after(&line, "CREATE TABLE") {
                if seen.insert(name.clone()) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "table".to_string(),
                        row_count: None,
                    });
                }
            }
        } else if upper.contains("CREATE VIEW") {
            if let Some(name) = extract_identifier_after(&line, "CREATE VIEW") {
                if seen.insert(name.clone()) {
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

/// Extract an identifier that follows a keyword (e.g., "CREATE TABLE").
fn extract_identifier_after(line: &str, keyword: &str) -> Option<String> {
    let upper = line.to_uppercase();
    let start = upper.find(&keyword.to_uppercase())?;
    let rest = line[start + keyword.len()..].trim_start();

    // Handle IF NOT EXISTS
    let rest = if rest.to_uppercase().starts_with("IF NOT EXISTS") {
        rest[13..].trim_start()
    } else {
        rest
    };

    // Handle schema-qualified names like "schema"."name" or schema.name
    let rest = rest.trim();
    if rest.is_empty() {
        return None;
    }

    // Try to parse the full identifier (possibly schema-qualified)
    extract_simple_identifier(rest)
}

/// Extract a simple identifier (possibly schema-qualified) from a string.
fn extract_simple_identifier(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    // Find the end of the identifier expression (could be schema.name)
    let mut result = String::new();
    let mut chars = s.chars().peekable();

    loop {
        // Parse one identifier segment
        if chars.peek() == Some(&'"') {
            chars.next(); // consume opening quote
            while let Some(&c) = chars.peek() {
                if c == '"' {
                    chars.next();
                    break;
                }
                result.push(c);
                chars.next();
            }
        } else {
            while let Some(&c) = chars.peek() {
                if c.is_alphanumeric() || c == '_' {
                    result.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
        }

        // Check for dot (schema separator)
        if chars.peek() == Some(&'.') {
            result.push('.');
            chars.next();
        } else {
            break;
        }
    }

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}
