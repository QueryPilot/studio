# P0-004: Cursor Management for Paginated Queries

## Priority
P0 - Critical Foundation

## Dependencies
- P0-002: Query Cancellation (cursors need cancellation support)

## Estimated Effort
4-5 hours

## Problem Statement
Large query results load entirely into memory, causing performance issues and potential crashes. No way to incrementally fetch results or maintain query state across pages.

## Acceptance Criteria
- [ ] Backend maintains query cursors with unique IDs
- [ ] Fetch results in configurable page sizes (default 1000 rows)
- [ ] Frontend can request next/previous pages
- [ ] Cursor cleanup on timeout or explicit close
- [ ] Memory efficient - only current page in memory
- [ ] Progress indication for total rows (when possible)

## Implementation Notes

### Backend (Rust)
```rust
// src-tauri/src/database/cursor.rs
pub struct QueryCursor {
    pub id: String,
    pub sql: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<String>>,  // Current page only
    pub page_size: usize,
    pub current_page: usize,
    pub total_rows: Option<usize>,
    pub is_complete: bool,
    pub created_at: Instant,
    pub last_accessed: Instant,
    
    // Database-specific cursor state
    cursor_name: Option<String>,  // PostgreSQL
    transaction: Option<Transaction>,  // Keep transaction alive
}

pub struct CursorManager {
    cursors: Arc<RwLock<HashMap<String, QueryCursor>>>,
    cleanup_interval: Duration,
}

impl CursorManager {
    pub async fn create_cursor(
        &self,
        sql: String,
        page_size: usize,
        pool: &DatabasePool,
    ) -> Result<QueryCursor, AppError> {
        let cursor_id = Uuid::new_v4().to_string();
        
        match pool {
            DatabasePool::Postgres(pg_pool) => {
                // Use server-side cursor for PostgreSQL
                let mut tx = pg_pool.begin().await?;
                let cursor_name = format!("cursor_{}", cursor_id);
                
                // Create cursor
                let declare = format!("DECLARE {} CURSOR FOR {}", cursor_name, sql);
                sqlx::query(&declare).execute(&mut tx).await?;
                
                // Fetch first page
                let fetch = format!("FETCH {} FROM {}", page_size, cursor_name);
                let rows = sqlx::query(&fetch).fetch_all(&mut tx).await?;
                
                // Extract columns and convert to strings
                let columns = extract_column_metadata(&rows);
                let string_rows = rows_to_strings(&rows, &columns);
                
                let cursor = QueryCursor {
                    id: cursor_id.clone(),
                    sql,
                    columns,
                    rows: string_rows,
                    page_size,
                    current_page: 0,
                    total_rows: None,  // Will be set asynchronously
                    is_complete: rows.len() < page_size,
                    created_at: Instant::now(),
                    last_accessed: Instant::now(),
                    cursor_name: Some(cursor_name),
                    transaction: Some(tx),
                };
                
                self.cursors.write().await.insert(cursor_id, cursor.clone());
                Ok(cursor)
            }
            DatabasePool::MySql(_) | DatabasePool::Sqlite(_) => {
                // Client-side pagination for MySQL/SQLite
                let limit_sql = format!("{} LIMIT {} OFFSET 0", sql, page_size);
                let rows = sqlx::query(&limit_sql).fetch_all(pool).await?;
                
                // Similar processing...
            }
        }
    }
    
    pub async fn fetch_next(
        &self,
        cursor_id: String,
    ) -> Result<QueryPage, AppError> {
        let mut cursors = self.cursors.write().await;
        let cursor = cursors.get_mut(&cursor_id)
            .ok_or(AppError::CursorNotFound)?;
        
        cursor.last_accessed = Instant::now();
        
        if cursor.is_complete {
            return Ok(QueryPage {
                rows: vec![],
                page: cursor.current_page,
                is_complete: true,
            });
        }
        
        // Fetch next page
        match &cursor.transaction {
            Some(tx) => {
                let fetch = format!("FETCH {} FROM {}", 
                    cursor.page_size, 
                    cursor.cursor_name.as_ref().unwrap()
                );
                let rows = sqlx::query(&fetch).fetch_all(tx).await?;
                
                cursor.current_page += 1;
                cursor.rows = rows_to_strings(&rows, &cursor.columns);
                cursor.is_complete = rows.len() < cursor.page_size;
                
                Ok(QueryPage {
                    rows: cursor.rows.clone(),
                    page: cursor.current_page,
                    is_complete: cursor.is_complete,
                })
            }
            None => {
                // Client-side pagination
                let offset = (cursor.current_page + 1) * cursor.page_size;
                let limit_sql = format!("{} LIMIT {} OFFSET {}", 
                    cursor.sql, cursor.page_size, offset
                );
                // Execute and return...
            }
        }
    }
    
    pub async fn close_cursor(&self, cursor_id: String) -> Result<(), AppError> {
        if let Some(mut cursor) = self.cursors.write().await.remove(&cursor_id) {
            // Clean up database resources
            if let Some(cursor_name) = cursor.cursor_name {
                if let Some(tx) = cursor.transaction {
                    let close = format!("CLOSE {}", cursor_name);
                    sqlx::query(&close).execute(&tx).await?;
                    tx.rollback().await?;
                }
            }
        }
        Ok(())
    }
    
    // Background cleanup task
    pub fn start_cleanup_task(self: Arc<Self>) -> JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            
            loop {
                interval.tick().await;
                
                let now = Instant::now();
                let mut cursors = self.cursors.write().await;
                
                // Remove cursors older than 5 minutes
                cursors.retain(|_, cursor| {
                    now.duration_since(cursor.last_accessed) < Duration::from_secs(300)
                });
            }
        })
    }
}
```

### Frontend (TypeScript)
```typescript
// src/hooks/usePaginatedQuery.ts
interface PaginatedResult {
  cursorId: string;
  columns: ColumnMeta[];
  rows: string[][];
  currentPage: number;
  totalRows?: number;
  isComplete: boolean;
  isLoading: boolean;
}

export function usePaginatedQuery(
  sql: string,
  connectionId: string,
  pageSize = 1000
) {
  const [result, setResult] = useState<PaginatedResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const execute = useCallback(async () => {
    setIsLoading(true);
    
    try {
      const cursor = await invoke('db_query_begin', {
        connectionId,
        sql,
        pageSize,
      });
      
      setResult({
        cursorId: cursor.id,
        columns: cursor.columns,
        rows: cursor.rows,
        currentPage: 0,
        totalRows: cursor.totalRows,
        isComplete: cursor.isComplete,
        isLoading: false,
      });
    } finally {
      setIsLoading(false);
    }
  }, [sql, connectionId, pageSize]);
  
  const fetchNext = useCallback(async () => {
    if (!result || result.isComplete) return;
    
    setIsLoading(true);
    
    try {
      const page = await invoke('db_query_fetch', {
        cursorId: result.cursorId,
      });
      
      setResult(prev => ({
        ...prev!,
        rows: [...prev!.rows, ...page.rows],
        currentPage: page.page,
        isComplete: page.isComplete,
      }));
    } finally {
      setIsLoading(false);
    }
  }, [result]);
  
  const close = useCallback(async () => {
    if (!result) return;
    
    await invoke('db_query_close', {
      cursorId: result.cursorId,
    });
    
    setResult(null);
  }, [result]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (result?.cursorId) {
        invoke('db_query_close', { cursorId: result.cursorId });
      }
    };
  }, [result?.cursorId]);
  
  return {
    result,
    isLoading,
    execute,
    fetchNext,
    close,
  };
}
```

## Files to Modify
- Create `src-tauri/src/database/cursor.rs` - Cursor management
- `src-tauri/src/database/mod.rs` - Export cursor module
- `src-tauri/src/commands/database.rs` - Add cursor commands
- Create `src/hooks/usePaginatedQuery.ts` - React hook for pagination
- `src/components/QueryResults.tsx` - Use paginated results
- `src/components/DataViewer/DataViewer.tsx` - Integrate pagination

## Testing Requirements
1. **Unit Tests**
   - Test cursor creation and cleanup
   - Test page fetching logic
   - Test timeout cleanup

2. **Integration Tests**
   - Fetch 10k+ row result set
   - Navigate through pages
   - Verify memory usage stays constant

3. **Manual Testing**
   - Run large SELECT and page through
   - Close cursor mid-fetch
   - Test timeout cleanup

## Success Metrics
- Memory usage < 100MB for 1M row result
- Page fetch time < 500ms
- Automatic cleanup after 5 minutes
- Zero cursor leaks

## Notes
- Consider infinite scroll UX
- May need to estimate total rows for progress
- Different strategies per database type