# Backup/Restore Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone Backup/Restore window that lets users backup and restore databases using native formats.

**Architecture:** Trait-based `BackupCapable` adapters following existing capability pattern. Native Rust for SQLite/MSSQL/Redis, external tools (downloaded on demand) for PostgreSQL/MySQL/MongoDB. Wizard-style UI with 4 steps.

**Tech Stack:** Rust (async-trait, tokio), TypeScript/React, Tauri 2 IPC channels, shadcn/ui components.

---

## Phase 1: Foundation (Backend Types & Trait)

### Task 1.1: Create BackupCapable Trait and Types

**Files:**
- Create: `src-tauri/src/core/backup_capability.rs`
- Modify: `src-tauri/src/core/mod.rs`

**Step 1: Create the backup capability module with types**

```rust
// src-tauri/src/core/backup_capability.rs

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use tokio::sync::mpsc;

use crate::error::AppError;

// ============ Types ============

/// Tool requirement for external backup tools
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRequirement {
    pub name: String,
    pub purpose: ToolPurpose,
    pub download_size_mb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ToolPurpose {
    Backup,
    Restore,
    Both,
}

/// Supported backup formats
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupFormat {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub description: String,
}

/// Field types for dynamic option rendering
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FieldType {
    Bool,
    String,
    Number { min: Option<f64>, max: Option<f64> },
    Select { options: Vec<SelectOption> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

/// Single option field for dynamic UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionField {
    pub key: String,
    pub label: String,
    pub field_type: FieldType,
    pub default: Value,
    pub description: String,
}

/// Schema for backup options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupOptionsSchema {
    pub common: Vec<OptionField>,
    pub advanced: Vec<OptionField>,
}

/// Schema for restore options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreOptionsSchema {
    pub common: Vec<OptionField>,
    pub advanced: Vec<OptionField>,
}

/// Object that can be backed up (table, collection, key pattern)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupObject {
    pub id: String,
    pub name: String,
    pub object_type: BackupObjectType,
    pub parent_id: Option<String>,
    pub estimated_size: Option<u64>,
    pub row_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct BackupConfig {
    pub destination_path: String,
    pub format: String,
    pub selected_objects: Option<Vec<String>>,
    pub options: Value,
}

/// Restore configuration from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreConfig {
    pub source_path: String,
    pub options: Value,
}

/// Preview of backup file contents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPreview {
    pub file_name: String,
    pub file_size: u64,
    pub database_type: String,
    pub created_at: Option<String>,
    pub objects: Vec<BackupPreviewObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPreviewObject {
    pub name: String,
    pub object_type: String,
    pub row_count: Option<u64>,
}

/// Progress messages sent during backup/restore
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BackupProgress {
    Started { total_steps: Option<u32> },
    Progress { current: u32, total: u32, message: String },
    Output { line: String, is_error: bool },
    Completed { message: String },
    Failed { error: String },
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
```

**Step 2: Update core/mod.rs to export the new module**

Add to `src-tauri/src/core/mod.rs`:
```rust
pub mod backup_capability;
pub use backup_capability::*;
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 4: Commit**

```bash
git add src-tauri/src/core/backup_capability.rs src-tauri/src/core/mod.rs
git commit -m "feat(backup): add BackupCapable trait and types"
```

---

### Task 1.2: Add BackupCapable to UnifiedAdapter

**Files:**
- Modify: `src-tauri/src/core/manager.rs`
- Modify: `src-tauri/src/core/capabilities.rs`

**Step 1: Add BackupCapable to AdapterCapability enum**

In `src-tauri/src/core/capabilities.rs`, add to the `AdapterCapability` enum:
```rust
pub enum AdapterCapability {
    SqlQueryable,
    DocumentQueryable,
    KeyValueOperable,
    RichKeyValueOperable,
    BackupCapable,  // Add this
}
```

**Step 2: Add backup pointer field to UnifiedAdapter**

In `src-tauri/src/core/manager.rs`, add to `UnifiedAdapter` struct:
```rust
pub struct UnifiedAdapter {
    inner: Box<dyn BaseCapability>,
    sql: Option<*const dyn SqlQueryable>,
    document: Option<*const dyn DocumentQueryable>,
    keyvalue: Option<*const dyn RichKeyValueOperable>,
    backup: Option<*const dyn BackupCapable>,  // Add this
    // ... rest of fields
}
```

**Step 3: Add as_backup accessor method**

Add to `UnifiedAdapter` impl:
```rust
pub fn as_backup(&self) -> Option<&dyn BackupCapable> {
    self.backup.map(|p| unsafe { &*p })
}
```

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds (adapters don't implement BackupCapable yet)

**Step 5: Commit**

```bash
git add src-tauri/src/core/capabilities.rs src-tauri/src/core/manager.rs
git commit -m "feat(backup): add BackupCapable to UnifiedAdapter"
```

---

## Phase 2: SQLite Backup Adapter (Native)

### Task 2.1: Implement SQLite BackupCapable

**Files:**
- Create: `src-tauri/src/adapters/sqlite/backup.rs`
- Modify: `src-tauri/src/adapters/sqlite/mod.rs`
- Modify: `src-tauri/src/adapters/sqlite/adapter.rs`

**Step 1: Create sqlite backup implementation**

```rust
// src-tauri/src/adapters/sqlite/backup.rs

use async_trait::async_trait;
use rusqlite::backup::Backup;
use std::path::Path;
use std::time::Duration;

use crate::core::{
    BackupCapable, BackupConfig, BackupFormat, BackupObject, BackupObjectType,
    BackupOptionsSchema, BackupPreview, BackupPreviewObject, BackupProgress,
    FieldType, OptionField, ProgressSender, RestoreConfig, RestoreOptionsSchema,
    ToolRequirement,
};
use crate::error::AppError;

use super::SqliteAdapter;

#[async_trait]
impl BackupCapable for SqliteAdapter {
    fn tool_requirements(&self) -> Vec<ToolRequirement> {
        // SQLite uses native Rust - no external tools needed
        vec![]
    }

    fn supported_formats(&self) -> Vec<BackupFormat> {
        vec![
            BackupFormat {
                id: "binary".to_string(),
                name: "SQLite Database".to_string(),
                extension: ".db".to_string(),
                description: "Binary database copy (fastest, recommended)".to_string(),
            },
            BackupFormat {
                id: "sql".to_string(),
                name: "SQL Dump".to_string(),
                extension: ".sql".to_string(),
                description: "Plain SQL statements (portable, human-readable)".to_string(),
            },
        ]
    }

    fn backup_options(&self) -> BackupOptionsSchema {
        BackupOptionsSchema {
            common: vec![],
            advanced: vec![
                OptionField {
                    key: "pages_per_step".to_string(),
                    label: "Pages per step".to_string(),
                    field_type: FieldType::Number { min: Some(1.0), max: Some(1000.0) },
                    default: serde_json::json!(100),
                    description: "Number of pages to copy per step (affects progress granularity)".to_string(),
                },
            ],
        }
    }

    fn restore_options(&self) -> RestoreOptionsSchema {
        RestoreOptionsSchema {
            common: vec![],
            advanced: vec![],
        }
    }

    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>, AppError> {
        let conn = self.get_connection().await?;

        let tables: Vec<BackupObject> = conn.call(|conn| {
            let mut stmt = conn.prepare(
                "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'"
            )?;

            let objects = stmt.query_map([], |row| {
                let name: String = row.get(0)?;
                let obj_type: String = row.get(1)?;
                Ok(BackupObject {
                    id: name.clone(),
                    name: name.clone(),
                    object_type: if obj_type == "table" {
                        BackupObjectType::Table
                    } else {
                        BackupObjectType::View
                    },
                    parent_id: None,
                    estimated_size: None,
                    row_count: None,
                })
            })?.collect::<Result<Vec<_>, _>>()?;

            Ok(objects)
        }).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

        Ok(tables)
    }

    async fn parse_backup_preview(&self, path: &Path) -> Result<BackupPreview, AppError> {
        let metadata = std::fs::metadata(path)
            .map_err(|e| AppError::DatabaseError(format!("Cannot read file: {}", e)))?;

        let file_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Try to open as SQLite to get table list
        let objects = if path.extension().map(|e| e == "db" || e == "sqlite").unwrap_or(false) {
            let conn = rusqlite::Connection::open(path)
                .map_err(|e| AppError::DatabaseError(format!("Cannot open SQLite file: {}", e)))?;

            let mut stmt = conn.prepare(
                "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'"
            ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

            stmt.query_map([], |row| {
                let name: String = row.get(0)?;
                let obj_type: String = row.get(1)?;
                Ok(BackupPreviewObject {
                    name,
                    object_type: obj_type,
                    row_count: None,
                })
            })
            .map_err(|e| AppError::DatabaseError(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?
        } else {
            vec![]
        };

        Ok(BackupPreview {
            file_name,
            file_size: metadata.len(),
            database_type: "SQLite".to_string(),
            created_at: None,
            objects,
        })
    }

    async fn execute_backup(
        &self,
        config: BackupConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let _ = progress.send(BackupProgress::Started { total_steps: None }).await;

        let src_conn = self.get_connection().await?;
        let dest_path = config.destination_path.clone();

        src_conn.call(move |src| {
            let mut dst = rusqlite::Connection::open(&dest_path)?;
            let backup = Backup::new(src, &mut dst)?;

            let pages_per_step = 100;
            let mut total_pages = 0;
            let mut remaining = backup.remaining();

            // Calculate total on first iteration
            if remaining > 0 {
                total_pages = backup.pagecount();
            }

            loop {
                let done = backup.step(pages_per_step)?;
                remaining = backup.remaining();
                let current = total_pages - remaining;

                // Note: Can't send progress from sync context easily
                // For now, just complete the backup

                if done {
                    break;
                }

                std::thread::sleep(Duration::from_millis(10));
            }

            Ok::<_, rusqlite::Error>(())
        }).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let _ = progress.send(BackupProgress::Completed {
            message: format!("Backup saved to {}", config.destination_path)
        }).await;

        Ok(())
    }

    async fn execute_restore(
        &self,
        config: RestoreConfig,
        progress: ProgressSender,
    ) -> Result<(), AppError> {
        let _ = progress.send(BackupProgress::Started { total_steps: None }).await;

        // For SQLite, restore is essentially copying the file or running SQL
        let source_path = Path::new(&config.source_path);

        if !source_path.exists() {
            return Err(AppError::DatabaseError("Source file does not exist".to_string()));
        }

        // Get the current database path and copy the backup over it
        let dest_conn = self.get_connection().await?;
        let dest_path_str = config.source_path.clone();

        dest_conn.call(move |dest| {
            let src = rusqlite::Connection::open(&dest_path_str)?;
            let backup = Backup::new(&src, dest)?;
            backup.run_to_completion(100, Duration::from_millis(10), None)?;
            Ok::<_, rusqlite::Error>(())
        }).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let _ = progress.send(BackupProgress::Completed {
            message: "Database restored successfully".to_string()
        }).await;

        Ok(())
    }
}
```

**Step 2: Update sqlite/mod.rs to include backup module**

Add to `src-tauri/src/adapters/sqlite/mod.rs`:
```rust
mod backup;
```

**Step 3: Update UnifiedAdapter::sqlite constructor to include backup pointer**

In `src-tauri/src/core/manager.rs`, update the `sqlite` constructor to set the backup pointer.

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 5: Commit**

```bash
git add src-tauri/src/adapters/sqlite/backup.rs src-tauri/src/adapters/sqlite/mod.rs
git commit -m "feat(backup): implement SQLite backup adapter (native Rust)"
```

---

## Phase 3: Backup Commands

### Task 3.1: Create Backup Command Module

**Files:**
- Create: `src-tauri/src/commands/backup.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create backup commands**

```rust
// src-tauri/src/commands/backup.rs

use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::mpsc;

use crate::core::{
    BackupConfig, BackupFormat, BackupOptionsSchema, BackupPreview, BackupProgress,
    RestoreConfig, RestoreOptionsSchema, ToolRequirement,
};
use crate::core::manager::ConnectionManager;
use crate::types::DbType;

#[derive(serde::Serialize)]
pub struct ToolStatus {
    pub required: Vec<String>,
    pub available: Vec<String>,
    pub missing: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct BackupCapabilityInfo {
    pub tool_requirements: Vec<ToolRequirement>,
    pub supported_formats: Vec<BackupFormat>,
    pub backup_options: BackupOptionsSchema,
    pub restore_options: RestoreOptionsSchema,
}

/// Get backup capability info for a connection
#[tauri::command]
pub async fn get_backup_capability(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<BackupCapabilityInfo, String> {
    let conn = manager
        .get_connection(&conn_id)
        .map_err(|e| e.to_string())?;

    let backup_adapter = conn.adapter
        .as_backup()
        .ok_or_else(|| "This database does not support backup/restore".to_string())?;

    Ok(BackupCapabilityInfo {
        tool_requirements: backup_adapter.tool_requirements(),
        supported_formats: backup_adapter.supported_formats(),
        backup_options: backup_adapter.backup_options(),
        restore_options: backup_adapter.restore_options(),
    })
}

/// Get tool status for a database type
#[tauri::command]
pub async fn get_tool_status(
    db_type: DbType,
) -> Result<ToolStatus, String> {
    // For native implementations, return empty
    match db_type {
        DbType::SQLite | DbType::SQLServer | DbType::Redis => {
            Ok(ToolStatus {
                required: vec![],
                available: vec![],
                missing: vec![],
            })
        }
        DbType::PostgreSQL => {
            // Check for pg_dump, pg_restore
            let required = vec!["pg_dump".to_string(), "pg_restore".to_string()];
            let available = check_tools_available(&required);
            let missing: Vec<String> = required.iter()
                .filter(|t| !available.contains(t))
                .cloned()
                .collect();
            Ok(ToolStatus { required, available, missing })
        }
        DbType::MySQL | DbType::MariaDB => {
            let required = vec!["mariadb-dump".to_string(), "mariadb".to_string()];
            let available = check_tools_available(&required);
            let missing: Vec<String> = required.iter()
                .filter(|t| !available.contains(t))
                .cloned()
                .collect();
            Ok(ToolStatus { required, available, missing })
        }
        DbType::MongoDB => {
            let required = vec!["mongodump".to_string(), "mongorestore".to_string()];
            let available = check_tools_available(&required);
            let missing: Vec<String> = required.iter()
                .filter(|t| !available.contains(t))
                .cloned()
                .collect();
            Ok(ToolStatus { required, available, missing })
        }
    }
}

fn check_tools_available(tools: &[String]) -> Vec<String> {
    // TODO: Implement actual tool checking
    // For now, return empty (no tools available)
    vec![]
}

/// Get backup preview for a file
#[tauri::command]
pub async fn get_backup_preview(
    conn_id: String,
    file_path: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<BackupPreview, String> {
    let conn = manager
        .get_connection(&conn_id)
        .map_err(|e| e.to_string())?;

    let backup_adapter = conn.adapter
        .as_backup()
        .ok_or_else(|| "This database does not support backup/restore".to_string())?;

    let path = PathBuf::from(file_path);
    backup_adapter
        .parse_backup_preview(&path)
        .await
        .map_err(|e| e.to_string())
}

/// Start a backup operation (returns immediately, streams progress)
#[tauri::command]
pub async fn start_backup(
    conn_id: String,
    config: BackupConfig,
    channel: tauri::ipc::Channel<BackupProgress>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .map_err(|e| e.to_string())?;

    let backup_adapter = conn.adapter
        .as_backup()
        .ok_or_else(|| "This database does not support backup/restore".to_string())?;

    // Create channel for progress
    let (tx, mut rx) = mpsc::channel::<BackupProgress>(100);

    // Spawn task to forward progress to Tauri channel
    let channel_clone = channel.clone();
    tokio::spawn(async move {
        while let Some(progress) = rx.recv().await {
            let _ = channel_clone.send(progress);
        }
    });

    // Execute backup
    backup_adapter
        .execute_backup(config, tx)
        .await
        .map_err(|e| e.to_string())
}

/// Start a restore operation
#[tauri::command]
pub async fn start_restore(
    conn_id: String,
    config: RestoreConfig,
    channel: tauri::ipc::Channel<BackupProgress>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .map_err(|e| e.to_string())?;

    let backup_adapter = conn.adapter
        .as_backup()
        .ok_or_else(|| "This database does not support backup/restore".to_string())?;

    let (tx, mut rx) = mpsc::channel::<BackupProgress>(100);

    let channel_clone = channel.clone();
    tokio::spawn(async move {
        while let Some(progress) = rx.recv().await {
            let _ = channel_clone.send(progress);
        }
    });

    backup_adapter
        .execute_restore(config, tx)
        .await
        .map_err(|e| e.to_string())
}
```

**Step 2: Update commands/mod.rs**

Add to `src-tauri/src/commands/mod.rs`:
```rust
pub mod backup;
pub use backup::*;
```

**Step 3: Register commands in lib.rs**

Add backup commands to the Tauri invoke handler in `src-tauri/src/lib.rs`.

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 5: Commit**

```bash
git add src-tauri/src/commands/backup.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(backup): add Tauri backup commands"
```

---

## Phase 4: Frontend Backup Screen

### Task 4.1: Create BackupRestoreScreen Structure

**Files:**
- Create: `src/screens/backup-restore/index.tsx`
- Create: `src/screens/backup-restore/BackupRestoreScreen.tsx`
- Modify: `src/App.tsx`

**Step 1: Create screen entry point**

```typescript
// src/screens/backup-restore/index.tsx
export { BackupRestoreScreen } from "./BackupRestoreScreen";
```

**Step 2: Create main screen component**

```typescript
// src/screens/backup-restore/BackupRestoreScreen.tsx
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { windowChannelTracker } from "@/services/windowChannelTracker";
import { isTauri } from "@/utils/tauri";

type WizardStep = "connection" | "operation" | "config" | "execute";

export function BackupRestoreScreen() {
  const [searchParams] = useSearchParams();
  const preselectedConnectionId = searchParams.get("connectionId");

  const [currentStep, setCurrentStep] = useState<WizardStep>("connection");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    preselectedConnectionId
  );
  const [operation, setOperation] = useState<"backup" | "restore" | null>(null);

  useEffect(() => {
    if (isTauri()) {
      windowChannelTracker.registerWindow("backup-restore");
      return () => {
        windowChannelTracker.unregisterWindow();
      };
    }
  }, []);

  // Skip connection step if pre-selected
  useEffect(() => {
    if (preselectedConnectionId && currentStep === "connection") {
      setCurrentStep("operation");
    }
  }, [preselectedConnectionId, currentStep]);

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h1 className="text-lg font-semibold">Backup & Restore</h1>
        <StepIndicator currentStep={currentStep} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {currentStep === "connection" && (
          <ConnectionStep
            selectedId={selectedConnectionId}
            onSelect={(id) => {
              setSelectedConnectionId(id);
              setCurrentStep("operation");
            }}
          />
        )}
        {currentStep === "operation" && (
          <OperationStep
            onSelect={(op) => {
              setOperation(op);
              setCurrentStep("config");
            }}
            onBack={() => setCurrentStep("connection")}
          />
        )}
        {currentStep === "config" && selectedConnectionId && operation && (
          <ConfigStep
            connectionId={selectedConnectionId}
            operation={operation}
            onStart={() => setCurrentStep("execute")}
            onBack={() => setCurrentStep("operation")}
          />
        )}
        {currentStep === "execute" && (
          <ExecuteStep
            connectionId={selectedConnectionId!}
            operation={operation!}
            onComplete={() => {
              // Reset or close window
            }}
          />
        )}
      </div>
    </div>
  );
}

// Placeholder components - implement in separate files
function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  return <div>Step: {currentStep}</div>;
}

function ConnectionStep({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  return <div>Connection Step (TODO)</div>;
}

function OperationStep({ onSelect, onBack }: { onSelect: (op: "backup" | "restore") => void; onBack: () => void }) {
  return <div>Operation Step (TODO)</div>;
}

function ConfigStep({ connectionId, operation, onStart, onBack }: { connectionId: string; operation: "backup" | "restore"; onStart: () => void; onBack: () => void }) {
  return <div>Config Step (TODO)</div>;
}

function ExecuteStep({ connectionId, operation, onComplete }: { connectionId: string; operation: "backup" | "restore"; onComplete: () => void }) {
  return <div>Execute Step (TODO)</div>;
}
```

**Step 3: Add route in App.tsx**

Add to routes in `src/App.tsx`:
```typescript
<Route path="/backup-restore" element={<BackupRestoreScreen />} />
```

**Step 4: Verify compilation**

Run: `pnpm typecheck`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/screens/backup-restore/ src/App.tsx
git commit -m "feat(backup): add BackupRestoreScreen skeleton"
```

---

### Task 4.2: Add Window Manager Support

**Files:**
- Modify: `src/services/windowManager.ts`

**Step 1: Add openBackupRestore method**

Add to `WindowManager` class:
```typescript
async openBackupRestore(connectionId?: string): Promise<string> {
  const label = "backup-restore";

  if (!isTauri()) {
    const url = connectionId
      ? `/backup-restore?connectionId=${connectionId}`
      : "/backup-restore";
    window.location.href = url;
    return label;
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

  // Check if already open
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    // TODO: If connectionId provided, update the selected connection
    return label;
  }

  const url = connectionId
    ? `/backup-restore?connectionId=${connectionId}`
    : "/backup-restore";

  const trafficLightPos = getMacOSTrafficLightPosition();

  const webview = new WebviewWindow(label, {
    url,
    title: "Backup & Restore",
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 500,
    center: true,
    resizable: true,
    decorations: true,
    transparent: false,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    ...(trafficLightPos && { trafficLightPosition: trafficLightPos }),
  });

  void webview.once("tauri://destroyed", () => {
    void updateWindowMenu();
  });

  void updateWindowMenu();
  return label;
}
```

**Step 2: Verify compilation**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/services/windowManager.ts
git commit -m "feat(backup): add windowManager.openBackupRestore()"
```

---

## Phase 5: Wizard Step Components

### Task 5.1: Implement ConnectionStep

**Files:**
- Create: `src/screens/backup-restore/steps/ConnectionStep.tsx`

**Step 1: Create ConnectionStep component**

```typescript
// src/screens/backup-restore/steps/ConnectionStep.tsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { vaultStorage } from "@/services/vaultStorage";
import { StoredConnection } from "@/types/vault";
import { getDatabaseIcon } from "@/utils/database";

interface ConnectionStepProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConnectionStep({ selectedId, onSelect }: ConnectionStepProps) {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadConnections() {
      const conns = await vaultStorage.getAllConnections();
      setConnections(conns);
      setLoading(false);
    }
    loadConnections();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Select Connection</h2>
      <p className="text-muted-foreground">
        Choose which database you want to backup or restore.
      </p>

      <div className="grid gap-3 mt-6">
        {connections.map((conn) => {
          const Icon = getDatabaseIcon(conn.profile.db_type);
          const isSelected = selectedId === conn.profile.id;

          return (
            <Card
              key={conn.profile.id}
              className={`p-4 cursor-pointer transition-colors hover:bg-accent ${
                isSelected ? "ring-2 ring-primary" : ""
              }`}
              onClick={() => onSelect(conn.profile.id)}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5" />
                <div className="flex-1">
                  <div className="font-medium">{conn.profile.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {conn.profile.host}:{conn.profile.port} / {conn.profile.database}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground uppercase">
                  {conn.profile.db_type}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {connections.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No connections found. Create a connection first.
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify compilation**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/screens/backup-restore/steps/ConnectionStep.tsx
git commit -m "feat(backup): implement ConnectionStep wizard component"
```

---

### Task 5.2: Implement OperationStep

**Files:**
- Create: `src/screens/backup-restore/steps/OperationStep.tsx`

**Step 1: Create OperationStep component**

```typescript
// src/screens/backup-restore/steps/OperationStep.tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconDatabaseExport, IconDatabaseImport, IconArrowLeft } from "@tabler/icons-react";

interface OperationStepProps {
  onSelect: (op: "backup" | "restore") => void;
  onBack: () => void;
}

export function OperationStep({ onSelect, onBack }: OperationStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold">Choose Operation</h2>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6">
        <Card
          className="p-6 cursor-pointer transition-colors hover:bg-accent group"
          onClick={() => onSelect("backup")}
        >
          <div className="flex flex-col items-center text-center gap-4">
            <div className="p-4 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <IconDatabaseExport className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Backup</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Export database to a file
              </p>
            </div>
          </div>
        </Card>

        <Card
          className="p-6 cursor-pointer transition-colors hover:bg-accent group"
          onClick={() => onSelect("restore")}
        >
          <div className="flex flex-col items-center text-center gap-4">
            <div className="p-4 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <IconDatabaseImport className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Restore</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Import database from a file
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
```

**Step 2: Verify compilation**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/screens/backup-restore/steps/OperationStep.tsx
git commit -m "feat(backup): implement OperationStep wizard component"
```

---

## Phase 6: Menu Integration

### Task 6.1: Add Context Menu Entry

**Files:**
- Modify: `src/screens/home/components/shared/ConnectionCard.tsx` (or relevant context menu file)

**Step 1: Add "Backup/Restore..." menu item**

Find the context menu items and add:
```typescript
<ContextMenuItem onClick={() => windowManager.openBackupRestore(profile.id)}>
  Backup/Restore...
</ContextMenuItem>
```

**Step 2: Verify compilation**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add <modified files>
git commit -m "feat(backup): add Backup/Restore to connection context menu"
```

---

### Task 6.2: Add Application Menu Entry

**Files:**
- Modify: `src-tauri/src/menu.rs`

**Step 1: Add menu item to File menu**

Add "Backup/Restore" menu item with handler that opens the backup-restore window.

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 3: Commit**

```bash
git add src-tauri/src/menu.rs
git commit -m "feat(backup): add Backup/Restore to application menu"
```

---

## Phase 7: Remaining Database Adapters

### Task 7.1: Implement PostgreSQL Backup Adapter (Tool-Based)

**Files:**
- Create: `src-tauri/src/adapters/postgres/backup.rs`

This will use external pg_dump/pg_restore tools via subprocess.

### Task 7.2: Implement MySQL Backup Adapter (Tool-Based)

**Files:**
- Create: `src-tauri/src/adapters/mysql/backup.rs`

Uses mariadb-dump/mariadb tools.

### Task 7.3: Implement MongoDB Backup Adapter (Tool-Based)

**Files:**
- Create: `src-tauri/src/adapters/mongodb/backup.rs`

Uses mongodump/mongorestore tools.

### Task 7.4: Implement MSSQL Backup Adapter (Native)

**Files:**
- Create: `src-tauri/src/adapters/mssql/backup.rs`

Uses tiberius to execute BACKUP DATABASE T-SQL.

### Task 7.5: Implement Redis Backup Adapter (Native)

**Files:**
- Create: `src-tauri/src/adapters/redis/backup.rs`

Uses redis crate with BGSAVE command.

---

## Phase 8: Tool Download System

### Task 8.1: Create Tool Registry

**Files:**
- Create: `src-tauri/src/core/tool_registry.rs`

### Task 8.2: Create Tool Executor

**Files:**
- Create: `src-tauri/src/core/tool_executor.rs`

### Task 8.3: Implement Tool Download Commands

**Files:**
- Modify: `src-tauri/src/commands/backup.rs`

---

## Phase 9: Config & Execute Steps

### Task 9.1: Implement BackupConfigStep

**Files:**
- Create: `src/screens/backup-restore/steps/BackupConfigStep.tsx`

### Task 9.2: Implement RestoreConfigStep

**Files:**
- Create: `src/screens/backup-restore/steps/RestoreConfigStep.tsx`

### Task 9.3: Implement ExecuteStep

**Files:**
- Create: `src/screens/backup-restore/steps/ExecuteStep.tsx`

---

## Milestone Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Foundation (types, trait) | TODO |
| 2 | SQLite adapter (native) | TODO |
| 3 | Backup commands | TODO |
| 4 | Frontend screen skeleton | TODO |
| 5 | Wizard step components | TODO |
| 6 | Menu integration | TODO |
| 7 | Remaining adapters | TODO |
| 8 | Tool download system | TODO |
| 9 | Config & execute steps | TODO |

**Estimated commits:** 15-20
**Dependencies:** Phases 1-3 must complete before 4-6. Phase 7-9 can be parallelized.
