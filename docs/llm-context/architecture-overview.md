# Architecture Overview

## Hybrid Desktop Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri 2 Shell                        │
├──────────────────────────┬──────────────────────────────┤
│   Frontend (WebView)     │     Backend (Rust)           │
│   React 19 + TypeScript  │     Tauri Commands           │
│   Vite + Tailwind        │     Connection Pool          │
│   Zustand State          │     Database Adapters        │
└──────────────────────────┴──────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         PostgreSQL     MongoDB      Redis
         MySQL          (Document)   (Key-Value)
         SQLite
         MSSQL
         (SQL)
```

## Multi-Paradigm Database Support

Query Pilot uses a **capability-based trait system**:

| Paradigm | Trait | Databases | Frontend Grid |
|----------|-------|-----------|---------------|
| SQL | `SqlQueryable` | PostgreSQL, MySQL, SQLite, MSSQL | `SqlDataGrid` |
| Document | `DocumentQueryable` | MongoDB | `DocumentDataGrid` |
| Key-Value | `RichKeyValueOperable` | Redis | `KeyValueDataGrid` |

**Capability Traits** (`src-tauri/src/core/capabilities.rs`):
- `BaseCapability` - All adapters: connect, disconnect, test_connection
- `SqlQueryable` - SQL: execute_query, execute_statement
- `DocumentQueryable` - MongoDB: find_documents, insert_document, aggregate
- `RichKeyValueOperable` - Redis: Hash, List, Set, ZSet, Stream operations

**UnifiedAdapter** wraps concrete adapters with runtime capability checking via `as_sql()`, `as_document()`, `as_keyvalue()`.

## Multi-Window Architecture

- **Main window** (`label="main"`): Connection browser
- **Workspace windows** (`label="workspace-{connectionId}"`): One per connection
- Cross-window coordination via `BroadcastChannel` API (not Tauri events)
- Each workspace manages its own connection cleanup on close

## IPC Communication

**Two query paths** (see [Query Execution](../architecture/query-execution.md)):

| Path | Use For | Transport | Encoding |
|------|---------|-----------|----------|
| Direct (`query`) | Metadata, <1K rows | Tauri invoke | JSON |
| Streaming (`execute_query`) | Data grids, user queries | IPC channels | MessagePack |

**Critical**: Streaming path skips `window.emit` overhead (300-350ms savings for large results).

## State Management (Zustand)

Key stores:
- `connectionStoreNew` - Active connections, favorites, recents
- `workbenchStore` - Layout tree, tab metadata, drag-drop
- `workspaceScreenStore` - Schema/table navigation
- `crudStore` - Transaction state, pending operations
- `dataInvalidationStore` - Event-driven cache invalidation

## Key Files

| Layer | Path | Purpose |
|-------|------|---------|
| Frontend entry | `src/screens/` | MainScreen, WorkspaceScreen |
| State | `src/stores/` | Zustand stores |
| Backend API | `src/services/backend.ts` | Tauri command wrappers |
| Rust commands | `src-tauri/src/commands/` | connection.rs, sql.rs, document.rs, keyvalue.rs |
| Connection pool | `src-tauri/src/core/manager.rs` | ConnectionManager + DashMap |
| Adapters | `src-tauri/src/adapters/` | Database implementations |
