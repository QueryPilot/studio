# Backup/Restore Feature Design

## Overview

A standalone Backup/Restore window that lets users backup and restore databases. Supports all database types: PostgreSQL, MySQL, SQLite, MSSQL, MongoDB, and Redis. Uses native backup formats for maximum compatibility.

**Key insight from research:** Not all databases require external tools. Three databases (SQLite, MSSQL, Redis) can be backed up using native Rust crates, while three others (PostgreSQL, MySQL, MongoDB) require external CLI tools.

## Key Decisions

| Aspect | Decision |
|--------|----------|
| Scope | All databases, native formats only |
| Granularity | Full database by default, selective in advanced mode |
| Storage | Local filesystem only |
| Restore targets | Same or any compatible database + preview before execute |
| UI | Standalone window, wizard-style flow |
| Implementation | Native Rust for SQLite/MSSQL/Redis; external tools for PostgreSQL/MySQL/MongoDB |
| Tools | Download on demand only for databases that need them |
| Options | Common options by default, full flags in advanced |
| History | No history tracking, users manage files manually |
| Architecture | Trait-based adapters, dynamic option schemas |

## Implementation Strategy

### Native Rust Backups (No External Tools)

These databases use Rust crates directly — no tool download, no subprocess management:

| Database | Rust Crate | Backup Method |
|----------|------------|---------------|
| **SQLite** | `rusqlite` | `backup::Backup` API for online backup |
| **MSSQL** | `tiberius` | Execute `BACKUP DATABASE` T-SQL command |
| **Redis** | `redis` | Send `BGSAVE` command + `DUMP`/`RESTORE` per key |

### Tool-Based Backups (External CLI Required)

These databases require external CLI tools downloaded on first use:

| Database | Tools | License | Size |
|----------|-------|---------|------|
| **PostgreSQL** | `pg_dump`, `pg_restore` | PostgreSQL License (permissive) | ~20 MB |
| **MySQL** | `mariadb-dump`, `mariadb` | LGPL 2.1+ (permissive) | ~50 MB |
| **MongoDB** | `mongodump`, `mongorestore` | Apache 2.0 | ~50 MB |

**Note:** We use MariaDB client tools instead of MySQL's `mysqldump` to avoid GPL licensing concerns. MariaDB tools are LGPL-licensed and compatible with MySQL databases.

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

### Window Registration

Following existing patterns:
- Register with `windowChannelTracker` on mount
- Use `BroadcastChannel` for cross-window communication
- Call `update_window_menu()` Tauri command after window creation/destruction

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
  - "Show Advanced Options" expands to full native tool flags (for tool-based databases)

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
├── check_tool_status()  — Returns which native tools are available (tool-based only)
└── download_tool()      — Downloads missing tool to app data (tool-based only)
```

### Backup Adapter Trait

Following the existing capability trait pattern (`SqlQueryable`, `DocumentQueryable`, `RichKeyValueOperable`):

```rust
// src-tauri/src/core/backup_capability.rs

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
├── postgres_backup.rs        — Tool-based: shells out to pg_dump/pg_restore
├── mysql_backup.rs           — Tool-based: shells out to mariadb-dump/mariadb
├── sqlite_backup.rs          — Native: uses rusqlite::backup API
├── mssql_backup.rs           — Native: uses tiberius for T-SQL BACKUP command
├── mongodb_backup.rs         — Tool-based: shells out to mongodump/mongorestore
└── redis_backup.rs           — Native: uses redis crate with BGSAVE + DUMP/RESTORE
```

### Subprocess Management (Tool-Based Only)

For PostgreSQL, MySQL, and MongoDB, we spawn external tools as child processes:

```rust
// src-tauri/src/core/tool_executor.rs

use std::process::{Command, Stdio, Child};
use tokio::io::{AsyncBufReadExt, BufReader};

pub struct ToolExecutor {
    child: Child,
    tool_path: PathBuf,
}

impl ToolExecutor {
    pub async fn spawn(
        tool_path: &Path,
        args: &[&str],
        env: HashMap<String, String>,
    ) -> Result<Self> {
        let child = Command::new(tool_path)
            .args(args)
            .envs(env)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        Ok(Self { child, tool_path: tool_path.to_path_buf() })
    }

    /// Stream stdout/stderr to frontend via IPC channel
    pub async fn stream_output(&mut self, progress_tx: ProgressSender) -> Result<ExitStatus> {
        let stdout = self.child.stdout.take().unwrap();
        let stderr = self.child.stderr.take().unwrap();

        // Read lines and send to frontend
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        loop {
            tokio::select! {
                line = stdout_reader.next_line() => {
                    if let Some(line) = line? {
                        progress_tx.send(ProgressMessage::Output { line, is_error: false })?;
                    }
                }
                line = stderr_reader.next_line() => {
                    if let Some(line) = line? {
                        progress_tx.send(ProgressMessage::Output { line, is_error: true })?;
                    }
                }
            }
        }

        self.child.wait()
    }

    /// Cancel running operation
    pub fn cancel(&mut self) -> Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Send SIGTERM for graceful shutdown
            unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM) };
        }

        #[cfg(windows)]
        {
            self.child.kill()?;
        }

        Ok(())
    }
}
```

### Tool Management (Tool-Based Only)

Tools stored in: `{app_data}/tools/{platform}/`
- e.g., `~/Library/Application Support/dev.querypilot.studio/tools/darwin-aarch64/pg_dump`

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

// Only 3 databases need tools
impl ToolRegistry {
    pub fn new() -> Self {
        let mut tools = HashMap::new();

        // PostgreSQL: libpq client tools
        tools.insert(DatabaseType::PostgreSQL, vec![
            ToolDefinition {
                name: "pg_dump".to_string(),
                purpose: ToolPurpose::Backup,
                // ... platform binaries
            },
            ToolDefinition {
                name: "pg_restore".to_string(),
                purpose: ToolPurpose::Restore,
                // ...
            },
        ]);

        // MySQL: MariaDB client tools (LGPL licensed)
        tools.insert(DatabaseType::MySQL, vec![
            ToolDefinition {
                name: "mariadb-dump".to_string(),
                purpose: ToolPurpose::Backup,
                // ...
            },
            ToolDefinition {
                name: "mariadb".to_string(),
                purpose: ToolPurpose::Restore,
                // ...
            },
        ]);

        // MongoDB: Database Tools (Apache 2.0)
        tools.insert(DatabaseType::MongoDB, vec![
            ToolDefinition {
                name: "mongodump".to_string(),
                purpose: ToolPurpose::Backup,
                // ...
            },
            ToolDefinition {
                name: "mongorestore".to_string(),
                purpose: ToolPurpose::Restore,
                // ...
            },
        ]);

        Self { tools }
    }
}
```

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
    └── ToolDownloadPrompt.tsx — Missing tools download UI (tool-based only)
```

## Database-Specific Details

### SQLite (Native Rust)

- **Implementation**: `rusqlite::backup::Backup` API
- **No external tool needed**
- **Formats**:
  - Binary backup (`.db`) — online backup API, recommended
  - SQL dump (`.sql`) — programmatic schema + data export
- **Common options**: schema-only, data-only

```rust
// Example implementation
use rusqlite::backup::Backup;

async fn backup_sqlite(src: &Connection, dest_path: &Path) -> Result<()> {
    let mut dst = Connection::open(dest_path)?;
    let backup = Backup::new(src, &mut dst)?;

    backup.run_to_completion(100, Duration::from_millis(50), Some(|progress| {
        // Report progress: progress.pagecount, progress.remaining
    }))?;

    Ok(())
}
```

### MSSQL (Native Rust)

- **Implementation**: `tiberius` crate to execute T-SQL
- **No external tool needed**
- **Formats**:
  - Native backup (`.bak`) — `BACKUP DATABASE` command
  - SQL script (`.sql`) — programmatic schema scripting
- **Common options**: compression, copy-only, differential

```rust
// Example implementation
use tiberius::{Client, Config};

async fn backup_mssql(client: &mut Client, db_name: &str, path: &str) -> Result<()> {
    let sql = format!(
        "BACKUP DATABASE [{}] TO DISK = N'{}' WITH FORMAT, COMPRESSION",
        db_name, path
    );
    client.execute(&sql, &[]).await?;
    Ok(())
}
```

### Redis (Native Rust)

- **Implementation**: `redis` crate
- **No external tool needed**
- **Backup approaches**:
  - `BGSAVE` command → triggers server-side RDB dump
  - `DUMP` command per key → portable key-by-key export
- **Formats**: RDB snapshot, JSON export (custom)
- **Common options**: key pattern filter, specific databases (0-15)

```rust
// Example implementation
use redis::Commands;

async fn backup_redis(conn: &mut Connection) -> Result<()> {
    // Trigger background save
    redis::cmd("BGSAVE").query::<()>(conn)?;

    // Wait for completion
    loop {
        let info: String = redis::cmd("INFO").arg("persistence").query(conn)?;
        if info.contains("rdb_bgsave_in_progress:0") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // RDB file is now saved on Redis server
    // For remote servers, use DUMP/RESTORE per key for portable backup
    Ok(())
}
```

### PostgreSQL (Tool-Based)

- **Tools**: `pg_dump` (backup), `pg_restore` / `psql` (restore)
- **Source**: libpq client package (~20 MB)
- **License**: PostgreSQL License (permissive)
- **Formats**: Plain SQL (`.sql`), Custom (`.dump`), Directory, Tar
- **Default**: Custom format with compression (most flexible for restore)
- **Common options**: schema-only, data-only, compression level, include/exclude tables

### MySQL (Tool-Based)

- **Tools**: `mariadb-dump` (backup), `mariadb` (restore)
- **Source**: MariaDB client package (~50 MB)
- **License**: LGPL 2.1+ (permissive, avoids MySQL's GPL)
- **Format**: Plain SQL (`.sql`)
- **Common options**: single-transaction, routines, triggers, events, compress
- **Note**: MariaDB tools are fully compatible with MySQL databases

### MongoDB (Tool-Based)

- **Tools**: `mongodump` (backup), `mongorestore` (restore)
- **Source**: MongoDB Database Tools (~50 MB)
- **License**: Apache 2.0 (permissive)
- **Format**: BSON dump (directory with `.bson` + `.metadata.json` files)
- **Common options**: collection filter, query filter, gzip compression

## Tool Download System

Only applies to PostgreSQL, MySQL, and MongoDB.

### Download Flow

1. User initiates backup/restore for tool-based database
2. Backend calls `adapter.tool_requirements()`
3. If returns empty (SQLite, MSSQL, Redis): proceed directly
4. If returns tools: check if tools exist in `{app_data}/tools/{platform}/`
5. If missing, frontend shows: "PostgreSQL backup requires pg_dump. Download now? (~20 MB)"
6. User confirms → backend downloads, verifies checksum, extracts
7. Tool marked as available, operation proceeds

### Tool Status API

```rust
#[tauri::command]
pub async fn get_tool_status(database_type: DatabaseType) -> ToolStatus {
    // Returns empty for native implementations
    if matches!(database_type, DatabaseType::SQLite | DatabaseType::MSSQL | DatabaseType::Redis) {
        return ToolStatus { required: vec![], available: vec![], missing: vec![] };
    }

    // Check tool availability for PostgreSQL, MySQL, MongoDB
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

| Platform | PostgreSQL Source | MariaDB Source | MongoDB Source |
|----------|-------------------|----------------|----------------|
| macOS arm64 | Homebrew libpq | MariaDB binaries | MongoDB Tools |
| macOS x64 | Homebrew libpq | MariaDB binaries | MongoDB Tools |
| Windows x64 | EDB installer | MariaDB MSI | MongoDB MSI |
| Linux x64 | Official packages | MariaDB packages | MongoDB packages |

### Tool Storage Structure

```
~/Library/Application Support/dev.querypilot.studio/
├── vault.bin                           # Encrypted connections
├── tools/
│   ├── darwin-aarch64/
│   │   ├── pg_dump
│   │   ├── pg_restore
│   │   ├── mariadb-dump
│   │   ├── mariadb
│   │   ├── mongodump
│   │   └── mongorestore
│   ├── darwin-x86_64/
│   │   └── ...
│   ├── windows-x86_64/
│   │   └── ...
│   └── linux-x86_64/
│       └── ...
└── tools-checksums.json                # SHA256 verification
```

## Error Handling

### Connection Failures

- Test connection at Step 1 before proceeding
- If connection drops mid-operation: abort cleanly, show error with partial file warning
- Backup files from failed operations marked with `.partial` suffix

### Native Backup Errors (SQLite, MSSQL, Redis)

- Rust crate errors mapped to user-friendly messages
- Full error details in expandable section
- No subprocess output to parse

### Tool Execution Errors (PostgreSQL, MySQL, MongoDB)

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

- **Native backups**: Cancel via tokio task cancellation
- **Tool-based backups**: Send SIGTERM to child process
- Clean up partial backup files
- Restore operations may leave database in inconsistent state — warn user before allowing cancel

### Concurrent Operations

- One operation per connection at a time
- Multiple backups to different connections allowed
- Show warning if user tries to start second operation on same connection

## Files to Create/Modify

| Layer | Files | Notes |
|-------|-------|-------|
| Rust traits | `src-tauri/src/core/backup_capability.rs` | BackupCapable trait |
| Rust adapters | `src-tauri/src/adapters/backup/sqlite_backup.rs` | Native: rusqlite |
| Rust adapters | `src-tauri/src/adapters/backup/mssql_backup.rs` | Native: tiberius |
| Rust adapters | `src-tauri/src/adapters/backup/redis_backup.rs` | Native: redis crate |
| Rust adapters | `src-tauri/src/adapters/backup/postgres_backup.rs` | Tool: pg_dump |
| Rust adapters | `src-tauri/src/adapters/backup/mysql_backup.rs` | Tool: mariadb-dump |
| Rust adapters | `src-tauri/src/adapters/backup/mongodb_backup.rs` | Tool: mongodump |
| Rust commands | `src-tauri/src/commands/backup.rs` | Tauri commands |
| Tool executor | `src-tauri/src/core/tool_executor.rs` | Subprocess management |
| Tool registry | `src-tauri/src/core/tool_registry.rs` | Tool download (3 DBs only) |
| Frontend screen | `src/screens/BackupRestoreScreen/` | Wizard UI |
| Entry points | Menu items, context menus, window registration | Multiple locations |
