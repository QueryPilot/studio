//! Backup capability trait and types for database adapters
//!
//! This module defines the backup/restore capability that allows database adapters
//! to support backup and restore operations with streaming progress updates.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use tokio::sync::mpsc;

use crate::error::AppError;

// ============ Types ============

/// Tool requirement for external backup tools
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequirement {
    pub name: String,
    pub purpose: ToolPurpose,
    pub download_size_mb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ToolPurpose {
    Backup,
    Restore,
    Both,
}

/// Supported backup formats
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFormat {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub description: String,
}

/// Field types for dynamic option rendering
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FieldType {
    Bool,
    String,
    Number { min: Option<f64>, max: Option<f64> },
    Select { options: Vec<SelectOption> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

/// Single option field for dynamic UI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionField {
    pub key: String,
    pub label: String,
    pub field_type: FieldType,
    pub default: Value,
    pub description: String,
}

/// Schema for backup options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOptionsSchema {
    pub common: Vec<OptionField>,
    pub advanced: Vec<OptionField>,
}

/// Schema for restore options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOptionsSchema {
    pub common: Vec<OptionField>,
    pub advanced: Vec<OptionField>,
}

/// Object that can be backed up (table, collection, key pattern)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupObject {
    pub id: String,
    pub name: String,
    pub object_type: BackupObjectType,
    pub parent_id: Option<String>,
    pub estimated_size: Option<u64>,
    pub row_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupObjectType {
    Schema,
    Table,
    View,
    Collection,
    KeyPattern,
    Database,
}

/// Backup configuration from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    pub destination_path: String,
    pub format: String,
    pub selected_objects: Option<Vec<String>>,
    pub options: Value,
}

/// Restore configuration from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreConfig {
    pub source_path: String,
    pub options: Value,
}

/// Preview of backup file contents
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    pub file_name: String,
    pub file_size: u64,
    pub database_type: String,
    pub created_at: Option<String>,
    pub objects: Vec<BackupPreviewObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreviewObject {
    pub name: String,
    pub object_type: String,
    pub row_count: Option<u64>,
}

/// Progress messages sent during backup/restore
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BackupProgress {
    Started {
        total_steps: Option<u32>,
    },
    Progress {
        current: u32,
        total: u32,
        message: String,
    },
    Output {
        line: String,
        is_error: bool,
    },
    Completed {
        message: String,
    },
    Failed {
        error: String,
    },
}

pub type ProgressSender = mpsc::Sender<BackupProgress>;

// ============ Trait ============

/// Backup capability trait - implemented by database adapters that support backup/restore
#[async_trait]
pub trait BackupCapable: Send + Sync {
    /// Returns tool requirements for this database type.
    /// Returns empty vec for native Rust implementations (SQLite, MSSQL, Redis).
    fn tool_requirements(&self) -> Vec<ToolRequirement>;

    /// Returns available backup formats
    fn supported_formats(&self) -> Vec<BackupFormat>;

    /// Returns configurable options with defaults
    fn backup_options(&self) -> BackupOptionsSchema;
    fn restore_options(&self) -> RestoreOptionsSchema;

    /// Introspect database for selective backup UI
    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError>;

    /// Parse backup file for preview
    async fn parse_backup_preview(&self, path: &Path) -> Result<BackupPreview, AppError>;

    /// Execute backup (streams progress via channel)
    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError>;

    /// Execute restore (streams progress via channel)
    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_purpose_equality() {
        assert_eq!(ToolPurpose::Backup, ToolPurpose::Backup);
        assert_eq!(ToolPurpose::Restore, ToolPurpose::Restore);
        assert_eq!(ToolPurpose::Both, ToolPurpose::Both);
        assert_ne!(ToolPurpose::Backup, ToolPurpose::Restore);
    }

    #[test]
    fn test_backup_config_serialization() {
        let config = BackupConfig {
            destination_path: "/tmp/backup.sql".to_string(),
            format: "sql".to_string(),
            selected_objects: Some(vec!["public.users".to_string()]),
            options: serde_json::json!({"compress": true}),
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: BackupConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.destination_path, config.destination_path);
        assert_eq!(deserialized.format, config.format);
    }

    #[test]
    fn test_backup_progress_variants() {
        let started = BackupProgress::Started {
            total_steps: Some(10),
        };
        let progress = BackupProgress::Progress {
            current: 5,
            total: 10,
            message: "Backing up table users".to_string(),
        };
        let output = BackupProgress::Output {
            line: "COPY 1000 rows".to_string(),
            is_error: false,
        };
        let completed = BackupProgress::Completed {
            message: "Backup completed successfully".to_string(),
        };
        let failed = BackupProgress::Failed {
            error: "Permission denied".to_string(),
        };

        // Verify serialization works for all variants
        assert!(serde_json::to_string(&started).is_ok());
        assert!(serde_json::to_string(&progress).is_ok());
        assert!(serde_json::to_string(&output).is_ok());
        assert!(serde_json::to_string(&completed).is_ok());
        assert!(serde_json::to_string(&failed).is_ok());
    }

    #[test]
    fn test_field_type_variants() {
        let bool_field = FieldType::Bool;
        let string_field = FieldType::String;
        let number_field = FieldType::Number {
            min: Some(0.0),
            max: Some(100.0),
        };
        let select_field = FieldType::Select {
            options: vec![
                SelectOption {
                    value: "fast".to_string(),
                    label: "Fast".to_string(),
                },
                SelectOption {
                    value: "best".to_string(),
                    label: "Best Compression".to_string(),
                },
            ],
        };

        // Verify serialization works for all variants
        assert!(serde_json::to_string(&bool_field).is_ok());
        assert!(serde_json::to_string(&string_field).is_ok());
        assert!(serde_json::to_string(&number_field).is_ok());
        assert!(serde_json::to_string(&select_field).is_ok());
    }

    #[test]
    fn test_backup_object_type_serialization() {
        let obj = BackupObject {
            id: "public.users".to_string(),
            name: "users".to_string(),
            object_type: BackupObjectType::Table,
            parent_id: Some("public".to_string()),
            estimated_size: Some(1024 * 1024),
            row_count: Some(10000),
        };

        let json = serde_json::to_string(&obj).unwrap();
        assert!(json.contains("\"objectType\":\"table\""));
    }
}
