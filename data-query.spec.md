# Data Query Adapter Redesign

## Strategy: AGGRESSIVE REFACTOR ⚡
**No feature flags. No compatibility layers. Delete slow code, replace with fast code.**

Current: 1.2 seconds for 13k rows
Target: < 100ms (10x faster, match/beat TablePlus)

## Goals
- **Eliminate ALL performance bottlenecks immediately**: Delete `CellValue.display_value`, remove query wrapping, replace `window.emit` with channels.
- Deliver a high-throughput query pipeline that streams results from the Rust adapter to React with minimal allocations and reduced parsing overhead.
- Eliminate bespoke wrappers (`CellValue`, ad-hoc display strings) and let the grid render cells directly from column metadata + raw values.
- Reuse schema/type metadata that is already fetched during introspection instead of recomputing type hints while fetching row data.
- Replace the current event-bus transport with a lower-overhead Tauri streaming channel to avoid repeated JSON encode/decode cycles.
- Keep the plan scoped to query + table data flows (no migrations or persistence changes).
- **Target performance**: 13k row queries < 100ms (match/beat TablePlus by 10x improvement).

## Non-Goals
- Supporting legacy adapters other than the actively maintained ones (PostgreSQL first; additional engines follow once the pattern is proven).
- Rewriting DataGridV2’s rendering logic—only the data plumbing and value adapters change.
- Introducing caching layers or pagination UX changes beyond what falls out of the new streaming pathway.

## Pain Points Today
- `PostgresTypeConverter` eagerly materialises display strings for every cell, even though the grid needs typed values and already knows column types.
- `StreamEvent::Data` serialises `CellValue` structs which the frontend immediately normalises again (`tableDataService`, `QueryManager`) – double work.
- `window.emit` broadcasts every batch through the Tauri event bus, forcing JSON round-trips and locking the event loop under heavy result sets.
- Table metadata + column typing are fetched separately from `get_columns`, but query execution recomputes type info by re-preparing statements.
- **Performance gap**: TablePlus queries 13k rows in ~100ms; our tool takes 1.x seconds (10x slower). Root causes likely include eager allocation, synchronous parsing, and event bus overhead.

## Critical Issues Identified (Must Address Before Implementation)

### 🚨 1. Schema Cache Invalidation Missing
**Risk**: Data corruption if schema changes between cache and query execution.

**Scenario**: Frontend caches metadata for `SELECT id, name FROM customers`. Another tool runs `ALTER TABLE customers DROP COLUMN name`. Frontend attempts to parse 2 columns from a 1-column payload → crash or corruption.

**Required Fixes**:
- **Immediate (Phase 1)**: Backend DDL detection - emit `schema:invalidate` event after successful `ALTER`/`DROP`/`CREATE`/`TRUNCATE` statements
- **Robust (Phase 3)**: Schema versioning - include `schema_hash` in metadata, cache against `(query, schema_hash)`, reject mismatched requests

### 🚨 2. Stream Termination Protocol Undefined
**Risk**: Partial results shown as complete if connection drops mid-stream.

**Problem**: Channel close is ambiguous - could be success or network failure after streaming 100k of 1M rows.

**Required Fix (Phase 1)**:
```rust
enum StreamMessage {
    Started { columns: Vec<QueryColumn>, estimated_rows: Option<usize> },
    RowBatch { rows: Vec<Vec<Value>>, row_offset: usize },
    Success { total_rows: usize, execution_time_ms: u64 },  // ← Add explicit success
    Error { code: String, message: String },                // ← Add explicit error
}
```
Frontend must wait for `Success` or `Error` before displaying results.

### 🚨 3. Performance Claims Need Correction
**Issue**: "Zero-copy" terminology is incorrect; `serde_json::Value` requires one heap allocation per cell.

**Reality Check**:
- For 1M rows × 20 columns = **20M allocations** (not zero-copy)
- Binary row mode reduces copying from driver → Rust, but Rust → JSON still allocates
- Realistic targets: 20% latency improvement achievable; 30% memory reduction requires columnar storage (Apache Arrow)

**Required Changes**:
- Replace "zero-copy" with "avoids eager buffering and string materialization"
- Document true cost of JSON serialization path vs binary protocol

## Architecture Proposal

### 1. Backend (Rust, `src-tauri`)
1. **Query Runtime Facade** (`src-tauri/src/core/query/runtime.rs`): encapsulate opening cursors, streaming rows, and closing handles. It wraps the adapter-specific implementation but exposes a uniform `async fn stream(sql, PageSize, channel)`.
2. **Typed Column Registry**: when a connection is opened or when `get_columns` runs, persist a lightweight `(schema.table -> Vec<ColumnMeta>)` snapshot in `ConnectionState`. `open_query` now resolves column metadata by reusing this registry whenever the query targets a single table; fall back to `Row::columns()` only when required. For cross-table queries, fall back to on-the-fly metadata extraction using the prepared statement output.
3. **Row Batches Close to Wire Format**: represent each row as `Vec<Value>` but lean on driver binary decoding to avoid string churn. Enable binary row mode where the driver supports it (Tokio Postgres supports per-statement binary formats) and translate only once into `serde_json::Value`/`serde_bytes::ByteBuf` structures, keeping bytes as `Uint8Array` for the frontend to render lazily. No `display_value` strings; `null` stays `null`.
4. **Zero-copy Channel Transport**: replace `window.emit` with `tauri::ipc::Channel` (`let (channel, receiver) = tauri::ipc::channel();`). The command returns the sender handle; rows are pushed via `channel.send(StreamMessage::RowBatch { ... })`. This keeps serialization to a single `serde_json::Value` per batch and bypasses the global event bus.
5. **Streaming Loop**: use `client.query_raw`/`query_portal` to obtain a `RowStream`. Pipe rows in fixed-size chunks (`Vec<RowPayload>`) straight into the channel. Push a `Started` message with `Vec<QueryColumn>` once, then subsequent batches, then `Completed`.
6. **Adapter Cleanup**: remove `CellValue`/`CellValueType` conversions from `postgres::types`. Introduce a thin `ToJsonValue` helper restricted to complex types (bytea, json, numerics needing `Decimal`). Everything else uses binary row getters (`row.try_get::<_, Option<&[u8]>>()` etc.) and converts straight into JSON primitives or `serde_bytes::ByteBuf`.
7. **Adapter Contract Preservation**: `ConnectionManager` still dispatches through `conn.adapter.stream_query(sql, options)` (new trait method). Each adapter (Postgres, MySQL, future document/graph engines) implements its own streaming cursor -> JSON batch conversion but returns the shared `StreamMessage`. We keep adapters authoritative for connection semantics while the runtime only orchestrates transport.
8. **Multi-Engine Support Path**: extend non-Postgres adapters with the same trait (cursor to `Vec<Value>`). For document/graph databases, adapters emit per-batch metadata describing structural columns (e.g., `_id`, nested fields) so the frontend can render hierarchical data. The channel protocol remains engine-agnostic.

### 2. Frontend (TypeScript, `src/services`, `src/components/DataGridV2`)
1. **Channel Client** (`src/services/queryStreamClient.ts`): wrap `invoke("stream_query")` to obtain a `Channel` and expose an `AsyncIterable<QueryBatch>` interface. Bridge the channel messages into React via `ReadableStream` or callback.
2. **Shared Column Model**: extend `schemaCache`/`@/types/database` to surface `type_oid`, `db_type`, nullability, etc. `TableDataService` consumes this metadata and no longer performs per-cell normalization—simply stores raw values.
3. **Data Grid Binding**: update the DataGridV2 data source adapter to expect `QueryBatch` objects with `columns: ColumnMeta` and `rows: JsonValue[][]`. Rendering components read `column.db_type` to choose formatters (number localisation, JSON pretty print, binary badges, etc.). Introduce per-database formatters (Postgres, MySQL, MongoDB, Neo4j) encapsulated in a lookup keyed by `db_type` so new engines can register their own format rules without touching transport.
4. **Hook Updates** (`useTableData`, query panel stores): collapse duplicated parsing code; wire them to the new stream client so rows append as batches arrive. Introduce lightweight formatting utilities (pure TS) that operate only at render time, not during transport.
5. **UI Mapping & Cleanup Plan**: map every consumer (table preview, query results, saved query playback) to the new stream client. During rollout, add a cleanup checklist removing legacy managers (`QueryManager`, `streamingTableService`, redundant DTOs) once the new pipeline is wired. Track progress in a dedicated chore issue.
6. **Worker Offload**: introduce a shared query-stream worker that receives channel batches, performs optional lightweight parsing, and posts transferable `ArrayBuffer`s to the React layer. The grid subscribes to the worker via `BroadcastChannel`/`MessagePort` so main-thread rendering stays smooth under heavy streams.

### 3. Protocol Definition
- **Command**: `stream_query { connId, sql, pageSize } -> QueryChannelHandle`.
- **Messages**:
  - `Started { columns: QueryColumn[], estimated_rows?: number }`
  - `RowBatch { rows: JsonValue[][], row_offset: number }`
  - `Completed { total_rows: number, execution_time_ms: number }`
  - `Error { code: string, message: string }`
- **QueryColumn**: `{ name: string, db_type: string, nullable: boolean, type_oid?: number, type_category?: string }` (mirrors backend `ColumnMeta`).
- **Rows**: each cell is a JSON primitive or structured value (objects/arrays) with no additional wrapper.

### 4. Implementation Phases (AGGRESSIVE REFACTOR - NO FEATURE FLAGS)

**Strategy**: Direct replacement of slow code paths. No feature flags, no compatibility layers. Fast or bust.

#### Phase 1: Rip Out the Bottlenecks (Day 1-2)
**Goal**: Remove all performance-killing code immediately.

**Backend Changes** (`src-tauri/src`):
1. **DELETE `CellValue` struct entirely** from `types.rs`:
   - Remove `display_value: String` field (saves 300-400ms)
   - Remove `value_type: CellValueType` enum complexity
   - Replace with lightweight `StreamValue` enum:
     ```rust
     #[derive(Serialize, Deserialize)]
     pub enum StreamValue {
         Null,
         Bool(bool),
         I16(i16), I32(i32), I64(i64),
         F32(f32), F64(f64),
         Text(String),
         Bytes(Vec<u8>),        // For UUID/bytea/JSON raw
         Timestamp(i64),         // Microseconds since epoch
         Date(i32),              // Days since epoch
     }
     ```

2. **DELETE query wrapping logic** from `postgres/query.rs:189-257`:
   - Remove subquery wrapper `SELECT * FROM (subquery)`
   - Execute user queries directly (saves 100-150ms)
   - Only cast problematic types inline when truly needed

3. **REPLACE `window.emit` with `tauri::ipc::Channel`**:
   - Delete all `window.emit` calls in query execution
   - Create `stream_table_data` command using channels
   - Implement explicit termination: `StreamMessage::Success` / `Error`

4. **ADD metadata caching** to `ConnectionState`:
   ```rust
   pub struct ConnectionState {
       metadata_cache: DashMap<(String, String), Vec<ColumnMeta>>,
       prepared_stmts: DashMap<String, Statement>,
   }
   ```

5. **ADD DDL detection**:
   ```rust
   fn is_ddl(sql: &str) -> bool {
       let upper = sql.trim().to_uppercase();
       upper.starts_with("ALTER") || upper.starts_with("DROP")
           || upper.starts_with("CREATE") || upper.starts_with("TRUNCATE")
   }

   // After successful DDL execution:
   if is_ddl(&sql) {
       state.metadata_cache.clear();
   }
   ```

**Frontend Changes** (`src/services`):
6. **CREATE `queryStreamClient.ts`** - direct channel consumer:
   ```typescript
   export class QueryStreamClient {
     async *stream(params: QueryParams): AsyncGenerator<StreamBatch> {
       const channel = await invoke<Channel>('stream_table_data', params);

       for await (const msg of channel) {
         if (msg.type === 'Started') {
           this.columns = msg.columns;  // Cache metadata
         } else if (msg.type === 'Batch') {
           yield msg;
         } else if (msg.type === 'Success') {
           return;
         } else if (msg.type === 'Error') {
           throw new Error(msg.message);
         }
       }
     }
   }
   ```

7. **UPDATE `tableDataService.ts`** - remove normalization:
   - Delete `transformedRows` mapping logic (lines 147-150)
   - Store raw `StreamValue` arrays directly
   - Remove `BackendCellValue` conversion overhead

#### Phase 2: Lazy Formatting Layer (Day 3-4)
**Goal**: Format cells only when visible in viewport.

1. **CREATE formatter registry** (`src/utils/formatters.ts`):
   ```typescript
   type CellFormatter = (value: StreamValue, column: ColumnMeta) => string;

   const formatters: Record<string, CellFormatter> = {
     'int2': (v) => new Intl.NumberFormat().format(v as number),
     'int4': (v) => new Intl.NumberFormat().format(v as number),
     'int8': (v) => v.toString(),  // BigInt handling
     'float4': (v) => (v as number).toFixed(2),
     'float8': (v) => (v as number).toFixed(4),
     'timestamp': (v) => new Intl.DateTimeFormat('en-US', {
       dateStyle: 'short',
       timeStyle: 'medium'
     }).format(new Date((v as number) / 1000)),
     'uuid': (v) => formatUUID(v as Uint8Array),
     'jsonb': (v) => JSON.stringify(v, null, 2),
     'bytea': (v) => `<Binary ${(v as Uint8Array).length} bytes>`,
     'default': (v) => String(v),
   };

   export const formatCell = (value: StreamValue, column: ColumnMeta): string => {
     if (value === null) return '';
     const formatter = formatters[column.db_type] || formatters.default;
     return formatter(value, column);
   };
   ```

2. **UPDATE DataGridV2** to use lazy formatting:
   - Call `formatCell()` only in render function
   - Cache formatted values per cell using `useMemo` keyed by row/column ID
   - Defer formatting until cell scrolls into viewport

#### Phase 3: Binary Protocol Optimization (Day 5-7)
**Goal**: Use Postgres binary protocol for primitives.

1. **UPDATE query execution** to use `query_raw`:
   ```rust
   // In postgres/query.rs
   let stmt = client.prepare_typed(sql, &[]).await?;
   let row_stream = client.query_raw(&stmt, params).await?;

   let mut batch = Vec::with_capacity(256);
   while let Some(row) = row_stream.try_next().await? {
       let values = extract_binary_values(&row, &columns)?;
       batch.push(values);

       if batch.len() >= 256 {
           channel.send(StreamMessage::Batch { rows: batch.clone() }).await?;
           batch.clear();
       }
   }
   ```

2. **IMPLEMENT `extract_binary_values`**:
   - Use `row.try_get::<_, i32>()` for integers (no string conversion)
   - Use `row.try_get::<_, f64>()` for floats
   - Use `row.try_get::<_, &[u8]>()` for bytea/UUID
   - Convert timestamps to microseconds epoch

#### Phase 4: Connection & Schema Management (Day 8-10)
**Goal**: Proper caching and invalidation.

1. **IMPLEMENT prepared statement cache**:
   - Key: `(schema, table, columns_hash)`
   - Reuse statements across fetches
   - Clear on DDL or explicit refresh

2. **ADD schema versioning** (optional, if time permits):
   - Include `schema_hash` in `ColumnMeta`
   - Frontend validates hash matches before using cached data

#### Phase 5: Test & Benchmark (Day 11-14)
**Goal**: Validate 10x improvement.

1. **Benchmark suite**:
   - 13k rows: measure time-to-complete (target: <100ms)
   - 100k rows: measure time-to-first-batch (target: <50ms)
   - Memory profiling: ensure no leaks
   - Compare against TablePlus on identical queries

2. **Load testing**:
   - Concurrent queries on same connection
   - Large result sets (1M+ rows)
   - Complex types (arrays, JSON, custom types)

3. **Regression testing**:
   - All existing query types still work
   - Complex queries (JOINs, CTEs, window functions)
   - Edge cases (NULL handling, type casting, enums)

### 5. Tauri Transport Notes
- `tauri::ipc::Channel` (available since Tauri 1.4) supports high-frequency messaging without re-subscribing to the event bus per batch. It serializes payloads once and avoids global locks present in `Window::emit`.
- **Migration strategy**: **Direct replacement - no feature flags**. Delete `window.emit` calls immediately and replace with channel streaming. Fast or bust.
- **Bounded channels**: Use `Channel::bounded(256)` for back-pressure. Policy: sender awaits on full channel (back-pressure pauses DB fetches).
- **Concurrent queries**: Use connection pooling - each `stream_table_data` acquires dedicated connection from pool to avoid serialization.

## Performance Deep Dive & Revalidation

### Terminology Clarification
**Important**: This design **does not achieve true "zero-copy"**. `serde_json::Value` requires heap allocation per cell (1M rows × 20 cols = 20M allocations). The optimizations are:
- **Avoid eager buffering**: Stream rows incrementally vs loading entire result set
- **Eliminate string materialization**: No `display_value` pre-computation; let frontend format on-demand
- **Reduce copy operations**: Driver → Rust uses binary protocol where possible

### Optimization Techniques
- **Driver-level streaming**: use `Client::query_raw` with binary row formats and pipeline mode to keep the socket saturated. For PostgreSQL, enable `portal.query` with `SIMPLE_THRESHOLD = 0` so prepared statements stay in binary mode; recycle the prepared portal across fetches to skip round trips.
- **Minimal-copy buffers**: reuse `BytesMut`/`Vec<u8>` slabs inside adapters; convert to `serde_bytes::ByteBuf` without cloning. Where JSON parsing is required (e.g., jsonb), forward the raw bytes and let the frontend lazy-parse on demand.
- **Chunk sizing heuristics**: start at 4–8 KB batches (~256 rows for narrow schemas) and auto-tune based on observed serialization cost; expose adapter hints so heavy columns (large JSON/BLOB) shrink batch size to protect frame time.
- **Worker handoff in the UI**: hydrate streaming batches inside a dedicated Web Worker (or SharedWorker) that feeds the React store via transferable `ArrayBuffer`s. This keeps the main thread free for rendering and ensures progressive paint beats TablePlus under large result sets.
- **Viewport virtualization**: ensure DataGridV2 stays in row-virtualized mode with column-level virtualization for wide payloads. Defer expensive formatters until cells enter the viewport; cache formatter output keyed by `(rowId, columnId, revision)` to avoid recompute while scrolling.
- **Back-pressure policy**: use bounded channels (`Channel::bounded(4)`) plus cooperative `await` on the sender. If the UI cannot drain fast enough, adapters pause fetches to prevent memory blow-up while still beating TablePlus’s eager buffering approach.
- **TablePlus comparison plan**: capture benchmarks on identical hardware using `SELECT *` against tables with varying row counts (13k, 100k, 1M rows) and deep JSON documents. Measure:
  - **Time-to-first-row**: How quickly first batch appears (target: <50ms)
  - **Time-to-13k-rows**: Total query time for typical workload (target: <100ms to match/beat TablePlus)
  - **Time-to-visible-10k rows**: Progressive rendering latency
  - **Memory footprint**: Peak RSS during streaming
  - **CPU utilization**: Serialization + parsing overhead
  - **Realistic target**: ≥20% better p95 latency than TablePlus (achievable with proposed optimizations)
  - **Stretch goal**: 30% memory reduction (requires columnar storage like Apache Arrow - defer to future)
- **Document/graph engines**: leverage streaming traversal (e.g., Mongo `find` with `batchSize`, Neo4j `BOLT` pull-many`). Keep the same binary-to-JSON pipeline so non-tabular data streams with equal efficiency.

## Additional Considerations (Must Document)

### Connection Lifecycle During Streaming
**Issue**: If database connection drops mid-stream (network timeout, server restart), channel sender errors.

**Required**: Add `StreamMessage::Interrupted { resumable: bool }` so adapters can signal resume capability (e.g., via SQL cursors with `DECLARE CURSOR ... WITH HOLD`).

### Concurrent Query Handling
**Issue**: If user runs 3 queries simultaneously on one connection, Postgres serializes them.

**Options**:
1. **Connection pooling** (recommended): Each `stream_query` acquires a connection from pool
2. **Document serialization**: Clearly state that concurrent queries on same connection will block

**Decision needed**: Specify in Phase 1.

### Large Object (LOB) Streaming
**Issue**: Postgres bytea/jsonb can exceed 1GB. Loading into memory will OOM.

**Required**: Add truncation policy for grid display (e.g., LIMIT 1MB per cell) or implement stream-to-disk for large columns. Document that TablePlus also truncates LOBs.

### Error Granularity
**Issue**: A batch might partially succeed (first 100 rows OK, row 101 has type coercion error).

**Recommendation**: Protocol should support `RowBatch` + inline warnings array. Consider whether to abort query on first error or continue with nulls + warnings.

## Decisions & Follow-ups
- **Metadata for multi-table/expr queries**: fall back to on-the-fly metadata extraction (prepare statement output) when introspection cannot provide a single-table mapping.
- **Per-database formatters**: required. Implement a formatter registry so each engine can encode its display rules (dates, numeric precision, document projections) without branching in transport.
- **Flow control/back-pressure**: start with the channel's bounded capacity (e.g., `Channel::bounded(n)`) and clamp batch size. This still yields best performance because we avoid unnecessary buffering while preventing the UI thread from being overwhelmed. If profiling shows contention, tune batch size + channel capacity per adapter.
- **NoSQL protocol extensions**: Current `QueryColumn` is flat; defer document/graph engines to v2.0 which will add nested/structural descriptors.

## Validation Strategy
- Benchmarks: measure round-trip latency and CPU usage executing `SELECT * FROM large_table LIMIT 1e5` before/after refactor.
- Functional: reuse existing integration tests, add streaming snapshots ensuring `RowBatch` aligns with metadata for JSON/UUID/binary edge cases.
- UI: manual verification that DataGrid renders progressively as batches arrive and honour column type formatting across all supported databases.

---

## Quick Start Checklist 🚀

### Day 1: Delete the Bottlenecks
- [ ] Delete `display_value: String` from `CellValue` struct in `src-tauri/src/types.rs`
- [ ] Create new `StreamValue` enum (see Phase 1)
- [ ] Delete query wrapping logic from `postgres/query.rs:189-257`
- [ ] Add metadata cache to `ConnectionState`

### Day 2: Channel Streaming
- [ ] Create `stream_table_data` Tauri command with `Channel` parameter
- [ ] Implement `StreamMessage` enum with `Started/Batch/Success/Error`
- [ ] Delete all `window.emit` calls in query path
- [ ] Add DDL detection and cache invalidation

### Day 3-4: Frontend
- [ ] Create `queryStreamClient.ts` with AsyncGenerator interface
- [ ] Update `tableDataService.ts` to use stream client
- [ ] Create formatter registry in `src/utils/formatters.ts`
- [ ] Update DataGridV2 to format cells lazily

### Day 5-7: Binary Protocol
- [ ] Switch from `query()` to `query_raw()` in Postgres adapter
- [ ] Implement `extract_binary_values()` helper
- [ ] Test all data types in binary mode

### Day 8-10: Polish
- [ ] Add prepared statement caching
- [ ] Implement connection pooling for concurrent queries
- [ ] Test edge cases (NULLs, complex types, large results)

### Day 11-14: Benchmark
- [ ] Run 13k row query benchmark (target: <100ms)
- [ ] Compare against TablePlus
- [ ] Memory profiling
- [ ] Load testing with concurrent queries

**Success Criteria**: 13k rows in <100ms ✅
