# Feature Development Reference

Consolidated architecture decisions, patterns, and implementation notes extracted from QueryPilot feature development. Organized by feature area for quick lookup.

---

## Table of Contents

- [Workspace & Multi-Connection](#workspace--multi-connection)
- [AI Architecture](#ai-architecture)
- [Safe Mode](#safe-mode)
- [Command Palette](#command-palette)
- [DataGrid & Table Editing](#datagrid--table-editing)
- [Inspector Panel](#inspector-panel)
- [SQL Editor & Query Execution](#sql-editor--query-execution)
- [Table Designer (Structure, Indexes, Triggers)](#table-designer-structure-indexes-triggers)
- [Selection Statistics](#selection-statistics)
- [ERD (Entity Relationship Diagrams)](#erd-entity-relationship-diagrams)
- [Backup & Restore](#backup--restore)
- [Serialization & Performance](#serialization--performance)
- [Security & Safety Patterns](#security--safety-patterns)
- [Known Tradeoffs & Limitations](#known-tradeoffs--limitations)

---

## Workspace & Multi-Connection

### Architecture Decisions

**Each database = separate connection profile.** Tabs are permanently bound to a `connectionId`. When a user switches databases, a new connection is created rather than mutating the existing one. This avoids state corruption and makes connection lifecycle explicit.

**Tab IDs include connectionId.** Format: `table-${connectionId}-${schema}-${name}`. This prevents ID collisions when the same table name exists across different connections. Without this, switching connections could route to stale tabs.

**Binary tree layout for workbench panels.** The panel system uses a binary tree structure where each node is either a leaf (panel) or a split (horizontal/vertical). This supports arbitrary nesting of editor/grid splits.

**ConnectionActivityBar replaced by inline sidebar.** The original vertical activity bar was replaced with collapsible connection sections in the sidebar. Each connection section shows its own object explorer tree. This scales better visually when many connections are open.

### Data Flow

```
Workspace (persisted in vault)
  ├── connections[] (ConnectionProfile, encrypted)
  │     └── Each has: connectionId, dbType, safeMode, credentials
  ├── tabs[] (TabState, persisted in tabStateStore via localStorage)
  │     └── Each bound to: connectionId, with debounced saves
  └── panels (binary tree of editor/grid splits)
```

### Key Stores

| Store | Persistence | Purpose |
|-------|-------------|---------|
| `useWorkspaceBundleStore` | Vault (encrypted) | Active workspace, connections |
| `tabStateStore` | localStorage (debounced) | Tab state, open tabs |
| `useGridPreferencesStore` | IndexedDB (Dexie) | Column order, sort, filters, inspector state |

### Grid Preferences Key Format

```
{connectionId}:{database}:{schema}:{table}:{tabId}
```

Used for column widths, sort preferences, quick filters, and inspector panel state. Stored in IndexedDB.

---

## AI Architecture

### Three Runtime Modes

QueryPilot supports three distinct AI runtimes, each with different trust boundaries:

| Runtime | Transport | Trust Level | Implementation |
|---------|-----------|-------------|----------------|
| ACP Agents | Subprocess + stdio | Sandboxed via CLI | External CLI agents (Claude Code, Codex, OpenCode) |
| BYOK (SDK) | Frontend TS -> HTTP | User's own API keys | Vercel AI SDK v6 with provider registry |
| QueryPilot CLI | Unix socket IPC | Read Only (hardcoded) | `src-cli/` binary, socket forwarder |

### Why Three Runtimes

- **ACP** enables power users to use their preferred CLI agent with full MCP tool access, without QueryPilot managing API keys.
- **BYOK** gives users direct AI access within the app UI using their own keys (OpenAI, Anthropic, etc.), with no external subprocess.
- **QueryPilot CLI** is always read-only and provides a socket forwarder for any compatible agent.

### QueryPilot CLI Architecture

```
External Agent (ACP)
  └── stdio JSON
        └── QueryPilot CLI Binary (src-cli/)
              └── Unix Socket IPC
                    └── Tauri Backend (main app)
                          └── Database Adapters
```

The CLI is a separate Rust binary in the Cargo workspace. It communicates with the main Tauri backend via IPC socket (Unix socket on macOS/Linux, named pipe on Windows). The CLI is always enforced as Read Only -- it cannot modify data.

### BYOK Provider Registry

Uses Vercel AI SDK v6's `customProvider()` to create a unified interface across OpenAI, Anthropic, Google, and Ollama:

```
User selects provider + enters API key
  → byokStore persists config (Zustand + IndexedDB)
  → createProviderInstance() builds AI SDK provider
  → AI SDK tools call Tauri IPC commands for database access
```

**Ollama note:** The original custom Rust Ollama code was deleted entirely and replaced by AI SDK's ollama provider. This eliminated ~1500 lines of custom streaming/parsing code.

### Key Stores

| Store | Location | Purpose |
|-------|----------|---------|
| `byokStore` | `src/stores/byokStore.ts` | Provider config, API keys (Zustand + persist) |
| AI preferences | `src/stores/aiPreferencesStore.ts` | Model selection, temperature, system prompts |

### Self-Correcting Query Generation

AI-generated SQL follows a retry loop:
1. Generate SQL from natural language
2. Lint generated SQL via `sql_engine::parser`
3. If lint errors, feed errors back to AI for correction
4. Retry up to 3 times before surfacing the error

---

## Safe Mode

### Why Safe Mode Exists

Desktop database tools connect directly to production databases. A single mistyped `DROP TABLE` can be catastrophic. Safe Mode provides graduated protection levels that users configure per-connection.

### Four Levels

| Level | Allows | Blocks |
|-------|--------|--------|
| `ReadOnly` | SELECT, EXPLAIN, SHOW | Everything else |
| `ReadWrite` | + INSERT | UPDATE, DELETE, DDL |
| `ReadWriteUpdate` | + UPDATE, DELETE | DDL (CREATE, ALTER, DROP) |
| `FullAccess` | Everything | Nothing |

### Enforcement Architecture

**Enforcement happens in the Rust backend command layer.** The frontend cannot bypass Safe Mode. This is a deliberate security decision -- if enforcement were only in the frontend, a compromised or modified UI could execute arbitrary SQL.

```
Frontend (SQL Editor)
  → Tauri IPC command
    → Safe Mode check (Rust)
      → sql_engine::parser::get_statement_type()
        → Allow or reject
```

### Key Implementation Details

- **Multi-statement batches:** If any statement in a batch is disallowed, the entire batch is rejected. This prevents smuggling dangerous statements inside benign ones.
- **Unknown/unparseable statements:** Treated as DDL (the most dangerous category). This is a fail-safe design -- if the parser cannot classify a statement, it assumes the worst.
- **Storage:** `ConnectionProfile.safe_mode` field, persisted in the encrypted vault alongside connection credentials.
- **SQL classification:** Uses `sql_engine::parser::get_statement_type()` which returns an enum mapping each SQL statement to its category.

---

## Command Palette

### Architecture

The command palette uses a nested mode pattern for contextual subpanels. The base palette shows all available commands; nested modes show domain-specific lists.

```
CommandPalette.tsx (shell)
  ├── Default mode: flat command list (match-sorter filtered)
  └── Nested modes (set via commandPaletteStore):
        ├── "safe-mode" → NestedSafeModeList
        ├── "open-erd" → NestedErdList
        └── (extensible for future modes)
```

### Nested Mode Pattern

The `commandPaletteStore` (`src/stores/ui/commandPaletteStore.ts`) holds a `NestedMode` union type:

```typescript
type NestedMode =
  | { type: "safe-mode"; connectionId: string }
  | { type: "open-erd" }
  // ... extensible
```

Each nested mode component receives `{ query, onSelect, onClose, listRef }` props and renders its own `<CommandList>` with `<CommandGroup>` sections.

### Adding Commands

New commands go in `src/data/defaultCommands.ts`. Each command has:
- `id`: Unique identifier (e.g., `"workbench.action.openErd"`)
- `label`: Display text
- `category`: Grouping (e.g., `"Workbench"`)
- `when`: Activation context (e.g., `"activeEditor"`)
- `handler`: Execution function

Keybindings are in `src/data/defaultKeybindings.ts`. Menu-to-command mapping is in `src/data/menuActionCommandMap.ts`.

---

## DataGrid & Table Editing

### Adapter Architecture

DataGrid uses an adapter pattern to support different data paradigms:

```
BaseDataGrid (shared grid logic, selection, keyboard, CRUD pipeline)
  ├── SqlDataGrid (SQL tables: Postgres, MySQL, MSSQL, SQLite)
  ├── DocumentDataGrid (MongoDB collections)
  └── KeyValueDataGrid (Redis)
```

Each adapter provides a `CommandFactory` that knows how to create CRUD commands for its paradigm. `BaseDataGrid` consumes the factory and handles staging, undo/redo, and commit.

### Row Identity Strategy (No-PK Editing)

Tables without primary keys can still be edited if they have deterministic identity:

**Priority order for row identity:**
1. Primary key columns
2. Unique constraint columns
3. Unique index columns (non-partial only)

If none exist, standard edit/delete is disabled with a user-facing explanation.

**Best-effort escape hatch:** For tables with no deterministic identity, explicit per-row context menu actions ("Best-effort Edit...", "Best-effort Delete...") are available. These build a WHERE clause from all row values and pre-check that exactly 1 row matches before proceeding.

```
chooseDeterministicIdentityColumns() in src/components/DataGrid/utils/rowIdentity.ts
  → Returns string[] | null
  → Used by SqlDataGrid to set primaryKeyColumns on the command factory
```

### CRUD Command Pipeline

```
User action (edit cell, delete row, add row)
  → CommandFactory.createEditCommand() / createDeleteCommand() / createInsertCommand()
    → stageCommand() (adds to undo/redo stack)
      → Optimistic display update via useOptimisticRows
        → On commit: commandToSql() → adapter.execute()
```

Commands carry metadata tags like `matcher:deterministic` or `matcher:best_effort` for observability.

### Optimistic Row Updates

`useOptimisticRows` hook merges staged commands with display rows for immediate visual feedback. When `primaryKeyColumns` is empty, it skips PK-signature matching (which would cause false collisions) and only applies tempId-linked insert updates.

### Embedded Foreign Key System

Allows inline display of referenced values from foreign key tables:

| Component | Location |
|-----------|----------|
| Config store | `useEmbeddedFKPreferencesStore` (IndexedDB) |
| Storage key | `{connectionId}:{schema}.{table}` |
| Config type | `EmbeddedFKConfig` from `@/adapters/types.ts` |
| Hidden columns | Convention: `__qp_fk__{fkColumn}__{refColumn}` |
| Query builder | `SqlAdapter.selectWithEmbeddedFK()` builds LEFT JOIN queries |

---

## Inspector Panel

### Architecture

The inspector is a multi-record panel with three views:

```
InspectorPanel (src/components/DataGrid/components/inspector/)
  ├── InspectorTreeView — merged key/value tree with inline editing
  ├── InspectorDiffView — inline unified diff (first record = reference)
  └── InspectorRawView — JSON display via CodeEditor (CodeMirror)
```

### Key Design Decisions

- **Multi-record support:** `selectedRows[]` replaces single `selectedRow`. All selected rows are collected from grid selection.
- **No manual baseline:** The first selected record is automatically the diff reference. The old "Set Baseline" button was removed.
- **Merged field display:** When multiple records are selected, fields with identical values across all records are shown as editable; fields with different values show `<multiple values>` with small badges.
- **Raw view uses CodeEditor:** Replaced `<pre>` + `JSON.stringify` with the CodeMirror-based `CodeEditor` component for syntax highlighting and performance on large JSON.
- **Persistence:** Inspector open/closed state and active tab stored per grid in `useGridPreferencesStore`.
- **Keyboard shortcut:** `Cmd+J` (Mac) / `Ctrl+J` toggles the inspector.

### Edit Flow

Inspector tree view editing routes through the same CRUD pipeline as inline cell editing:

```
User clicks value in tree
  → inline input field
    → onCellEdit(rowIndexes[], field, newValue)
      → handleInspectorCellEdit constructs GridEditCommitEvent per row
        → handleCellEditCommit (existing CRUD pipeline)
```

---

## SQL Editor & Query Execution

### Completion Architecture

Completion uses a Rust-first approach with TypeScript fallback:

```
Keystroke → CodeMirror autocomplete
  → Tauri IPC → Rust sql_engine::completion
    → Fuzzy ranking with usage boosts
      → Results sent back to CodeMirror
  → TS fallback (if Tauri unavailable, e.g., in tests)
```

**Cache key format:** `connectionId:schema` -- the completion metadata cache must include the schema because different schemas have different tables/columns.

### Per-Editor Isolation

Each editor instance needs its own caches for semantic highlighting and outline. Module-level caches cause cross-editor contamination. This was a significant bug source.

### Performance Degradation Ladder

For large SQL files, features are progressively disabled:

| Threshold | Disabled Features |
|-----------|-------------------|
| > 10k lines | Semantic highlighting, outline |
| > 20k lines | Autocomplete |
| > 50k lines | Syntax highlighting switches to basic mode |

### Tauri Detection

There is an inconsistency in Tauri detection: some code checks `__TAURI__`, others check `__TAURI_INTERNALS__`. The correct check for Tauri 2 is `__TAURI_INTERNALS__`.

---

## Table Designer (Structure, Indexes, Triggers)

### Context Menu Pattern

All table designer grids (Structure, Indexes, Triggers) follow the same context menu implementation pattern:

```
shadcn ContextMenu wraps DataGridBase
  → Hover tracking via useRef + onItemHovered
  → Snapshot hovered row into state on menu open (onOpenChange)
  → Menu items dispatch existing handlers or stage commands via crudStore
```

**Why snapshot on open:** When the user right-clicks, the hovered row ref is captured into state. Without this, moving the mouse to the context menu popup would null out the ref.

### Structure Table Context Menu

Actions: Add Column, Duplicate Column, Nullable toggle (submenu), Copy Column Name, Copy Column DDL, Delete/Discard/Undo Delete.

- DDL construction happens on the frontend from row data
- Read-only views skip the context menu entirely (`isReadOnly` check)
- File: `src/components/TableStructure/StructureTableContextMenu.tsx`

### Index Table Context Menu

Actions: Add Index, Change Type (submenu with database-specific types), Toggle Unique, Copy Index Name, Copy DDL, Delete/Undo Delete.

- Primary key indexes are locked (edit/delete disabled)
- Type/Unique changes on existing indexes use drop+recreate pattern (tagged with `recreate:{name}`)
- File: `src/components/TableIndexes/IndexTableContextMenu.tsx`

### Trigger Table Context Menu

Actions: Toggle Enabled, Copy Trigger Name, Copy Definition, Delete/Undo Delete.

- Simpler than index/structure menus (no inline editing of trigger properties)
- File: `src/components/TableTriggers/TriggerTableContextMenu.tsx`

### Row State Rules (Common Pattern)

| Row State | Add | Edit Actions | Copy Actions | Delete |
|-----------|-----|-------------|-------------|--------|
| Normal | Enabled | Enabled | Enabled | Enabled (with confirm dialog) |
| Locked (PK) | Enabled | Disabled | Enabled | Disabled |
| Pending Delete | Enabled | Disabled | Enabled | Shows "Undo Delete" |
| Pending New | Enabled | Enabled | Enabled | Shows "Discard" (immediate) |

---

## Selection Statistics

### Architecture

Selection statistics display as an expandable inline stats bar in the DataGrid status bar:

```
DataGridStatusBar
  └── SelectionSummary (src/components/DataGrid/components/SelectionSummary.tsx)
        ├── Expanded: all enabled stats shown inline with dividers
        └── Compact: primary stat only in a pill
```

### Key Design Decisions

- **Replaced popover with inline bar.** The old single-pill + popover added unnecessary friction.
- **Color-coded by type:** Green tint for numeric selections, blue for non-numeric.
- **Click interactions:** Click value = copy to clipboard. Click label = cycle to next stat. Right-click = context menu to toggle stats.
- **Persistence:** `useSelectionStatsPreferencesStore` (Zustand + IndexedDB). Global preferences, not per-table.

### Performance Thresholds

- **>5000 cells:** Expensive stats (median, etc.) are skipped; only count is shown.
- **>10k rows:** Status bar stat calculation is skipped entirely.

### Default Stats

- **Numeric:** Sum, Avg, Count
- **Non-numeric:** Count, Unique

### Stat Ordering

Fixed render order regardless of toggle order:
- Numeric: Sum, Avg, Median, Min, Max, Count, Null
- Non-numeric: Count, Unique, Null

---

## ERD (Entity Relationship Diagrams)

### Command Palette Integration

ERD access via `Cmd+E` with smart shortcutting:

```
Cmd+E
  → Check connected SQL connections
  → If 0: no-op
  → If 1 connection, 1 database, <=1 schema: open ERD directly
  → Otherwise: open palette with "open-erd" nested mode
    → NestedErdList shows targets grouped by connection
    → User selects → openErdView() → closePalette()
```

### ERD Target Format by DB Type

| DB Type | Has Schemas | Target Format |
|---------|-------------|---------------|
| PostgreSQL | Yes | `database / schema` |
| SQL Server | Yes | `database / schema` |
| MySQL | No | `database` |
| MariaDB | No | `database` |
| SQLite | No | `database` |
| MongoDB | N/A | Excluded (document DB) |
| Redis | N/A | Excluded (key-value) |

### Tab Deduplication

ERD tabs use `objectKey` for per-panel deduplication. Selecting an already-open ERD target focuses the existing tab rather than opening a duplicate.

---

## Backup & Restore

### Architecture Decision

**Native Rust for some, external tools for others.** This is because some database backup formats require the official client tools for correctness:

| Database | Approach | Tool |
|----------|----------|------|
| PostgreSQL | External tool | `pg_dump` / `pg_restore` |
| MySQL | External tool | `mariadb-dump` (not `mysqldump`) |
| MongoDB | External tool | `mongodump` / `mongorestore` |
| SQLite | Native Rust | Direct file copy + VACUUM |
| MSSQL | Native Rust | SQL-based backup commands |
| Redis | Native Rust | RDB snapshot via protocol |

**Why MariaDB tools for MySQL:** MariaDB's dump tool is LGPL-licensed, while MySQL's `mysqldump` is GPL. LGPL allows distribution with proprietary software.

### Tool Distribution

External tools are bundled with the app at `{app_data}/tools/{platform}/`. Platform-specific binaries are included in the build.

### Trait-Based Design

```rust
trait BackupCapable {
    fn backup_options_schema(&self) -> BackupOptionsSchema;
    fn backup(&self, options: BackupOptions) -> Result<BackupResult>;
    fn restore(&self, options: RestoreOptions) -> Result<RestoreResult>;
}
```

Each adapter implements this trait with dynamic option schemas. The frontend renders the options form from the schema, so new backup options don't require frontend changes.

---

## Serialization & Performance

### DirectMsgPackEncoder Optimization

The serialization pipeline was redesigned for performance with large result sets:

**Before:** Per-row `Vec<u8>` allocation (one buffer per row).
**After:** `par_chunks()` with shared chunk buffers (one buffer per thread chunk).

```rust
// Parallel chunked encoding pattern
rows.par_chunks(CHUNK_SIZE)
    .map(|chunk| {
        let mut buf = CHUNK_BUF_POOL.get();
        for row in chunk {
            encode_row(row, &mut buf);
        }
        buf.freeze()
    })
```

### Specific Optimizations

- **Stack-buffer formatters:** Decimal and IPv4 values use stack-allocated formatters instead of `to_string()`, eliminating heap allocations in hot paths.
- **Buffer pooling:** `CHUNK_BUF_POOL` reuses buffers across chunks to reduce allocation pressure.
- **Applied to all 4 SQL adapters:** Postgres, MySQL, MSSQL, SQLite.
- **Expected improvement:** 15-25% on large result sets.

### VS Code-Level Performance Overhaul

Frontend performance follows these principles:

1. **Store isolation:** Zustand stores are split to prevent cross-panel re-renders. A change in one editor's state should not cause another panel to re-render.
2. **Focus-gated extensions:** CodeMirror extensions that do heavy work (semantic highlighting, linting) are disabled when the editor is not focused.
3. **Shared linter coordinator:** Multiple editors share a single linter coordinator that deduplicates IPC calls. Without this, N open editors would send N redundant lint requests.
4. **Feature degradation ladder:** See [SQL Editor](#sql-editor--query-execution) section for line-count thresholds.

---

## Security & Safety Patterns

### Encrypted Vault

Connection credentials are stored in an encrypted vault using the OS keychain:

```
ConnectionProfile (includes credentials)
  → Serialized + encrypted
    → Stored in app data directory
      → Encryption key stored in OS keychain (macOS Keychain, Windows DPAPI, Linux Secret Service)
```

### Frontend Cannot Bypass Backend Safety

All security-critical checks happen in the Rust backend:
- Safe Mode enforcement
- CLI read-only restriction
- Connection credential encryption/decryption

The frontend is treated as untrusted for security decisions.

### AI Tool Execution

AI tools (both MCP and BYOK) call the same Tauri IPC commands as the UI. This means Safe Mode applies equally to AI-generated queries. There is no separate "AI bypass" path.

### Fail-Safe Defaults

- Unknown SQL statements are treated as DDL (most restrictive category)
- QueryPilot CLI is hardcoded to Read Only
- Multi-statement batches are rejected entirely if any statement is disallowed
- Best-effort row matching requires pre-check confirmation (match count === 1)

---

## Known Tradeoffs & Limitations

### Rust/TS Serialization Mismatch

Rust backend uses `#[serde(rename_all = "camelCase")]` on structs, but the TypeScript `QueryColumnMeta` interface uses snake_case field names. This means `col.db_type` is `undefined` at runtime when using `BackendAPI.query()` results because the JSON actually has `dbType`.

**Workaround:** Use table introspection (`useTableFullStructure`) for column metadata instead of query result columns. The `ColumnMeta` from `@/types/schema.ts` has correct snake_case fields.

### Two Different ColumnMeta Types

| Type | Source | Fields |
|------|--------|--------|
| `ColumnMeta` from `@/types/schema.ts` | Table introspection | `db_type`, `is_pk`, `is_fk`, `ordinal` (correct) |
| `QueryColumnMeta` from `@/services/backend.ts` | Query results | `db_type`, `data_type` (snake_case in TS, camelCase in JSON -- broken) |

### Best-Effort Row Matching Limitations

- Requires a round-trip to the database for pre-check
- Cannot handle concurrent modifications between pre-check and execution
- All-column WHERE clauses can be slow on wide tables

### MariaDB Tools for MySQL

Using MariaDB tools instead of MySQL native tools means some MySQL-specific features may not be supported in backup/restore. This is a licensing tradeoff (LGPL vs GPL).

### Per-Editor Cache Requirement

CodeMirror extensions must use per-editor instance caches. Module-level caches cause state leakage between editors. This adds memory overhead proportional to the number of open editors.

### Safe Mode Granularity

Safe Mode operates at the connection level, not per-database or per-schema. A user who needs Read Only on production tables but Full Access on staging tables within the same server must create separate connections.

---

## Implementation Status (as of 2026-03-02)

Features from recent development plans and their implementation state. Unfinished plans are kept in `docs/plans/`.

### Fully Implemented

| Feature | Completed |
|---------|-----------|
| AI SDK BYOK Runtime | Feb 24 |
| Multi-Connection GlobalChangesDialog | Feb 25 |
| ERD Command Palette | Feb 27 |
| Inspector Panel Redesign | Feb 27 |
| Index Table Context Menu | Feb 28 |
| Trigger Table Context Menu | Feb 28 |
| Structure Table Context Menu | Feb 28 |
| Selection Statistics Redesign | Mar 1 |

### Partially Implemented

**AI Preferences Panel** (plan: `docs/plans/2026-02-24-ai-preferences-panel-*`)
- Done: AI category in PreferencesDialog, `AIPreferencesPanel.tsx`, `CompactModelPicker`, `byokStore` with `runtimeMode`/`autoExecuteQueries`/`includeSchemaContext`
- Missing: `maxToolSteps` dynamic configuration — currently hardcoded as `MAX_TOOL_STEPS` constant in `src/ai/constants.ts` instead of user-configurable via store/service

**DataGrid No-Primary-Key Editing** (plan: `docs/plans/2026-02-26-datagrid-no-primary-key-editing-*`)
- Done: `chooseDeterministicIdentityColumns()` in `rowIdentity.ts`, `bestEffortMatcher.ts` utility, `matcher:deterministic`/`matcher:best_effort` tags in CRUD commands, `useOptimisticRows` PK-signature guard
- Missing: `canMutateExistingRows` UX guard not wired in `BaseDataGrid.tsx` (no toast/banner when identity columns are empty); "Best-effort Edit/Delete" context menu items not connected to existing `bestEffortMatcher.ts`

### Not Implemented

**AI Runtime Unification** (plan: `docs/plans/2026-02-25-ai-runtime-unification-*`)
- Goal: Unified `RuntimeAdapter` contract across ACP, BYOK, and MCP runtimes with capability-driven UI
- Missing: No `src/ai/runtime/` directory, no `RuntimeAdapter` contract, no `aiRuntimeStore`, no ACP process lifecycle (`acp_stop_agent`), no capability matrix (`supportsImages`, `supportsSessionHistory`)
