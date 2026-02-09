//! MongoDB backup implementation using mongodump/mongorestore tools.
//!
//! MongoDB requires external CLI tools (mongodump/mongorestore) for backup/restore
//! operations. This module implements BackupCapable by shelling out to these tools.
//!
//! ## Supported Formats
//! - **Directory**: Standard mongodump output with BSON files per collection
//! - **Archive**: Single compressed archive file (--archive --gzip)
//!
//! ## Tool Requirements
//! - mongodump: For backup operations
//! - mongorestore: For restore operations
//!
//! These tools are part of the MongoDB Database Tools package:
//! https://www.mongodb.com/try/download/database-tools

use async_trait::async_trait;
use serde_json::json;
use std::fs;
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::core::backup_capability::BackupProgress;
use crate::core::backup_capability::{
    BackupCapable, BackupConfig, BackupFormat, BackupObject, BackupObjectType, BackupOptionsSchema,
    BackupPreview, BackupPreviewObject, FieldType, OptionField, ProgressSender, RestoreConfig,
    RestoreOptionsSchema, ToolPurpose, ToolRequirement,
};
use crate::error::AppError;

use super::MongoDbAdapter;

#[async_trait]
impl BackupCapable for MongoDbAdapter {
    /// MongoDB requires mongodump and mongorestore external tools.
    fn tool_requirements(&self) -> Vec<ToolRequirement> {
        vec![
            ToolRequirement {
                name: "mongodump".to_string(),
                purpose: ToolPurpose::Backup,
                download_size_mb: 60,
            },
            ToolRequirement {
                name: "mongorestore".to_string(),
                purpose: ToolPurpose::Restore,
                download_size_mb: 0, // Included with mongodump
            },
        ]
    }

    /// MongoDB supports directory and archive backup formats.
    fn supported_formats(&self) -> Vec<BackupFormat> {
        vec![
            BackupFormat {
                id: "archive".to_string(),
                name: "Archive (Compressed)".to_string(),
                extension: "archive".to_string(),
                description: "Single compressed archive file. Recommended for most use cases.".to_string(),
            },
            BackupFormat {
                id: "directory".to_string(),
                name: "Directory (BSON)".to_string(),
                extension: "".to_string(),
                description: "Standard mongodump output with BSON files per collection. Useful for selective restore.".to_string(),
            },
        ]
    }

    /// Backup options schema for MongoDB.
    fn backup_options(&self) -> BackupOptionsSchema {
        BackupOptionsSchema {
            common: vec![
                OptionField {
                    key: "gzip".to_string(),
                    label: "Enable Compression".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Compress backup data using gzip. Recommended for archive format.".to_string(),
                },
            ],
            advanced: vec![
                OptionField {
                    key: "collection".to_string(),
                    label: "Collection Filter".to_string(),
                    field_type: FieldType::String,
                    default: json!(""),
                    description: "Backup only this specific collection. Leave empty to backup all collections.".to_string(),
                },
                OptionField {
                    key: "query".to_string(),
                    label: "Query Filter".to_string(),
                    field_type: FieldType::String,
                    default: json!(""),
                    description: "JSON query to filter documents for backup. Example: {\"status\": \"active\"}".to_string(),
                },
                OptionField {
                    key: "numParallelCollections".to_string(),
                    label: "Parallel Collections".to_string(),
                    field_type: FieldType::Number {
                        min: Some(1.0),
                        max: Some(16.0),
                    },
                    default: json!(4),
                    description: "Number of collections to dump in parallel.".to_string(),
                },
            ],
        }
    }

    /// Restore options schema for MongoDB.
    fn restore_options(&self) -> RestoreOptionsSchema {
        RestoreOptionsSchema {
            common: vec![OptionField {
                key: "drop".to_string(),
                label: "Drop Before Restore".to_string(),
                field_type: FieldType::Bool,
                default: json!(false),
                description: "Drop existing collections before restoring. Use with caution!"
                    .to_string(),
            }],
            advanced: vec![
                OptionField {
                    key: "nsFrom".to_string(),
                    label: "Namespace From".to_string(),
                    field_type: FieldType::String,
                    default: json!(""),
                    description:
                        "Rename namespace during restore. Source pattern (e.g., 'olddb.*')."
                            .to_string(),
                },
                OptionField {
                    key: "nsTo".to_string(),
                    label: "Namespace To".to_string(),
                    field_type: FieldType::String,
                    default: json!(""),
                    description:
                        "Rename namespace during restore. Target pattern (e.g., 'newdb.*')."
                            .to_string(),
                },
                OptionField {
                    key: "numParallelCollections".to_string(),
                    label: "Parallel Collections".to_string(),
                    field_type: FieldType::Number {
                        min: Some(1.0),
                        max: Some(16.0),
                    },
                    default: json!(4),
                    description: "Number of collections to restore in parallel.".to_string(),
                },
                OptionField {
                    key: "numInsertionWorkersPerCollection".to_string(),
                    label: "Insertion Workers".to_string(),
                    field_type: FieldType::Number {
                        min: Some(1.0),
                        max: Some(16.0),
                    },
                    default: json!(1),
                    description: "Number of insert workers per collection.".to_string(),
                },
            ],
        }
    }

    /// List collections that can be backed up.
    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError> {
        let collections = self.list_collections().await?;
        let db_name = self.get_database_name().await;

        let mut objects = Vec::new();

        // Add the database as a parent object
        let total_docs: u64 = collections.iter().filter_map(|c| c.doc_count).sum();
        let total_size: u64 = collections.iter().filter_map(|c| c.size_bytes).sum();

        objects.push(BackupObject {
            id: db_name.clone(),
            name: format!("{} ({} collections)", db_name, collections.len()),
            object_type: BackupObjectType::Database,
            parent_id: None,
            estimated_size: Some(total_size),
            row_count: Some(total_docs),
        });

        // Add each collection
        for coll in collections {
            objects.push(BackupObject {
                id: format!("{}.{}", db_name, coll.name),
                name: coll.name.clone(),
                object_type: BackupObjectType::Collection,
                parent_id: Some(db_name.clone()),
                estimated_size: coll.size_bytes,
                row_count: coll.doc_count,
            });
        }

        Ok(objects)
    }

    /// Parse a backup file/directory to preview its contents.
    async fn parse_backup_preview(&self, path: &Path) -> Result<BackupPreview, AppError> {
        let path = path.to_path_buf();

        tokio::task::spawn_blocking(move || {
            let file_name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let metadata = fs::metadata(&path)
                .map_err(|e| AppError::Io(format!("Failed to read path metadata: {}", e)))?;

            if metadata.is_dir() {
                // Directory backup - scan for BSON files
                parse_directory_backup(&path)
            } else {
                // Archive backup - limited preview
                let file_size = metadata.len();

                // Check if it's gzipped by reading first bytes
                let is_gzip = check_gzip_magic(&path)?;

                Ok(BackupPreview {
                    file_name,
                    file_size,
                    database_type: "MongoDB".to_string(),
                    created_at: metadata.modified().ok().map(|t| {
                        let datetime: chrono::DateTime<chrono::Utc> = t.into();
                        datetime.to_rfc3339()
                    }),
                    objects: vec![BackupPreviewObject {
                        name: if is_gzip {
                            "Compressed Archive"
                        } else {
                            "Archive"
                        }
                        .to_string(),
                        object_type: "archive".to_string(),
                        row_count: None,
                    }],
                })
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    /// Execute backup using mongodump.
    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let db_name = self.get_database_name().await;
        let client = self
            .get_client()
            .await
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        // Build connection URI from adapter state
        // We need to get connection info - use the client's default database
        let uri = build_connection_uri(&client, &db_name).await?;

        let destination_path = config.destination_path.clone();
        let format = config.format.clone();

        // Parse options
        let gzip = config
            .options
            .get("gzip")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let collection = config
            .options
            .get("collection")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let query = config
            .options
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let num_parallel = config
            .options
            .get("numParallelCollections")
            .and_then(|v| v.as_u64())
            .unwrap_or(4) as u32;

        // Send started message
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Build mongodump command
        let mut cmd = Command::new("mongodump");
        cmd.arg("--uri").arg(&uri);
        cmd.arg("--db").arg(&db_name);

        // Format-specific options
        match format.as_str() {
            "archive" => {
                cmd.arg("--archive").arg(&destination_path);
                if gzip {
                    cmd.arg("--gzip");
                }
            }
            "directory" => {
                cmd.arg("--out").arg(&destination_path);
                if gzip {
                    cmd.arg("--gzip");
                }
            }
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "Unsupported backup format: {}",
                    format
                )));
            }
        }

        // Optional filters
        if !collection.is_empty() {
            cmd.arg("--collection").arg(&collection);
        }
        if !query.is_empty() {
            cmd.arg("--query").arg(&query);
        }

        cmd.arg("--numParallelCollections")
            .arg(num_parallel.to_string());

        // Run mongodump and capture output
        execute_tool_command(cmd, progress).await
    }

    /// Execute restore using mongorestore.
    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let db_name = self.get_database_name().await;
        let client = self
            .get_client()
            .await
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let uri = build_connection_uri(&client, &db_name).await?;
        let source_path = config.source_path.clone();

        // Parse options
        let drop = config
            .options
            .get("drop")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let ns_from = config
            .options
            .get("nsFrom")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ns_to = config
            .options
            .get("nsTo")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let num_parallel = config
            .options
            .get("numParallelCollections")
            .and_then(|v| v.as_u64())
            .unwrap_or(4) as u32;
        let num_workers = config
            .options
            .get("numInsertionWorkersPerCollection")
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32;

        // Send started message
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Determine if source is archive or directory
        let path = Path::new(&source_path);
        let is_archive = path.is_file();
        let is_gzip = is_archive && check_gzip_magic(path).unwrap_or(false);

        // Build mongorestore command
        let mut cmd = Command::new("mongorestore");
        cmd.arg("--uri").arg(&uri);
        cmd.arg("--db").arg(&db_name);

        if is_archive {
            cmd.arg("--archive").arg(&source_path);
            if is_gzip {
                cmd.arg("--gzip");
            }
        } else {
            // Directory restore - point to the db folder inside the dump
            let db_path = path.join(&db_name);
            if db_path.exists() {
                cmd.arg(&db_path);
            } else {
                cmd.arg(&source_path);
            }
            // Check if bson files are gzipped
            if has_gzipped_bson(path) {
                cmd.arg("--gzip");
            }
        }

        if drop {
            cmd.arg("--drop");
        }

        // Namespace remapping
        if !ns_from.is_empty() && !ns_to.is_empty() {
            cmd.arg("--nsFrom").arg(&ns_from);
            cmd.arg("--nsTo").arg(&ns_to);
        }

        cmd.arg("--numParallelCollections")
            .arg(num_parallel.to_string());
        cmd.arg("--numInsertionWorkersPerCollection")
            .arg(num_workers.to_string());

        // Run mongorestore and capture output
        execute_tool_command(cmd, progress).await
    }
}

// ============ Helper Functions ============

/// Build MongoDB connection URI from client.
/// Note: This is a simplified version - in production, you'd want to preserve
/// the original connection string or reconstruct it from stored credentials.
async fn build_connection_uri(client: &mongodb::Client, db_name: &str) -> Result<String, AppError> {
    // Get connection info from client options
    // The mongodb crate doesn't expose the original URI, so we reconstruct it
    // from the client's default selection criteria

    // For now, we'll use a workaround: ping the server to get host info
    let admin_db = client.database("admin");
    let server_status = admin_db
        .run_command(bson::doc! { "serverStatus": 1 })
        .await
        .map_err(|e| AppError::DatabaseError(format!("Failed to get server status: {}", e)))?;

    // Extract host from server status (this is a simplified approach)
    let host = server_status
        .get_str("host")
        .unwrap_or("localhost:27017")
        .to_string();

    // Parse host:port
    let (hostname, port) = if host.contains(':') {
        let parts: Vec<&str> = host.split(':').collect();
        (
            parts[0].to_string(),
            parts.get(1).unwrap_or(&"27017").to_string(),
        )
    } else {
        (host, "27017".to_string())
    };

    // Build URI without auth (tools will use the URI from client options if available)
    // In a real implementation, you'd want to store and reuse the original connection string
    Ok(format!("mongodb://{}:{}/{}", hostname, port, db_name))
}

/// Parse a directory backup to extract collection information.
fn parse_directory_backup(path: &Path) -> Result<BackupPreview, AppError> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut objects = Vec::new();
    let mut total_size = 0u64;

    // Walk the directory looking for .bson files
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                // This is a database folder
                let db_name = entry_path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

                if let Ok(db_entries) = fs::read_dir(&entry_path) {
                    for db_entry in db_entries.flatten() {
                        let db_entry_path = db_entry.path();
                        let file_name = db_entry_path
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_default();

                        // Look for .bson or .bson.gz files
                        if file_name.ends_with(".bson") || file_name.ends_with(".bson.gz") {
                            let coll_name = file_name
                                .trim_end_matches(".gz")
                                .trim_end_matches(".bson")
                                .to_string();

                            if let Ok(meta) = fs::metadata(&db_entry_path) {
                                total_size += meta.len();
                                objects.push(BackupPreviewObject {
                                    name: format!("{}.{}", db_name, coll_name),
                                    object_type: "collection".to_string(),
                                    row_count: None, // Can't easily determine without parsing BSON
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Get directory creation time
    let created_at = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let datetime: chrono::DateTime<chrono::Utc> = t.into();
            datetime.to_rfc3339()
        });

    Ok(BackupPreview {
        file_name,
        file_size: total_size,
        database_type: "MongoDB".to_string(),
        created_at,
        objects,
    })
}

/// Check if a file starts with gzip magic bytes.
fn check_gzip_magic(path: &Path) -> Result<bool, AppError> {
    use std::io::Read;
    let mut file =
        fs::File::open(path).map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;

    let mut magic = [0u8; 2];
    if file.read_exact(&mut magic).is_ok() {
        // Gzip magic: 0x1f 0x8b
        Ok(magic[0] == 0x1f && magic[1] == 0x8b)
    } else {
        Ok(false)
    }
}

/// Check if a directory contains gzipped BSON files.
fn has_gzipped_bson(path: &Path) -> bool {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                if has_gzipped_bson(&entry_path) {
                    return true;
                }
            } else {
                let name = entry_path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if name.ends_with(".bson.gz") {
                    return true;
                }
            }
        }
    }
    false
}

/// Execute a tool command (mongodump/mongorestore) and stream progress.
async fn execute_tool_command(mut cmd: Command, progress: ProgressSender) -> Result<(), AppError> {
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let _ = progress
        .send(BackupProgress::Output {
            line: format!("Running: {:?}", cmd),
            is_error: false,
        })
        .await;

    let mut child = cmd.spawn().map_err(|e| {
        AppError::Io(format!(
            "Failed to start tool. Is it installed? Error: {}",
            e
        ))
    })?;

    // Read stderr (mongodump/mongorestore write progress to stderr)
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("Failed to capture stderr".to_string()))?;

    let mut stderr_reader = BufReader::new(stderr).lines();

    // Also capture stdout for any output
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Failed to capture stdout".to_string()))?;

    let mut stdout_reader = BufReader::new(stdout).lines();

    // Process output streams concurrently
    let progress_clone = progress.clone();
    let stderr_task = tokio::spawn(async move {
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            let is_error = line.contains("error") || line.contains("failed");

            // Parse progress from mongodump/mongorestore output
            // Example lines:
            // "2024-01-01T00:00:00.000+0000	writing mydb.mycollection to..."
            // "2024-01-01T00:00:00.000+0000	done dumping mydb.mycollection (1000 documents)"

            let _ = progress_clone
                .send(BackupProgress::Output {
                    line: line.clone(),
                    is_error,
                })
                .await;
        }
    });

    let progress_clone2 = progress.clone();
    let stdout_task = tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            let _ = progress_clone2
                .send(BackupProgress::Output {
                    line,
                    is_error: false,
                })
                .await;
        }
    });

    // Wait for command to complete
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to wait for tool: {}", e)))?;

    // Wait for output tasks
    let _ = stderr_task.await;
    let _ = stdout_task.await;

    if status.success() {
        let _ = progress
            .send(BackupProgress::Completed {
                message: "Operation completed successfully".to_string(),
            })
            .await;
        Ok(())
    } else {
        let error_msg = format!("Tool exited with status: {}", status);
        let _ = progress
            .send(BackupProgress::Failed {
                error: error_msg.clone(),
            })
            .await;
        Err(AppError::DatabaseError(error_msg))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_requirements() {
        let adapter = MongoDbAdapter::new();
        let tools = adapter.tool_requirements();

        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "mongodump");
        assert_eq!(tools[0].purpose, ToolPurpose::Backup);
        assert_eq!(tools[1].name, "mongorestore");
        assert_eq!(tools[1].purpose, ToolPurpose::Restore);
    }

    #[test]
    fn test_supported_formats() {
        let adapter = MongoDbAdapter::new();
        let formats = adapter.supported_formats();

        assert_eq!(formats.len(), 2);
        assert_eq!(formats[0].id, "archive");
        assert_eq!(formats[1].id, "directory");
    }

    #[test]
    fn test_backup_options_schema() {
        let adapter = MongoDbAdapter::new();
        let schema = adapter.backup_options();

        assert!(!schema.common.is_empty());
        assert!(schema.common.iter().any(|o| o.key == "gzip"));
        assert!(schema.advanced.iter().any(|o| o.key == "collection"));
    }

    #[test]
    fn test_restore_options_schema() {
        let adapter = MongoDbAdapter::new();
        let schema = adapter.restore_options();

        assert!(!schema.common.is_empty());
        assert!(schema.common.iter().any(|o| o.key == "drop"));
        assert!(schema.advanced.iter().any(|o| o.key == "nsFrom"));
        assert!(schema.advanced.iter().any(|o| o.key == "nsTo"));
    }

    #[test]
    fn test_gzip_magic_detection() {
        // Create a temp file with gzip magic
        use std::io::Write;
        let temp_dir = std::env::temp_dir();
        let gzip_path = temp_dir.join("test_gzip_magic.gz");
        let mut file = fs::File::create(&gzip_path).unwrap();
        file.write_all(&[0x1f, 0x8b, 0x08, 0x00]).unwrap();
        drop(file);

        assert!(check_gzip_magic(&gzip_path).unwrap());

        // Create a non-gzip file
        let plain_path = temp_dir.join("test_plain.txt");
        let mut file = fs::File::create(&plain_path).unwrap();
        file.write_all(b"hello").unwrap();
        drop(file);

        assert!(!check_gzip_magic(&plain_path).unwrap());

        // Cleanup
        let _ = fs::remove_file(&gzip_path);
        let _ = fs::remove_file(&plain_path);
    }
}
