# Execution Time Tracking

## Overview

Displays accurate database execution time in UI status bar (e.g., "12,887 rows • 45ms") for both query execution and table data viewing.

## Problem & Solution

**Issue**: Execution time showed "0ms" because it was retrieved after query state removal.

**Fix**: Store `execution_time_ms` in `PageChunk` before cleanup, then pass through data flow.

## Implementation

### Backend (Rust)

Added `execution_time_ms` field to data structures:
- `PageChunk` (src-tauri/src/types.rs:97)
- `TableDataResult` (src-tauri/src/types.rs:443)

**Timing captured in** `fetch_page()` (src-tauri/src/adapters/postgres/query_fast.rs:111):
```rust
if is_first_fetch {
    execution_time_ms = Some(state.created_at.elapsed().as_millis() as u64);
}
```

Measures: `BEGIN` + `DECLARE CURSOR` + first `FETCH` (matches TablePlus methodology)

### Frontend (TypeScript)

Data flow:
1. `TableDataResult.execution_time_ms` → `TableDataMetaEvent.execution_time`
2. `useTableDataQuery` → surfaces `executionTimeMs` per streamed page
3. `TableDataGridV2` adapter → feeds the status bar props
4. `DataGridStatusBar` → displays in UI

## Key Files

**Backend**: types.rs, query_fast.rs, adapter.rs, commands.rs
**Frontend**: backend.ts, tableDataTypes.ts, tableDataService.ts, tableDataTransform.ts, useTableDataQuery.ts, TableDataGridV2.tsx

## Result

✅ Table data: Shows real execution time
✅ Query execution: Shows real execution time
✅ Comparable to TablePlus timing
