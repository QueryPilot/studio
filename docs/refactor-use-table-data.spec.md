# Unified Streaming Table Data Hook Plan

## Background

- Two overlapping hooks (`src/hooks/useTableData.ts`, `src/components/DataGridV2/hooks/useInfiniteTableData.ts`) keep bespoke loading state, pagination, and connection checks, forcing every consumer to juggle duplicated logic.
- Both hooks orchestrate `tableDataService.loadTableData`, which still performs eager buffering and manual state updates instead of leveraging the streaming channel implemented in `queryStreamClient`/`streamingTableService`.
- Because we are not using React Query, there is no consistent caching or invalidation story across tabs; the Data Grid re-fetches on every mount, and refresh semantics are ad-hoc.
- We now have a backend streaming path (channel-based batches, progress notifications) that should drive both table/view/materialized view reads, but the current hooks only partially expose it and still treat pagination as offset polling.

## Goals

- Replace `useTableData` and `useInfiniteTableData` with a single React Query-powered hook that can fetch any tabular entity (table, view, materialized view) using the streaming backend.
- Surface progressive row delivery (batches) to the UI while letting React Query own caching, refetch, background refresh, and stale-time semantics.
- Preserve existing features (estimated totals, execution time, `loadMore`, `refresh`, connection guardrails) without bespoke local state.
- Offer a unified API that downstream adapters (e.g., `TableDataGridV2`) can consume without special cases for entity type.
- Keep non-Tauri/browser fallback behaviour predictable (graceful no-stream stub with clear errors).

## Out of Scope / Non-Goals

- Rewriting backend streaming contracts (`stream_query`) beyond minor adjustments needed for pagination.
- Changing Data Grid editing behaviours or virtualization internals (they will simply consume the new hook output).
- Introducing server-side filtering/sorting that does not already exist in `TableDataParams`; we will continue to pass through filter/sort arguments.

## Proposed Hook API

```ts
interface UseTableDataQueryParams {
  connectionId: string;
  database: string;
  schema?: string;
  entityName: string; // table/view/materialized view identifier
  entityType: "table" | "view" | "materialized_view";
  select?: string[];
  filters?: FilterConfig;
  sorts?: SortConfig[];
  limit?: number;
  pageSize?: number; // batch size per stream page, default 1000
  rowLimit?: number; // optional hard cap for streaming to protect memory
  enabled?: boolean;
}

interface TableDataPage {
  rows: TableDataRow[];
  columns: ColumnMeta[];
  nextCursor?: string | null;
  estimatedTotal?: number;
  executionTimeMs?: number;
}

interface UseTableDataQueryResult {
  data: InfiniteData<TableDataPage> | undefined;
  rows: TableDataRow[]; // flattened convenience accessor
  columns: ColumnMeta[];
  status: "idle" | "loading" | "success" | "error";
  error: unknown;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<QueryObserverResult<TableDataPage>>;
  cancelStream: () => void; // abort active stream from UI
  progress: {
    rowsFetched: number;
    totalRows?: number;
    percentage?: number;
    executionTimeMs?: number;
  };
}
```

- Consumers will typically destructure `{ rows, columns, fetchNextPage, hasNextPage, progress }`.
- `rows` is the flattened aggregation of all loaded pages so existing Data Grid code does not need to understand React Query's page structure.

## Data Flow & Architecture

1. **Query key**: `tableDataQueryKey = ["tableData", connectionId, database, schema ?? null, entityType, entityName, serializeFilters(filters), serializeSorts(sorts), limit, pageSize];` to ensure cache separation across tables and filter states.
2. **Query function**: uses `useInfiniteQuery` with an async `streamPageFetcher` that wraps the streaming service. Each call receives `pageParam` containing `{ offset: number; cursor?: string | null; }`.
3. **Streaming integration**:
   - `streamPageFetcher` calls a new `tableStreamingService.streamEntityPage(params, { onBatch, signal })` helper that:
     - Builds SQL for the given entity type (table/view/mview) with limit/offset/filter/sort.
     - Uses `queryStreamClient.streamWithCallbacks` to receive `started`, `batch`, `success`, `error` events.
     - Pushes each batch via a supplied callback so we can immediately `queryClient.setQueryData` and append rows for optimistic UI updates while the stream is still open.
     - Resolves with `{ rows, columns, nextCursor, estimatedTotal, executionTimeMs }` once the backend signals success.
   - Streams are aborted when React Query cancels (`signal.aborted`), calling a `cancel()` hook on the underlying streaming client to release resources.
4. **Flattening**: use the `select` option on `useInfiniteQuery` to transform page arrays into `{ ...result, rows: pages.flatMap(...) }` so consumers receive aggregated rows while preserving per-page metadata internally for pagination.
5. **Connection health**: reuse existing `databaseService.getActiveConnection` to skip queries when inactive. The hook no longer manages timers; instead we expose an `enabled` flag so callers can disable the query when disconnected.
6. **Column metadata reuse**: share column shape with the existing table structure flow. Refactor `useTableFullStructure` onto React Query so it issues a single cached request per entity (replacing SWR). The streaming hook reads from the same `tableStructureQueryKey` when available, ensuring we do not fire duplicate metadata fetches and keeping column descriptions consistent across views.
7. **React Query Provider**: wrap `App` in `QueryClientProvider` (and optional `ReactQueryDevtools` behind dev flag) so the hook can run anywhere in the tree.
8. **Fallback (non-Tauri)**: if `isTauri()` is false, surface a clear error so web development mode knows streaming is unavailable (no more pagination fallback).
9. **Legacy removal**: delete `useTableData.ts`, `useInfiniteTableData.ts`, and the paginated Tauri commands, updating imports in `TableDataGridV2` and any other consumers to call the new hook.

## Implementation Roadmap

1. **Preparatory work**
   - Audit all current `useTableData`/`useInfiniteTableData` usages to understand dependency graph (expected: Table view, maybe query panel stubs).
   - Introduce `QueryClientProvider` in `src/main.tsx` with a shared `QueryClient` configured for streaming workloads (e.g., `defaultOptions.queries = { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1 }`).
2. **Service Layer**
   - Create `src/services/tableStreamingService.ts` (or extend existing `streamingTableService`) with a `streamEntityPage` method that accepts `{ connectionId, database, schema, entityType, entityName, offset, limit, filters, sorts, signal, onProgress, onBatch }`.
   - Ensure the service can map `entityType` to the appropriate SQL (`SELECT * FROM schema.entity` vs. `SELECT * FROM schema."entity"`). Reuse `TableDataParams` serialization helpers where possible.
   - Extract a shared `tableStructureQueryKey` + fetcher that returns `TableStructure`, powered by React Query. This replaces the SWR-based `useTableFullStructure` so all callers (including the streaming hook) hit the same cached request.
   - Confirm streaming callbacks update progress metrics (`rowsFetched`, `totalRows`, `percentage`, `executionTimeMs`).
3. **Hook Implementation**
   - Add `src/hooks/useTableDataQuery.ts` exporting the unified hook described above.
   - Use `useInfiniteQuery` with `initialPageParam: { offset: 0 }` and `getNextPageParam` deriving the next offset from `page.rows.length` unless `nextCursor` is present.
   - Before initiating a stream, read column metadata via `queryClient.ensureQueryData(tableStructureQueryKey(...))` so the hook reuses the structure cache when available and only falls back to stream-provided columns if structure loading is disabled.
   - Inside the query function, wire streaming batches to `queryClient.setQueryData` to append rows in-place so virtualization can render newly-arrived data even before the query promise resolves.
   - Expose a `cancelStream` callback by storing the cancel function in a ref and returning it via the hook result.
4. **Consumer Updates**
   - Refactor `src/components/DataGridV2/adapters/TableDataGridV2.tsx` (and any other hook consumers) to call `useTableDataQuery({ entityType: "table", ... })`, adapting to the new return shape.
   - Replace manual `setRows` sync logic with direct usage of `rows` from the hook (still allow local editing overlays to manage optimistic changes).
   - Update connection guard logic: rely on `enabled` flag and `error` from React Query instead of manual `useEffect` intervals.
5. **Cleanup**
   - Remove old hooks and any unused helpers (state refs, `tableDataService.loadTableData` wiring if superseded).
   - Drop the SWR dependency once `useTableFullStructure` has been migrated and ensure no other callers rely on it.
   - Adjust tests/docs referencing the old hooks (`data-grid-v2.spec.md`, etc.).
   - Ensure exported hook index files (if any) point to the new hook.

## Caching & Invalidation Strategy

- Default `staleTime` 30s so navigating between table and query tabs reuses cached data without immediate refetch.
- Manual `refetch` invalidates cache for the specific entity key. When schema changes (e.g., DDL), callers can call `queryClient.invalidateQueries(tableDataQueryKey(...))`.
- Integrate with existing table mutation flows by invalidating the matching query key upon successful write (future work: centralize in mutation utilities).

## Streaming Considerations

- Use a dedicated `AbortController` per page fetch so React Query cancellation stops the stream promptly.
- Guard against oversized datasets by supporting `rowLimit` and early terminating the stream once the limit is hit while signaling `hasNextPage = true` so the user can continue if desired.
- Buffer columns only once (first page). Subsequent pages reuse cached metadata; ensure validator checks metadata consistency and logs warnings if backend sends mismatched schemas.

## Testing Plan

- Unit-test the new hook with mocked `queryStreamClient` to ensure batches append correctly, cancellation works, and error states propagate.
- Smoke-test in Tauri dev: open table view, confirm streaming progress indicator updates, infinite scroll works, and cached data persists across tab switches.
- Browser-only (`pnpm dev`) fallback: verify the hook resolves using non-streaming fetch and the UI shows a clear warning/toast when streaming is unavailable.
- Regression checks: `pnpm lint`, `pnpm typecheck`, targeted component tests for Data Grid adapters (if present) or add new ones.

## Risks & Mitigations

- **Memory pressure** from buffering large tables: enforce `rowLimit` + virtualization, consider incremental GC by trimming cached pages after scroll (future enhancement).
- **React Query unfamiliarity**: document hook usage patterns and provide helper utilities for query keys to avoid ad-hoc string building.
- **Streaming errors mid-flight**: ensure `onError` tears down partial data gracefully and surfaces actionable error messages to the UI (pass through backend codes).
- **Non-Tauri environments**: provide clear error messages and fallbacks so web builds remain functional albeit without streaming acceleration.

## Open Questions

1. Should we expose raw `InfiniteData<TableDataPage>` to consumers for advanced pagination, or keep the flattened `rows` convenience only?
2. Do we need to support server-driven cursors in addition to offset pagination right away, or can we iterate once backend exposes cursor-based paging?
3. How will table mutations trigger invalidations—do we still rely on manual invalidation from stores, or introduce shared mutation helpers?
