# Unified DataGrid Architecture Design

> **Date:** 2026-01-16
> **Status:** Draft
> **Author:** Claude + Hieu

## Problem Statement

Query Pilot currently has three separate rendering systems for different database paradigms:

1. **SQL** - `DataGrid` with 19+ renderers, 28+ hooks, full CRUD support
2. **MongoDB** - Separate `CollectionBrowser` + `DocumentEditor/TreeView`
3. **Redis** - Separate `KeyBrowser` + 6 type-specific editors

This causes:
- **Code duplication** - Similar features (filtering, pagination, editing, export) maintained in three places
- **Inconsistent UX** - Different interactions, keyboard shortcuts, visual patterns per database type
- **Feature parity gaps** - Undo/redo exists in DataGrid but not MongoDB/Redis
- **Technical debt** - Harder to onboard developers or add cross-cutting features

## Solution Overview

Unify all three paradigms under the existing DataGrid infrastructure using:

1. **GridDataSource abstraction** - Common interface for all data sources
2. **Operation Executor layer** - Paradigm-specific command execution
3. **Path navigation** - Drill-down for nested MongoDB documents
4. **Type-based columns** - Redis values mapped to tabular structure

## Architecture

### Core Abstraction: GridDataSource

```typescript
interface GridDataSource<TRow = GridRowModel> {
  readonly paradigm: 'sql' | 'document' | 'keyvalue';
  readonly connectionId: string;
  readonly identifier: DataSourceIdentifier;

  // Column definition
  getColumns(): GridColumnV2[];

  // Data access
  getRowCount(): number;
  getRow(index: number): TRow;
  getCellContent(row: number, col: number): GridCell;

  // Streaming/pagination
  fetchMore(offset: number, limit: number): Promise<void>;
  isLoading: boolean;
  hasMore: boolean;

  // CRUD capability
  readonly editable: boolean;
  createEditCommand(event: GridEditCommitEvent): CrudCommand | null;
  createInsertCommand(values: Record<string, unknown>): CrudCommand;
  createDeleteCommand(row: TRow): CrudCommand;
}

type DataSourceIdentifier =
  | { type: 'table'; database: string; schema?: string; table: string }
  | { type: 'collection'; database: string; collection: string }
  | { type: 'keyspace'; database: number; pattern?: string };
```

### Three Implementations

```
┌─────────────────────────────────────────────────────────────┐
│                    UnifiedDataGrid                           │
│         (existing DataGridBase + EditableDataGrid)          │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ uses
┌───────────────────────────┼───────────────────────────────┐
│                    GridDataSource                          │
└───────────────────────────┼───────────────────────────────┘
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌────────────────┐  ┌────────────────┐
│SqlDataSource  │  │DocumentData    │  │KeyValueData    │
│               │  │Source          │  │Source          │
│• schema cols  │  │• dynamic cols  │  │• type-based    │
│• typed cells  │  │• path nav      │  │  columns       │
│• PK-based ops │  │• _id-based ops │  │• key-based ops │
└───────────────┘  └────────────────┘  └────────────────┘
```

## Operation Executor Layer

### Interface

```typescript
interface OperationExecutor {
  readonly paradigm: 'sql' | 'document' | 'keyvalue';

  execute(commands: CrudCommand[]): Promise<ExecuteResult>;
  preview(commands: CrudCommand[]): OperationPreview;
  validate(command: CrudCommand): ValidationResult;
}

interface ExecuteResult {
  success: boolean;
  affectedCount: number;
  errors: ExecuteError[];
}

interface OperationPreview {
  type: 'sql' | 'mongo-ops' | 'redis-cmds';
  content: string;
  operations: PreviewOp[];
}
```

### Integration Points

**CrudStore** - Replace SQL-only execution:
```typescript
// Before
const transactionSql = adapter.transaction(sqlStatements);
await adapter.execute(transactionSql);

// After
const executor = getOperationExecutor(connectionId, dbType);
await executor.execute(commands);
```

**GlobalChangesDialog** - Paradigm-aware preview:
```typescript
const executor = getOperationExecutor(connectionId, dbType);
const preview = executor.preview(commands);
// Renders SQL, JSON, or Redis commands based on preview.type
```

## Document Navigation (MongoDB)

### Path-Based Drill-Down

Inspired by [Studio 3T's "Step Into" pattern](https://studio3t.com/knowledge-base/articles/table-view/):

```typescript
interface DocumentDataSource extends GridDataSource {
  readonly currentPath: PathSegment[];
  readonly pathDisplay: string;  // "users > addresses > [0]"

  canStepInto(row: number, col: number): boolean;
  stepInto(row: number, col: number): void;
  stepOut(): void;
  navigateToPath(path: PathSegment[]): void;
}

type PathSegment =
  | { type: 'field'; name: string }
  | { type: 'index'; index: number };
```

### UI Pattern

```
┌─────────────────────────────────────────────────────────────┐
│ 📁 orders > items > [2]                    [↑ Step Out]     │  ← Breadcrumb
├─────────────────────────────────────────────────────────────┤
│  productId  │  name       │  quantity  │  price   │ options │
├─────────────┼─────────────┼────────────┼──────────┼─────────┤
│  prod_123   │  Widget     │  5         │  29.99   │ {3...}⏵ │
│  prod_456   │  Gadget     │  2         │  49.99   │ {2...}⏵ │
└─────────────────────────────────────────────────────────────┘
     Enter on ⏵ cell to step in, Backspace to step out
```

### Dynamic Column Generation

Columns derived from document structure at current path level:
- Collect all unique keys across documents
- `_id` always first if present
- Infer types from values for cell rendering

## Key-Value Grid (Redis)

### Type-Aware Column Mapping

| Redis Type | Grid Columns |
|------------|--------------|
| String | `[value]` |
| Hash | `[field, value]` |
| List | `[index, value]` |
| Set | `[member]` |
| ZSet | `[member, score]` |
| Stream | `[id, timestamp, ...fields]` |

### UI Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔑 user:1001                    Type: HASH │ TTL: 3600s │ [⟳]  │
├─────────────────────────────────────────────────────────────────┤
│  field          │  value                                        │
├─────────────────┼───────────────────────────────────────────────┤
│  name           │  John Doe                                     │
│  email          │  john@example.com                             │
│  preferences    │  {"theme":"dark"}                        ⏵   │
├─────────────────┴───────────────────────────────────────────────┤
│  [+ Add Field]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

### New Files

```
src/components/DataGrid/
├── sources/
│   ├── types.ts                      # GridDataSource interface
│   ├── SqlDataSource.ts              # SQL tables
│   ├── DocumentDataSource.ts         # MongoDB collections
│   ├── KeyValueDataSource.ts         # Redis keys
│   └── index.ts
│
├── components/
│   ├── BreadcrumbNav.tsx             # Path navigation
│   ├── KeyHeader.tsx                 # Redis key info bar
│   └── ViewModeToggle.tsx            # Grid/Tree/JSON switcher
│
├── renderers/
│   └── ExpandableCell/               # Nested objects/arrays

src/services/
├── operationExecutors/
│   ├── types.ts
│   ├── SqlOperationExecutor.ts
│   ├── DocumentOperationExecutor.ts
│   ├── KeyValueOperationExecutor.ts
│   ├── factory.ts
│   └── index.ts
```

### Files to Modify

- `src/components/DataGrid/adapters/TableDataGrid.tsx` - Use GridDataSource
- `src/stores/crudStore.ts` - Use executor pattern
- `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx` - Paradigm-aware preview

### Files to Deprecate

- `src/components/MongoDB/CollectionBrowser.tsx`
- `src/components/MongoDB/DocumentEditor/`
- `src/components/Redis/KeyBrowser.tsx`
- `src/components/Redis/editors/`

## Implementation Phases

### Phase 1: Foundation
- Create GridDataSource interface
- Create SqlDataSource (extract from TableDataGrid)
- Verify existing SQL functionality unchanged

### Phase 2: Operation Executors
- Create executor interface + SqlOperationExecutor
- Integrate into crudStore
- Update GlobalChangesDialog preview

### Phase 3: Document Support
- Create DocumentDataSource with path navigation
- Create DocumentOperationExecutor
- Add BreadcrumbNav + ExpandableCell renderer
- Replace CollectionBrowser with unified grid

### Phase 4: KeyValue Support
- Create KeyValueDataSource with type mapping
- Create KeyValueOperationExecutor
- Add KeyHeader component
- Replace KeyBrowser with unified grid

### Phase 5: Polish
- Add ViewModeToggle (Grid/Tree/JSON)
- Keyboard shortcuts (Enter/Backspace navigation)
- Remove deprecated MongoDB/Redis components
- Documentation updates

## Research Sources

- [MongoDB Compass - View Documents](https://www.mongodb.com/docs/compass/documents/view/)
- [Studio 3T - Table View](https://studio3t.com/knowledge-base/articles/table-view/)
- [Studio 3T - Flatten Nested Collections](https://studio3t.com/knowledge-base/articles/explore-mongodb-arrays-fields/)
- [DataGrip - Editing MongoDB Data](https://www.jetbrains.com/help/datagrip/editing-data-in-mongodb.html)
- [DBeaver - MongoDB](https://dbeaver.com/docs/dbeaver/MongoDB/)
- [DBeaver - Redis](https://dbeaver.com/docs/dbeaver/Redis/)
- [Redis Insight](https://redis.io/docs/latest/develop/tools/insight/)
- [Navicat - MongoDB Grid View](https://www.navicat.com/en/company/aboutus/blog/823-navicat-for-mongodb-grid-view-features-expanding-array-values,-colorizing-cells,-and-migrating-data-part-2)

## Success Criteria

1. **Single codebase** - All paradigms use DataGrid infrastructure
2. **Feature parity** - Undo/redo, export, filtering work for all paradigms
3. **Consistent UX** - Same keyboard shortcuts, visual patterns across DBs
4. **No regression** - Existing SQL functionality unchanged
5. **Performance** - Large datasets (10K+ docs/keys) render smoothly
