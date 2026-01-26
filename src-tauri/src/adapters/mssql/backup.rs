//! MSSQL backup implementation using native T-SQL commands.
//!
//! SQL Server supports native BACKUP DATABASE and RESTORE DATABASE commands.
//! Note: MSSQL backups are server-side operations - the backup path must be
//! accessible from the SQL Server instance, not the client machine.

use async_trait::async_trait;
use serde_json::json;
use std::fs;
use std::path::Path;

use crate::core::backup_capability::{
    BackupCapable, BackupConfig, BackupFormat, BackupObject, BackupObjectType,
    BackupOptionsSchema, BackupPreview, BackupPreviewObject, FieldType, OptionField,
    ProgressSender, RestoreConfig, RestoreOptionsSchema, ToolRequirement,
};
use crate::core::backup_capability::BackupProgress;
use crate::error::AppError;

use super::MssqlAdapter;

#[async_trait]
impl BackupCapable for MssqlAdapter {
    /// MSSQL uses native T-SQL commands, no external tools required.
    fn tool_requirements(&self) -> Vec<ToolRequirement> {
        vec![]
    }

    /// MSSQL supports .bak (native backup) format.
    fn supported_formats(&self) -> Vec<BackupFormat> {
        vec![BackupFormat {
            id: "bak".to_string(),
            name: "Native Backup".to_string(),
            extension: "bak".to_string(),
            description: "SQL Server native backup format (.bak). The backup path must be accessible from the SQL Server instance.".to_string(),
        }]
    }

    /// Backup options schema - MSSQL supports compression.
    fn backup_options(&self) -> BackupOptionsSchema {
        BackupOptionsSchema {
            common: vec![OptionField {
                key: "compression".to_string(),
                label: "Enable Compression".to_string(),
                field_type: FieldType::Bool,
                default: json!(true),
                description: "Compress the backup file to reduce size. Requires SQL Server Enterprise or Standard edition.".to_string(),
            }],
            advanced: vec![
                OptionField {
                    key: "copy_only".to_string(),
                    label: "Copy-Only Backup".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(false),
                    description: "Create a copy-only backup that doesn't affect the normal backup sequence.".to_string(),
                },
                OptionField {
                    key: "checksum".to_string(),
                    label: "Verify Checksum".to_string(),
                    field_type: FieldType::Bool,
                    default: json!(true),
                    description: "Generate and verify page checksums during backup.".to_string(),
                },
            ],
        }
    }

    /// Restore options - MSSQL restore supports REPLACE option.
    fn restore_options(&self) -> RestoreOptionsSchema {
        RestoreOptionsSchema {
            common: vec![OptionField {
                key: "replace".to_string(),
                label: "Replace Existing Database".to_string(),
                field_type: FieldType::Bool,
                default: json!(true),
                description: "Replace the existing database if it exists. Required when restoring over an existing database.".to_string(),
            }],
            advanced: vec![OptionField {
                key: "recovery".to_string(),
                label: "Recovery State".to_string(),
                field_type: FieldType::Bool,
                default: json!(true),
                description: "Complete the recovery process and bring the database online. Disable for additional log restores.".to_string(),
            }],
        }
    }

    /// List tables that can be backed up.
    /// Note: MSSQL native backup always backs up the entire database.
    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError> {
        let pool = self.get_pool().await.ok_or_else(|| {
            AppError::ConnectionClosed("Not connected".into())
        })?;

        let mut conn = pool.get().await.map_err(|e| {
            AppError::Internal(format!("Failed to get connection: {}", e))
        })?;

        // Query for tables with row counts
        let sql = r#"
            SELECT
                s.name AS schema_name,
                t.name AS table_name,
                p.rows AS row_count,
                SUM(a.total_pages) * 8 * 1024 AS estimated_size
            FROM sys.tables t
            INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
            INNER JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
            INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
            GROUP BY s.name, t.name, p.rows
            ORDER BY s.name, t.name
        "#;

        let result = conn
            .simple_query(sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        let rows = result
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get result: {}", e)))?;

        let mut objects = Vec::new();

        for row in rows {
            let schema_name: Option<&str> = row.get(0);
            let table_name: Option<&str> = row.get(1);
            let row_count: Option<i64> = row.get(2);
            let estimated_size: Option<i64> = row.get(3);

            let schema = schema_name.unwrap_or("dbo");
            let table = table_name.unwrap_or("");

            if table.is_empty() {
                continue;
            }

            let full_name = format!("{}.{}", schema, table);

            objects.push(BackupObject {
                id: full_name.clone(),
                name: full_name,
                object_type: BackupObjectType::Table,
                parent_id: Some(schema.to_string()),
                estimated_size: estimated_size.map(|s| s as u64),
                row_count: row_count.map(|c| c as u64),
            });
        }

        // Also list views
        let view_sql = r#"
            SELECT
                s.name AS schema_name,
                v.name AS view_name
            FROM sys.views v
            INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
            ORDER BY s.name, v.name
        "#;

        let view_result = conn
            .simple_query(view_sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("View query failed: {}", e)))?;

        let view_rows = view_result
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get view result: {}", e)))?;

        for row in view_rows {
            let schema_name: Option<&str> = row.get(0);
            let view_name: Option<&str> = row.get(1);

            let schema = schema_name.unwrap_or("dbo");
            let view = view_name.unwrap_or("");

            if view.is_empty() {
                continue;
            }

            let full_name = format!("{}.{}", schema, view);

            objects.push(BackupObject {
                id: full_name.clone(),
                name: full_name,
                object_type: BackupObjectType::View,
                parent_id: Some(schema.to_string()),
                estimated_size: None,
                row_count: None,
            });
        }

        Ok(objects)
    }

    /// Parse a backup file to preview its contents using RESTORE FILELISTONLY.
    /// Note: This requires the backup file to be accessible from the SQL Server.
    async fn parse_backup_preview(&self, path: &Path) -> Result<BackupPreview, AppError> {
        let path_str = path.to_string_lossy().to_string();

        // Get file metadata if accessible from client
        let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let file_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let pool = self.get_pool().await.ok_or_else(|| {
            AppError::ConnectionClosed("Not connected".into())
        })?;

        let mut conn = pool.get().await.map_err(|e| {
            AppError::Internal(format!("Failed to get connection: {}", e))
        })?;

        // Use RESTORE FILELISTONLY to get backup contents
        let escaped_path = path_str.replace('\'', "''");
        let sql = format!(
            "RESTORE FILELISTONLY FROM DISK = N'{}'",
            escaped_path
        );

        let result = conn
            .simple_query(&sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!(
                "Failed to read backup file info. Ensure the path is accessible from the SQL Server: {}", e
            )))?;

        let rows = result
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get result: {}", e)))?;

        let mut objects = Vec::new();

        for row in rows {
            let logical_name: Option<&str> = row.get(0);
            let file_type: Option<&str> = row.get(2);

            let name = logical_name.unwrap_or("").to_string();
            let obj_type = file_type.unwrap_or("").to_string();

            if !name.is_empty() {
                objects.push(BackupPreviewObject {
                    name,
                    object_type: obj_type,
                    row_count: None,
                });
            }
        }

        // Get header info for database name and backup time
        let header_sql = format!(
            "RESTORE HEADERONLY FROM DISK = N'{}'",
            escaped_path
        );

        let header_result = conn
            .simple_query(&header_sql)
            .await
            .ok();

        let mut created_at = None;
        if let Some(result) = header_result {
            if let Ok(header_rows) = result.into_first_result().await {
                if let Some(row) = header_rows.into_iter().next() {
                    // BackupFinishDate is typically column 16
                    let backup_date: Option<chrono::NaiveDateTime> = row.get(16);
                    created_at = backup_date.map(|d| d.to_string());
                }
            }
        }

        Ok(BackupPreview {
            file_name,
            file_size,
            database_type: "SQL Server".to_string(),
            created_at,
            objects,
        })
    }

    /// Execute backup using BACKUP DATABASE T-SQL command.
    /// Note: The destination path must be accessible from the SQL Server instance.
    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let pool = self.get_pool().await.ok_or_else(|| {
            AppError::ConnectionClosed("Not connected".into())
        })?;

        let mut conn = pool.get().await.map_err(|e| {
            AppError::Internal(format!("Failed to get connection: {}", e))
        })?;

        // Send started message
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Get current database name
        let db_result = conn
            .simple_query("SELECT DB_NAME()")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get database name: {}", e)))?;

        let db_rows = db_result
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get result: {}", e)))?;

        let db_name = db_rows
            .into_iter()
            .next()
            .and_then(|row| row.get::<&str, _>(0).map(|s| s.to_string()))
            .ok_or_else(|| AppError::DatabaseError("Could not determine database name".into()))?;

        // Parse options
        let compression = config
            .options
            .get("compression")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let copy_only = config
            .options
            .get("copy_only")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let checksum = config
            .options
            .get("checksum")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        // Build BACKUP command
        let escaped_path = config.destination_path.replace('\'', "''");
        let escaped_db = db_name.replace(']', "]]");

        let mut options = vec!["FORMAT".to_string(), "INIT".to_string()];

        if compression {
            options.push("COMPRESSION".to_string());
        }
        if copy_only {
            options.push("COPY_ONLY".to_string());
        }
        if checksum {
            options.push("CHECKSUM".to_string());
        }

        let sql = format!(
            "BACKUP DATABASE [{}] TO DISK = N'{}' WITH {}",
            escaped_db,
            escaped_path,
            options.join(", ")
        );

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Starting backup of database [{}]...", db_name),
                is_error: false,
            })
            .await;

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Destination: {}", config.destination_path),
                is_error: false,
            })
            .await;

        // Execute backup command
        let result = conn
            .simple_query(&sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Backup failed: {}", e)))?;

        // Consume the result to ensure the command completes
        let _ = result.into_first_result().await;

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
                    "Backup completed successfully. Database [{}] backed up to {}",
                    db_name, config.destination_path
                ),
            })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        Ok(())
    }

    /// Execute restore using RESTORE DATABASE T-SQL command.
    /// Note: The source path must be accessible from the SQL Server instance.
    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let pool = self.get_pool().await.ok_or_else(|| {
            AppError::ConnectionClosed("Not connected".into())
        })?;

        let mut conn = pool.get().await.map_err(|e| {
            AppError::Internal(format!("Failed to get connection: {}", e))
        })?;

        // Send started message
        if progress
            .send(BackupProgress::Started { total_steps: None })
            .await
            .is_err()
        {
            return Err(AppError::InvalidInput("Operation cancelled".into()));
        }

        // Get current database name
        let db_result = conn
            .simple_query("SELECT DB_NAME()")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get database name: {}", e)))?;

        let db_rows = db_result
            .into_first_result()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to get result: {}", e)))?;

        let db_name = db_rows
            .into_iter()
            .next()
            .and_then(|row| row.get::<&str, _>(0).map(|s| s.to_string()))
            .ok_or_else(|| AppError::DatabaseError("Could not determine database name".into()))?;

        // Parse options
        let replace = config
            .options
            .get("replace")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let recovery = config
            .options
            .get("recovery")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        // Build RESTORE command
        let escaped_path = config.source_path.replace('\'', "''");
        let escaped_db = db_name.replace(']', "]]");

        let mut options = Vec::new();

        if replace {
            options.push("REPLACE".to_string());
        }

        if recovery {
            options.push("RECOVERY".to_string());
        } else {
            options.push("NORECOVERY".to_string());
        }

        let sql = if options.is_empty() {
            format!(
                "RESTORE DATABASE [{}] FROM DISK = N'{}'",
                escaped_db,
                escaped_path
            )
        } else {
            format!(
                "RESTORE DATABASE [{}] FROM DISK = N'{}' WITH {}",
                escaped_db,
                escaped_path,
                options.join(", ")
            )
        };

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Starting restore of database [{}]...", db_name),
                is_error: false,
            })
            .await;

        let _ = progress
            .send(BackupProgress::Output {
                line: format!("Source: {}", config.source_path),
                is_error: false,
            })
            .await;

        // For restore, we need to switch to master database first
        // because we can't restore a database while connected to it
        let _ = conn
            .simple_query("USE master")
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to switch to master: {}", e)))?
            .into_first_result()
            .await;

        // Set database to single user mode to allow restore
        let single_user_sql = format!(
            "ALTER DATABASE [{}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE",
            escaped_db
        );

        // Try to set single user mode (may fail if database doesn't exist)
        let _ = conn.simple_query(&single_user_sql).await;

        // Execute restore command
        let result = conn
            .simple_query(&sql)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Restore failed: {}", e)))?;

        // Consume the result to ensure the command completes
        let _ = result.into_first_result().await;

        // Set database back to multi-user mode
        let multi_user_sql = format!(
            "ALTER DATABASE [{}] SET MULTI_USER",
            escaped_db
        );
        let _ = conn.simple_query(&multi_user_sql).await;

        // Switch back to the restored database
        let use_db_sql = format!("USE [{}]", escaped_db);
        let _ = conn.simple_query(&use_db_sql).await;

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
                    "Restore completed successfully. Database [{}] restored from {}",
                    db_name, config.source_path
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_formats() {
        let adapter = MssqlAdapter::new();
        let formats = adapter.supported_formats();

        assert_eq!(formats.len(), 1);
        assert_eq!(formats[0].id, "bak");
        assert_eq!(formats[0].extension, "bak");
    }

    #[test]
    fn test_tool_requirements() {
        let adapter = MssqlAdapter::new();
        let requirements = adapter.tool_requirements();

        // MSSQL uses native T-SQL, no external tools
        assert!(requirements.is_empty());
    }

    #[test]
    fn test_backup_options() {
        let adapter = MssqlAdapter::new();
        let options = adapter.backup_options();

        // Should have compression in common options
        assert!(!options.common.is_empty());
        assert!(options.common.iter().any(|o| o.key == "compression"));

        // Should have copy_only and checksum in advanced
        assert!(options.advanced.iter().any(|o| o.key == "copy_only"));
        assert!(options.advanced.iter().any(|o| o.key == "checksum"));
    }

    #[test]
    fn test_restore_options() {
        let adapter = MssqlAdapter::new();
        let options = adapter.restore_options();

        // Should have replace option
        assert!(options.common.iter().any(|o| o.key == "replace"));

        // Should have recovery option
        assert!(options.advanced.iter().any(|o| o.key == "recovery"));
    }
}
