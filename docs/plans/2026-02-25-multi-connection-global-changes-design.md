# Multi-Connection GlobalChangesDialog Design

**Goal:** The GlobalChangesDialog shows and commits staged changes across ALL workspace connections, not just the focused one.

**Current limitation:** The dialog receives a single `connectionId` and filters `stagedCommands` by that prefix. The title bar pill only counts the focused connection's changes. Users with changes across multiple connections must switch focus and review each one separately.

**Approach:** Make `connectionId` optional. When omitted, the dialog shows all staged commands. The sidebar gains a two-level tree: connection headers with table children. DDL preview groups output by connection with separate executors, but only for commands in the active sidebar filter (All / connection / table). The title bar pill counts all workspace changes.

## Data Model

### New type: ConnectionGroup

```typescript
interface ConnectionGroup {
  connectionId: string;
  connectionName: string;
  dbType: DbType;
  tables: TableSummary[];
  totalChanges: number;
}
```

### Props change

```typescript
interface GlobalChangesDialogProps {
  connectionId?: string;  // Optional — omit for workspace-wide multi-connection
  database?: string;
  schema?: string;
  table?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitSuccess?: () => void;
}
```

### Scope modes

| Mode | Condition | Behavior |
|---|---|---|
| Table-specific | `connectionId` + `database` + `table` all set | Single table (unchanged) |
| Connection-wide | `connectionId` set, no `table` | All tables for one connection (unchanged) |
| Workspace-wide | `connectionId` omitted | All staged commands across all connections |

**Invariant:** `database` + `table` without `connectionId` is invalid input. In this case, the dialog must fail fast (show internal error + close or no-op) and MUST NOT fall back to workspace-wide commit/discard behavior.

## Sidebar

In workspace-wide mode, the sidebar becomes a two-level tree:

```
All (12 changes)
▼ Production PG (5)
    public.users (2)
    public.orders (3)
▼ Cache Redis (2)
    keys (2)
```

- Connection headers show connection name + change count
- Clicking a connection header filters to that connection
- Clicking a table filters to that specific table
- "All" shows everything
- The same active filter drives both the Changes tab and DDL preview

Connection name and dbType are resolved from `useConnectionStore().getConnection(connectionId)`.

To avoid stale names/types when connection metadata changes while the dialog is open, grouping and language derivation subscribe to connection store state (`connections`) so memoized values recompute.

Selection state safety:
- Reset `selectedConnectionId` and `selectedTableKey` on dialog open
- If filtered data changes and current selection no longer exists, clear the invalid selection automatically

## DDL Preview

Use only commands in the current filter selection (All / selected connection / selected table), then group those commands by `connectionId` from the command target. For each unique connection, create an executor via `getOperationExecutor(connId, dbType)` and call `preview()`. Concatenate with connection header comments:

```
-- === Production PG ===

ALTER TABLE public.users ...;

-- === Cache Redis ===

SET user:1 "value"
```

CodeEditor language: if all connections share the same paradigm, use that language. If mixed (SQL + Redis), fall back to `"text"`.

## Title Bar

- `totalChanges` counts ALL staged commands in the store (not filtered by `connectionId:`)
- Dialog opens with no `connectionId` prop (workspace-wide mode)

## Commit

Workspace-wide commit in this dialog should use a settled per-table loop (`commitChanges(tableKey)` with try/catch per table) instead of fail-fast `commitAll()`, so one table/connection failure does not block others.

Rules:
- Commit continues after individual failures
- Invalidate and clear committed changes only for successful table keys
- Failed table keys remain staged
- Success toast includes committed count + failed table count
- Error toast/inline message includes failed tables (grouped by connection for readability)

Table-specific handlers must validate scope first. If `isTableSpecific` is true and `connectionId` is missing, show an internal error and return early.

## Error Handling

Per-connection errors: if connection A succeeds but B fails, show partial success. Conflict detection stays per-table (unchanged).

## Testing

Add/extend tests for:
- table-specific invariant hard-error (`database/table` with missing `connectionId`)
- workspace-wide sidebar filters driving DDL preview scope
- mixed-paradigm filtered preview language fallback
- selection reset when dialog opens and when selected connection/table disappears
- partial-success workspace commit (some tables succeed, others fail)
