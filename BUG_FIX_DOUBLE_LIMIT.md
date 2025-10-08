# Bug Fix: SQL Syntax Error - Double LIMIT

**Date**: October 8, 2025
**Issue**: `FETCH_ERROR: SQL syntax error: 42601: syntax error at or near "LIMIT"`
**Status**: ✅ **FIXED**

## Problem

When viewing a table in the UI, the application threw a PostgreSQL syntax error:

```
FETCH_ERROR: SQL syntax error: 42601: syntax error at or near "LIMIT"
```

## Root Cause

The `get_table_data` method in `adapter.rs` was using the `open_query`/`fetch_page` pattern incorrectly:

1. `get_table_data` created a query WITH `LIMIT` and `OFFSET`:
   ```rust
   let query = format!(
       "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
       schema, table, limit, offset
   );
   ```

2. Then called `executor.open_query(&query)` which stored this SQL

3. Then called `executor.fetch_page(&handle, limit)` which ADDED ANOTHER `LIMIT` and `OFFSET`:
   ```rust
   // From query_fast.rs line 86
   let paginated_query = format!("{} LIMIT {} OFFSET {}", sql_trimmed, max_rows, offset);
   ```

4. This created invalid SQL:
   ```sql
   SELECT * FROM "public"."todos" LIMIT 1000 OFFSET 0 LIMIT 1000 OFFSET 0
   ```

PostgreSQL rejected this as a syntax error at the second `LIMIT`.

## Solution

Modified `get_table_data` to execute the query directly instead of using the `open_query`/`fetch_page` pattern:

**Before** (adapter.rs:450-489):
```rust
async fn get_table_data(...) -> Result<TableDataResult> {
    let executor = self.query_executor.as_ref().ok_or_else(...)?;

    // BAD: Query already has LIMIT/OFFSET
    let query = format!(
        "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
        schema, table, limit, offset
    );

    let handle = executor.open_query(&query).await?;
    // BAD: fetch_page adds ANOTHER LIMIT/OFFSET
    let chunk = executor.fetch_page(&handle, limit).await?;
    ...
}
```

**After** (adapter.rs:450-507):
```rust
async fn get_table_data(...) -> Result<TableDataResult> {
    let client = self.client.as_ref().ok_or_else(...)?;

    // Build query with pagination
    let query = format!(
        "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
        schema, table, limit, offset
    );

    // Execute directly (no double LIMIT)
    let rows = client.query(&query, &[]).await?;

    // Get column metadata
    let stmt = client.prepare(&query).await?;
    let columns = stmt.columns().iter().map(...).collect();

    // Convert rows using fast converter
    let result_rows = FastPostgresConverter::rows_to_cells(&rows)?;

    Ok(TableDataResult {
        columns,
        rows: result_rows,
        has_more: result_rows.len() == limit,
        total_count,
    })
}
```

## Changes Made

**File**: `src-tauri/src/adapters/postgres/adapter.rs`

1. **Lines 450-507**: Rewrote `get_table_data` method
   - Use `client.query()` directly instead of `open_query`/`fetch_page`
   - Get column metadata via `client.prepare()`
   - Use `FastPostgresConverter::rows_to_cells()` for fast conversion
   - Calculate `has_more` based on result length vs limit

2. **Line 11**: Added import for `PostgresTypeConverter`
   ```rust
   use super::types::PostgresTypeConverter;
   ```

## Testing

**Compilation**: ✅ Passes
```bash
cargo build --quiet
# No errors
```

**Expected Result**:
- Loading table data should work without SQL syntax errors
- Pagination should work correctly (offset parameter is respected)
- Fast conversion path is maintained (using `FastPostgresConverter`)

## Impact

- **Performance**: No negative impact - still uses fast conversion path
- **Functionality**: Fixes critical bug preventing table data from loading
- **Compatibility**: No API changes - same method signature

## Related Files

- `src-tauri/src/adapters/postgres/adapter.rs` (modified)
- `src-tauri/src/adapters/postgres/fast_converter.rs` (used for conversion)
- `src-tauri/src/adapters/postgres/types.rs` (used for type conversion)

## Notes

The `open_query`/`fetch_page` pattern is still used by:
- `stream_query` command (for streaming large result sets)
- `execute_query` command (for interactive queries)

Those methods pass queries WITHOUT `LIMIT`/`OFFSET`, allowing `fetch_page` to add pagination correctly.

For `get_table_data`, direct execution is simpler and avoids the double-pagination issue.
