# ERD Command Palette Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Cmd+E command palette subpanel that lets users pick which ERD to open from all connected databases/schemas, grouped by connection.

**Architecture:** New `NestedErdList` component using the NestedSafeModeList grouped-by-connection pattern. Command handler in `defaultCommands.ts` opens palette with nested mode, or shortcuts directly to `openErdView()` when there's only one obvious target. Menu actions routed through the command system.

**Tech Stack:** React, Zustand, React Query, match-sorter, existing `openErdView()` opener

---

### Task 1: Add `"open-erd"` nested mode to command palette store

**Files:**
- Modify: `src/stores/ui/commandPaletteStore.ts:3-10`

**Step 1: Add type variant**

In `src/stores/ui/commandPaletteStore.ts`, add `| { type: "open-erd" }` to the `NestedMode` union:

```typescript
export type NestedMode =
  | { type: "switch-database" }
  | { type: "switch-schema" }
  | { type: "open-connection" }
  | { type: "switch-workspace" }
  | { type: "new-query-connection" }
  | { type: "search-saved-queries" }
  | { type: "set-safe-mode" }
  | { type: "open-erd" };
```

**Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS (no consumers reference `NestedMode` exhaustively yet)

**Step 3: Commit**

```bash
git add src/stores/ui/commandPaletteStore.ts
git commit -m "feat(erd): add open-erd nested mode to command palette store"
```

---

### Task 2: Create `NestedErdList` component

**Files:**
- Create: `src/components/CommandPalette/NestedErdList.tsx`

**Step 1: Create the component**

Create `src/components/CommandPalette/NestedErdList.tsx` with the full implementation:

```typescript
import React, { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { matchSorter, rankings } from "match-sorter";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { databaseService } from "@/services/databaseService";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { DbType, getParadigm } from "@/types/connection";

// --- Types ---

export interface ErdTarget {
  connectionId: string;
  connectionName: string;
  database: string;
  schema?: string;
  dbType: DbType;
}

interface ConnectionInfo {
  connectionId: string;
  name: string;
  dbType: DbType;
  database: string; // current/default database from profile
}

interface NestedErdListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onSelect: (target: ErdTarget) => void;
  onClose?: () => void;
}

// --- Helpers ---

/** PostgreSQL and SQL Server support schemas; MySQL, MariaDB, SQLite do not */
function supportsSchemas(dbType: DbType): boolean {
  return dbType === DbType.PostgreSQL || dbType === DbType.SQLServer;
}

// --- Component ---

export function NestedErdList({
  listRef,
  query,
  onSelect,
}: NestedErdListProps): React.ReactElement {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const connections = useConnectionStore((state) => state.connections);

  // Build list of connected SQL connections
  const sqlConnections = useMemo<ConnectionInfo[]>(() => {
    if (!activeWorkspace) return [];
    const result: ConnectionInfo[] = [];
    for (const [connId, openConn] of activeWorkspace.connections) {
      if (openConn.status !== "connected") continue;
      const stored = connections.find((c) => c.profile.id === connId);
      const profile = stored?.profile ?? openConn.profile;
      if (getParadigm(profile.db_type) !== "sql") continue;
      result.push({
        connectionId: connId,
        name: profile.name,
        dbType: profile.db_type,
        database: openConn.database || profile.database || "",
      });
    }
    return result;
  }, [activeWorkspace, connections]);

  // Load databases for each SQL connection
  const databaseQueries = useQueries({
    queries: sqlConnections.map((conn) => ({
      queryKey: ["databases", conn.connectionId],
      queryFn: async () => {
        if (!databaseService.isConnectionActive(conn.connectionId)) {
          throw new Error("Connection is not active");
        }
        return databaseService.listDatabases(conn.connectionId);
      },
      enabled: databaseService.isConnectionActive(conn.connectionId),
      staleTime: 60_000,
      retry: 2,
    })),
  });

  // Build flat targets per connection (databases, and schemas for Postgres/MSSQL)
  // For schema-supporting DBs, we load schemas for the *current* database only
  // to avoid N*M queries. Users switch databases via the database picker.
  const schemaQueries = useQueries({
    queries: sqlConnections
      .filter((conn) => supportsSchemas(conn.dbType) && conn.database)
      .map((conn) => ({
        queryKey: ["schemas", conn.connectionId, conn.database],
        queryFn: async () => {
          if (!databaseService.isConnectionActive(conn.connectionId)) {
            throw new Error("Connection is not active");
          }
          return databaseService.listSchemas(
            conn.connectionId,
            conn.database,
          );
        },
        enabled: databaseService.isConnectionActive(conn.connectionId),
        staleTime: 60_000,
        retry: 2,
      })),
  });

  // Assemble groups: connection -> targets
  const groups = useMemo(() => {
    // Build schema lookup: connectionId -> schemas[]
    const schemaConns = sqlConnections.filter(
      (c) => supportsSchemas(c.dbType) && c.database,
    );
    const schemaMap = new Map<string, string[]>();
    schemaConns.forEach((conn, i) => {
      const result = schemaQueries[i];
      if (result?.data) {
        schemaMap.set(conn.connectionId, result.data);
      }
    });

    return sqlConnections.map((conn, connIdx) => {
      const dbResult = databaseQueries[connIdx];
      const databases = dbResult?.data ?? [];
      const isLoading = dbResult?.isLoading ?? false;

      const targets: ErdTarget[] = [];

      if (supportsSchemas(conn.dbType)) {
        // For schema-supporting DBs: show database/schema combos
        // For the current database, expand schemas
        const schemas = schemaMap.get(conn.connectionId) ?? [];
        if (schemas.length > 0) {
          for (const schema of schemas) {
            targets.push({
              connectionId: conn.connectionId,
              connectionName: conn.name,
              database: conn.database,
              schema,
              dbType: conn.dbType,
            });
          }
        } else if (conn.database) {
          // Schemas still loading or empty - show database as target
          targets.push({
            connectionId: conn.connectionId,
            connectionName: conn.name,
            database: conn.database,
            dbType: conn.dbType,
          });
        }
        // Also show other databases (without schema expansion)
        for (const db of databases) {
          if (db === conn.database) continue; // already expanded above
          targets.push({
            connectionId: conn.connectionId,
            connectionName: conn.name,
            database: db,
            dbType: conn.dbType,
          });
        }
      } else {
        // Non-schema DBs: each database is a target
        if (databases.length > 0) {
          for (const db of databases) {
            targets.push({
              connectionId: conn.connectionId,
              connectionName: conn.name,
              database: db,
              dbType: conn.dbType,
            });
          }
        } else if (conn.database) {
          // Fallback: use the connection's current database
          targets.push({
            connectionId: conn.connectionId,
            connectionName: conn.name,
            database: conn.database,
            dbType: conn.dbType,
          });
        }
      }

      return {
        connectionId: conn.connectionId,
        name: conn.name,
        dbType: conn.dbType,
        targets,
        isLoading,
      };
    });
  }, [sqlConnections, databaseQueries, schemaQueries]);

  // Filter by search query
  const filteredGroups = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return groups;

    // Match against connection names
    const matchingConnections = matchSorter(groups, trimmed, {
      keys: ["name"],
      threshold: rankings.CONTAINS,
    });
    const matchingConnIds = new Set(
      matchingConnections.map((g) => g.connectionId),
    );

    const result: typeof groups = [];
    for (const group of groups) {
      if (matchingConnIds.has(group.connectionId)) {
        // Connection name matches → show all targets
        result.push(group);
      } else {
        // Try matching targets within this group
        const matchingTargets = matchSorter(group.targets, trimmed, {
          keys: ["database", "schema"],
          threshold: rankings.CONTAINS,
        });
        if (matchingTargets.length > 0) {
          result.push({ ...group, targets: matchingTargets });
        }
      }
    }
    return result;
  }, [groups, query]);

  const getTargetLabel = (target: ErdTarget): string => {
    if (target.schema) {
      return `${target.database} / ${target.schema}`;
    }
    return target.database;
  };

  return (
    <CommandList ref={listRef} className="h-[500px]">
      <CommandEmpty>No ERD targets found.</CommandEmpty>
      {filteredGroups.map((group) => (
        <CommandGroup
          key={group.connectionId}
          heading={
            <div className="flex items-center gap-2">
              <img
                src={getDatabaseLogo(group.dbType)}
                alt={group.dbType}
                className="size-3.5!"
              />
              <span className="truncate">{group.name}</span>
              {group.isLoading && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Loading...
                </span>
              )}
            </div>
          }
        >
          {group.targets.map((target) => {
            const key = `${target.connectionId}:${target.database}:${target.schema ?? ""}`;
            return (
              <CommandItem
                key={key}
                value={key}
                onSelect={() => onSelect(target)}
              >
                <div className="flex items-center gap-3 w-full">
                  <IconLayout2 className="size-4! text-muted-foreground shrink-0" />
                  <span className="text-xs truncate">
                    {getTargetLabel(target)}
                  </span>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </CommandList>
  );
}
```

Note: Import `IconLayout2` from `@tabler/icons-react` (already used in CommandPalette.tsx line 14).

**Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/CommandPalette/NestedErdList.tsx
git commit -m "feat(erd): create NestedErdList command palette subpanel"
```

---

### Task 3: Wire `NestedErdList` into `CommandPalette.tsx`

**Files:**
- Modify: `src/components/CommandPalette/CommandPalette.tsx:43-48,839-857,900-929`

**Step 1: Add imports**

In `src/components/CommandPalette/CommandPalette.tsx`, add import for `NestedErdList` and `openErdView` near line 48:

```typescript
import {
  openFunctionObject,
  openTableObject,
  openTableInSplitRight,
  openFunctionInSplitRight,
  openErdView,
} from "@/utils/workbench/openers";
```

Add import for the component near line 61:
```typescript
import { NestedErdList, type ErdTarget } from "./NestedErdList";
```

**Step 2: Add the `handleErdSelect` callback**

Add this after the `handleNewQueryConnectionSelect` callback (around line 780, after the existing handlers):

```typescript
// Handler for open-erd: open ERD view for selected target
const handleErdSelect = useCallback(
  (target: ErdTarget) => {
    openErdView({
      connectionId: target.connectionId,
      connectionName: target.connectionName,
      database: target.database,
      schema: target.schema,
    });
    closePalette();
  },
  [closePalette],
);
```

**Step 3: Add placeholder text**

In the `getInputPlaceholder()` function (around line 839-857), add a case before the closing `}`:

After the `"set-safe-mode"` case:
```typescript
case "open-erd":
  return "Select ERD target...";
```

**Step 4: Add routing for nested mode**

In the nested mode rendering block (around line 916-922), add a new case. Insert before the final else (the `<NestedConnectionList>` fallback):

Change:
```typescript
          ) : nestedMode.type === "set-safe-mode" ? (
            <NestedSafeModeList
              listRef={listRef}
              query={query}
              onClose={closePalette}
            />
          ) : (
```

To:
```typescript
          ) : nestedMode.type === "set-safe-mode" ? (
            <NestedSafeModeList
              listRef={listRef}
              query={query}
              onClose={closePalette}
            />
          ) : nestedMode.type === "open-erd" ? (
            <NestedErdList
              listRef={listRef}
              query={query}
              onSelect={handleErdSelect}
              onClose={closePalette}
            />
          ) : (
```

**Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/CommandPalette/CommandPalette.tsx
git commit -m "feat(erd): wire NestedErdList into command palette routing"
```

---

### Task 4: Add `workbench.action.openErd` command and Cmd+E keybinding

**Files:**
- Modify: `src/data/defaultCommands.ts:497` (after newQueryTab command)
- Modify: `src/data/defaultKeybindings.ts:71` (after newQueryTab keybinding)

**Step 1: Add the command**

In `src/data/defaultCommands.ts`, add import for `openErdView` at the top (around line 30):

```typescript
import {
  openQueryWithSql,
  openQueryWithTemplate,
  openTableDesigner,
  getCreateDatabaseTemplate,
  getCreateSchemaTemplate,
  openErdView,
} from "@/utils/workbench/openers";
```

Then add the new command after the `workbench.action.newQueryTab` command block (after the closing `},` around line 595). Place it right after:

```typescript
  {
    id: "workbench.action.openErd",
    label: "Open ERD",
    category: "Workbench",
    when: "activeEditor",
    handler: () => {
      const workspaceBundleStore = useWorkspaceBundleStore.getState();
      const connectionStore = useConnectionStore.getState();
      const activeWorkspace = workspaceBundleStore.activeWorkspace;

      if (!activeWorkspace) return;

      // Get connected SQL connections
      const sqlConnections = Array.from(activeWorkspace.connections.values())
        .filter(
          (c) =>
            c.status === "connected" &&
            getParadigm(c.profile.db_type) === "sql",
        );

      if (sqlConnections.length === 0) return;

      // Single SQL connection → open ERD directly
      if (sqlConnections.length === 1) {
        const conn = sqlConnections[0];
        const stored = connectionStore.getConnection(conn.id);
        const name = stored?.profile.name ?? conn.profile.name;
        openErdView({
          connectionId: conn.id,
          connectionName: name,
          database: conn.database || conn.profile.database,
          schema: conn.schema,
        });
        return;
      }

      // Multiple SQL connections → show picker
      const paletteStore = useCommandPaletteStore.getState();
      paletteStore.openPalette();
      paletteStore.setNestedMode({ type: "open-erd" });
    },
  },
```

Note: `getParadigm` is already imported in defaultCommands.ts (used by newQueryTab handler around line 551). Verify this — if not, add `import { getParadigm } from "@/types/connection";`.

**Step 2: Add the keybinding**

In `src/data/defaultKeybindings.ts`, add after the `newQueryTab` keybinding (after line 71):

```typescript
  {
    command: 'workbench.action.openErd',
    key: 'cmd+e',
    when: 'activeEditor',
  },
```

**Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/data/defaultCommands.ts src/data/defaultKeybindings.ts
git commit -m "feat(erd): add workbench.action.openErd command with Cmd+E keybinding"
```

---

### Task 5: Route menu actions through command system

**Files:**
- Modify: `src/data/menuActionCommandMap.ts:4`
- Modify: `src/hooks/useMenuEventListener.ts:51,71-75,130-134,205-228`

**Step 1: Add menu action mappings**

In `src/data/menuActionCommandMap.ts`, add two new mappings:

```typescript
export const menuActionCommandMap: Record<string, string> = {
  open_preferences: "preferences.open",
  new_connection: "connection.open",
  new_query: "workbench.action.newQueryTab",
  new_erd: "workbench.action.openErd",
  erd: "workbench.action.openErd",
  close_tab: "workbench.action.closeActiveTab",
  // ... rest unchanged
```

**Step 2: Remove direct `handleNewErd` calls from `useMenuEventListener.ts`**

In `src/hooks/useMenuEventListener.ts`:

1. Remove the `"new_erd"` and `"erd"` from the debug log array (line 51). Change:
```typescript
if (["connect", "disconnect", "refresh", "execute", "execute_selection", "export", "import", "erd", "new_query", "new_erd"].includes(action)) {
```
To:
```typescript
if (["connect", "disconnect", "refresh", "execute", "execute_selection", "export", "import", "new_query"].includes(action)) {
```

2. Remove the `case "new_erd"` block (lines 71-75):
```typescript
        case "new_erd":
          if (activeConnectionId) {
            handleNewErd(activeConnectionId, workbenchStore);
          }
          break;
```

3. Remove the `case "erd"` block (lines 130-134):
```typescript
        case "erd":
          if (activeConnectionId) {
            handleNewErd(activeConnectionId, workbenchStore);
          }
          break;
```

4. Remove the `handleNewErd` function definition (lines 205-228) if it becomes unused. Check that no other code calls it. If `handleNewErd` is only used by the two removed cases, delete the entire function.

**Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. If lint warns about unused `handleNewErd`, delete it.

**Step 4: Commit**

```bash
git add src/data/menuActionCommandMap.ts src/hooks/useMenuEventListener.ts
git commit -m "refactor(erd): route erd menu actions through command system"
```

---

### Task 6: Verify end-to-end and run full checks

**Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

**Step 3: Run frontend tests**

Run: `pnpm test:unit`
Expected: PASS

**Step 4: Manual verification checklist**

If running locally (`make dev`):
- [ ] Cmd+E with single SQL connection → opens ERD directly
- [ ] Cmd+E with multiple SQL connections → opens palette with connection-grouped list
- [ ] Search filters by connection name, database name, schema name
- [ ] Selecting a target opens ERD tab (or focuses existing one)
- [ ] Backspace exits nested mode back to main palette
- [ ] Escape closes palette
- [ ] MongoDB/Redis connections are not shown in the list
- [ ] Menu > File > New ERD Workspace also triggers the palette flow

**Step 5: Commit**

```bash
git commit --allow-empty -m "chore(erd): verify erd command palette integration"
```
