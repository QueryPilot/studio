# Multi-Connection GlobalChangesDialog Implementation Plan (Revised)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make GlobalChangesDialog show and commit staged changes across all workspace connections, not just the focused one.

**Architecture:** Make `connectionId` optional in GlobalChangesDialog props. When omitted, the dialog reads all entries from `stagedCommands` (unfiltered). The sidebar gains connection-level grouping. DDL preview loops through unique connectionIds with separate executors, but only for commands visible under the active sidebar filter. WorkspaceTitleBar counts all staged commands and opens the dialog without a `connectionId`. Table-specific actions fail fast if `database/table` is provided without `connectionId`.

**Tech Stack:** React 19, Zustand (crudStore, connectionStoreNew), TypeScript, Tailwind CSS, existing operationExecutor system

**Key files:**
- `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx` — main dialog (all UI + handlers)
- `src/screens/workspace/components/WorkspaceTitleBar.tsx` — pill button + dialog invocation

**Review findings incorporated:**
- rowMap key collision across tables (Issue 11) — prefix rowKey with tableKey
- Table-specific handlers enforce invariant hard-error when `connectionId` is missing
- DDL preview must derive connectionId from command targets, not from props
- `getConnection(undefined)` must be guarded
- Invalid table-specific scope (`database/table` without `connectionId`) must hard-error and return early
- DDL preview must respect current sidebar filter scope (All / connection / table), not always all scoped commands
- Workspace commit path must support partial success (continue after table-level failures)
- Connection-group/language memos must react to connection metadata changes
- Selection state must reset and self-heal when filtered data changes

---

### Task 1: Fix rowMap key collision + make connectionId optional + add scope flags

This task makes `connectionId` optional, guards all usages of it, fixes a pre-existing bug where `rowMap` keys collide across different tables (rows with same PK like `{"id":1}` in different tables get merged), and adds the `isWorkspaceWide` flag.

**Files:**
- Modify: `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx`

**Step 1: Fix rowMap key collision in `buildDerivedChangesData`**

In `buildDerivedChangesData` (line 164), the `rowKey` is just `getRowKeyForCommand(command)` which produces `JSON.stringify(primaryKeys)`. Two tables with `id=1` rows collide. Prefix with `tableKey`:

Change line 164 from:
```typescript
      const rowKey = getRowKeyForCommand(command);
```
to:
```typescript
      const rowKey = `${tableKey}::${getRowKeyForCommand(command)}`;
```

Apply the same fix in the chunked path (line 407):
```typescript
      const rowKey = `${tableKey}::${getRowKeyForCommand(command)}`;
```

Note: `tableKey` is available as the outer loop variable in both locations. The `::` separator avoids ambiguity since tableKey uses `:` as separator.

**Step 2: Make connectionId optional in props**

Change line 66:
```typescript
  connectionId?: string;
```

**Step 3: Add isWorkspaceWide flag**

After `isTableSpecific` (line 255), add:
```typescript
const isWorkspaceWide = connectionId === undefined;
```

**Step 4: Guard getConnection call**

Change lines 247-249 from:
```typescript
const connection = getConnection(connectionId);
```
to:
```typescript
const connection = connectionId ? getConnection(connectionId) : undefined;
```

**Step 4.1: Subscribe to connection metadata reactively**

Replace broad store destructuring with explicit selectors so memos can depend on `connections`:

```typescript
const getConnection = useConnectionStore((state) => state.getConnection);
const connections = useConnectionStore((state) => state.connections);
```

**Step 5: Run typecheck**

Run: `pnpm typecheck 2>&1 | grep GlobalChangesDialog`
Expected: No new errors from GlobalChangesDialog (callers still pass connectionId)

**Step 6: Commit**

```bash
git add src/components/GlobalChangesDialog/GlobalChangesDialog.tsx
git commit -m "fix: rowMap key collision across tables + make connectionId optional"
```

---

### Task 2: Enforce table-specific scope invariant in all handlers (hard-error, no fallback)

When `connectionId` is optional, the dangerous failure mode is silently falling back to workspace-wide behavior if table-specific props are provided without `connectionId`. The invariant is strict: `isTableSpecific` implies `connectionId` must exist. Every affected handler must fail fast when invariant is violated.

**Files:**
- Modify: `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx` (handlers at lines 582-903)

**Step 1: Add explicit fail-fast guard in each table-specific handler**

At the top of each handler (`handleCommitAll`, `handleForceCommit`, `handleRefreshAndDiscard`, `handleDiscardAll`), add:

```typescript
if (isTableSpecific && !connectionId) {
  logger.error("[GlobalChangesDialog] Invalid table-specific scope: missing connectionId");
  toast.error("Internal error: missing connection context for table-specific changes");
  onOpenChange(false);
  return;
}
```

This ensures invalid table scope does not continue into commit/discard logic.

**Step 2: Keep table-specific branches as `if (isTableSpecific)` (do not use `&& connectionId`)**

After the fail-fast guard above, preserve branch shape:

```typescript
if (isTableSpecific) {
  // table-specific path
} else {
  // connection/workspace path
}
```

This avoids re-routing invalid table-specific calls into workspace-wide commit/discard behavior.

**Step 3: Narrow `connectionId` safely inside table-specific branches**

Inside each `if (isTableSpecific)` branch, assign a narrowed variable once and use it for typed calls:

```typescript
const scopedConnectionId = connectionId!;
```

Use `scopedConnectionId` for:
- `getTableKey({ connectionId: scopedConnectionId, ... })`
- `invalidateSchema(scopedConnectionId, ...)`
- `invalidateTable(scopedConnectionId, ...)`

The non-null assertion is safe because Step 1 returns early when missing.

**Step 4: Run typecheck**

Run: `pnpm typecheck 2>&1 | grep GlobalChangesDialog`
Expected: No type errors from handlers

**Step 5: Commit**

```bash
git add src/components/GlobalChangesDialog/GlobalChangesDialog.tsx
git commit -m "fix: enforce table-scope invariant for optional connectionId handlers"
```

---

### Task 3: Add ConnectionGroup type and connection-grouped sidebar data

**Files:**
- Modify: `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx`

**Step 1: Add ConnectionGroup interface**

Add after the `TableSummary` interface (after line 89):

```typescript
interface ConnectionGroup {
  connectionId: string;
  connectionName: string;
  dbType: DbType;
  tables: TableSummary[];
  totalChanges: number;
}
```

**Step 2: Add selectedConnectionId state**

Near the existing `selectedTableKey` state declaration, add:

```typescript
const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
```

**Step 3: Build connectionGroups useMemo**

After the `derivedData` processing (after the `validationStatus` useMemo, around line 502), add:

```typescript
const connectionGroups = useMemo<ConnectionGroup[]>(() => {
  if (!isWorkspaceWide) return [];

  const groupMap = new Map<string, { tables: TableSummary[]; total: number }>();

  for (const ts of tableSummaries) {
    const connId = ts.tableKey.split(":")[0];
    if (!connId) continue;

    let group = groupMap.get(connId);
    if (!group) {
      group = { tables: [], total: 0 };
      groupMap.set(connId, group);
    }
    group.tables.push(ts);
    group.total += ts.total;
  }

  const groups: ConnectionGroup[] = [];
  for (const [connId, group] of groupMap) {
    const conn = getConnection(connId);
    groups.push({
      connectionId: connId,
      connectionName: conn?.profile?.name ?? connId.slice(0, 8),
      dbType: (conn?.profile?.db_type as DbType) ?? DbType.PostgreSQL,
      tables: group.tables,
      totalChanges: group.total,
    });
  }

  return groups;
}, [isWorkspaceWide, tableSummaries, connections, getConnection]);
```

**Step 4: Update filteredGroupedByRow to respect selectedConnectionId**

Replace the existing `filteredGroupedByRow` useMemo with:

```typescript
const filteredGroupedByRow = useMemo(() => {
  let filtered = groupedByRow;

  // Filter by connection (workspace-wide mode)
  if (selectedConnectionId) {
    filtered = filtered.filter((row) => {
      const cmd = row.commands[0];
      return cmd?.target.connectionId === selectedConnectionId;
    });
  }

  // Filter by table
  if (selectedTableKey) {
    const tableName = tableNameByKey.get(selectedTableKey);
    if (tableName) {
      filtered = filtered.filter((row) => row.tableName === tableName);
    }
  }

  return filtered;
}, [groupedByRow, selectedConnectionId, selectedTableKey, tableNameByKey]);
```

**Step 5: Run typecheck**

Run: `pnpm typecheck 2>&1 | grep GlobalChangesDialog`
Expected: No new errors

**Step 6: Commit**

```bash
git add src/components/GlobalChangesDialog/GlobalChangesDialog.tsx
git commit -m "feat(changes-dialog): add ConnectionGroup type and grouping logic"
```

---

### Task 4: Redesign sidebar with connection-level tree

**Files:**
- Modify: `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx` (sidebar section, around lines 924-1044)

**Step 1: Update showSidebar condition**

Change from:
```typescript
const showSidebar = !isTableSpecific && tableSummaries.length > 1;
```
to:
```typescript
const showSidebar = !isTableSpecific && (tableSummaries.length > 1 || isWorkspaceWide);
```

**Step 2: Replace sidebar content with connection-grouped tree**

Replace the sidebar `<div>` content (the section starting with `<div className="p-3 pb-2">` through the end of `tableSummaries.map`) with:

```tsx
<div className="p-3 pb-2">
  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
    {isWorkspaceWide ? "Connections" : "Tables"}
  </p>
</div>
<div className="flex-1 overflow-y-auto px-2 pb-2">
  {/* "All" option */}
  <button
    className={cn(
      "w-full text-left px-2.5 py-2 rounded-md text-sm mb-0.5 transition-colors",
      selectedTableKey === null && selectedConnectionId === null
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground hover:bg-background/50",
    )}
    onClick={() => { setSelectedTableKey(null); setSelectedConnectionId(null); }}
  >
    <div className="flex items-center justify-between">
      <span className="font-medium">All</span>
      <span className="text-xs tabular-nums text-muted-foreground">{totalChanges}</span>
    </div>
  </button>

  {isWorkspaceWide && connectionGroups.length > 0 ? (
    connectionGroups.map((group) => (
      <div key={group.connectionId} className="mt-1">
        <button
          className={cn(
            "w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors",
            selectedConnectionId === group.connectionId && selectedTableKey === null
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-background/50",
          )}
          onClick={() => {
            setSelectedConnectionId(group.connectionId);
            setSelectedTableKey(null);
          }}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium truncate">{group.connectionName}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{group.totalChanges}</span>
          </div>
        </button>
        <div className="ml-2 mt-0.5">
          {group.tables.map((ts) => (
            <button
              key={ts.tableKey}
              className={cn(
                "w-full text-left px-2.5 py-1.5 rounded-md text-sm mb-0.5 transition-colors",
                selectedTableKey === ts.tableKey
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50",
              )}
              onClick={() => {
                setSelectedConnectionId(group.connectionId);
                setSelectedTableKey(ts.tableKey);
              }}
            >
              <div className="flex items-center gap-1.5">
                <IconTable className="h-3.5 w-3.5 shrink-0 opacity-50" />
                <span className="truncate font-medium">{ts.displayName}</span>
              </div>
              <div className="flex gap-2 mt-0.5 ml-5 text-xs">
                {ts.inserts > 0 && <span className="text-green-500">+{ts.inserts}</span>}
                {ts.updates > 0 && <span className="text-blue-500">~{ts.updates}</span>}
                {ts.deletes > 0 && <span className="text-red-500">-{ts.deletes}</span>}
                {ts.ddl > 0 && <span className="text-purple-500">{ts.ddl} DDL</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    ))
  ) : (
    tableSummaries.map((ts) => (
      <button
        key={ts.tableKey}
        className={cn(
          "w-full text-left px-2.5 py-2 rounded-md text-sm mb-0.5 transition-colors",
          selectedTableKey === ts.tableKey
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-background/50",
        )}
        onClick={() => setSelectedTableKey(ts.tableKey)}
      >
        <div className="flex items-center gap-1.5">
          <IconTable className="h-3.5 w-3.5 shrink-0 opacity-50" />
          <span className="truncate font-medium">{ts.displayName}</span>
        </div>
        <div className="flex gap-2 mt-1 ml-5 text-xs">
          {ts.inserts > 0 && <span className="text-green-500">+{ts.inserts}</span>}
          {ts.updates > 0 && <span className="text-blue-500">~{ts.updates}</span>}
          {ts.deletes > 0 && <span className="text-red-500">-{ts.deletes}</span>}
          {ts.ddl > 0 && <span className="text-purple-500">{ts.ddl} DDL</span>}
        </div>
      </button>
    ))
  )}
</div>
```

**Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm eslint src/components/GlobalChangesDialog/GlobalChangesDialog.tsx`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/components/GlobalChangesDialog/GlobalChangesDialog.tsx
git commit -m "feat(changes-dialog): connection-grouped sidebar tree"
```

---

### Task 5: Multi-connection DDL preview + dynamic editor language + header text

**Files:**
- Modify: `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx` (DDL useEffect, CodeEditor, header)

**Step 1: Make DDL preview respect sidebar filters, then rewrite generation useEffect**

First derive the preview command set from the currently visible rows in the Changes tab:

```typescript
const ddlPreviewCommands = useMemo<CrudCommand[]>(() => {
  return filteredGroupedByRow.flatMap((row) => row.commands);
}, [filteredGroupedByRow]);
```

Then replace the `generatePreview` async function and the useEffect dependency array. The new version groups `ddlPreviewCommands` by `command.target.connectionId` and creates per-connection executors:

```typescript
const generatePreview = async () => {
  setGeneratedSQL("-- Generating preview...");

  if (ddlPreviewCommands.length === 0) {
    setGeneratedSQL("-- No changes to commit");
    setSqlGenerated(true);
    return;
  }

  try {
    // Group commands by connectionId from command target
    const commandsByConnection = new Map<string, CrudCommand[]>();
    for (const command of ddlPreviewCommands) {
      const connId = command.target.connectionId;
      let list = commandsByConnection.get(connId);
      if (!list) {
        list = [];
        commandsByConnection.set(connId, list);
      }
      list.push(command);
    }

    // Single connection — simple path
    if (commandsByConnection.size === 1) {
      const [connId, commands] = [...commandsByConnection.entries()][0]!;
      const conn = getConnection(connId);
      const connDbType = (conn?.profile?.db_type as DbType) ?? DbType.PostgreSQL;
      const executor = await getOperationExecutor(connId, connDbType);
      const preview = executor.preview(commands);
      setGeneratedSQL(preview.content);
      setSqlGenerated(true);
      return;
    }

    // Multiple connections — per-connection previews with headers
    const sections: string[] = [];
    for (const [connId, commands] of commandsByConnection) {
      const conn = getConnection(connId);
      const connName = conn?.profile?.name ?? connId.slice(0, 8);
      const connDbType = (conn?.profile?.db_type as DbType) ?? DbType.PostgreSQL;
      const executor = await getOperationExecutor(connId, connDbType);
      const preview = executor.preview(commands);
      sections.push(`-- === ${connName} ===\n\n${preview.content}`);
    }
    setGeneratedSQL(sections.join("\n\n"));
  } catch (error) {
    logger.error("[GlobalChangesDialog] Failed to generate preview:", error);
    setGeneratedSQL("-- Error generating preview");
  }
  setSqlGenerated(true);
};
```

Update dependencies:

```typescript
}, [viewMode, sqlGenerated, ddlPreviewCommands, connections, getConnection]);
```

Also update SQL cache reset effect:

```typescript
useEffect(() => {
  setSqlGenerated(false);
}, [ddlPreviewCommands, connections]);
```

**Step 2: Add ddlEditorLanguage computed value (based on preview scope)**

```typescript
const ddlEditorLanguage = useMemo<CodeEditorLanguage>(() => {
  if (!isWorkspaceWide) {
    return dbTypeToEditorLanguage[dbType];
  }

  const connectionIds = new Set(ddlPreviewCommands.map((cmd) => cmd.target.connectionId));
  const languages = new Set<CodeEditorLanguage>();

  for (const connId of connectionIds) {
    const conn = getConnection(connId);
    const connDbType = (conn?.profile?.db_type as DbType) ?? DbType.PostgreSQL;
    languages.add(dbTypeToEditorLanguage[connDbType]);
  }

  if (languages.size === 0) {
    return "text";
  }
  if (languages.size === 1) {
    return [...languages][0]!;
  }
  return "text";
}, [isWorkspaceWide, dbType, ddlPreviewCommands, connections, getConnection]);
```

**Step 3: Update CodeEditor usage**

```tsx
<CodeEditor
  value={generatedSQL || "-- No preview generated"}
  readOnly={true}
  language={ddlEditorLanguage}
  dialect={!isWorkspaceWide ? dbTypeToDialect[dbType] : undefined}
  lineNumbers={true}
  height="100%"
/>
```

**Step 4: Update header text**

Replace the title and subtitle area with:

```tsx
<span className="text-sm font-medium">
  {isTableSpecific
    ? "Commit Changes"
    : isWorkspaceWide
      ? "Review All Changes"
      : "Review Changes"}
</span>
{!isLoading && (
  <span className="text-xs text-muted-foreground">
    {totalChanges} {totalChanges === 1 ? "change" : "changes"}
    {isWorkspaceWide && connectionGroups.length > 1 && (
      <> across {connectionGroups.length} connections</>
    )}
    {!isTableSpecific && !isWorkspaceWide && tableSummaries.length > 0 && (
      <> across {tableSummaries.length} {tableSummaries.length === 1 ? "table" : "tables"}</>
    )}
  </span>
)}
```

**Step 5: Run typecheck**

Run: `pnpm typecheck 2>&1 | grep GlobalChangesDialog`
Expected: No new errors

**Step 6: Commit**

```bash
git add src/components/GlobalChangesDialog/GlobalChangesDialog.tsx
git commit -m "feat(changes-dialog): multi-connection DDL preview + dynamic editor language + header"
```

---

### Task 6: Implement partial-success workspace commits (no fail-fast)

**Files:**
- Modify: `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx` (commit handlers around lines 582-849)

**Step 1: Replace workspace branch in `handleCommitAll` with settled per-table loop**

In the `else` (non-table-specific) branch, replace `commitAll()` usage with `commitChanges(tableKey)` per table in `connectionCommands`:

```typescript
const successful: Array<{ tableKey: string; committedCount: number }> = [];
const failed: Array<{ tableKey: string; error: string }> = [];

for (const [tableKey] of connectionCommands) {
  try {
    const result = await commitChanges(tableKey);
    successful.push({ tableKey, committedCount: result.committed.length });
  } catch (error) {
    failed.push({
      tableKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

**Step 2: Invalidate and clear only successful table keys**

Build invalidation sets from `successful.map((s) => s.tableKey)`, not all `connectionCommands`.

- For schema-changing operations, inspect commands only for successful table keys
- Call `clearCommittedChanges(tableKey)` only for successful keys
- Do not clear failed table keys (keep them staged)

**Step 3: Add partial-success UX behavior**

- Compute `totalCommitted` from successful results
- If `failed.length === 0`: existing success path, close dialog, call `onCommitSuccess`
- If `failed.length > 0`: keep dialog open, show error toast with failed table list and a success toast/message for committed count

Expected behavior: users can retry/discard remaining failed changes without losing successful commits.

**Step 4: Apply same settled pattern to workspace branch of `handleForceCommit`**

After stripping old values and restaging per table, commit each table independently with try/catch so failures do not block successes. Keep failed tables staged for retry.

**Step 5: Remove unused `commitAll` selector from this component**

After replacing both workspace commit paths, remove `const commitAll = useCrudStore((state) => state.commitAll);` if unused.

**Step 6: Run typecheck**

Run: `pnpm typecheck 2>&1 | grep GlobalChangesDialog`
Expected: No new errors

**Step 7: Commit**

```bash
git add src/components/GlobalChangesDialog/GlobalChangesDialog.tsx
git commit -m "feat(changes-dialog): support partial-success workspace commits"
```

---

### Task 7: Keep selection and connection metadata state fresh

**Files:**
- Modify: `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx`

**Step 1: Reset sidebar selections when dialog opens**

Add an effect:

```typescript
useEffect(() => {
  if (!open) return;
  setSelectedConnectionId(null);
  setSelectedTableKey(null);
}, [open]);
```

**Step 2: Clear stale selected connection when it disappears**

```typescript
useEffect(() => {
  if (!selectedConnectionId) return;
  const exists = tableSummaries.some((ts) =>
    ts.tableKey.startsWith(`${selectedConnectionId}:`),
  );
  if (!exists) {
    setSelectedConnectionId(null);
    setSelectedTableKey(null);
  }
}, [selectedConnectionId, tableSummaries]);
```

**Step 3: Clear stale selected table when it disappears**

```typescript
useEffect(() => {
  if (!selectedTableKey) return;
  if (!tableNameByKey.has(selectedTableKey)) {
    setSelectedTableKey(null);
  }
}, [selectedTableKey, tableNameByKey]);
```

**Step 4: Ensure memo deps include `connections` where connection metadata is used**

Confirm these include `connections` in dependency arrays:
- `connectionGroups`
- `ddlPreview` generation effect
- `ddlEditorLanguage`

This keeps names and language current if connection profiles change while dialog is open.

**Step 5: Run typecheck**

Run: `pnpm typecheck 2>&1 | grep GlobalChangesDialog`
Expected: No new errors

**Step 6: Commit**

```bash
git add src/components/GlobalChangesDialog/GlobalChangesDialog.tsx
git commit -m "fix(changes-dialog): reset stale sidebar selections and react to connection metadata"
```

---

### Task 8: Update WorkspaceTitleBar — count all connections + open workspace-wide dialog

**Files:**
- Modify: `src/screens/workspace/components/WorkspaceTitleBar.tsx`

**IMPORTANT:** Task 1 (making `connectionId` optional) MUST be done before this task. Otherwise removing `connectionId` from the dialog invocation causes a type error.

**Step 1: Change totalChanges to count all workspace connections**

Replace lines 140-149:

```typescript
const totalChanges = useMemo(() => {
  let count = 0;
  stagedCommands.forEach((commands) => {
    count += commands.length;
  });
  return count;
}, [stagedCommands]);
```

**Step 2: Remove connectionId from GlobalChangesDialog invocation**

Replace lines 1054-1058:

```tsx
<GlobalChangesDialog
  open={showGlobalChanges}
  onOpenChange={setShowGlobalChanges}
/>
```

**Step 3: Run typecheck**

Run: `pnpm typecheck 2>&1 | grep WorkspaceTitleBar`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/screens/workspace/components/WorkspaceTitleBar.tsx
git commit -m "feat(title-bar): count all workspace changes and open workspace-wide dialog"
```

---

### Task 9: Add regression tests for new behavior

**Files:**
- Modify: `src/components/GlobalChangesDialog/__tests__/GlobalChangesDialog.test.tsx`
- Modify: `src/stores/__tests__/crudStore.test.ts` (only if store API changes are introduced while implementing)

**Step 1: Add table-scope invariant test**

Add a test that renders table-specific props without `connectionId`, triggers commit/discard action, and asserts:
- `onOpenChange(false)` is called
- workspace-wide handlers are not used as fallback

**Step 2: Add filter-driven DDL preview test**

In workspace-wide mode with staged changes across 2 connections:
- select one connection/table in sidebar
- switch to DDL tab
- assert preview contains only commands from that filtered scope

**Step 3: Add language selection tests for filtered preview scope**

Use mixed SQL + Redis data:
- `All` scope should use `"text"` language
- selecting only SQL connection should use `"sql"`
- selecting only Redis connection should use `"redis"`

Expose editor language in CodeEditor test mock (e.g., `data-language`).

**Step 4: Add selection reset/self-heal tests**

Cover:
- opening dialog resets prior selection to `All`
- selected connection/table is cleared when filtered dataset changes and that node no longer exists

**Step 5: Add partial-success workspace commit test**

Mock workspace commit where one table succeeds and one fails:
- successful table gets invalidated + cleared
- failed table stays staged
- dialog remains open with partial-failure feedback

**Step 6: Run focused tests**

Run:
```bash
pnpm test:unit -- src/components/GlobalChangesDialog/__tests__/GlobalChangesDialog.test.tsx
```

If store tests changed, also run:
```bash
pnpm test:unit -- src/stores/__tests__/crudStore.test.ts
```

**Step 7: Commit**

```bash
git add -A
git commit -m "test(changes-dialog): cover scope invariant, filtered DDL preview, and partial-success commits"
```

---

### Task 10: Final typecheck + lint

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: No new errors from our changes (pre-existing errors are fine)

**Step 2: Run lint on changed files**

Run: `pnpm eslint src/components/GlobalChangesDialog/GlobalChangesDialog.tsx src/screens/workspace/components/WorkspaceTitleBar.tsx`
Expected: No new lint errors from our changes

**Step 3: Fix any issues found**

Common things to watch for:
- Unused imports (e.g., if `dbType` is no longer used in some places)
- `@typescript-eslint/no-unnecessary-condition` if guards are over-cautious
- Missing deps in useEffect/useMemo dependency arrays

**Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: lint and typecheck cleanup for multi-connection dialog"
```
