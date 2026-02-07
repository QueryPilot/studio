# Command Palette Multi-Connection Search

**Date:** 2026-01-27
**Status:** Approved

## Problem

The Command Palette has several issues with multi-connection workspaces:

1. **Badge only shows schema** - Items display "public" but don't indicate which connection/database they belong to, making it impossible to distinguish items across connections
2. **Only searches current schema** - Tables from other open connections don't appear in search results
3. **Duplicate table names open wrong table** - When two connections have `vw_activities`, clicking opens the wrong one because item IDs don't include connectionId
4. **Wrong connection used when opening** - `handleSelect` always uses `activeConnectionId` instead of the item's actual connection
5. **Tab IDs collide across connections** - `table-public-users` could be from any connection, causing tab reuse issues

## Solution

Implement DataGrip-style cross-connection search with clear hierarchical badges.

## Data Model Changes

Update `UnifiedItem` in `useCommandPaletteQueries.ts`:

```typescript
export interface UnifiedItem {
  id: string;
  type: UnifiedItemType;
  name: string;
  subtitle: string;        // Row estimates for tables
  keywords: string[];

  // Connection context for multi-connection support
  connectionId?: string;   // Which connection this belongs to
  connectionName?: string; // Display name (e.g., "ftl")
  database?: string;       // Database name (e.g., "aaa")
  schema?: string;         // Schema name (e.g., "public")

  // Type-specific payload (unchanged)
  table?: TableMeta;
  func?: FunctionMeta;
  command?: CategorizedCommand;
}
```

## Multi-Connection Data Fetching

Create new hook `useAllConnectionsSchemaData` that:

1. Gets all open connections from `useWorkspaceBundleStore`
2. Filters to only `status: "connected"` connections
3. Fetches schema data for each connection using `schemaCache`
4. Tags each item with connection context
5. Combines all results

```typescript
export function useAllConnectionsSchemaData() {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);

  // Build stable query key from connection states
  const connectionKeys = useMemo(() => {
    if (!activeWorkspace) return [];
    return Array.from(activeWorkspace.connections.values())
      .filter(c => c.status === "connected")
      .map(c => `${c.id}:${c.database}:${c.schema}`)
      .sort();
  }, [activeWorkspace]);

  return useQuery({
    queryKey: ["allConnectionsSchemaData", connectionKeys],
    queryFn: async () => {
      // Fetch from all connected connections in parallel
      const results = await Promise.all(
        connectedConnections.map(async (conn) => {
          const [tables, functions] = await Promise.all([
            schemaCache.getTables(conn.id, conn.schema),
            schemaCache.getFunctions(conn.id, conn.schema),
          ]);
          return { conn, tables, functions };
        })
      );
      return results;
    },
    enabled: connectionKeys.length > 0,
  });
}
```

Keep existing `useSchemaData` hook for single-connection contexts (sidebar, etc.).

## Badge Display

Format: `[db-icon] connection › schema` (database name omitted since it typically matches connection name)

Display logic:
- **Single connection workspace:** show only `schema`
- **Multiple connections:** show `[db-icon] connection › schema`
- **Commands:** keybinding (unchanged)

Example:
```
┌─────────────────────────────────────────────────────────┐
│ 🟠 t_action                          [🐘] ftl › public │
│ 🟠 t_action                      [🐘] staging › public │
│ 🟢 users_view                        [🐘] ftl › public │
└─────────────────────────────────────────────────────────┘
```

## Tab Titles with Context

For multi-connection workspaces, tabs show an inline subtitle:

```
[🐘] users ftl:public
```

- Shows `connectionName:schema` as a small muted text after the tab name
- Only visible when 2+ connections are in the workspace
- Keeps tabs accessible after schema switch (uses metadata, not workspace state)

## Bug Fixes

### Fix 1: Item IDs Must Include ConnectionId

Current (causes duplicate collision):
```typescript
id: `${entityType}:${table.schema}.${table.name}`
```

Fixed:
```typescript
id: `${entityType}:${connectionId}:${table.schema}.${table.name}`
```

### Fix 2: handleSelect Must Use Item's Connection

Current (always uses focused connection):
```typescript
openTableObject({
  table: item.table,
  connectionId: activeConnectionId,  // Wrong
  database: selectedDatabase,        // Wrong
});
```

Fixed:
```typescript
openTableObject({
  table: item.table,
  connectionId: item.connectionId!,  // Use item's connection
  database: item.database!,          // Use item's database
});
```

### Fix 3: Tab IDs Must Include ConnectionId

In `src/utils/workbench/openers.ts`:

Current:
```typescript
const baseTabId = `table-${table.schema}-${table.name}`;
```

Fixed:
```typescript
const baseTabId = `table-${connectionId}-${table.schema}-${table.name}`;
```

Same fix needed for function tabs:
```typescript
const tabId = `function-${connectionId}-${func.schema}-${func.name}`;
```

## Files to Modify

1. **`src/components/CommandPalette/useCommandPaletteQueries.ts`**
   - Add `useAllConnectionsSchemaData` hook
   - Update `UnifiedItem` interface
   - Update `useUnifiedItems` to use multi-connection data
   - Fix item ID generation to include connectionId

2. **`src/components/CommandPalette/CommandPalette.tsx`**
   - Update `UnifiedItemRow` badge rendering
   - Handle single vs multi-connection display logic
   - Fix `handleSelect` to use item's connectionId and database

3. **`src/utils/workbench/openers.ts`**
   - Update `openTableObject` tab ID to include connectionId
   - Update `openFunctionObject` tab ID to include connectionId
   - Update `openTableInSplitRight` tab ID to include connectionId
   - Update `openFunctionInSplitRight` tab ID to include connectionId

## Edge Cases

- **Connection disconnects:** Skip that connection's data (filter by status)
- **Empty workspace:** Show only commands
- **Single connection:** Simplified badge without connection name prefix
- **Duplicate table names:** Badge disambiguates which connection each belongs to

## Not Changing

- `useSchemaData.ts` - Sidebar continues using single-connection hook
- Search/filter logic - match-sorter config unchanged

## Migration Note

Frecency tracking uses item IDs. The new ID format (`table:connId:schema.name`) differs from old (`table:schema.name`). Existing frecency data will no longer match, so recently-used items will reset. This is acceptable - users will rebuild frecency naturally.
