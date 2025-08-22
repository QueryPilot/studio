# Cursor Management API Documentation

## Overview
The cursor management system enables efficient handling of large query results by fetching data in pages rather than loading everything into memory at once. This prevents memory issues and improves performance for queries returning thousands or millions of rows.

## Architecture

### Backend (Rust/Tauri)

#### CursorManager
Located in `src-tauri/src/database/cursor.rs`

**Key Components:**
- Maintains active cursors in thread-safe HashMap
- Automatic cleanup task removes idle cursors after 5 minutes
- Database-specific implementation strategies

**Database Strategies:**
- **PostgreSQL**: Server-side cursors using `DECLARE CURSOR` for true streaming
- **MySQL/SQLite**: Client-side pagination using `LIMIT/OFFSET`

#### Tauri Commands

```rust
// Begin a new paginated query
#[tauri::command]
async fn db_query_begin(
    connection_id: String,
    sql: String,
    params: Option<Vec<Value>>,
    opts: Option<QueryOptions>,
) -> Result<QueryBeginResponse, AppError>

// Fetch next page of results
#[tauri::command]
async fn db_query_fetch(
    cursor_id: String,
    page: usize,
    page_size: usize,
) -> Result<QueryFetchResponse, AppError>

// Close cursor and free resources
#[tauri::command]
async fn db_query_close(
    cursor_id: String,
) -> Result<(), AppError>
```

### Frontend (React/TypeScript)

#### usePaginatedQuery Hook
Located in `src/hooks/usePaginatedQuery.ts`

**Features:**
- Manages cursor lifecycle
- Page caching (up to 5 pages)
- Infinite scroll support
- Error handling with retry
- Automatic cleanup on unmount

**Usage:**
```typescript
const {
  result,      // Current data and metadata
  isLoading,   // Loading state
  error,       // Error message if any
  execute,     // Start query execution
  fetchNext,   // Fetch next page
  reset,       // Reset state
  close,       // Close cursor
} = usePaginatedQuery(sql, connectionId, {
  page_size: 1000,    // Rows per page
  timeout_ms: 30000,  // Query timeout
});
```

#### QueryDataViewer Component
Located in `src/components/QueryDataViewer.tsx`

Enhanced DataViewer wrapper supporting both static and paginated data.

**Props:**
```typescript
interface QueryDataViewerProps {
  // Static data mode
  data?: any[];
  columns?: string[];
  queryTime?: number;
  error?: string;
  
  // Paginated mode
  sql?: string;
  connectionId?: string;
  usePagination?: boolean;
  onExecute?: () => void;
  className?: string;
}
```

**Usage Examples:**

```typescript
// Static data (backward compatible)
<QueryDataViewer
  data={queryResults}
  columns={columnNames}
  queryTime={executionTime}
/>

// Paginated query
<QueryDataViewer
  sql="SELECT * FROM large_table"
  connectionId={activeConnection}
  usePagination={true}
  onExecute={() => console.log('Query started')}
/>
```

## Data Flow

1. **Query Initiation**
   - Frontend calls `db_query_begin` with SQL and options
   - Backend creates cursor, executes query, returns first page
   - Cursor ID returned for subsequent operations

2. **Page Fetching**
   - Infinite scroll triggers when user nears bottom
   - Frontend calls `db_query_fetch` with cursor ID
   - Backend returns next page of results
   - Frontend accumulates data for display

3. **Cleanup**
   - Manual: User navigates away, frontend calls `db_query_close`
   - Automatic: Backend cleanup task removes idle cursors after 5 minutes
   - On unmount: React cleanup effect closes cursor

## Performance Characteristics

### Memory Usage
- Frontend: Current page + up to 5 cached pages
- Backend: Only current page in memory
- Estimated: <100MB for 1M row result set

### Timing
- Initial query: Depends on database and query complexity
- Page fetch: Typically <500ms for 1000 rows
- Cleanup interval: 60 seconds
- Idle timeout: 5 minutes

### Limits
- Default page size: 1000 rows
- Max cached pages: 5
- No hard limit on total rows

## Error Handling

### Common Errors
- `CursorNotFound`: Cursor expired or invalid ID
- `QueryCancelled`: Query was cancelled by user
- `Timeout`: Query exceeded timeout limit
- `Database`: SQL errors or connection issues

### Recovery Strategies
- Retry button on error display
- Automatic reconnection for connection errors
- Graceful degradation for missing features

## Best Practices

1. **Use pagination for large results**
   - Enable for queries expected to return >10k rows
   - Especially important for `SELECT *` queries

2. **Set appropriate page sizes**
   - 1000 rows: Good default for most cases
   - 100-500 rows: For complex rows with many columns
   - 5000+ rows: For simple data with few columns

3. **Handle errors gracefully**
   - Show clear error messages
   - Provide retry options
   - Log errors for debugging

4. **Clean up resources**
   - Always close cursors when done
   - Rely on automatic cleanup as fallback
   - Monitor for cursor leaks in development

## Future Enhancements

1. **Bidirectional Navigation**
   - Support for previous page fetching
   - Jump to specific page

2. **Row Count Estimation**
   - Quick count queries for progress indication
   - EXPLAIN-based estimation for complex queries

3. **Advanced Caching**
   - Persistent cache across sessions
   - Smart prefetching based on scroll speed

4. **Export Integration**
   - Stream large exports without loading all data
   - Progress indication for exports