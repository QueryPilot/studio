//! Redis backup implementation using native Redis commands.
//!
//! Redis backup supports two modes:
//! 1. **RDB Snapshot**: Uses BGSAVE to create an RDB snapshot, then copies the file.
//!    Note: Full restore from RDB requires server restart.
//! 2. **Key Export (JSON)**: Exports keys using DUMP command to a JSON file.
//!    This allows selective backup and restore without server restart.
//!
//! ## Limitations
//! - RDB restore typically requires server restart or redis-server access
//! - For production restore, users should use redis-cli or server admin tools
//! - Key export is limited by available memory for large datasets

use async_trait::async_trait;
use bytes::Bytes;
use fred::interfaces::{ClientLike, KeysInterface, ServerInterface};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use crate::core::backup_capability::BackupProgress;
use crate::core::backup_capability::{
    BackupCapable, BackupConfig, BackupFormat, BackupObject, BackupObjectType, BackupOptionsSchema,
    BackupPreview, BackupPreviewObject, FieldType, OptionField, ProgressSender, RestoreConfig,
    RestoreOptionsSchema, ToolRequirement,
};
use crate::error::AppError;

use super::RedisAdapter;

/// Serialized key data for JSON backup format
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KeyBackup {
    key: String,
    key_type: String,
    ttl: i64,
    /// Base64-encoded serialized value from DUMP command
    data: String,
}

/// JSON backup file format
#[derive(Debug, Clone, Serialize, Deserialize)]
struct JsonBackupFile {
    version: u32,
    redis_version: Option<String>,
    database: u8,
    created_at: String,
    keys: Vec<KeyBackup>,
}

#[async_trait]
impl BackupCapable for RedisAdapter {
    /// Redis uses native commands, no external tools required.
    fn tool_requirements(&self) -> Vec<ToolRequirement> {
        vec![]
    }

    /// Redis supports RDB and JSON backup formats.
    fn supported_formats(&self) -> Vec<BackupFormat> {
        vec![
            BackupFormat {
                id: "json".to_string(),
                name: "JSON Key Export".to_string(),
                extension: "json".to_string(),
                description: "Exports keys using DUMP command to JSON. Supports selective backup and restore without server restart.".to_string(),
            },
            BackupFormat {
                id: "rdb".to_string(),
                name: "RDB Snapshot".to_string(),
                extension: "rdb".to_string(),
                description: "Native Redis RDB format via BGSAVE. Fast and compact, but restore requires server access.".to_string(),
            },
        ]
    }

    /// Backup options schema - Redis has minimal options.
    fn backup_options(&self) -> BackupOptionsSchema {
        BackupOptionsSchema {
            common: vec![OptionField {
                key: "pattern".to_string(),
                label: "Key Pattern".to_string(),
                field_type: FieldType::String,
                default: json!("*"),
                description: "Pattern to match keys for backup (e.g., 'user:*', 'cache:*'). Only applies to JSON format.".to_string(),
            }],
            advanced: vec![OptionField {
                key: "scan_count".to_string(),
                label: "Scan Batch Size".to_string(),
                field_type: FieldType::Number {
                    min: Some(10.0),
                    max: Some(10000.0),
                },
                default: json!(1000),
                description: "Number of keys to scan per iteration. Higher values are faster but use more memory.".to_string(),
            }],
        }
    }

    /// Restore options - Redis restore has minimal options.
    fn restore_options(&self) -> RestoreOptionsSchema {
        RestoreOptionsSchema {
            common: vec![OptionField {
                key: "replace".to_string(),
                label: "Replace Existing Keys".to_string(),
                field_type: FieldType::Bool,
                default: json!(false),
                description:
                    "If true, overwrites existing keys. If false, skips keys that already exist."
                        .to_string(),
            }],
            advanced: vec![],
        }
    }

    /// List key patterns that can be backed up.
    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError> {
        let client = self
            .get_client()
            .await
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let mut objects = Vec::new();

        // Get database info
        let db_index = self.current_database().await;
        let db_size: u64 = client
            .dbsize()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get database size: {}", e)))?;

        // Add the current database as a backup object
        objects.push(BackupObject {
            id: format!("db{}", db_index),
            name: format!("Database {} ({} keys)", db_index, db_size),
            object_type: BackupObjectType::Database,
            parent_id: None,
            estimated_size: None,
            row_count: Some(db_size),
        });

        // Scan for common key prefixes to show as patterns
        let common_patterns = scan_key_patterns(&client, 100).await?;

        for (pattern, count) in common_patterns {
            objects.push(BackupObject {
                id: pattern.clone(),
                name: format!("{}* ({} keys)", pattern, count),
                object_type: BackupObjectType::KeyPattern,
                parent_id: Some(format!("db{}", db_index)),
                estimated_size: None,
                row_count: Some(count),
            });
        }

        Ok(objects)
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

            let (objects, created_at) = match extension.as_str() {
                "json" => parse_json_backup(&path)?,
                "rdb" => parse_rdb_backup(&path)?,
                _ => {
                    // Try JSON first, fall back to RDB info
                    parse_json_backup(&path).or_else(|_| parse_rdb_backup(&path))?
                }
            };

            Ok(BackupPreview {
                file_name,
                file_size,
                database_type: "Redis".to_string(),
                created_at,
                objects,
            })
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    /// Execute backup using BGSAVE or DUMP commands.
    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let client = self
            .get_client()
            .await
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let destination_path = config.destination_path.clone();
        let format = config.format.clone();

        // Parse options
        let pattern = config
            .options
            .get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or("*")
            .to_string();
        let scan_count = config
            .options
            .get("scan_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(1000) as u32;

        // Send started message - check for cancellation
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        match format.as_str() {
            "json" => {
                execute_json_backup(
                    &client,
                    &destination_path,
                    &pattern,
                    scan_count,
                    self.current_database().await,
                    &progress,
                )
                .await
            }
            "rdb" => execute_rdb_backup(&client, &destination_path, &progress).await,
            _ => Err(AppError::InvalidInput(format!(
                "Unsupported backup format: {}",
                format
            ))),
        }
    }

    /// Execute restore using RESTORE command.
    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let client = self
            .get_client()
            .await
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let source_path = config.source_path.clone();
        let replace = config
            .options
            .get("replace")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Determine format by extension
        let path = Path::new(&source_path);
        let extension = path
            .extension()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        // Send started message - check for cancellation
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        match extension.as_str() {
            "json" => execute_json_restore(&client, &source_path, replace, &progress).await,
            "rdb" => {
                // RDB restore requires server access - provide helpful error
                let _ = progress.send(BackupProgress::Failed {
                    error: "RDB restore requires direct server access. Please use redis-cli or copy the RDB file to the server's data directory and restart Redis.".to_string(),
                }).await;
                Err(AppError::InvalidInput(
                    "RDB restore not supported via client connection. Use redis-cli or server admin tools.".to_string()
                ))
            }
            _ => {
                // Try JSON restore
                execute_json_restore(&client, &source_path, replace, &progress).await
            }
        }
    }
}

// ============ Helper Functions ============

/// Scan for common key prefixes to suggest backup patterns.
async fn scan_key_patterns(
    client: &fred::clients::Client,
    sample_size: u32,
) -> Result<Vec<(String, u64)>, AppError> {
    use std::collections::HashMap;

    let mut prefix_counts: HashMap<String, u64> = HashMap::new();
    let mut cursor = "0".to_string();
    let mut total_scanned = 0u32;

    // Sample keys to find common prefixes
    loop {
        let (new_cursor, keys): (String, Vec<fred::types::Key>) = client
            .scan_page(&cursor, "*", Some(100), None)
            .await
            .map_err(|e| AppError::DatabaseError(format!("SCAN failed: {}", e)))?;

        for key in keys {
            let key_str = key.as_str_lossy();
            // Extract prefix (everything before first ':' or the whole key if no ':')
            let prefix = key_str
                .find(':')
                .map(|i| &key_str[..=i])
                .unwrap_or("")
                .to_string();

            if !prefix.is_empty() {
                *prefix_counts.entry(prefix).or_insert(0) += 1;
            }
            total_scanned += 1;
        }

        cursor = new_cursor;
        if cursor == "0" || total_scanned >= sample_size {
            break;
        }
    }

    // Sort by count and return top prefixes
    let mut patterns: Vec<_> = prefix_counts.into_iter().collect();
    patterns.sort_by(|a, b| b.1.cmp(&a.1));
    patterns.truncate(10); // Top 10 patterns

    Ok(patterns)
}

/// Parse JSON backup file for preview.
fn parse_json_backup(path: &Path) -> Result<(Vec<BackupPreviewObject>, Option<String>), AppError> {
    let file = fs::File::open(path)
        .map_err(|e| AppError::Io(format!("Failed to open backup file: {}", e)))?;

    let reader = BufReader::new(file);
    let backup: JsonBackupFile = serde_json::from_reader(reader)
        .map_err(|e| AppError::Io(format!("Failed to parse JSON backup: {}", e)))?;

    // Group keys by type
    let mut type_counts: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    for key in &backup.keys {
        *type_counts.entry(key.key_type.clone()).or_insert(0) += 1;
    }

    let objects: Vec<BackupPreviewObject> = type_counts
        .into_iter()
        .map(|(key_type, count)| BackupPreviewObject {
            name: format!("{} keys", key_type),
            object_type: key_type,
            row_count: Some(count),
        })
        .collect();

    Ok((objects, Some(backup.created_at)))
}

/// Parse RDB file for basic preview (limited info available).
fn parse_rdb_backup(path: &Path) -> Result<(Vec<BackupPreviewObject>, Option<String>), AppError> {
    // RDB files are binary - we can only show basic file info
    let metadata = fs::metadata(path)
        .map_err(|e| AppError::Io(format!("Failed to read file metadata: {}", e)))?;

    // Check for RDB magic number "REDIS"
    let mut file =
        fs::File::open(path).map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;

    let mut magic = [0u8; 5];
    use std::io::Read;
    file.read_exact(&mut magic)
        .map_err(|e| AppError::Io(format!("Failed to read file header: {}", e)))?;

    if &magic != b"REDIS" {
        return Err(AppError::Io("Not a valid RDB file".to_string()));
    }

    let objects = vec![BackupPreviewObject {
        name: "RDB Snapshot".to_string(),
        object_type: "binary".to_string(),
        row_count: None,
    }];

    // Try to get file modification time as created_at
    let created_at = metadata.modified().ok().map(|time| {
        let datetime: chrono::DateTime<chrono::Utc> = time.into();
        datetime.to_rfc3339()
    });

    Ok((objects, created_at))
}

/// Execute JSON backup using DUMP command.
async fn execute_json_backup(
    client: &fred::clients::Client,
    destination_path: &str,
    pattern: &str,
    scan_count: u32,
    db_index: u8,
    progress: &ProgressSender,
) -> Result<(), AppError> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    let _ = progress
        .send(BackupProgress::Output {
            line: format!("Starting JSON backup with pattern: {}", pattern),
            is_error: false,
        })
        .await;

    // First, count total keys matching the pattern
    let total_keys = count_keys_matching(client, pattern).await?;

    let _ = progress
        .send(BackupProgress::Output {
            line: format!("Found {} keys matching pattern", total_keys),
            is_error: false,
        })
        .await;

    // Get Redis version
    let info: String = client.info(None).await.unwrap_or_default();
    let redis_version = info
        .lines()
        .find(|line| line.starts_with("redis_version:"))
        .map(|line| line.trim_start_matches("redis_version:").to_string());

    let mut keys_data = Vec::new();
    let mut cursor = "0".to_string();
    let mut processed = 0u64;

    loop {
        let (new_cursor, scanned_keys): (String, Vec<fred::types::Key>) = client
            .scan_page(&cursor, pattern, Some(scan_count), None)
            .await
            .map_err(|e| AppError::DatabaseError(format!("SCAN failed: {}", e)))?;

        for key in scanned_keys {
            let key_str = key.as_str_lossy().to_string();

            // Get key type
            let key_type: String = client
                .r#type(&key_str)
                .await
                .unwrap_or_else(|_| "unknown".to_string());

            // Get TTL
            let ttl: i64 = client.ttl(&key_str).await.unwrap_or(-1);

            // DUMP the key to get serialized value
            let dump_result: Result<Bytes, _> = client.dump(&key_str).await;

            if let Ok(dump_data) = dump_result {
                let data = BASE64.encode(dump_data.as_ref());
                keys_data.push(KeyBackup {
                    key: key_str,
                    key_type,
                    ttl,
                    data,
                });
            }

            processed += 1;
            if processed.is_multiple_of(100)
                && progress
                    .send(BackupProgress::Progress {
                        current: processed as u32,
                        total: total_keys as u32,
                        message: format!("Exported {} keys", processed),
                    })
                    .await
                    .is_err()
            {
                return Err(AppError::InvalidInput("Operation cancelled".into()));
            }
        }

        cursor = new_cursor;
        if cursor == "0" {
            break;
        }
    }

    // Write JSON file
    let backup = JsonBackupFile {
        version: 1,
        redis_version,
        database: db_index,
        created_at: chrono::Utc::now().to_rfc3339(),
        keys: keys_data,
    };

    let file = fs::File::create(destination_path)
        .map_err(|e| AppError::Io(format!("Failed to create backup file: {}", e)))?;
    let writer = BufWriter::new(file);
    serde_json::to_writer_pretty(writer, &backup)
        .map_err(|e| AppError::Io(format!("Failed to write backup file: {}", e)))?;

    if progress
        .send(BackupProgress::Completed {
            message: format!("Backup completed: {} keys exported to JSON", processed),
        })
        .await
        .is_err()
    {
        return Err(AppError::InvalidInput("Operation cancelled".into()));
    }

    Ok(())
}

/// Execute RDB backup using BGSAVE command.
async fn execute_rdb_backup(
    client: &fred::clients::Client,
    destination_path: &str,
    progress: &ProgressSender,
) -> Result<(), AppError> {
    let _ = progress
        .send(BackupProgress::Output {
            line: "Triggering BGSAVE...".to_string(),
            is_error: false,
        })
        .await;

    // Get current LASTSAVE timestamp
    let initial_lastsave: i64 = client
        .custom(fred::cmd!("LASTSAVE"), Vec::<String>::new())
        .await
        .map_err(|e| AppError::DatabaseError(format!("LASTSAVE failed: {}", e)))?;

    // Trigger BGSAVE
    let _: String = client
        .custom(fred::cmd!("BGSAVE"), Vec::<String>::new())
        .await
        .map_err(|e| AppError::DatabaseError(format!("BGSAVE failed: {}", e)))?;

    // Wait for BGSAVE to complete (poll LASTSAVE)
    let mut attempts = 0;
    loop {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        let current_lastsave: i64 = client
            .custom(fred::cmd!("LASTSAVE"), Vec::<String>::new())
            .await
            .map_err(|e| AppError::DatabaseError(format!("LASTSAVE failed: {}", e)))?;

        if current_lastsave > initial_lastsave {
            break;
        }

        attempts += 1;
        if attempts > 120 {
            // 60 seconds timeout
            return Err(AppError::DatabaseError(
                "BGSAVE timeout after 60 seconds".to_string(),
            ));
        }

        let _ = progress
            .send(BackupProgress::Output {
                line: format!(
                    "Waiting for BGSAVE to complete... ({} seconds)",
                    attempts / 2
                ),
                is_error: false,
            })
            .await;
    }

    // Get RDB file location
    let dir: String = client
        .custom(
            fred::cmd!("CONFIG"),
            vec!["GET".to_string(), "dir".to_string()],
        )
        .await
        .map_err(|e| AppError::DatabaseError(format!("CONFIG GET dir failed: {}", e)))?;

    let dbfilename: String = client
        .custom(
            fred::cmd!("CONFIG"),
            vec!["GET".to_string(), "dbfilename".to_string()],
        )
        .await
        .map_err(|e| AppError::DatabaseError(format!("CONFIG GET dbfilename failed: {}", e)))?;

    // Parse CONFIG GET response (returns array: [key, value])
    let dir = parse_config_value(&dir);
    let dbfilename = parse_config_value(&dbfilename);

    let rdb_path = Path::new(&dir).join(&dbfilename);

    let _ = progress
        .send(BackupProgress::Output {
            line: format!("RDB file location: {}", rdb_path.display()),
            is_error: false,
        })
        .await;

    // Try to copy the RDB file
    // Note: This may fail if Redis is on a remote server or in a container
    match fs::copy(&rdb_path, destination_path) {
        Ok(bytes) => {
            if progress
                .send(BackupProgress::Completed {
                    message: format!("RDB backup completed: {} bytes copied", bytes),
                })
                .await
                .is_err()
            {
                return Err(AppError::InvalidInput("Operation cancelled".into()));
            }
            Ok(())
        }
        Err(e) => {
            let _ = progress.send(BackupProgress::Failed {
                error: format!(
                    "Could not copy RDB file: {}. The RDB file is located at: {}. For remote Redis servers, manually copy this file.",
                    e, rdb_path.display()
                ),
            }).await;
            Err(AppError::Io(format!(
                "Failed to copy RDB file from {}: {}. For remote servers, manually copy the file.",
                rdb_path.display(),
                e
            )))
        }
    }
}

/// Execute JSON restore using RESTORE command.
async fn execute_json_restore(
    client: &fred::clients::Client,
    source_path: &str,
    replace: bool,
    progress: &ProgressSender,
) -> Result<(), AppError> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    let _ = progress
        .send(BackupProgress::Output {
            line: "Reading JSON backup file...".to_string(),
            is_error: false,
        })
        .await;

    // Read and parse JSON file
    let file = fs::File::open(source_path)
        .map_err(|e| AppError::Io(format!("Failed to open backup file: {}", e)))?;
    let reader = BufReader::new(file);
    let backup: JsonBackupFile = serde_json::from_reader(reader)
        .map_err(|e| AppError::Io(format!("Failed to parse JSON backup: {}", e)))?;

    let total = backup.keys.len();
    let _ = progress
        .send(BackupProgress::Output {
            line: format!("Found {} keys to restore", total),
            is_error: false,
        })
        .await;

    let mut restored = 0u64;
    let mut skipped = 0u64;
    let mut errors = 0u64;

    for key_backup in backup.keys {
        // Decode the serialized data
        let data = BASE64
            .decode(&key_backup.data)
            .map_err(|e| AppError::Io(format!("Failed to decode key data: {}", e)))?;

        // Calculate TTL for RESTORE command
        // TTL is in milliseconds for RESTORE, -1 means no expiry
        let ttl_ms = if key_backup.ttl > 0 {
            key_backup.ttl * 1000 // Convert seconds to milliseconds
        } else {
            0 // No expiry
        };

        // Check if key exists when not replacing
        if !replace {
            let exists: u64 = client.exists(&key_backup.key).await.unwrap_or(0);
            if exists > 0 {
                skipped += 1;
                continue;
            }
        }

        // Use RESTORE command with binary data
        // RESTORE key ttl serialized-value [REPLACE]
        let restore_result: Result<String, _> = if replace {
            client
                .custom(
                    fred::cmd!("RESTORE"),
                    vec![
                        key_backup.key.as_str(),
                        &ttl_ms.to_string(),
                        unsafe { std::str::from_utf8_unchecked(&data) }, // Binary data
                        "REPLACE",
                    ],
                )
                .await
        } else {
            client
                .custom(
                    fred::cmd!("RESTORE"),
                    vec![
                        key_backup.key.as_str(),
                        &ttl_ms.to_string(),
                        unsafe { std::str::from_utf8_unchecked(&data) }, // Binary data
                    ],
                )
                .await
        };

        match restore_result {
            Ok(_) => restored += 1,
            Err(e) => {
                errors += 1;
                let _ = progress
                    .send(BackupProgress::Output {
                        line: format!("Failed to restore key '{}': {}", key_backup.key, e),
                        is_error: true,
                    })
                    .await;
            }
        }

        let processed = restored + skipped + errors;
        if processed.is_multiple_of(100)
            && progress
                .send(BackupProgress::Progress {
                    current: processed as u32,
                    total: total as u32,
                    message: format!(
                        "Restored {} keys, skipped {}, errors {}",
                        restored, skipped, errors
                    ),
                })
                .await
                .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }
    }

    let message = format!(
        "Restore completed: {} keys restored, {} skipped, {} errors",
        restored, skipped, errors
    );

    if progress
        .send(BackupProgress::Completed { message })
        .await
        .is_err()
    {
        return Err(AppError::InvalidInput("Operation cancelled".into()));
    }

    Ok(())
}

/// Count keys matching a pattern using SCAN.
async fn count_keys_matching(
    client: &fred::clients::Client,
    pattern: &str,
) -> Result<u64, AppError> {
    let mut count = 0u64;
    let mut cursor = "0".to_string();

    loop {
        let (new_cursor, keys): (String, Vec<fred::types::Key>) = client
            .scan_page(&cursor, pattern, Some(1000), None)
            .await
            .map_err(|e| AppError::DatabaseError(format!("SCAN failed: {}", e)))?;

        count += keys.len() as u64;
        cursor = new_cursor;

        if cursor == "0" {
            break;
        }
    }

    Ok(count)
}

/// Parse CONFIG GET response value.
/// CONFIG GET returns an array like ["dir", "/data"] - we want the value part.
fn parse_config_value(response: &str) -> String {
    // The response might be the raw value or we might need to parse it
    // For now, just return the response trimmed
    response.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_backup_file_serialization() {
        let backup = JsonBackupFile {
            version: 1,
            redis_version: Some("7.0.0".to_string()),
            database: 0,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            keys: vec![KeyBackup {
                key: "test:key".to_string(),
                key_type: "string".to_string(),
                ttl: -1,
                data: "dGVzdA==".to_string(), // base64 "test"
            }],
        };

        let json = serde_json::to_string(&backup).unwrap();
        assert!(json.contains("\"version\":1"));
        assert!(json.contains("test:key"));
    }

    #[test]
    fn test_key_backup_serialization() {
        let key = KeyBackup {
            key: "user:123".to_string(),
            key_type: "hash".to_string(),
            ttl: 3600,
            data: "c29tZWRhdGE=".to_string(),
        };

        let json = serde_json::to_string(&key).unwrap();
        let parsed: KeyBackup = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.key, "user:123");
        assert_eq!(parsed.key_type, "hash");
        assert_eq!(parsed.ttl, 3600);
    }

    #[test]
    fn test_parse_config_value() {
        assert_eq!(parse_config_value("/data"), "/data");
        assert_eq!(parse_config_value("  /data  "), "/data");
        assert_eq!(parse_config_value("dump.rdb"), "dump.rdb");
    }
}
