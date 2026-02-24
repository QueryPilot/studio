# DataGrid Adapter Architecture

**Last Updated:** 2026-01-23
**Purpose:** Complete guide to DataGrid architecture, adapter patterns, and implementation

## Table of Contents

1. [Overview](#overview)
2. [Architecture Layers](#architecture-layers)
3. [Frontend Adapters](#frontend-adapters-srccomponentsdatagridadapters)
4. [Backend Adapters](#backend-adapters-srcadapters)
5. [The Bridge: Data Hooks](#the-bridge-data-hooks)
6. [Feature Comparison](#feature-comparison-table)
7. [When to Use Which Grid](#when-to-use-which-grid)
8. [Implementation Patterns](#implementation-patterns)
9. [Code Examples](#code-examples)
10. [Related Documentation](#related-documentation)

---

## Overview

Query Pilot uses a **two-category** architecture for data grids:

| Category | Grids | Purpose |
|----------|-------|---------|
| **Query Result Display** | `QueryResultGrid` | Display static query results (ad-hoc queries) |
| **Data Browser & Editor** | `SqlDataGrid`, `DocumentDataGrid`, `KeyValueDataGrid` | Browse & edit live database storage |

All grids share `BaseDataGrid` for consistent UX (column reordering, sorting, filtering, clipboard), but have **fundamentally different architectures and capabilities**.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        UI LAYER (Frontend Adapters)                       │
│  ┌────────────────┐ ┌───────────┐ ┌────────────────┐ ┌────────────────┐  │
│  │QueryResultGrid │ │SqlDataGrid│ │DocumentDataGrid│ │KeyValueDataGrid│  │
│  └───────┬────────┘ └─────┬─────┘ └───────┬────────┘ └───────┬────────┘  │
│          │                │               │                  │           │
│          └────────────────┴───────────────┴──────────────────┘           │
│                                   │                                       │
│                            ┌──────▼──────┐                               │
│                            │ BaseDataGrid │                               │
│                            └──────┬───────┘                               │
│                                   │                                       │
│                            ┌──────▼──────┐                               │
│                            │EditableGrid │ (Glide Data Grid)             │
│                            └─────────────┘                               │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     BRIDGE LAYER (Data Hooks)                            │
│  ┌──────────────────┐ ┌───────────────┐ ┌────────────────┐               │
│  │useTableDataQuery │ │useDocumentData│ │ useKeyValueData│               │
│  │    (SQL)         │ │   (MongoDB)   │ │    (Redis)     │               │
│  └────────┬─────────┘ └───────┬───────┘ └───────┬────────┘               │
└───────────┼───────────────────┼─────────────────┼────────────────────────┘
            │                   │                 │
            ▼                   ▼                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    BACKEND LAYER (Database Adapters)                     │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                      /src/adapters/                               │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐               │    │
│  │  │ /dialects/  │  │  /mongodb/   │  │  /redis/    │               │    │
│  │  │ PostgreSQL  │  │MongoDBAdapter│  │RedisAdapter │               │    │
│  │  │ MySQL       │  └──────────────┘  └─────────────┘               │    │
│  │  │ SQLite      │                                                   │    │
│  │  │ MSSQL       │                                                   │    │
│  │  └─────────────┘                                                   │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
            │                   │                 │
            ▼                   ▼                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      RUST BACKEND (Tauri Commands)                       │
│      /src-tauri/src/commands/{sql.rs, document.rs, keyvalue.rs}          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Layers

### Layer 1: Frontend Adapters (`/src/components/DataGrid/adapters/`)

These are React components that provide paradigm-specific UI and behavior:

| Adapter | File | Purpose |
|---------|------|---------|
| `QueryResultGrid` | `QueryResultGrid.tsx` | Read-only display of query results |
| `SqlDataGrid` | `SqlDataGrid.tsx` | SQL table browser with FK navigation |
| `DocumentDataGrid` | `DocumentDataGrid.tsx` | MongoDB collection browser with drill-down |
| `KeyValueDataGrid` | `KeyValueDataGrid.tsx` | Redis key browser with type-aware rendering |

### Layer 2: Shared Foundation (`/src/components/DataGrid/base/`)

| Component | Purpose |
|-----------|---------|
| `BaseDataGrid.tsx` | Unified features: column management, sorting, filtering, clipboard, cell rendering |
| `EditableDataGrid.tsx` | CRUD staging, optimistic updates, change highlighting |

### Layer 3: Data Hooks (`/src/components/DataGrid/hooks/`)

| Hook | Used By | Backend Connection |
|------|---------|-------------------|
| `useTableDataQuery` | `SqlDataGrid` | SQL adapters via Tauri commands |
| `useDocumentData` | `DocumentDataGrid` | `MongoDBAdapter` |
| `useKeyValueData` | `KeyValueDataGrid` | `RedisAdapter` |

### Layer 4: Backend Adapters (`/src/adapters/`)

| Adapter | Location | Rust Commands |
|---------|----------|---------------|
| `PostgreSQLAdapter` | `/dialects/PostgreSQLAdapter.ts` | `sql.rs` |
| `MySQLAdapter` | `/dialects/MySQLAdapter.ts` | `sql.rs` |
| `SQLiteAdapter` | `/dialects/SQLiteAdapter.ts` | `sql.rs` |
| `MSSQLAdapter` | `/dialects/MSSQLAdapter.ts` | `sql.rs` |
| `MongoDBAdapter` | `/mongodb/MongoDBAdapter.ts` | `document.rs` |
| `RedisAdapter` | `/redis/RedisAdapter.ts` | `keyvalue.rs` |

---

## Frontend Adapters (`/src/components/DataGrid/adapters/`)

### QueryResultGrid: Static Query Results

**Purpose:** Display read-only query results from ad-hoc queries.

```typescript
// No connection after query execution
User Query → Backend → Static rows[][] → QueryResultGrid → Display
                              ↑
                        No refetching
                        No live updates
```

**Key characteristics:**
- Receives data as a static prop (no fetching)
- Read-only (no CRUD)
- Client-side filtering/sorting only
- Shows performance metrics (execution time, streaming stats)
- Supports all paradigms via `paradigm` prop

```typescript
interface QueryResultGridProps {
  gridId: string;
  data?: {
    columns: string[];
    columnMeta?: ColumnMeta[];
    rows: unknown[][];      // Static data
    rowCount?: number;
  };
  paradigm?: 'sql' | 'document' | 'keyvalue';
  executionTime?: number;
  isStreaming?: boolean;
  // ...
}
```

---

### SqlDataGrid: SQL Table Browser

**Purpose:** Browse and edit SQL tables with FK navigation and server-side operations.

```typescript
SqlDataGrid → useTableDataQuery → Backend API → SQL Database
      ↓
   Live refetching
   Server-side WHERE/ORDER BY/LIMIT
      ↓
useTableFullStructure → PK/FK/Constraints
      ↓
CRUD Commands → Staging Pipeline → Batch commit
```

**Key characteristics:**
- Live connection with auto-refetch
- Server-side filtering, sorting, pagination
- FK navigation and embedded display
- Full CRUD with staging
- Schema-aware (PK, FK, constraints)

```typescript
interface SqlDataGridProps {
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
  dbType: DbType;
  readOnly?: boolean;
  initialFilter?: string;  // Server-side WHERE clause
  panelId?: string;        // For FK navigation
  // ...
}
```

---

### DocumentDataGrid: MongoDB Collection Browser

**Purpose:** Browse and edit MongoDB collections with drill-down navigation.

```typescript
DocumentDataGrid → useDocumentData → MongoDBAdapter
      ↓
   Server-side { age: { $gt: 30 } }
   Drill-down: currentPath = ['address', 'city']
      ↓
Dynamic columns from document structure
      ↓
CRUD Commands → MongoDB operations
```

**Key characteristics:**
- Drill-down into nested objects/arrays
- Breadcrumb navigation
- Dynamic column generation
- MongoDB query syntax filtering
- CRUD for root-level documents

```typescript
interface DocumentDataGridProps {
  gridId: string;
  connectionId: string;
  database: string;
  collection: string;
  pageSize?: number;
  // ...
}
```

---

### KeyValueDataGrid: Redis Key Browser

**Purpose:** Browse and edit Redis keys with type-aware rendering.

```typescript
KeyValueDataGrid → useKeyValueData → RedisAdapter
      ↓
   Browser Mode: SCAN 0 MATCH user:*
   Key Mode: GET/HGETALL/LRANGE/etc.
      ↓
Type detection: string/hash/list/set/zset/stream
      ↓
CRUD Commands → Redis operations
```

**Key characteristics:**
- SCAN pattern matching
- Key drill-down (hash/list/set contents)
- Type-aware rendering for all 6 Redis types
- TTL display and management

```typescript
interface KeyValueDataGridProps {
  gridId: string;
  connectionId: string;
  database: number;        // Redis DB number (0-15)
  pattern?: string;        // SCAN pattern
  pageSize?: number;
  // ...
}
```

---

## Backend Adapters (`/src/adapters/`)

Backend adapters provide the domain logic for database operations. They are **separate** from DataGrid adapters but connected via data hooks.

### Directory Structure

```
/src/adapters/
├── base/
│   └── SqlAdapter.ts           # Base interface for SQL operations
├── dialects/
│   ├── PostgreSQLAdapter.ts    # PostgreSQL-specific SQL
│   ├── MySQLAdapter.ts         # MySQL-specific SQL
│   ├── SQLiteAdapter.ts        # SQLite-specific SQL
│   └── MSSQLAdapter.ts         # SQL Server-specific SQL
├── mongodb/
│   └── MongoDBAdapter.ts       # MongoDB document operations
├── redis/
│   └── RedisAdapter.ts         # Redis key-value operations
├── sidebar/
│   ├── SqlSidebarAdapter.ts    # SQL schema tree navigation
│   ├── MongoSidebarAdapter.ts  # MongoDB database/collection tree
│   └── RedisSidebarAdapter.ts  # Redis database tree
├── capabilities.ts             # Capability definitions
├── types.ts                    # Shared type definitions
└── index.ts                    # Factory and routing
```

### Adapter Capabilities

Each adapter implements specific capabilities:

| Capability | SQL Adapters | MongoDBAdapter | RedisAdapter |
|------------|--------------|----------------|--------------|
| `query()` | ✅ SQL queries | ✅ Find/Aggregate | ✅ Commands |
| `execute()` | ✅ DDL/DML | ✅ updateOne, etc. | ✅ SET, DEL, etc. |
| `getSchema()` | ✅ Tables, views | ✅ Collections | ✅ Databases |
| `introspect()` | ✅ Columns, PKs, FKs | ❌ Schemaless | ❌ Schemaless |

### Factory Pattern

```typescript
// /src/adapters/index.ts
export function createAdapter(connectionId: string, dbType: DbType): BaseAdapter {
  switch (dbType) {
    case DbType.PostgreSQL:
      return new PostgreSQLAdapter(connectionId);
    case DbType.MySQL:
      return new MySQLAdapter(connectionId);
    case DbType.MongoDB:
      return new MongoDBAdapter(connectionId);
    case DbType.Redis:
      return new RedisAdapter(connectionId);
    // ...
  }
}
```

---

## The Bridge: Data Hooks

Data hooks connect frontend adapters to backend adapters:

### Common Interface

All data hooks return a compatible structure for `BaseDataGrid`:

```typescript
interface DataHookResult {
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent?: (cell: Item) => GridCell;  // Optional custom cell rendering
  isLoading?: boolean;
  hasMore?: boolean;
  fetchNextPage?: () => Promise<void>;
  refetch?: () => Promise<void>;
  // CRUD command factories
  createEditCommand?: (event: GridEditCommitEvent) => CrudCommand | null;
  createInsertCommand?: (values: Record<string, unknown>) => CrudCommand;
  createDeleteCommand?: (row: GridRowModel) => CrudCommand;
  commandFactory?: CrudCommandFactory;  // For BaseDataGrid CRUD integration
}
```

### TableKey Format (Unified CRUD Targeting)

All adapters use the same `TableKey` format for staging CRUD operations:

```typescript
type TableKey =
  | `${connectionId}:${database}:${schema}:${table}`     // SQL
  | `${connectionId}:${database}::${collection}`         // MongoDB (empty schema)
  | `${connectionId}:${dbIndex}::${keyName}`             // Redis
```

This unified format allows `crudStore` to route execution to the correct backend adapter.

---

## Feature Comparison Table

| Feature | QueryResultGrid | SqlDataGrid | DocumentDataGrid | KeyValueDataGrid |
|---------|----------------|-------------|------------------|------------------|
| **Purpose** | Display query results | Browse/edit SQL tables | Browse/edit MongoDB collections | Browse/edit Redis keys |
| **Data Source** | Static `rows[][]` | Live SQL query | Live MongoDB query | Live Redis SCAN/GET |
| **CRUD** | ❌ Read-only | ✅ Full | ✅ Full | ✅ Full |
| **Server Filtering** | ❌ None | ✅ WHERE clause | ✅ MongoDB query | ✅ SCAN pattern |
| **Client Filtering** | ✅ Yes | ✅ Yes | ✅ Yes (search) | ✅ Yes |
| **Server Sorting** | ❌ None | ✅ ORDER BY | ✅ MongoDB sort | ❌ None |
| **Client Sorting** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Column Reordering** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Pagination** | ❌ All rows | ✅ Server-side | ✅ Server-side | ✅ Server-side (cursor) |
| **Refetching** | ❌ None | ✅ Auto | ✅ Auto | ✅ Auto |
| **Schema Awareness** | ❌ None | ✅ PK/FK/Constraints | ❌ None | ❌ None |
| **Paradigm-Specific** | Generic | FK navigation | Drill-down | Type-aware |
| **Performance Metrics** | ✅ Yes | ❌ None | ❌ None | ❌ None |
| **Change Staging** | ❌ N/A | ✅ Yes | ✅ Yes | ✅ Yes |

---

## When to Use Which Grid

### Use QueryResultGrid When:

✅ Displaying results from **ad-hoc user queries**
✅ Query returns **computed/aggregated data** (JOINs, GROUP BY)
✅ Results are **not directly editable** (views, CTEs, aggregations)
✅ You need **performance metrics** (execution time)
✅ Implementing a **Query Panel** result display

**Examples:**
- `SELECT users.*, COUNT(orders.id) FROM users LEFT JOIN orders GROUP BY users.id`
- `db.users.aggregate([...])`
- `INFO SERVER` (Redis command output)

### Use SqlDataGrid When:

✅ Browsing/editing a **specific SQL table**
✅ Need **FK navigation** (click FK → navigate to referenced table)
✅ Need **server-side filtering** (`WHERE age > 30`)
✅ Need **CRUD operations** on table rows
✅ Displaying **views or materialized views** (read-only)

### Use DocumentDataGrid When:

✅ Browsing/editing a **MongoDB collection**
✅ Need **drill-down into nested documents**
✅ Need **MongoDB query filtering**
✅ Need **CRUD operations** on documents

### Use KeyValueDataGrid When:

✅ Browsing **Redis keys** (SCAN pattern matching)
✅ Need **key drill-down** (view hash/list/set contents)
✅ Need **type-aware rendering**
✅ Need **CRUD operations** on keys/values

---

## Implementation Patterns

### Pattern 1: Cell Factory

Each paradigm has its own cell factory for specialized rendering:

| Factory | Location | Purpose |
|---------|----------|---------|
| `cellFactory.ts` | `utils/cellFactory.ts` | SQL cell types (FK, boolean, JSON, etc.) |
| `documentCellFactory.ts` | `utils/documentCellFactory.ts` | MongoDB cells (DrillableCell for nested) |
| `keyvalueCellFactory.ts` | `utils/keyvalueCellFactory.ts` | Redis type-aware cells |

### Pattern 2: Filter Parsers

Each paradigm parses filters differently:

| Parser | Location | Syntax |
|--------|----------|--------|
| `filterParser.ts` | `utils/filterParser.ts` | SQL WHERE clauses |
| `documentFilterParser.ts` | `utils/documentFilterParser.ts` | MongoDB query objects |
| `keyvalueFilterParser.ts` | `utils/keyvalueFilterParser.ts` | SCAN patterns + client search |

### Pattern 3: Column Reordering Fix

**Important:** When adapters provide custom `getCellContent`, BaseDataGrid maps the visual column index back to the original index:

```typescript
// BaseDataGrid.tsx - Column index mapping
const getCellContent = useCallback((cell: Item): GridCell => {
  if (propGetCellContentRef.current) {
    const [visualColIdx, rowIdx] = cell;
    // Map visual index to original index for adapter's getCellContent
    const originalColIdx = visualToOriginalColIndexRef.current.get(visualColIdx);
    const mappedCell: Item = originalColIdx !== undefined
      ? [originalColIdx, rowIdx]
      : cell;
    return propGetCellContentRef.current(mappedCell);
  }
  return internalGetCellContent(cell);
}, [...]);
```

This ensures column reordering works correctly with paradigm-specific cell rendering.

### Pattern 4: Grid Preferences Persistence

`gridPreferencesStore` persists per `gridId`:
- Column widths, visibility, order, pinning
- Sort configuration
- FK embedded display preferences
- Filter state

---

## Code Examples

### Example 1: QueryResultGrid (SQL Query Results)

```typescript
<QueryResultGrid
  gridId={`query-${panelId}-${tabId}`}
  paradigm="sql"
  data={{
    columns: ['id', 'name', 'age', 'country'],
    columnMeta: [...],
    rows: [
      [1, 'Alice', 35, 'USA'],
      [2, 'Bob', 42, 'Canada'],
    ],
    rowCount: 2,
  }}
  executionTime={123}
  isStreaming={false}
/>
```

### Example 2: SqlDataGrid (Table Browser)

```typescript
<SqlDataGrid
  connectionId="conn-123"
  database="mydb"
  schema="public"
  table="users"
  dbType={DbType.PostgreSQL}
  readOnly={false}
  kind="Table"
  initialFilter="age > 30"
  panelId={panelId}
  focused={focused}
/>
```

### Example 3: DocumentDataGrid (MongoDB Browser)

```typescript
<DocumentDataGrid
  gridId={`collection-${panelId}`}
  connectionId="conn-mongo-456"
  database="mydb"
  collection="users"
  pageSize={50}
  focused={focused}
/>
```

### Example 4: KeyValueDataGrid (Redis Browser)

```typescript
<KeyValueDataGrid
  gridId={`redis-${panelId}`}
  connectionId="conn-redis-789"
  database={0}
  pattern="user:*"
  pageSize={100}
  focused={focused}
/>
```

---

## Related Documentation

- [DataGrid Filtering](../features/data-grid-filtering.md) - QuickFilter feature docs
- [Query Execution](../architecture/query-execution.md) - How queries are executed
- [Backend API](../architecture/backend-api.md) - Tauri command architecture
- [CLAUDE.md](/CLAUDE.md) - Project architecture overview

---

## Summary

**Key Takeaways:**

1. **Two adapter categories**: QueryResultGrid (static display) vs. paradigm-specific grids (live browsing)
2. **Three architectural layers**: Frontend adapters → Data hooks → Backend adapters
3. **Unified foundation**: All grids compose `BaseDataGrid` for consistent UX
4. **Paradigm-specific features**: FK navigation (SQL), drill-down (MongoDB), type-aware (Redis)
5. **Backend adapters** (`/src/adapters/`) provide domain logic, **frontend adapters** (`/src/components/DataGrid/adapters/`) provide UI

**Architecture Philosophy:**
- Separation of concerns: Query results vs. data browsing
- Composition over inheritance: All grids compose BaseDataGrid
- Paradigm-aware design: Each adapter optimized for its database type
- Unified UX: Consistent features across all grids
