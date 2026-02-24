//! PostgreSQL backup implementation using pg_dump/pg_restore CLI tools.
//!
//! PostgreSQL requires external tools (pg_dump, pg_restore) for backup/restore
//! operations. This implementation executes these tools as subprocesses.

use async_trait::async_trait;
use serde_json::json;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader as TokioBufReader};
use tokio::process::Command;

use crate::core::backup_capability::{
    BackupCapable, BackupConfig, BackupFormat, BackupObject, BackupObjectType, BackupOptionsSchema,
    BackupPreview, BackupPreviewObject, BackupProgress, FieldType, OptionField, ProgressSender,
    RestoreConfig, RestoreOptionsSchema, SelectOption, ToolPurpose, ToolRequirement,
};
use crate::core::tool_registry::ToolRegistry;
use crate::error::AppError;

use super::PostgresAdapter;

impl PostgresAdapter {
    /// Find pg_dump tool path, checking both PATH and Homebrew keg-only locations.
    async fn find_pg_dump() -> Result<String, AppError> {
        let status = ToolRegistry::check_tool("pg_dump").await;
        if status.installed {
            if let Some(path) = status.path {
                return Ok(path.to_string_lossy().to_string());
            }
        }
        Err(AppError::Internal(
            "pg_dump not found. Install PostgreSQL client tools: brew install libpq".to_string(),
        ))
    }

    /// Find pg_restore tool path, checking both PATH and Homebrew keg-only locations.
    async fn find_pg_restore() -> Result<String, AppError> {
        let status = ToolRegistry::check_tool("pg_restore").await;
        if status.installed {
            if let Some(path) = status.path {
                return Ok(path.to_string_lossy().to_string());
            }
        }
        Err(AppError::Internal(
            "pg_restore not found. Install PostgreSQL client tools: brew install libpq".to_string(),
        ))
    }

    /// Find psql tool path, checking both PATH and Homebrew keg-only locations.
    async fn find_psql() -> Result<String, AppError> {
        let status = ToolRegistry::check_tool("psql").await;
        if status.installed {
            if let Some(path) = status.path {
                return Ok(path.to_string_lossy().to_string());
            }
        }
        Err(AppError::Internal(
            "psql not found. Install PostgreSQL client tools: brew install libpq".to_string(),
        ))
    }
}

#[async_trait]
impl BackupCapable for PostgresAdapter {
    /// PostgreSQL requires pg_dump for backup and pg_restore for restore.
    fn tool_requirements(&self) -> Vec<ToolRequirement> {
        vec![
            ToolRequirement {
                name: "pg_dump".to_string(),
                purpose: ToolPurpose::Backup,
                download_size_mb: 50,
            },
            ToolRequirement {
                name: "pg_restore".to_string(),
                purpose: ToolPurpose::Restore,
                download_size_mb: 0, // Included with pg_dump
            },
        ]
    }

    /// PostgreSQL supports custom format (.dump) and plain SQL (.sql).
    fn supported_formats(&self) -> Vec<BackupFormat> {
        vec![
            BackupFormat {
                id: "custom".to_string(),
                name: "Custom Format".to_string(),
                extension: "dump".to_string(),
                description: "PostgreSQL custom format. Compressed, supports parallel restore, \
                    and selective object restore. Recommended for most use cases."
                    .to_string(),
            },
            BackupFormat {
                id: "plain".to_string(),
                name: "Plain SQL".to_string(),
                extension: "sql".to_string(),
                description: "Human-readable SQL script. Portable, can be edited manually, \
                    but larger and slower to restore."
                    .to_string(),
            },
            BackupFormat {
                id: "tar".to_string(),
                name: "Tar Archive".to_string(),
                extension: "tar".to_string(),
                description: "TAR archive format. Similar to custom format but compatible with \
                    standard archive tools."
                    .to_string(),
            },
            BackupFormat {
                id: "directory".to_string(),
                name: "Directory".to_string(),
                extension: "".to_string(),
                description:
                    "Directory format with one file per table. Supports parallel backup/restore. \
                    Best for very large databases."
                        .to_string(),
            },
        ]
    }

    /// Backup options schema for pg_dump.
    fn backup_options(&self) -> BackupOptionsSchema {
        BackupOptionsSchema {
            common: vec![
                OptionField {
                    key: "compression".to_string(),
                    label: "Compression Level".to_string(),
                    field_type: FieldType::Select {
                        options: vec![
                            SelectOption {
                                value: "0".to_string(),
                                label: "No compression".to_string(),
                            },
                            SelectOption {
                                value: "5".to_string(),
                                label: "Default (5)".to_string(),
                            },
                            SelectOption {
                                value: "9".to_string(),
                                label: "Maximum (9)".to_string(),
                            },
                        ],
                    },
                    default: json!("5"),
                    description: "Compression level for custom and directory formats (0-9)."
                        .to_string(),
                },
                OptionField {
                    key: "data_only".to_string(),
                    label: "Data Only".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Dump only data, not schema (tables, views, etc.).".to_string(),
                },
                OptionField {
                    key: "schema_only".to_string(),
                    label: "Schema Only".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Dump only schema, not data.".to_string(),
                },
            ],
            advanced: vec![
                OptionField {
                    key: "no_owner".to_string(),
                    label: "Skip Ownership".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Don't output commands to set ownership of objects.".to_string(),
                },
                OptionField {
                    key: "no_privileges".to_string(),
                    label: "Skip Privileges".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Don't output commands to set access privileges (GRANT/REVOKE)."
                        .to_string(),
                },
                OptionField {
                    key: "no_tablespaces".to_string(),
                    label: "Skip Tablespaces".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Don't output commands to select tablespaces.".to_string(),
                },
                OptionField {
                    key: "clean".to_string(),
                    label: "Include DROP Commands".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Include DROP commands before CREATE commands.".to_string(),
                },
                OptionField {
                    key: "if_exists".to_string(),
                    label: "Use IF EXISTS".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Use IF EXISTS with DROP commands.".to_string(),
                },
                OptionField {
                    key: "jobs".to_string(),
                    label: "Parallel Jobs".to_string(),
                    field_type: FieldType::Number {
                        min: Some(1.0),
                        max: Some(32.0),
                    },
                    default: json!(1),
                    description: "Number of parallel dump jobs (directory format only)."
                        .to_string(),
                },
            ],
        }
    }

    /// Restore options schema for pg_restore.
    fn restore_options(&self) -> RestoreOptionsSchema {
        RestoreOptionsSchema {
            common: vec![
                OptionField {
                    key: "clean".to_string(),
                    label: "Drop Existing Objects".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Drop database objects before recreating them.".to_string(),
                },
                OptionField {
                    key: "data_only".to_string(),
                    label: "Data Only".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Restore only data, not schema.".to_string(),
                },
            ],
            advanced: vec![
                OptionField {
                    key: "no_owner".to_string(),
                    label: "Skip Ownership".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Don't restore object ownership.".to_string(),
                },
                OptionField {
                    key: "no_privileges".to_string(),
                    label: "Skip Privileges".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Don't restore access privileges.".to_string(),
                },
                OptionField {
                    key: "no_tablespaces".to_string(),
                    label: "Skip Tablespaces".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Don't restore tablespace assignments.".to_string(),
                },
                OptionField {
                    key: "single_transaction".to_string(),
                    label: "Single Transaction".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Execute restore in a single transaction.".to_string(),
                },
                OptionField {
                    key: "jobs".to_string(),
                    label: "Parallel Jobs".to_string(),
                    field_type: FieldType::Number {
                        min: Some(1.0),
                        max: Some(32.0),
                    },
                    default: json!(1),
                    description: "Number of parallel restore jobs.".to_string(),
                },
                OptionField {
                    key: "exit_on_error".to_string(),
                    label: "Exit on Error".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Exit immediately if an error occurs during restore.".to_string(),
                },
            ],
        }
    }

    /// List schemas and tables that can be backed up.
    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError> {
        let pool = self
            .get_pool()
            .await
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let mut objects = Vec::new();

        // List schemas
        let schema_rows = client
            .query(
                "SELECT schema_name FROM information_schema.schemata
                 WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                 ORDER BY schema_name",
                &[],
            )
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to list schemas: {}", e)))?;

        for row in &schema_rows {
            let schema_name: String = row.get(0);
            objects.push(BackupObject {
                id: schema_name.clone(),
                name: schema_name,
                object_type: BackupObjectType::Schema,
                parent_id: None,
                estimated_size: None,
                row_count: None,
            });
        }

        // List tables with row counts and sizes
        let table_rows = client
            .query(
                "SELECT
                    t.table_schema,
                    t.table_name,
                    pg_stat_user_tables.n_live_tup as row_count,
                    pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) as total_size
                 FROM information_schema.tables t
                 LEFT JOIN pg_stat_user_tables
                    ON pg_stat_user_tables.schemaname = t.table_schema
                    AND pg_stat_user_tables.relname = t.table_name
                 WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                   AND t.table_type = 'BASE TABLE'
                 ORDER BY t.table_schema, t.table_name",
                &[],
            )
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to list tables: {}", e)))?;

        for row in &table_rows {
            let schema: String = row.get(0);
            let table: String = row.get(1);
            let row_count: Option<i64> = row.get(2);
            let total_size: Option<i64> = row.get(3);

            let full_name = format!("{}.{}", schema, table);
            objects.push(BackupObject {
                id: full_name.clone(),
                name: full_name,
                object_type: BackupObjectType::Table,
                parent_id: Some(schema.clone()),
                estimated_size: total_size.map(|s| s as u64),
                row_count: row_count.map(|c| c as u64),
            });
        }

        // List views
        let view_rows = client
            .query(
                "SELECT table_schema, table_name
                 FROM information_schema.views
                 WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                 ORDER BY table_schema, table_name",
                &[],
            )
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to list views: {}", e)))?;

        for row in &view_rows {
            let schema: String = row.get(0);
            let view: String = row.get(1);
            let full_name = format!("{}.{}", schema, view);
            objects.push(BackupObject {
                id: full_name.clone(),
                name: full_name,
                object_type: BackupObjectType::View,
                parent_id: Some(schema),
                estimated_size: None,
                row_count: None,
            });
        }

        Ok(objects)
    }

    /// Parse a backup file to preview its contents using pg_restore --list.
    async fn parse_backup_preview(&self, path: &Path) -> Result<BackupPreview, AppError> {
        let path_str = path.to_string_lossy().to_string();

        // Get file metadata
        let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let file_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        // Determine if this is a SQL file or a custom/tar format
        let extension = path
            .extension()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if extension == "sql" {
            // Parse SQL file manually
            return parse_sql_backup_preview(path, file_name, file_size);
        }

        // For custom/tar formats, use pg_restore --list
        let pg_restore = Self::find_pg_restore().await?;
        let output = Command::new(&pg_restore)
            .arg("--list")
            .arg(&path_str)
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to run pg_restore: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Internal(format!(
                "pg_restore --list failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let objects = parse_pg_restore_list(&stdout);

        Ok(BackupPreview {
            file_name,
            file_size,
            database_type: "PostgreSQL".to_string(),
            created_at: None,
            objects,
        })
    }

    /// Execute backup using pg_dump subprocess.
    /// Note: Connection parameters must be passed via config options since we can't
    /// extract password from the connection pool.
    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        // Extract connection parameters from config options
        let host = config
            .options
            .get("host")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing host in config".into()))?
            .to_string();

        let port = config
            .options
            .get("port")
            .and_then(|v| v.as_u64())
            .unwrap_or(5432) as u16;

        let user = config
            .options
            .get("user")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing user in config".into()))?
            .to_string();

        let password = config
            .options
            .get("password")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let database = config
            .options
            .get("database")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing database in config".into()))?
            .to_string();

        // Send started message
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Build pg_dump command
        let pg_dump = Self::find_pg_dump().await?;
        let mut cmd = Command::new(&pg_dump);
        cmd.arg("-h")
            .arg(&host)
            .arg("-p")
            .arg(port.to_string())
            .arg("-U")
            .arg(&user)
            .arg("-d")
            .arg(&database);

        // Set format based on config
        let format_flag = match config.format.as_str() {
            "custom" => "-Fc",
            "plain" => "-Fp",
            "tar" => "-Ft",
            "directory" => "-Fd",
            _ => "-Fc", // Default to custom
        };
        cmd.arg(format_flag);

        // Output file
        cmd.arg("-f").arg(&config.destination_path);

        // Parse and apply options
        if let Some(compression) = config.options.get("compression").and_then(|v| v.as_str()) {
            if compression != "0" {
                cmd.arg("-Z").arg(compression);
            }
        }

        if config
            .options
            .get("data_only")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            cmd.arg("--data-only");
        }

        if config
            .options
            .get("schema_only")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            cmd.arg("--schema-only");
        }

        if config
            .options
            .get("no_owner")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            cmd.arg("--no-owner");
        }

        if config
            .options
            .get("no_privileges")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            cmd.arg("--no-privileges");
        }

        if config
            .options
            .get("no_tablespaces")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            cmd.arg("--no-tablespaces");
        }

        if config
            .options
            .get("clean")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            cmd.arg("--clean");
        }

        if config
            .options
            .get("if_exists")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            cmd.arg("--if-exists");
        }

        // Parallel jobs (directory format only)
        if config.format == "directory" {
            if let Some(jobs) = config.options.get("jobs").and_then(|v| v.as_u64()) {
                if jobs > 1 {
                    cmd.arg("-j").arg(jobs.to_string());
                }
            }
        }

        // Selected tables (if any)
        if let Some(selected) = &config.selected_objects {
            for obj in selected {
                // Check if it's a schema or table
                if obj.contains('.') {
                    cmd.arg("-t").arg(obj);
                } else {
                    cmd.arg("-n").arg(obj);
                }
            }
        }

        // Verbose output for progress
        cmd.arg("-v");

        // Set password via environment variable
        cmd.env("PGPASSWORD", &password);

        // Setup stdio
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Starting backup of database '{}'...", database),
                is_error: false,
            })
            .await;

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to spawn pg_dump: {}", e)))?;

        // Read stderr for progress (pg_dump outputs to stderr with -v)
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Internal("Failed to capture stderr".into()))?;

        let progress_clone = progress.clone();
        let stderr_task = tokio::spawn(async move {
            let reader = TokioBufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                // Parse pg_dump verbose output
                let is_error = line.contains("error") || line.contains("ERROR");
                let _ = progress_clone
                    .send(BackupProgress::Output { line, is_error })
                    .await;
            }
        });

        // Wait for process to complete
        let status = child
            .wait()
            .await
            .map_err(|e| AppError::Internal(format!("pg_dump process error: {}", e)))?;

        // Wait for stderr reading to complete
        let _ = stderr_task.await;

        if !status.success() {
            let _ = progress
                .send(BackupProgress::Failed {
                    error: format!("pg_dump exited with code: {:?}", status.code()),
                })
                .await;
            return Err(AppError::Internal(format!(
                "pg_dump failed with exit code: {:?}",
                status.code()
            )));
        }

        // Send completion
        if progress
            .send(BackupProgress::Completed {
                message: format!("Backup completed successfully: {}", config.destination_path),
            })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        Ok(())
    }

    /// Execute restore using pg_restore or psql subprocess.
    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        // Extract connection parameters from config options
        let host = config
            .options
            .get("host")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing host in config".into()))?
            .to_string();

        let port = config
            .options
            .get("port")
            .and_then(|v| v.as_u64())
            .unwrap_or(5432) as u16;

        let user = config
            .options
            .get("user")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing user in config".into()))?
            .to_string();

        let password = config
            .options
            .get("password")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let database = config
            .options
            .get("database")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing database in config".into()))?
            .to_string();

        // Send started message
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Determine if this is a SQL file or custom/tar format
        let path = Path::new(&config.source_path);
        let extension = path
            .extension()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let is_sql = extension == "sql";

        let mut cmd = if is_sql {
            // Use psql for SQL files
            let psql = Self::find_psql().await?;
            let mut c = Command::new(&psql);
            c.arg("-h")
                .arg(&host)
                .arg("-p")
                .arg(port.to_string())
                .arg("-U")
                .arg(&user)
                .arg("-d")
                .arg(&database)
                .arg("-f")
                .arg(&config.source_path);
            c
        } else {
            // Use pg_restore for custom/tar formats
            let pg_restore = Self::find_pg_restore().await?;
            let mut c = Command::new(&pg_restore);
            c.arg("-h")
                .arg(&host)
                .arg("-p")
                .arg(port.to_string())
                .arg("-U")
                .arg(&user)
                .arg("-d")
                .arg(&database);

            // Parse and apply options
            if config
                .options
                .get("clean")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                c.arg("--clean");
            }

            if config
                .options
                .get("data_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                c.arg("--data-only");
            }

            if config
                .options
                .get("no_owner")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                c.arg("--no-owner");
            }

            if config
                .options
                .get("no_privileges")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                c.arg("--no-privileges");
            }

            if config
                .options
                .get("no_tablespaces")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                c.arg("--no-tablespaces");
            }

            if config
                .options
                .get("single_transaction")
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
            {
                c.arg("--single-transaction");
            }

            if let Some(jobs) = config.options.get("jobs").and_then(|v| v.as_u64()) {
                if jobs > 1 {
                    c.arg("-j").arg(jobs.to_string());
                }
            }

            if config
                .options
                .get("exit_on_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                c.arg("--exit-on-error");
            }

            // Verbose output
            c.arg("-v");

            // Input file
            c.arg(&config.source_path);
            c
        };

        // Set password via environment variable
        cmd.env("PGPASSWORD", &password);

        // Setup stdio
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let tool_name = if is_sql { "psql" } else { "pg_restore" };
        let _ = progress
            .send(BackupProgress::Output {
                line: format!(
                    "Starting restore to database '{}' using {}...",
                    database, tool_name
                ),
                is_error: false,
            })
            .await;

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to spawn {}: {}", tool_name, e)))?;

        // Read stderr for progress
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Internal("Failed to capture stderr".into()))?;

        let progress_clone = progress.clone();
        let stderr_task = tokio::spawn(async move {
            let reader = TokioBufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                let is_error = line.contains("error") || line.contains("ERROR");
                let _ = progress_clone
                    .send(BackupProgress::Output { line, is_error })
                    .await;
            }
        });

        // Wait for process to complete
        let status = child
            .wait()
            .await
            .map_err(|e| AppError::Internal(format!("{} process error: {}", tool_name, e)))?;

        // Wait for stderr reading to complete
        let _ = stderr_task.await;

        if !status.success() {
            let _ = progress
                .send(BackupProgress::Failed {
                    error: format!("{} exited with code: {:?}", tool_name, status.code()),
                })
                .await;
            return Err(AppError::Internal(format!(
                "{} failed with exit code: {:?}",
                tool_name,
                status.code()
            )));
        }

        // Send completion
        if progress
            .send(BackupProgress::Completed {
                message: format!(
                    "Restore completed successfully from: {}",
                    config.source_path
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

/// Parse pg_restore --list output to extract backup objects.
fn parse_pg_restore_list(output: &str) -> Vec<BackupPreviewObject> {
    let mut objects = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in output.lines() {
        let line = line.trim();

        // Skip comments and empty lines
        if line.is_empty() || line.starts_with(';') {
            continue;
        }

        // Parse TOC entry format: "id; type namespace name owner"
        // Example: "3458; 1259 16389 TABLE public users postgres"
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            // Try to find type and name
            // Format varies but typically: id; type_oid type_name schema_or_name name
            let type_idx = parts.iter().position(|&p| {
                matches!(
                    p.to_uppercase().as_str(),
                    "TABLE"
                        | "VIEW"
                        | "SEQUENCE"
                        | "INDEX"
                        | "FUNCTION"
                        | "SCHEMA"
                        | "TYPE"
                        | "CONSTRAINT"
                        | "TRIGGER"
                )
            });

            if let Some(idx) = type_idx {
                let obj_type = parts[idx].to_lowercase();
                // Name is typically after schema (if present)
                let name = if idx + 2 < parts.len() {
                    format!("{}.{}", parts[idx + 1], parts[idx + 2])
                } else if idx + 1 < parts.len() {
                    parts[idx + 1].to_string()
                } else {
                    continue;
                };

                // Deduplicate
                let key = format!("{}:{}", obj_type, name);
                if !seen.insert(key) {
                    continue;
                }

                objects.push(BackupPreviewObject {
                    name,
                    object_type: obj_type,
                    row_count: None,
                });
            }
        }
    }

    objects
}

/// Parse a SQL backup file to preview its contents.
fn parse_sql_backup_preview(
    path: &Path,
    file_name: String,
    file_size: u64,
) -> Result<BackupPreview, AppError> {
    let file = fs::File::open(path)
        .map_err(|e| AppError::Io(format!("Failed to open backup file: {}", e)))?;

    let reader = BufReader::new(file);
    let mut objects = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in reader.lines() {
        let line = line.map_err(|e| AppError::Io(format!("Failed to read line: {}", e)))?;
        let upper = line.to_uppercase();

        // Look for CREATE TABLE statements
        if upper.contains("CREATE TABLE") {
            if let Some(name) = extract_pg_identifier(&line, "CREATE TABLE") {
                if seen.insert(format!("table:{}", name)) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "table".to_string(),
                        row_count: None,
                    });
                }
            }
        }
        // Look for CREATE VIEW statements
        else if upper.contains("CREATE VIEW") || upper.contains("CREATE OR REPLACE VIEW") {
            if let Some(name) = extract_pg_identifier(&line, "CREATE VIEW")
                .or_else(|| extract_pg_identifier(&line, "CREATE OR REPLACE VIEW"))
            {
                if seen.insert(format!("view:{}", name)) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "view".to_string(),
                        row_count: None,
                    });
                }
            }
        }
        // Look for CREATE SCHEMA statements
        else if upper.contains("CREATE SCHEMA") {
            if let Some(name) = extract_pg_identifier(&line, "CREATE SCHEMA") {
                if seen.insert(format!("schema:{}", name)) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "schema".to_string(),
                        row_count: None,
                    });
                }
            }
        }
        // Look for CREATE SEQUENCE statements
        else if upper.contains("CREATE SEQUENCE") {
            if let Some(name) = extract_pg_identifier(&line, "CREATE SEQUENCE") {
                if seen.insert(format!("sequence:{}", name)) {
                    objects.push(BackupPreviewObject {
                        name,
                        object_type: "sequence".to_string(),
                        row_count: None,
                    });
                }
            }
        }
    }

    Ok(BackupPreview {
        file_name,
        file_size,
        database_type: "PostgreSQL".to_string(),
        created_at: None,
        objects,
    })
}

/// Extract PostgreSQL identifier from a CREATE statement.
fn extract_pg_identifier(line: &str, keyword: &str) -> Option<String> {
    let upper = line.to_uppercase();
    let kw_upper = keyword.to_uppercase();
    let start = upper.find(&kw_upper)?;
    let rest = &line[start + keyword.len()..].trim_start();

    // Handle IF NOT EXISTS
    let rest = if rest.to_uppercase().starts_with("IF NOT EXISTS") {
        rest[13..].trim_start()
    } else {
        rest
    };

    extract_identifier(rest)
}

/// Extract an identifier (schema.name or just name) from the start of a string.
fn extract_identifier(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    // Handle quoted identifiers
    if s.starts_with('"') {
        // Find closing quote
        let rest = &s[1..];
        if let Some(end) = rest.find('"') {
            let first = &rest[..end];
            // Check for schema.table pattern
            let after = &rest[end + 1..];
            if after.starts_with('.') {
                let schema_table = extract_second_identifier(&after[1..])
                    .map(|t| format!("{}.{}", first, t))
                    .unwrap_or_else(|| first.to_string());
                return Some(schema_table);
            }
            return Some(first.to_string());
        }
        return None;
    }

    // Unquoted identifier
    let end = s
        .find(|c: char| c.is_whitespace() || c == '(' || c == ';')
        .unwrap_or(s.len());

    if end > 0 {
        let ident = &s[..end];
        // Handle schema.table (both parts unquoted)
        if ident.contains('.') {
            return Some(ident.to_string());
        }
        Some(ident.to_string())
    } else {
        None
    }
}

/// Extract the second identifier (table name) after a dot.
fn extract_second_identifier(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    if s.starts_with('"') {
        let rest = &s[1..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
        return None;
    }

    let end = s
        .find(|c: char| c.is_whitespace() || c == '(' || c == ';')
        .unwrap_or(s.len());

    if end > 0 {
        Some(s[..end].to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_formats() {
        let adapter = PostgresAdapter::new();
        let formats = adapter.supported_formats();

        assert_eq!(formats.len(), 4);
        assert!(formats.iter().any(|f| f.id == "custom"));
        assert!(formats.iter().any(|f| f.id == "plain"));
        assert!(formats.iter().any(|f| f.id == "tar"));
        assert!(formats.iter().any(|f| f.id == "directory"));
    }

    #[test]
    fn test_tool_requirements() {
        let adapter = PostgresAdapter::new();
        let requirements = adapter.tool_requirements();

        assert_eq!(requirements.len(), 2);
        assert!(requirements.iter().any(|t| t.name == "pg_dump"));
        assert!(requirements.iter().any(|t| t.name == "pg_restore"));
    }

    #[test]
    fn test_backup_options() {
        let adapter = PostgresAdapter::new();
        let options = adapter.backup_options();

        // Should have compression in common options
        assert!(!options.common.is_empty());
        assert!(options.common.iter().any(|o| o.key == "compression"));
        assert!(options.common.iter().any(|o| o.key == "data_only"));
        assert!(options.common.iter().any(|o| o.key == "schema_only"));

        // Should have advanced options
        assert!(options.advanced.iter().any(|o| o.key == "no_owner"));
        assert!(options.advanced.iter().any(|o| o.key == "jobs"));
    }

    #[test]
    fn test_restore_options() {
        let adapter = PostgresAdapter::new();
        let options = adapter.restore_options();

        // Should have clean option
        assert!(options.common.iter().any(|o| o.key == "clean"));

        // Should have advanced options
        assert!(options
            .advanced
            .iter()
            .any(|o| o.key == "single_transaction"));
        assert!(options.advanced.iter().any(|o| o.key == "jobs"));
    }

    #[test]
    fn test_parse_pg_restore_list() {
        let output = r#"
;
; Archive created at 2024-01-15 10:00:00 UTC
;
3456; 1259 16389 TABLE public users postgres
3457; 1259 16400 TABLE public orders postgres
3458; 1247 16420 VIEW public user_orders postgres
"#;

        let objects = parse_pg_restore_list(output);

        assert!(!objects.is_empty());
        // Should find tables and views
        assert!(objects.iter().any(|o| o.object_type == "table"));
    }

    #[test]
    fn test_extract_identifier() {
        assert_eq!(extract_identifier("users ("), Some("users".to_string()));
        assert_eq!(
            extract_identifier("\"quoted_name\" ("),
            Some("quoted_name".to_string())
        );
        assert_eq!(
            extract_identifier("public.users ("),
            Some("public.users".to_string())
        );
        assert_eq!(
            extract_identifier("\"public\".\"users\" ("),
            Some("public.users".to_string())
        );
    }
}
