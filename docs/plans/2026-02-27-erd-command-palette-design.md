# ERD Command Palette Subpanel

## Summary

Add a command palette subpanel (triggered by Cmd+E) that lets users select which ERD to open from a flat list of all available database/schema targets, grouped by connection. This replaces the current behavior of opening ERD for the active connection only.

## Design Decisions

- **Flat list grouped by connection** (like NestedSafeModeList pattern)
- **Available targets only** — no "recently opened" section; previously opened ERDs are just tabs
- **Adapt to DB type** — Postgres/MSSQL show `database / schema`, MySQL/SQLite show just `database`
- **Focus existing tab** on duplicate selection — reuses `openErdView()` per-panel dedup via objectKey
- **ERD only for SQL paradigm** — MongoDB and Redis connections are excluded (no table-relationship diagrams)

## Architecture

### Data Flow

```
Cmd+E
  → command handler checks connected connections
  → if 0: no-op
  → if 1 SQL connection with 1 database and ≤1 schema: open ERD directly
  → otherwise: openPalette() + setNestedMode({ type: "open-erd" })
    → CommandPalette renders <NestedErdList>
      → For each connected SQL connection in workspace:
          → useQuery: databaseService.listDatabases(connId)
          → For schema-supporting DBs (Postgres, MSSQL):
              → useQuery: databaseService.listSchemas(connId, db)
          → For non-schema DBs (MySQL, SQLite):
              → Each database is a direct ERD target
      → Flat list grouped by connection, filtered by match-sorter
    → User selects item
      → openErdView({ connectionId, connectionName, database, schema })
      → closePalette()
```

### Files to Create

**`src/components/CommandPalette/NestedErdList.tsx`**

New subpanel component following the NestedSafeModeList pattern:

```typescript
interface ErdTarget {
  connectionId: string;
  connectionName: string;
  database: string;
  schema?: string;        // undefined for MySQL/SQLite
  dbType: DbType;
}

interface ConnectionErdGroup {
  connectionId: string;
  name: string;
  dbType: DbType;
  targets: ErdTarget[];
  isLoading: boolean;
}
```

Props follow standard pattern:
```typescript
interface NestedErdListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onSelect: (target: ErdTarget) => void;
  onClose?: () => void;
}
```

Data loading strategy:
- Get connections from `useWorkspaceBundleStore` (activeWorkspace.connections)
- Filter to SQL paradigm only (`getParadigm(dbType) === "sql"`)
- Filter to connected status only
- For each connection: `useQuery` to load databases (60s staleTime)
- For schema-supporting DBs (Postgres, MSSQL): `useQuery` per database to load schemas
- For non-schema DBs (MySQL, MariaDB, SQLite): each database is a target directly

UI layout:
```
<CommandList className="h-[500px]">
  <CommandEmpty>No ERD targets found.</CommandEmpty>
  {groups.map(group => (
    <CommandGroup heading={<ConnectionHeader />}>
      {group.targets.map(target => (
        <CommandItem>
          <DatabaseIcon />
          <span>{target.database}{target.schema ? ` / ${target.schema}` : ""}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  ))}
</CommandList>
```

### Files to Modify

**`src/stores/ui/commandPaletteStore.ts`** — Add to NestedMode union:
```typescript
| { type: "open-erd" }
```

**`src/data/defaultCommands.ts`** — Add new command:
```typescript
{
  id: "workbench.action.openErd",
  label: "Open ERD",
  category: "Workbench",
  when: "activeEditor",
  handler: () => {
    // Get connected SQL connections
    // If single obvious target → openErdView() directly
    // If multiple → open palette with nested mode
  },
}
```

**`src/data/defaultKeybindings.ts`** — Add keybinding:
```typescript
{
  command: 'workbench.action.openErd',
  key: 'cmd+e',
  when: 'activeEditor',
}
```

**`src/components/CommandPalette/CommandPalette.tsx`** — Wire subpanel:
- Import `NestedErdList`
- Add placeholder text for `"open-erd"`: `"Select ERD target..."`
- Add routing: `nestedMode.type === "open-erd"` → render `<NestedErdList>`
- Add `handleErdSelect` callback that calls `openErdView()` + `closePalette()`

**`src/data/menuActionCommandMap.ts`** — Map menu action:
```typescript
new_erd: "workbench.action.openErd",
```

**`src/hooks/useMenuEventListener.ts`** — Remove direct `handleNewErd` calls for `"new_erd"` and `"erd"` cases (now handled via command mapping).

## Schema Support Matrix

| DB Type    | Has Schemas | ERD Target Format      |
|------------|-------------|------------------------|
| PostgreSQL | Yes         | `database / schema`    |
| SQL Server | Yes         | `database / schema`    |
| MySQL      | No          | `database`             |
| MariaDB    | No          | `database`             |
| SQLite     | No          | `database`             |
| MongoDB    | N/A         | Excluded (document DB) |
| Redis      | N/A         | Excluded (key-value)   |

## Edge Cases

1. **No connected SQL connections** — Command is a no-op (same as current behavior)
2. **Single connection, single database, no/single schema** — Skip palette, open ERD directly
3. **Connection disconnects while palette is open** — React Query's `enabled` guard prevents stale fetches; list re-renders without that connection
4. **Database/schema loading errors** — Show connection group with "Failed to load" message, don't block other connections
