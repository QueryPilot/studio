# Unified DataGrid Architecture Design

**Date**: 2026-01-17
**Status**: Complete
**Goal**: Single DataGrid foundation for SQL, MongoDB, and Redis with full feature parity

## Problem Statement

Current state has three separate rendering approaches:
- **SQL**: Production-grade `TableDataGrid` with streaming, 20+ cell renderers, full CRUD
- **MongoDB**: `CollectionBrowser` - list-based, modal editing, no streaming
- **Redis**: `KeyBrowser` + 6 scattered type-specific editors, no grid view

This causes: poor performance for NoSQL, feature disparity, code duplication, inconsistent UX.

---

## Code Review Findings (Critical)

### Finding 1: Interface Mismatch

`EditableDataGrid` expects data as **props** (array-based):
```typescript
interface EditableDataGridProps {
  rows: GridRowModel[];           // Array, not method
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => GridCell;
}
```

The original class-based `GridDataSource` with `getRow(index)` methods doesn't match.

**Resolution**: Use **hook-based data providers** that return props-compatible structures. This matches the existing `useTableDataQuery` pattern.

### Finding 2: Missing Drill-Down Cell Renderer

For MongoDB drill-down, cells showing nested objects/arrays need:
- Visual indicator (`{...}` or `[...]`)
- Click handling to trigger navigation
- Preview text (e.g., "{3 fields}", "[5 items]")

**Resolution**: Create `DrillableCellRenderer` for nested object/array cells.

### Finding 3: Cell Factory is SQL-Centric

`buildGridCellV2()` in `cellFactory.ts` handles SQL types. MongoDB documents and Redis values need mapping.

**Resolution**: Extend cell factory or create paradigm-specific cell builders.

---

## Solution: Hook-Based Unified Architecture

### Layer Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                     Data Hooks Layer                            │
│  ┌───────────────┐  ┌────────────────┐  ┌─────────────────┐    │
│  │useSqlData     │  │useDocumentData │  │useKeyValueData  │    │
│  │               │  │                │  │                 │    │
│  │• streaming    │  │• drill-down    │  │• type-aware     │    │
│  │• pagination   │  │• path state    │  │• key selection  │    │
│  └───────┬───────┘  └───────┬────────┘  └────────┬────────┘    │
└──────────┼──────────────────┼───────────────────┼──────────────┘
           │                  │                   │
           │   Returns: { rows, columns, getCellContent, ... }
           │                  │                   │
┌──────────▼──────────────────▼───────────────────▼──────────────┐
│              Paradigm Wrapper Layer                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐         │
│  │SqlDataGrid  │  │DocumentData  │  │KeyValueData    │         │
│  │             │  │Grid          │  │Grid            │         │
│  │• SQL toolbar│  │• BreadcrumbNav│ │• KeyHeader     │         │
│  │• Constraints│  │• Drill events│  │• Type columns  │         │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘         │
└─────────┼────────────────┼──────────────────┼──────────────────┘
          │                │                  │
          └────────────────┼──────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    EditableDataGrid                             │
│  Props: { rows, columns, getCellContent, onCellEditCommit, ...}│
│  • Cell editing & commit         • Keyboard navigation          │
│  • History/undo                  • Copy/paste                   │
│  • Row selection                 • Delete handling              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                      DataGridBase                               │
│  Glide DataEditor + Theme + Hover highlighting                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Change**: Data providers are **hooks**, not classes. Hooks return `{ rows, columns, getCellContent }` directly compatible with `EditableDataGrid` props.

---

## Data Provider Hooks

### useSqlData (refactor from useTableDataQuery)

```typescript
interface UseSqlDataParams {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
}

interface UseSqlDataResult {
  // EditableDataGrid props
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => GridCell;

  // SQL-specific
  isLoading: boolean;
  hasMore: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
  estimatedTotal?: number;

  // CRUD helpers
  createEditCommand: (event: GridEditCommitEvent) => CrudCommand | null;
  createInsertCommand: (values: Record<string, unknown>) => CrudCommand;
  createDeleteCommand: (row: GridRowModel) => CrudCommand;
}

function useSqlData(params: UseSqlDataParams): UseSqlDataResult {
  // Internally uses queryStreamClient for streaming
  // Returns data compatible with EditableDataGrid
}
```

### useDocumentData (new)

```typescript
interface UseDocumentDataParams {
  connectionId: string;
  database: string;
  collection: string;
}

interface UseDocumentDataResult {
  // EditableDataGrid props
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => GridCell;

  // Document-specific (drill-down)
  currentPath: PathSegment[];
  canStepInto: (row: number, col: number) => boolean;
  stepInto: (row: number, col: number) => void;
  stepOut: () => void;
  navigateToPath: (pathIndex: number) => void;
  getCurrentDocumentId: () => string | null;

  // Pagination
  isLoading: boolean;
  hasMore: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
  totalCount?: number;

  // CRUD helpers
  createEditCommand: (event: GridEditCommitEvent) => CrudCommand | null;
  createInsertCommand: (values: Record<string, unknown>) => CrudCommand;
  createDeleteCommand: (row: GridRowModel) => CrudCommand;
}
```

**Column Generation Strategy**:
- Fetch documents at current path level
- Union all keys from fetched documents → columns
- Nested objects show as `DrillableCell` with `{...}` display
- Arrays show as `DrillableCell` with `[...]` display
- Primitive values use existing cell renderers (Text, Number, Boolean, etc.)

**Drill-Down Flow**:
```
Root level: documents have {_id, name, address: {...}, tags: [...]}
  → Columns: [_id, name, address, tags]
  → address cell shows "{3 fields}" (DrillableCell)
  → tags cell shows "[5 items]" (DrillableCell)

User clicks address cell → stepInto(row, col)
  → currentPath becomes [{key: '_id_value', label: 'doc'}, {key: 'address', label: 'address', type: 'object'}]
  → Columns regenerated from address object: [street, city, zip]
  → BreadcrumbNav shows: Collection > doc > address
```

### useKeyValueData (new)

```typescript
interface UseKeyValueDataParams {
  connectionId: string;
  database: number;  // Redis DB index
  initialKey?: string;
}

interface UseKeyValueDataResult {
  // EditableDataGrid props
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => GridCell;

  // Key-specific
  currentKey: KeyMetadata | null;
  selectKey: (key: string) => Promise<void>;
  clearSelection: () => void;
  setKeyTTL: (seconds: number) => Promise<void>;
  deleteCurrentKey: () => Promise<void>;

  // State
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;

  // CRUD helpers
  createEditCommand: (event: GridEditCommitEvent) => CrudCommand | null;
  createInsertCommand: (values: Record<string, unknown>) => CrudCommand;
  createDeleteCommand: (row: GridRowModel) => CrudCommand;
}
```

**Type-Aware Column Mapping**:

| Redis Type | Columns | Row Structure |
|------------|---------|---------------|
| `string` | `[value]` | Single row: `{ value: "..." }` |
| `hash` | `[field, value]` | N rows: `{ field: "key", value: "val" }` |
| `list` | `[index, value]` | N rows: `{ index: 0, value: "item" }` |
| `set` | `[member]` | N rows: `{ member: "item" }` |
| `zset` | `[score, member]` | N rows: `{ score: 1.5, member: "item" }` |
| `stream` | `[id, fields]` | N rows: `{ id: "1234-0", fields: {...} }` |

**Row Mapping Implementation**:
```typescript
function mapRedisDataToRows(data: RedisValue, type: RedisType): GridRowModel[] {
  switch (type) {
    case 'hash':
      return Object.entries(data as Record<string, string>).map(([field, value]) => ({
        field: { value: field, db_type: 'text', value_type: 'String' },
        value: { value, db_type: 'text', value_type: 'String' },
      }));
    case 'list':
      return (data as string[]).map((value, index) => ({
        index: { value: index, db_type: 'integer', value_type: 'Number' },
        value: { value, db_type: 'text', value_type: 'String' },
      }));
    // ... other types
  }
}
```

---

## New Cell Renderer: DrillableCell

For MongoDB nested objects/arrays that support drill-down navigation.

```typescript
// src/components/DataGrid/renderers/DrillableCell/types.ts
interface DrillableCellData {
  type: 'object' | 'array';
  preview: string;        // "{3 fields}" or "[5 items]"
  itemCount: number;
  canDrillDown: boolean;
}

// Cell kind identifier
const DRILLABLE_CELL_KIND = 'drillable-cell';
```

**Renderer Features**:
- Displays preview text: `{3 fields}` for objects, `[5 items]` for arrays
- Shows chevron-right icon indicating drillable
- Hover state with subtle highlight
- Click triggers `onCellActivated` → wrapper calls `stepInto()`
- Read-only (no inline editing - must drill down first)

**Visual Design**:
```
┌─────────────────────────────┐
│ {3 fields}              ▶  │  ← Object cell
└─────────────────────────────┘

┌─────────────────────────────┐
│ [5 items]               ▶  │  ← Array cell
└─────────────────────────────┘
```

---

## Paradigm Wrapper Components

### SqlDataGrid

```tsx
function SqlDataGrid({ connectionId, database, schema, table }: SqlDataGridProps) {
  const data = useSqlData({ connectionId, database, schema, table });
  const tableKey = `${connectionId}:${database}:${schema}:${table}`;

  return (
    <div className="flex flex-col h-full">
      <SqlToolbar onRefresh={data.refetch} />

      <EditableDataGrid
        tableKey={tableKey}
        rows={data.rows}
        columns={data.columns}
        getCellContent={data.getCellContent}
        onCellEditCommit={(event) => {
          const cmd = data.createEditCommand(event);
          if (cmd) crudStore.stageCommand(tableKey, cmd);
        }}
      />

      <SqlPagination
        hasMore={data.hasMore}
        isLoading={data.isLoading}
        onLoadMore={data.fetchNextPage}
        total={data.estimatedTotal}
      />
    </div>
  );
}
```

### DocumentDataGrid

```tsx
function DocumentDataGrid({ connectionId, database, collection }: DocumentDataGridProps) {
  const data = useDocumentData({ connectionId, database, collection });
  const tableKey = `${connectionId}:${database}::${collection}`;

  const handleCellActivated = useCallback((cell: Item) => {
    const [col, row] = cell;
    if (data.canStepInto(row, col)) {
      data.stepInto(row, col);
    }
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      <BreadcrumbNav
        path={data.currentPath}
        collectionName={collection}
        onNavigate={data.navigateToPath}
        onNavigateToRoot={() => data.navigateToPath(-1)}
      />

      <EditableDataGrid
        tableKey={tableKey}
        rows={data.rows}
        columns={data.columns}
        getCellContent={data.getCellContent}
        onCellActivated={handleCellActivated}
        onCellEditCommit={(event) => {
          const cmd = data.createEditCommand(event);
          if (cmd) crudStore.stageCommand(tableKey, cmd);
        }}
      />

      <DocumentPagination
        hasMore={data.hasMore}
        isLoading={data.isLoading}
        onLoadMore={data.fetchNextPage}
        total={data.totalCount}
      />
    </div>
  );
}
```

### KeyValueDataGrid

```tsx
function KeyValueDataGrid({ connectionId, database, initialKey }: KeyValueDataGridProps) {
  const data = useKeyValueData({ connectionId, database, initialKey });
  const tableKey = data.currentKey
    ? `${connectionId}:${database}::${data.currentKey.key}`
    : null;

  return (
    <div className="flex flex-col h-full">
      <KeyHeader
        metadata={data.currentKey}
        onRefresh={data.refetch}
      />

      {data.currentKey && tableKey && (
        <EditableDataGrid
          tableKey={tableKey}
          rows={data.rows}
          columns={data.columns}
          getCellContent={data.getCellContent}
          onCellEditCommit={(event) => {
            const cmd = data.createEditCommand(event);
            if (cmd) crudStore.stageCommand(tableKey, cmd);
          }}
        />
      )}

      {!data.currentKey && (
        <EmptyState message="Select a key to view its contents" />
      )}
    </div>
  );
}
```

---

## Data Flow

### Read Path

```
User opens tab
       │
       ▼
PanelContentRenderer detects paradigm from tab metadata
       │
       ├─► type="table"            → SqlDataGrid
       ├─► type="mongo-collection" → DocumentDataGrid
       └─► type="redis-key"        → KeyValueDataGrid
       │
       ▼
Wrapper component calls data hook
       │
       ├─► useSqlData      → queryStreamClient.stream() → rows[]
       ├─► useDocumentData → MongoDBAdapter.findDocuments() → rows[]
       └─► useKeyValueData → RedisAdapter.hgetall/lrange/etc → rows[]
       │
       ▼
Hook returns { rows, columns, getCellContent }
       │
       ▼
EditableDataGrid renders via DataGridBase
```

### Write Path (CRUD)

```
User edits cell / inserts row / deletes row
       │
       ▼
EditableDataGrid calls onCellEditCommit(event)
       │
       ▼
Wrapper calls hook's createEditCommand(event)
       │
       ▼
Hook returns CrudCommand with proper target/payload
       │
       ▼
Wrapper calls crudStore.stageCommand(tableKey, command)
       │
       ▼
User clicks "Commit" in GlobalChangesDialog
       │
       ▼
crudStore.commitChanges(tableKey)
       │
       ▼
getOperationExecutor(connectionId, dbType)
       │
       ├─► SqlOperationExecutor.execute()      ✅ EXISTS
       ├─► DocumentOperationExecutor.execute() ✅ EXISTS
       └─► KeyValueOperationExecutor.execute() ✅ EXISTS
       │
       ▼
Hook's refetch() called → UI updates
```

### TableKey Format

```typescript
// Unified key format for crudStore
type TableKey =
  | `${connectionId}:${database}:${schema}:${table}`     // SQL
  | `${connectionId}:${database}::${collection}`         // MongoDB (empty schema)
  | `${connectionId}:${dbIndex}::${keyName}`             // Redis
```

---

## Migration Plan

### Files to DELETE

```
src/components/MongoDB/
├── CollectionBrowser.tsx      ❌ DELETE - replaced by DocumentDataGrid
├── DocumentEditor/
│   ├── index.tsx              ❌ DELETE - inline editing in grid
│   ├── TreeView.tsx           ❌ DELETE - drill-down replaces tree
│   └── RawJsonEditor.tsx      ❌ DELETE - cell editor handles JSON

src/components/Redis/
├── KeyBrowser.tsx             ❌ DELETE - replaced by KeyValueDataGrid
├── editors/
│   ├── StringEditor.tsx       ❌ DELETE - grid cell handles it
│   ├── HashEditor.tsx         ❌ DELETE - grid with field|value columns
│   ├── ListEditor.tsx         ❌ DELETE - grid with index|value columns
│   ├── SetEditor.tsx          ❌ DELETE - grid with member column
│   ├── ZSetEditor.tsx         ❌ DELETE - grid with score|member columns
│   └── StreamEditor.tsx       ❌ DELETE - grid with id|fields columns
```

### Files to KEEP

```
src/components/DataGrid/
├── base/
│   ├── DataGridBase.tsx       ✅ KEEP - foundation
│   └── EditableDataGrid.tsx   ✅ KEEP - editing layer
├── components/
│   ├── BreadcrumbNav.tsx      ✅ KEEP - document navigation
│   └── KeyHeader.tsx          ✅ KEEP - redis key info
├── renderers/                 ✅ KEEP - all existing renderers
├── sources/
│   └── types.ts               ✅ KEEP - type definitions (simplified)
├── integration/               ✅ KEEP - executor integration
├── utils/
│   └── cellFactory.ts         ✅ KEEP - extend for paradigms
```

### Files to CREATE

```
src/components/DataGrid/
├── hooks/
│   ├── useDocumentData.ts     📝 NEW - MongoDB data hook
│   └── useKeyValueData.ts     📝 NEW - Redis data hook
├── renderers/
│   └── DrillableCell/         📝 NEW - nested object/array cells
│       ├── index.ts
│       ├── types.ts
│       └── DrillableCellRenderer.tsx
├── adapters/
│   ├── DocumentDataGrid.tsx   📝 NEW - MongoDB wrapper
│   └── KeyValueDataGrid.tsx   📝 NEW - Redis wrapper
├── utils/
│   ├── documentCellFactory.ts 📝 NEW - MongoDB cell builder
│   └── keyvalueCellFactory.ts 📝 NEW - Redis cell builder
```

### Files to MODIFY

```
src/components/DataGrid/
├── sources/types.ts           🔧 SIMPLIFY - keep types, remove class interfaces
├── renderers/index.ts         🔧 ADD DrillableCellRenderer to exports

src/components/Workbench/
├── PanelContentRenderer.tsx   🔧 UPDATE routing to new components
```

---

## Implementation Order

### Phase 1: Foundation
1. Create `DrillableCellRenderer` for nested objects/arrays
2. Extend `cellFactory.ts` with paradigm-aware helpers
3. Simplify `sources/types.ts` (remove class-based interface, keep type definitions)

### Phase 2: MongoDB Support
1. Implement `useDocumentData` hook with drill-down state management
2. Create `documentCellFactory.ts` for MongoDB → GridCell mapping
3. Create `DocumentDataGrid` wrapper component
4. Test drill-down navigation with BreadcrumbNav

### Phase 3: Redis Support
1. Implement `useKeyValueData` hook with type-aware column mapping
2. Create `keyvalueCellFactory.ts` for Redis → GridCell mapping
3. Create `KeyValueDataGrid` wrapper component
4. Test all 6 Redis types (string, hash, list, set, zset, stream)

### Phase 4: Integration
1. Update `PanelContentRenderer` routing
2. Delete old MongoDB components
3. Delete old Redis components
4. Update sidebar adapters if needed

### Phase 5: Polish
1. Add proper error states
2. Add loading skeletons
3. Ensure CRUD commits work via executor pipeline
4. Performance testing with large datasets

---

## Success Criteria

- [x] All three paradigms render through DataGridBase
- [x] `useDocumentData` hook provides drill-down navigation
- [x] `useKeyValueData` hook provides type-aware columns
- [x] DrillableCell renders nested objects/arrays with click-to-drill
- [x] BreadcrumbNav works for MongoDB path navigation
- [x] KeyHeader works for Redis key metadata
- [x] Streaming/pagination works for MongoDB
- [x] All 6 Redis types render with correct columns
- [x] Inline editing works for all paradigms
- [x] CRUD commits work via existing OperationExecutor pipeline
- [x] Old MongoDB/Redis components deleted
- [x] No regression in SQL DataGrid functionality

---

## Appendix: Existing Infrastructure Reuse

### Already Complete (from unified-datagrid-architecture branch)
- `OperationExecutor` interface + all 3 paradigm executors ✅
- `crudStore` integration with executors ✅
- `BreadcrumbNav` component ✅
- `KeyHeader` component ✅
- Type guards (`isSqlDataSource`, etc.) ✅
- `PathSegment` and `KeyMetadata` types ✅

### Already Works
- `MongoDBAdapter.findDocuments()` - pagination supported ✅
- `RedisAdapter` - all type-specific methods ✅
- Cell renderers - 20+ types including JSONCell ✅
- `EditableDataGrid` - full editing capabilities ✅
- `DataGridBase` - Glide wrapper with theming ✅
