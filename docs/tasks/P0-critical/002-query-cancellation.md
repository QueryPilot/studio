# P0-002: Query Cancellation Mechanism

## Priority
P0 - Critical Foundation

## Dependencies
None - Independent foundation task

## Estimated Effort
3-4 hours

## Problem Statement
Long-running queries cannot be cancelled, forcing users to wait or restart the application. This is especially problematic for accidental cartesian joins or missing WHERE clauses.

## Acceptance Criteria
- [x] Backend tracks all active queries with unique IDs
- [x] Cancellation command immediately aborts query execution
- [x] Proper cleanup of database resources on cancellation
- [x] Frontend shows cancel button for running queries
- [x] User receives confirmation when query is cancelled
- [x] Cancelled queries don't affect other operations

## Status: ✅ COMPLETED ✨ FULLY IMPLEMENTED

### Implementation Summary
Query cancellation has been successfully implemented and is fully operational with the following components:

**Backend (Rust/Tauri):**
- `QueryExecutor` with abort handle registry and cancellation token support
- `db_query_cancel` Tauri command for cancelling queries
- Proper cleanup of database resources and connections

**Frontend (React/TypeScript):**
- Enhanced `useQueryStore` to track active queries in runtime
- `useExecuteQueryWithCancellation` hook for query execution with cancellation support
- Cancel buttons in QueryEditor and QueryTab components
- Real-time display of active queries with individual cancel options
- Graceful error handling and user feedback

**Key Features:**
- Queries are tracked with unique IDs from execution start
- Cancel buttons appear for all running queries
- Individual query cancellation and "Cancel All" functionality
- Visual feedback showing running queries in blue badges
- Proper cleanup of UI state after cancellation

## Implementation Notes

### Backend (Rust)
```rust
// src-tauri/src/database/query_executor.rs
pub struct QueryExecutor {
    abort_registry: Arc<RwLock<HashMap<String, AbortHandle>>>,
}

impl QueryExecutor {
    pub async fn execute_cancellable(
        &self,
        query_id: String,
        sql: String,
        pool: &DatabasePool,
    ) -> Result<QueryResult, AppError> {
        let (abort_handle, abort_registration) = AbortHandle::new_pair();
        
        // Register abort handle
        self.abort_registry.write().await
            .insert(query_id.clone(), abort_handle);
        
        // Execute with cancellation
        let query_future = Abortable::new(
            execute_query(sql, pool),
            abort_registration,
        );
        
        match query_future.await {
            Ok(result) => {
                self.abort_registry.write().await.remove(&query_id);
                result
            }
            Err(_aborted) => {
                Err(AppError::QueryCancelled)
            }
        }
    }
    
    pub async fn cancel_query(&self, query_id: String) -> Result<(), AppError> {
        if let Some(handle) = self.abort_registry.write().await.remove(&query_id) {
            handle.abort();
            Ok(())
        } else {
            Err(AppError::QueryNotFound)
        }
    }
}

// Tauri command
#[tauri::command]
pub async fn db_query_cancel(
    query_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<(), AppError> {
    registry.cancel_query(query_id).await
}
```

### Frontend (React/TypeScript)
```typescript
// src/stores/queryStore.ts
interface ActiveQuery {
  id: string;
  sql: string;
  startTime: Date;
  isCancellable: boolean;
}

export const useQueryStore = create<QueryStore>((set, get) => ({
  activeQueries: new Map<string, ActiveQuery>(),
  
  executeQuery: async (sql: string) => {
    const queryId = generateId();
    
    // Register as active
    set((state) => ({
      activeQueries: new Map(state.activeQueries).set(queryId, {
        id: queryId,
        sql,
        startTime: new Date(),
        isCancellable: true,
      })
    }));
    
    try {
      const result = await invoke('db_query_execute', { queryId, sql });
      return result;
    } finally {
      // Remove from active queries
      set((state) => {
        const queries = new Map(state.activeQueries);
        queries.delete(queryId);
        return { activeQueries: queries };
      });
    }
  },
  
  cancelQuery: async (queryId: string) => {
    await invoke('db_query_cancel', { queryId });
    
    set((state) => {
      const queries = new Map(state.activeQueries);
      queries.delete(queryId);
      return { activeQueries: queries };
    });
  },
}));

// src/components/QueryControls.tsx
export function QueryControls() {
  const { activeQueries, cancelQuery } = useQueryStore();
  
  return (
    <div className="flex gap-2">
      {Array.from(activeQueries.values()).map((query) => (
        <Button
          key={query.id}
          variant="destructive"
          size="sm"
          onClick={() => cancelQuery(query.id)}
        >
          Cancel Query
        </Button>
      ))}
    </div>
  );
}
```

## Files to Modify
- Create `src-tauri/src/database/query_executor.rs` - Query execution with cancellation
- `src-tauri/src/database/connection_manager.rs` - Integrate query executor
- `src-tauri/src/commands/database.rs` - Add cancel command
- `src/stores/queryStore.ts` - Track active queries
- `src/components/QueryControls.tsx` - Cancel button UI
- `src/components/QueryEditor.tsx` - Integrate query controls

## Testing Requirements
1. **Unit Tests**
   - Test abort handle registration/cleanup
   - Test cancellation during different query phases
   - Test multiple concurrent cancellations

2. **Integration Tests**
   - Cancel long-running SELECT query
   - Cancel during transaction
   - Verify resource cleanup after cancellation

3. **Manual Testing**
   - Run `SELECT pg_sleep(30)` and cancel
   - Cancel large table scan
   - Verify other queries continue working

## Success Metrics
- Query cancellation completes within 100ms
- No resource leaks after cancellation
- No impact on other active queries
- Clean error messages to user

## Notes
- Database-specific cancellation methods may be more efficient
- Consider progress reporting for long queries
- May need timeout in addition to manual cancellation