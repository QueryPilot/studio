# Safe Mode Feature Design

## Overview

Per-connection safe mode that restricts what operations the GUI allows, regardless of the actual database user's permissions. Enforcement happens in the Rust backend - the frontend cannot bypass it.

## Safe Mode Levels

| Level | Allowed Operations |
|---|---|
| **Read Only** | SELECT, EXPLAIN, SHOW, DESCRIBE |
| **Read + Write** | Above + INSERT |
| **Read + Write + Update** | Above + UPDATE |
| **Full Access** (default) | Everything including DELETE, DDL (DROP, ALTER, CREATE, TRUNCATE) |

### Per-Paradigm Mapping

#### SQL (Postgres, MySQL, MariaDB, SQLite, MSSQL)

| Level | Allowed |
|---|---|
| Read Only | `SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`, `WITH...SELECT` |
| + Write | `INSERT` |
| + Update | `UPDATE` |
| Full | `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE` |

#### MongoDB

| Level | Allowed |
|---|---|
| Read Only | `find`, `findPage`, `count`, `aggregate`, `listCollections`, `sampleSchema` |
| + Write | `insertOne`, `insertMany` |
| + Update | `updateOne`, `updateMany` |
| Full | `deleteOne`, `deleteMany`, `createCollection`, `dropCollection`, `runCommand` |

#### Redis

| Level | Allowed |
|---|---|
| Read Only | `GET`, `SCAN`, `ScanWithPreviews`, `TYPE`, `TTL`, `DBSIZE`, `ServerInfo`, `SelectDb`, `HashGetAll`, `ListRange`, `ListLen`, `SetMembers`, `ZSetRange`, `StreamRange`, `StreamLen` |
| + Write | `SET`, `HashSet`, `ListPush`, `SetAdd`, `ZSetAdd` |
| + Update | `SetTtl` |
| Full | `DELETE`, `HashDelete`, `SetRemove`, `ExecuteRaw` |

### MCP Bridge

MCP is **always Read Only**, hardcoded. Not configurable. MCP is an external surface area and should never mutate data.

## Architecture

### Enforcement Location

All enforcement in the Rust Tauri command layer. The backend parses/classifies operations and rejects disallowed ones before execution.

### Rust Types

```rust
// src-tauri/src/types.rs
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SafeMode {
    ReadOnly,
    ReadWrite,
    ReadWriteUpdate,
    #[default]
    FullAccess,
}

// src-tauri/src/core/safe_mode.rs
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OperationKind {
    Read,
    Insert,
    Update,
    Delete,
    Ddl,
}

impl SafeMode {
    pub fn allows(&self, op: OperationKind) -> bool {
        match self {
            SafeMode::ReadOnly => matches!(op, OperationKind::Read),
            SafeMode::ReadWrite => matches!(op, OperationKind::Read | OperationKind::Insert),
            SafeMode::ReadWriteUpdate => {
                matches!(op, OperationKind::Read | OperationKind::Insert | OperationKind::Update)
            }
            SafeMode::FullAccess => true,
        }
    }
}
```

### SQL Classification

Uses the existing `sql_engine::parser::get_statement_type()` to classify statements:

- `SELECT`, `EXPLAIN`, `SHOW` -> `OperationKind::Read`
- `INSERT` -> `OperationKind::Insert`
- `UPDATE` -> `OperationKind::Update`
- `DELETE` -> `OperationKind::Delete`
- `CREATE`, `ALTER`, `DROP`, `TRUNCATE` -> `OperationKind::Ddl`

#### Edge Cases

- **Multi-statement**: Parse all statements, reject entire batch if any is disallowed
- **CTEs**: `WITH x AS (...) DELETE FROM ...` classified by the final statement (DELETE)
- **RETURNING**: `INSERT ... RETURNING *` is still INSERT
- **EXPLAIN**: Always Read, even `EXPLAIN DELETE` (doesn't execute the mutation)
- **Transactions**: `BEGIN/COMMIT/ROLLBACK` are Read (control flow); statements inside checked individually
- **Unknown/unparseable**: Falls back to keyword scan; if still unknown, treated as DDL (fail safe)

### Document Operation Classification

Matches the `DocumentOperation` enum variant directly - no parsing needed.

### KeyValue Operation Classification

Matches the `KeyValueOperation` enum variant directly - no parsing needed.

### Guard Function

Single guard check called by all three command modules:

```rust
fn check_safe_mode(safe_mode: SafeMode, kind: OperationKind, description: &str) -> Result<(), String> {
    if safe_mode.allows(kind) {
        Ok(())
    } else {
        Err(format!(
            "Blocked by Safe Mode ({:?}): {} is not allowed on this connection.",
            safe_mode, description
        ))
    }
}
```

## Storage

### Frontend (TypeScript)

Safe mode stored in `ConnectionProfile` (persisted in encrypted vault):

```typescript
// src/types/connection.ts
export type SafeMode = "read_only" | "read_write" | "read_write_update" | "full_access";

export interface ConnectionProfile {
  // ... existing fields
  safe_mode?: SafeMode; // defaults to "full_access"
}
```

### Flow

1. User sets safe mode in ConnectionForm (dropdown)
2. Stored in `ConnectionProfile.safe_mode` in vault (persisted, encrypted)
3. On `connect()`, frontend passes `safe_mode` on the `ConnectionProfile` to Rust
4. Rust stores it in `LiveConnection` alongside the adapter
5. Every command handler reads it from `LiveConnection` before executing

## UI: WorkspaceTitleBar Lock Icon

The existing `IconLock` button in `WorkspaceTitleBar.tsx` (currently a placeholder at line ~889) becomes the safe mode indicator and quick-switch trigger.

**Behavior:**
- Displays the current safe mode level via icon color/variant:
  - Read Only: red lock icon
  - Read + Write: orange lock icon
  - Read + Write + Update: yellow lock icon
  - Full Access: green unlocked icon
- Tooltip shows the current level name (e.g. "Safe Mode: Read Only")
- **Click** opens the command palette in `set-safe-mode` nested mode

**Implementation:**
- Read safe mode from the current connection's profile via `useConnectionStore`
- On click: `useCommandPaletteStore.getState().openPalette()` then `setNestedMode({ type: "set-safe-mode" })`

## UI: Command Palette Safe Mode Selector

Add a new `NestedMode` for safe mode selection, following the existing pattern (switch-database, switch-schema, etc.).

**Changes to `commandPaletteStore.ts`:**
```typescript
export type NestedMode =
  | { type: "switch-database" }
  | { type: "switch-schema" }
  | { type: "open-connection" }
  | { type: "switch-workspace" }
  | { type: "new-query-connection" }
  | { type: "search-saved-queries" }
  | { type: "set-safe-mode" };       // NEW
```

**New component: `NestedSafeModeList.tsx`** in `src/components/CommandPalette/`:
- Shows the 4 safe mode levels as selectable items
- Current level has a checkmark
- On select: updates the connection profile via `connectionStore.updateConnection()` with the new `safe_mode` value, and calls a Tauri command to update the live connection's safe mode in the backend
- Each item shows: icon + level name + short description of what's allowed

**Also register a command** (in `useCommandPaletteQueries.ts` or command registration) so users can find it by typing "Safe Mode" or "Lock Mode" in the palette without needing the lock icon.

## Files to Modify

| Layer | File | Change |
|---|---|---|
| Types (Rust) | `src-tauri/src/types.rs` | Add `SafeMode` enum, add `safe_mode` field to `ConnectionProfile` |
| Guard logic | `src-tauri/src/core/safe_mode.rs` (new) | `OperationKind` enum, `SafeMode::allows()`, `classify_sql()`, `check_safe_mode()` |
| SQL commands | `src-tauri/src/commands/sql.rs` | Guard check before `execute_query` and `query` |
| Document commands | `src-tauri/src/commands/document.rs` | Guard check before `document_execute` dispatch |
| KeyValue commands | `src-tauri/src/commands/keyvalue.rs` | Guard check before `keyvalue_execute` dispatch |
| MCP handlers | `src-tauri/src/mcp/handlers.rs` | Hardcoded read-only enforcement |
| Connection manager | `src-tauri/src/core/manager.rs` | Store `safe_mode` in `LiveConnection` |
| Core module | `src-tauri/src/core/mod.rs` | Register `safe_mode` module |
| Types (TS) | `src/types/connection.ts` | Add `SafeMode` type, add to `ConnectionProfile` |
| Connection form | `src/screens/home/.../ConnectionForm.tsx` | Safe mode dropdown selector |
| Connection store | `src/stores/connectionStoreNew.ts` | Pass `safe_mode` through to backend |
| Command palette store | `src/stores/ui/commandPaletteStore.ts` | Add `"set-safe-mode"` to `NestedMode` union |
| Safe mode list | `src/components/CommandPalette/NestedSafeModeList.tsx` (new) | Nested list showing 4 safe mode levels |
| Command palette | `src/components/CommandPalette/CommandPalette.tsx` | Render `NestedSafeModeList` when nested mode is `set-safe-mode` |
| Title bar | `src/screens/workspace/components/WorkspaceTitleBar.tsx` | Update `IconLock` button to show safe mode state and open palette on click |
