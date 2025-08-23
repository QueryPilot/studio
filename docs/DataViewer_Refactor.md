# DataViewer Refactor – Pure Component Spec (v2)

## 1) Goals

- Make the `DataViewer` **pure** and modular; remove complex data-loading side effects.
- Keep existing functionality (Data | Structure | Indexes | Triggers) with **testability**, **type safety**, and **UX** improvements.
- Align the frontend contract with the backend `db_table_data` streaming API and optional column **projection (`select`)**.
- Prepare for multi‑engine support (SQL + NoSQL) via **capability flags**.

### Non‑Goals

- No DML implementation here (only wire `onSave` callback).
- No cross‑table joins.

---

## 3) TypeScript Contracts

```ts
export type ConnectionType =
  | "pg"
  | "mysql"
  | "sqlite"
  | "mssql"
  | "oracle"
  | "mongo"
  | "cassandra"
  | "redis";

export type SortDirection = "asc" | "desc";
export interface SortSpec {
  column: string;
  direction: SortDirection;
}

export type Operator =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "LIKE"
  | "ILIKE"
  | "IN"
  | "IS NULL"
  | "IS NOT NULL"
  | "BETWEEN";

export interface FilterSpec {
  column: string;
  operator: Operator;
  value: unknown;
}

export interface DataRequest {
  connectionId: string;
  connectionType: ConnectionType;
  tableName: string; // pg/mysql/etc: table; mongo: collection; cassandra: table; redis: key pattern or pseudo-table
  schemaName?: string; // pg/mysql: schema; mongo: database; cassandra: keyspace
  cursor?: string; // opaque cursor
  offset?: number; // fallback pagination
  skip?: number; // alias for offset (backward compat)
  limit?: number; // page size
  sorts?: SortSpec[];
  filters?: FilterSpec[];
  search?: string; // best-effort per engine
  select?: string[]; // projection; if omitted => all columns
}

export type AppType =
  | "integer"
  | "float"
  | "decimal"
  | "string"
  | "text"
  | "boolean"
  | "date"
  | "time"
  | "datetime"
  | "json"
  | "bytes"
  | "uuid"
  | "any";

export interface MetaColumn {
  name: string;
  dbType: string; // engine-specific (e.g., int4, varchar, bson)
  appType: AppType; // normalized for UI rendering
  nullable: boolean;
  isPrimaryKey?: boolean;
}

export interface EngineCapabilities {
  supportsSchema: boolean;
  supportsProjection: boolean;
  supportsMultiSort: boolean;
  supportsFilters: { operators: Operator[]; requiresPartitionKey?: boolean };
  supportsSearch: "none" | "basic" | "fulltext";
  supportsCursorPagination: boolean;
  supportsOffsetPagination: boolean;
}

export interface MetaChunk {
  type: "meta";
  table: string;
  schema?: string;
  columns: MetaColumn[];
  selected: string[]; // mirrors `select` (or all columns)
  pageSize: number;
  cursorKeyColumns?: string[]; // keyset fields (may be hidden from rows)
  engineCapabilities?: EngineCapabilities;
}

export interface RowsChunk {
  type: "rows";
  rows: Record<string, unknown>[];
  next_cursor: string | null;
}
export interface DoneChunk {
  type: "done";
}
export interface ErrorChunk {
  type: "error";
  code: string;
  message: string;
}
export type DataStreamChunk = MetaChunk | RowsChunk | DoneChunk | ErrorChunk;
export type DataStream =
  | AsyncIterable<DataStreamChunk>
  | { read(): Promise<DataStreamChunk | null> };

export interface StructureColumn {
  name: string;
  dbType: string;
  appType: AppType;
  nullable: boolean;
  default?: string | null;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
}
export interface TableStructure {
  name: string;
  schema?: string;
  columns: StructureColumn[];
  [k: string]: unknown;
}
export interface TableIndex {
  name: string;
  columns: string[];
  unique?: boolean;
  [k: string]: unknown;
}
export interface TableTrigger {
  name: string;
  timing: "BEFORE" | "AFTER" | "INSTEAD OF";
  event: string;
  [k: string]: unknown;
}

export interface DataViewerProps {
  error?: string | null;
  features?: Array<"data" | "structure" | "indexes" | "triggers">;

  connectionId: string;
  connectionType: ConnectionType;
  tableName: string;
  schemaName?: string;

  initialView?: "data" | "structure" | "indexes" | "triggers";

  loadData: (req: DataRequest) => Promise<DataStream | RowsChunk>;
  loadStructure: (p: {
    connectionId: string;
    tableName: string;
    schemaName?: string;
  }) => Promise<TableStructure>;
  loadIndexes: (p: {
    connectionId: string;
    tableName: string;
    schemaName?: string;
  }) => Promise<TableIndex[]>;
  loadTriggers: (p: {
    connectionId: string;
    tableName: string;
    schemaName?: string;
  }) => Promise<TableTrigger[]>;

  onSave?: (p: {
    connectionId: string;
    tableName: string;
    schemaName?: string;
    data: unknown;
  }) => Promise<void>;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}
```

---

## 4) Component Decomposition

```
<DataViewer>
  ├─ <ViewerTabs />                       // Data | Structure | Indexes | Triggers
  ├─ <DataTab>
  │    ├─ <DataToolbar />                // Search, Filters, Sorts, Select Columns, Refresh
  │    ├─ <DataGrid />                   // Virtualized table
  │    └─ <Pagination />                 // Cursor/offset controls
  ├─ <StructureTab />
  ├─ <IndexesTab />
  └─ <TriggersTab />
```

**Subcomponents (presentational only):**

- `DataToolbar` – emits intents: `onSearch`, `onApplyFilters`, `onApplySorts`, `onSelectColumns`, `onRefresh`.
- `DataGrid` – receives `columns` (from `meta.selected` + `meta.columns`), `rows`, `loading`, `error`.
- `Pagination` – accepts `next_cursor`, `offset`, `limit`, emits `onNext`, `onPrev`, `onJump`.
- `ErrorBanner`, `EmptyState` for UX; `SelectColumnsSheet` for projection.

**Local UI State Only**

- Active tab, drafts for search/filters/sorts/select, and pagination cursor. No data caches.

---

## 5) Hooks (optional helpers)

```ts
export function useDataPager(
  loadData: DataViewerProps["loadData"],
  base: Omit<DataRequest, "cursor" | "offset" | "skip">,
) {
  // returns: { meta, rows, loading, error, hasMore, next, refresh, apply(params) }
}

export function useStructure(
  loadStructure: DataViewerProps["loadStructure"],
  args: { connectionId: string; tableName: string; schemaName?: string },
) {
  // returns: { structure, loading, error, refresh }
}
```

`useDataPager` should handle both streaming and non‑streaming loaders:

- Streaming: process `meta → rows* → done` (or `error`).
- Batch: synthesize or separately fetch meta on first load if needed.

---

## 6) Engine Capability Awareness

- Backend should surface `engineCapabilities` in the **meta** chunk. UI should:

  - Disable multi‑sort if `supportsMultiSort=false`.
  - Restrict operators to `supportsFilters.operators`.
  - Show warnings or disable search if `supportsSearch='none'`.
  - Prefer cursor pagination if `supportsCursorPagination=true`.
  - **Cassandra:** `requiresPartitionKey=true`; validate partition key presence before enabling “Apply”.
  - **Redis:** switch to type‑specific column sets (`key`, `type`, `ttl`, etc.).

---

## 7) Engine Mapping Cheatsheet

### SQL (Postgres/MySQL/SQLite/MSSQL/Oracle)

- `schemaName` ⇒ schema (or database for MySQL).
- `tableName` ⇒ table/view.
- `select` ⇒ projected columns list.
- Push down `filters/sorts/search` when adapter supports it.
- Pagination: prefer **keyset** when stable ordering exists; else offset/limit.

### MongoDB

- `schemaName` ⇒ **database**; `tableName` ⇒ **collection**.
- `select` ⇒ projection `{ field: 1 }`.
- `filters` ⇒ MQL (safe subset); `sorts` ⇒ sort doc; prefer `_id` keyset.
- `search` ⇒ `$text` only if index exists.
- Cursor: `_id` keyset or driver cursor.

### Cassandra

- `schemaName` ⇒ **keyspace**; `tableName` ⇒ **table**.
- **Require partition key(s)** in `filters`; otherwise error `REQUIRES_PARTITION_KEY`.
- Sorting only on clustering columns; pagination via driver paging state (opaque `cursor`).

### Redis

- Normalized views:

  - Keys list via `SCAN` (`tableName` as key pattern), rows `{ key, type, ttl }`.
  - Hash via `HSCAN` rows `{ field, value }` (projection applies to hash fields).
  - List/Set/ZSet/Stream viewers with type‑specific schemas.

- Limited `filters/sorts`; reflect via capabilities.

---

## 8) Minimal Code Skeletons

### DataViewer (presentational orchestrator)

```tsx
import React from "react";
import type {
  DataViewerProps,
  DataRequest,
  MetaChunk,
  RowsChunk,
  DataStream,
} from "./types";

export function DataViewer(props: DataViewerProps) {
  const {
    error: externalError,
    features = ["data", "structure", "indexes", "triggers"],
    connectionId,
    connectionType,
    tableName,
    schemaName,
    initialView = "data",
    loadData,
    loadStructure,
    loadIndexes,
    loadTriggers,
    onSave,
    onSuccess,
    onError,
  } = props;

  const [activeTab, setActiveTab] =
    React.useState<typeof initialView>(initialView);
  const [meta, setMeta] = React.useState<MetaChunk | null>(null);
  const [rows, setRows] = React.useState<RowsChunk["rows"]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(
    externalError ?? null,
  );

  const baseReq: Omit<DataRequest, "cursor" | "offset" | "skip"> = {
    connectionId,
    connectionType,
    tableName,
    schemaName,
    limit: 100,
  };

  const runLoad = React.useCallback(
    async (req: DataRequest) => {
      setLoading(true);
      setError(null);
      try {
        const r = await loadData(req);
        if (Symbol.asyncIterator in Object(r as any)) {
          const stream = r as DataStream as AsyncIterable<any>;
          setRows([]);
          for await (const chunk of stream) {
            if (chunk.type === "meta") setMeta(chunk);
            if (chunk.type === "rows") {
              setRows((prev) => prev.concat(chunk.rows));
              setNextCursor(chunk.next_cursor);
            }
            if (chunk.type === "error") {
              setError(chunk.message);
              break;
            }
          }
        } else {
          const batch = r as RowsChunk;
          setRows(batch.rows);
          setNextCursor(batch.next_cursor);
        }
      } catch (e: any) {
        setError(e?.message ?? "Failed to load data");
      } finally {
        setLoading(false);
      }
    },
    [loadData],
  );

  React.useEffect(() => {
    if (activeTab === "data") runLoad(baseReq as DataRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, connectionId, tableName, schemaName]);

  return (
    <div className="flex h-full flex-col">
      {/* Tabs, Toolbar, Grid, Pagination; Structure/Indexes/Triggers tabs call respective loaders */}
      {error && <div className="text-red-600">{error}</div>}
    </div>
  );
}
```

### IPC loader (normalizes `skip → offset`)

```ts
export async function loadDataViaIPC(req: DataRequest) {
  const { skip, ...rest } = req as any;
  const payload = { ...rest, offset: rest.offset ?? skip };
  return await (window as any).app.db_table_data(payload); // replace with your IPC
}
```

### Workspace Tab usage

```tsx
<DataViewer
  connectionId={connId}
  connectionType={engine}
  tableName={table}
  schemaName={schema}
  initialView="data"
  loadData={loadDataViaIPC}
  loadStructure={loadStructureViaIPC}
  loadIndexes={loadIndexesViaIPC}
  loadTriggers={loadTriggersViaIPC}
  onSave={saveChangesViaIPC}
/>
```

### Storybook Smoke Test

```tsx
export const DataOnly = () => (
  <DataViewer
    connectionId="demo"
    connectionType="pg"
    tableName="orders"
    loadData={async () => ({
      type: "rows",
      rows: [{ id: 1, total: "12.34" }],
      next_cursor: null,
    })}
    loadStructure={async () => ({ name: "orders", columns: [] })}
    loadIndexes={async () => []}
    loadTriggers={async () => []}
  />
);
```

---

## 9) Migration Checklist

- [ ] Extract current fetch logic into standalone services; wire them to `load*` props.
- [ ] Implement IPC wrapper for `db_table_data` (+ structure/index/trigger endpoints).
- [ ] Replace internal state that mixes data + UI with a thin UI state (activeTab, filters, sorts, select, pagination).
- [ ] Add `engineCapabilities` handling; gate UI accordingly.
- [ ] Create stories for typical engines (pg, mongo, cassandra, redis hash).
- [ ] Add tests for `select`, cursor pagination, and capability gating.

---

## 10) Engine Notes (NoSQL)

- **MongoDB**: `schemaName → database`, `tableName → collection`; `select` → projection; use `_id` keyset or driver cursor; `$text` only if indexed.
- **Cassandra**: require partition key(s) in `filters`; sort only on clustering columns; paging via driver paging state.
- **Redis**: normalized viewers (keys list, hash fields, list/set/zset/stream). Use SCAN/HSCAN cursors. `select` meaningful for hash fields only; reflect via capabilities.

---

## 11) Testing Snippets

- Projection order preserved (selected columns sequence kept).
- `skip` treated as `offset` for backward compatibility.
- Filters/sorts on non‑selected columns allowed; output rows respect `select`.
- Streaming: verify `meta → rows* → done` flow and back‑to‑back pagination calls with `next_cursor`.
