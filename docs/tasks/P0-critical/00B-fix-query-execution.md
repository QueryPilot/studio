# P0-00B: Fix Query Execution (IMMEDIATE BLOCKER)

## Priority
P0 - CRITICAL BLOCKER (Queries cannot be executed at all)

## Dependencies
None - This is an immediate fix needed before any other work

## Estimated Effort
1-2 hours

## Problem Statement
The frontend is incorrectly trying to use `@tauri-apps/plugin-sql` directly, which fails with permission error: `sql.load not allowed`. The backend already has the `execute_db_query` command implemented, but the frontend isn't using it.

## Current State Issues
- **Frontend uses wrong approach**: Tries to use Tauri SQL plugin directly
- **Permission error**: `sql.load not allowed` - SQL plugin not configured
- **Backend command exists but unused**: `execute_db_query` is already implemented
- **Queries cannot be executed at all**: Complete functionality breakdown

## Root Cause
The `queryService.ts` is using:
```typescript
import Database from '@tauri-apps/plugin-sql';
db = await Database.load(connectionString);
const result = await db.select(query);
```

Instead of:
```typescript
import { invoke } from '@tauri-apps/api/tauri';
const result = await invoke('execute_db_query', { 
  connectionId, 
  query 
});
```

## Acceptance Criteria
- [ ] Query execution works without permission errors
- [ ] Frontend uses backend `execute_db_query` command
- [ ] Remove dependency on `@tauri-apps/plugin-sql`
- [ ] Connection management uses backend commands
- [ ] Results are properly displayed in QueryResults component

## Implementation Plan

### 1. Update queryService.ts
```typescript
// src/services/queryService.ts
import { invoke } from '@tauri-apps/api/tauri';
import { DatabaseConnection } from '@/types/database';

export interface QueryResult {
  columns: string[];
  rows: any[];
  rowCount: number;
  queryTime: number;
}

export interface QueryError {
  message: string;
  code?: string;
  details?: string;
}

class QueryService {
  async executeQuery(
    connection: DatabaseConnection,
    query: string
  ): Promise<QueryResult> {
    const startTime = performance.now();
    
    try {
      // First ensure connection exists in backend
      await invoke('create_db_connection', {
        connectionId: connection.id,
        connectionConfig: {
          db_type: connection.type,
          host: connection.host,
          port: connection.port,
          user: connection.username,
          password: connection.password,
          database: connection.database,
          ssl_mode: connection.ssl
        }
      });

      // Execute query using backend command
      const result = await invoke<any>('execute_db_query', {
        connectionId: connection.id,
        query
      });
      
      const queryTime = Math.round(performance.now() - startTime);

      // Backend returns data in a different format, need to transform
      return {
        columns: result.columns || [],
        rows: result.rows || [],
        rowCount: result.rows?.length || 0,
        queryTime
      };
    } catch (error: any) {
      throw this.formatError(error);
    }
  }

  async testConnection(connection: DatabaseConnection): Promise<boolean> {
    try {
      // Create connection in backend
      await invoke('create_db_connection', {
        connectionId: connection.id,
        connectionConfig: {
          db_type: connection.type,
          host: connection.host,
          port: connection.port,
          user: connection.username,
          password: connection.password,
          database: connection.database,
          ssl_mode: connection.ssl
        }
      });

      // Test the connection
      const result = await invoke<boolean>('test_db_connection', {
        connectionId: connection.id
      });
      
      return result;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async closeConnection(connectionId: string): Promise<void> {
    try {
      await invoke('close_db_connection', { connectionId });
    } catch (error) {
      console.error('Failed to close connection:', error);
    }
  }

  private formatError(error: any): QueryError {
    if (typeof error === 'string') {
      return { message: error };
    }
    
    return {
      message: error.message || 'Unknown error occurred',
      code: error.code,
      details: error.details || error.stack
    };
  }
}

export const queryService = new QueryService();
```

### 2. Remove SQL Plugin Dependency
```bash
# Remove the plugin from package.json
pnpm remove @tauri-apps/plugin-sql
```

### 3. Update Connection Flow
The connection flow needs to be updated to:
1. Store connection config securely using `store_connection` 
2. Create database connection in backend using `create_db_connection`
3. Execute queries using `execute_db_query`
4. Close connections properly using `close_db_connection`

### 4. Verify Backend Response Format
Check what format `execute_db_query` returns and adjust the frontend accordingly:
```rust
// src-tauri/src/database/mod.rs
// Need to verify the return type of execute_db_query
```

## Files to Modify
- `src/services/queryService.ts` - Complete rewrite to use backend commands
- `package.json` - Remove `@tauri-apps/plugin-sql` dependency
- `src/components/QueryWorkspace.tsx` - Ensure it handles new response format
- `src/components/QueryResults.tsx` - Verify it displays results correctly

## Testing Requirements
1. **Manual Testing**
   - Connect to a database
   - Execute a SELECT query
   - Execute an INSERT/UPDATE query
   - Handle query errors gracefully
   - Test connection closing

2. **Queries to Test**
   ```sql
   -- Simple SELECT
   SELECT * FROM users LIMIT 10;
   
   -- JOIN query
   SELECT u.name, p.title 
   FROM users u 
   JOIN posts p ON u.id = p.user_id;
   
   -- Aggregation
   SELECT COUNT(*) as total, 
          AVG(age) as avg_age 
   FROM users;
   
   -- Error case
   SELECT * FROM non_existent_table;
   ```

## Success Metrics
- Queries execute without permission errors
- Results display correctly in the UI
- Error messages are meaningful
- No console errors about SQL plugin

## Notes
- This is a CRITICAL BLOCKER - no queries can be executed until this is fixed
- The backend already has all necessary commands implemented
- This should be a quick fix that unblocks all database functionality
- After this fix, the backend refactor (P0-000) can proceed with proper architecture