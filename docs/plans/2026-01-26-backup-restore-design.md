# Backup/Restore Feature Design

## Overview

A standalone Backup/Restore window that lets users backup and restore databases using native tools. Supports all database types: PostgreSQL, MySQL, SQLite, MSSQL, MongoDB, and Redis. Uses native backup formats for maximum compatibility with external tools.

## Key Decisions

| Aspect | Decision |
|--------|----------|
| Scope | All databases, native formats only |
| Granularity | Full database by default, selective in advanced mode |
| Storage | Local filesystem only |
| Restore targets | Same or any compatible database + preview before execute |
| UI | Standalone window, wizard-style flow |
| Tools | Native tools if available, download on demand if missing |
| Options | Common options by default, full native tool flags in advanced |
| History | No history tracking, users manage files manually |
| Architecture | Trait-based adapters, dynamic option schemas |

## Window Architecture

Following Query Pilot's multi-window pattern, opens as a new Tauri window with label `backup-restore`. Independent of workspace windows — users can have it open while working in other connections.

### Entry Points

| Location | Trigger | Behavior |
|----------|---------|----------|
| Main window | "Backup/Restore" button or menu item | Opens window, no connection pre-selected |
| Workspace window | Menu bar → Tools → Backup/Restore | Opens window with current connection pre-selected |
| Connection context menu | Right-click → "Backup/Restore..." | Opens window with that connection pre-selected |
| Application menu | File → Backup/Restore | Opens window, no connection pre-selected |

### Single Instance

Only one Backup/Restore window at a time. If already open and user triggers it again with a different connection, focus the existing window and update the selected connection (with confirmation if an operation is in progress).

## Wizard Flow

### Step 1 — Select Connection

- Dropdown/list of all saved connections from Query Pilot
- Shows connection name, database type icon, host/database info
- If opened from context menu or workspace, this step is pre-filled and can be skipped
- "Test Connection" button to verify connectivity before proceeding

### Step 2 — Choose Operation

- Two large cards: **Backup** and **Restore**
- Each shows a brief description and icon
- Selecting one moves to the next step

### Step 3a — Backup Configuration

- **Destination**: File picker for output location, auto-suggested filename with timestamp (e.g., `mydb_2026-01-26_143022.sql`)
- **Scope toggle**: "Full Database" (default) or "Select Objects" (advanced)
  - If "Select Objects": tree view of schemas/tables/collections/key patterns to include/exclude
- **Options panel**: Common options shown by default (compression, schema-only/data-only for SQL)
  - "Show Advanced Options" expands to full native tool flags

### Step 3b — Restore Configuration

- **Source**: File picker to select backup file
- **Target**: Confirms the connection from Step 1, with option to change
- **Preview panel**: Shows basic summary (filename, size, type, target)
  - "Show Details" expands to list tables/collections/keys with counts
- **Options**: Drop existing objects, create database if not exists, etc.

### Step 4 — Execute & Progress

- Summary of what will happen
- "Start Backup/Restore" button
- Progress bar with live output log
- Cancel button (if operation supports it)
- On completion: success message with file path (backup) or summary (restore)

## Technical Architecture

### Rust Backend Structure

New command module: `src-tauri/src/commands/backup.rs`

```
commands/backup.rs
├── start_backup()       — Initiates backup, returns job_id
├── start_restore()      — Initiates restore, returns job_id
├── cancel_operation()   — Cancels running operation
├── get_backup_preview() — Parses backup file for preview info
├── check_tool_status()  — Returns which native tools are available
└── download_tool()      — Downloads missing tool to app data
```

### Backup Adapter Trait

Following the existing capability trait pattern (`SqlQueryable`, `DocumentQueryable`, `RichKeyValueOperable`):

```rust
// src-tauri/src/core/backup_capability.rs

pub trait BackupCapable: Send + Sync {
    /// Returns tool requirements for this database type
    fn tool_requirements(&self) -> Vec<ToolRequirement>;

    /// Returns available backup formats
    fn supported_formats(&self) -> Vec<BackupFormat>;

    /// Returns configurable options with defaults
    fn backup_options(&self) -> BackupOptionsSchema;
    fn restore_options(&self) -> RestoreOptionsSchema;

    /// Introspect database for selective backup UI
    async fn list_backup_objects(&self) -> Result<Vec<BackupObject>>;

    /// Parse backup file for preview
    async fn parse_backup_preview(&self, path: &Path) -> Result<BackupPreview>;

    /// Execute backup (streams progress via channel)
    async fn execute_backup(&self, config: BackupConfig, progress: ProgressSender) -> Result<()>;

    /// Execute restore (streams progress via channel)
    async fn execute_restore(&self, config: RestoreConfig, progress: ProgressSender) -> Result<()>;
}
```

### Dynamic Option Schema

Each adapter returns its options as a schema, so the frontend can render the options panel dynamically:

```rust
pub struct BackupOptionsSchema {
    pub common: Vec<OptionField>,    // Shown by default
    pub advanced: Vec<OptionField>,  // Behind "Show Advanced"
}

pub struct OptionField {
    pub key: String,
    pub label: String,
    pub field_type: FieldType,  // Bool, String, Select, Number
    pub default: Value,
    pub description: String,
}
```

### No Branching in Commands

```rust
// In commands/backup.rs — no if/else on database type
pub async fn start_backup(connection_id: &str, config: BackupConfig) -> Result<JobId> {
    let adapter = manager.get_adapter(connection_id)?;
    let backup_adapter = adapter.as_backup()?;  // Returns &dyn BackupCapable
    backup_adapter.execute_backup(config, progress_tx).await
}
```

### Adapter Implementations

```
src-tauri/src/adapters/backup/
├── mod.rs                    — Trait definition + registry
├── postgres_backup.rs        — impl BackupCapable for PostgresAdapter
├── mysql_backup.rs
├── sqlite_backup.rs
├── mssql_backup.rs
├── mongodb_backup.rs
└── redis_backup.rs
```

### Tool Management

Tools stored in: `{app_data}/tools/{platform}/`
- e.g., `~/Library/Application Support/com.querypilot.app/tools/darwin/pg_dump`

```rust
// src-tauri/src/core/tool_registry.rs

pub struct ToolRegistry {
    tools: HashMap<DatabaseType, Vec<ToolDefinition>>,
}

pub struct ToolDefinition {
    pub name: String,              // "pg_dump"
    pub purpose: ToolPurpose,      // Backup, Restore, Both
    pub platforms: HashMap<Platform, PlatformBinary>,
}

pub struct PlatformBinary {
    pub download_url: String,      // URL to download from
    pub executable: String,        // Binary name after extraction
    pub checksum: String,          // SHA256 for verification
    pub version: String,           // Tool version
}
```

### Execution Model

- Operations run as spawned child processes in Rust
- Progress streamed to frontend via Tauri IPC channel (like existing streaming query path)
- Stdout/stderr captured and displayed in real-time log
- Process handle stored to support cancellation

### Frontend Structure

```
src/screens/BackupRestoreScreen/
├── index.tsx                 — Window entry point
├── steps/
│   ├── ConnectionStep.tsx
│   ├── OperationStep.tsx
│   ├── BackupConfigStep.tsx
│   ├── RestoreConfigStep.tsx
│   └── ExecuteStep.tsx
└── components/
    ├── ObjectSelector.tsx    — Tree view for selective backup
    ├── OptionsPanel.tsx      — Common + advanced options
    ├── ProgressLog.tsx       — Real-time output display
    └── ToolDownloadPrompt.tsx — Missing tools download UI
```

## Database-Specific Details

### PostgreSQL

- Tools: `pg_dump` (backup), `pg_restore` / `psql` (restore)
- Formats: Plain SQL (`.sql`), Custom (`.dump`), Directory, Tar
- Default: Custom format with compression (most flexible for restore)
- Common options: schema-only, data-only, compression level, include/exclude tables

### MySQL

- Tools: `mysqldump` (backup), `mysql` (restore)
- Format: Plain SQL (`.sql`)
- Common options: single-transaction, routines, triggers, events, compress

### SQLite

- No external tool needed — use Rust `rusqlite` to execute `.dump` equivalent
- Format: Plain SQL (`.sql`)
- Alternative: Simple file copy for binary backup (`.db`)
- Common options: schema-only, data-only

### MSSQL

- Tools: `sqlcmd` or `mssql-cli`
- Format: SQL script (`.sql`) via scripting, or `.bacpac` via `SqlPackage`
- Common options: schema-only, data-only, specific tables

### MongoDB

- Tools: `mongodump` (backup), `mongorestore` (restore)
- Format: BSON dump (directory with `.bson` + `.metadata.json` files)
- Common options: collection filter, query filter, gzip compression

### Redis

- Tools: `redis-cli`
- Backup approach: `BGSAVE` trigger + copy RDB file, or key-by-key export to JSON
- Restore approach: Replace RDB file + restart, or `redis-cli` pipe for JSON
- Common options: key pattern filter, specific databases (0-15)

## Tool Download System

### Download Flow

1. User initiates backup/restore
2. Backend calls `adapter.tool_requirements()`
3. Check if tools exist in `{app_data}/tools/{platform}/`
4. If missing, frontend shows: "PostgreSQL backup requires pg_dump. Download now? (45 MB)"
5. User confirms → backend downloads, verifies checksum, extracts
6. Tool marked as available, operation proceeds

### Tool Status API

```rust
#[tauri::command]
pub async fn get_tool_status(database_type: DatabaseType) -> ToolStatus {
    ToolStatus {
        required: vec!["pg_dump", "pg_restore"],
        available: vec!["pg_dump"],
        missing: vec!["pg_restore"],
    }
}

#[tauri::command]
pub async fn download_tool(tool_name: &str, progress: Channel) -> Result<()>
```

### Platform Support

| Platform | Tool Source |
|----------|-------------|
| macOS | Official binaries or Homebrew bottles |
| Windows | Official installers extracted or portable builds |
| Linux | Official binaries or AppImage-style packages |

## Error Handling

### Connection Failures

- Test connection at Step 1 before proceeding
- If connection drops mid-operation: abort cleanly, show error with partial file warning
- Backup files from failed operations marked with `.partial` suffix

### Tool Execution Errors

- Capture stderr from native tools, display in progress log
- Parse common error patterns for friendly messages:
  - "permission denied" → "Check database user permissions"
  - "connection refused" → "Database server not reachable"
- Full raw output always available in expandable log

### File System Errors

- Check disk space before starting (estimate from database size)
- Handle permission errors on destination folder
- Validate backup file exists and is readable before restore

### Restore Safety

- Warn before overwriting existing data: "This will modify database X. Continue?"
- No automatic rollback (native tools don't support it) — document this clearly
- Suggest taking a backup before restore in the UI

### Cancellation

- Send SIGTERM to child process
- Clean up partial backup files
- Restore operations may leave database in inconsistent state — warn user before allowing cancel

### Concurrent Operations

- One operation per connection at a time
- Multiple backups to different connections allowed
- Show warning if user tries to start second operation on same connection

## Files to Create/Modify

| Layer | Files |
|-------|-------|
| Rust traits | `src-tauri/src/core/backup_capability.rs` |
| Rust adapters | `src-tauri/src/adapters/backup/*.rs` (6 files) |
| Rust commands | `src-tauri/src/commands/backup.rs` |
| Tool system | `src-tauri/src/core/tool_registry.rs` |
| Frontend screen | `src/screens/BackupRestoreScreen/` |
| Entry points | Menu items, context menus, window registration |
