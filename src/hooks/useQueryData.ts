import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { secureDatabaseService } from '@/services/secureDatabaseService';
import { cacheService } from '@/services/cacheService';

// Types based on the backend implementation
interface QueryOptions {
  pageSize?: number;
  timeout?: number;
  useCache?: boolean;
}

interface ColumnMeta {
  name: string;
  db_type: string;
  nullable: boolean;
  default?: string;
  is_pk: boolean;
  is_fk: boolean;
  ordinal: number;
  precision?: number;
  scale?: number;
}

interface QueryCursor {
  id: string;
  columns: ColumnMeta[];
  rows: any[][];
  total_rows?: number;
  is_complete: boolean;
}

interface QueryPageResult {
  rows: any[][];
  is_complete: boolean;
}

/**
 * Hook for executing SQL queries with caching and pagination support
 */
export function useQueryData(
  connectionId: string | null,
  sql: string,
  options: QueryOptions = {}
) {
  const { pageSize = 1000, useCache = true } = options;

  return useQuery({
    queryKey: ['query', connectionId, sql, pageSize],
    queryFn: async (): Promise<QueryCursor> => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      // Check cache first if enabled
      if (useCache) {
        const cached = cacheService.getQueryResult(connectionId, sql);
        if (cached) {
          // Convert cached result to expected format
          return {
            id: crypto.randomUUID(),
            columns: cached.columns.map(col => ({
              name: col,
              db_type: 'unknown',
              nullable: true,
              is_pk: false,
              is_fk: false,
              ordinal: 0,
            })),
            rows: cached.rows,
            total_rows: cached.rows.length,
            is_complete: true,
          };
        }
      }

      // Execute query through secure database service
      const queryResult = await secureDatabaseService.executeQuery(connectionId, sql.trim());
      
      // Convert to expected format
      const result: QueryCursor = {
        id: crypto.randomUUID(),
        columns: queryResult.columns.map((colName: string, index: number) => ({
          name: colName,
          db_type: 'unknown', // TODO: Get actual type from backend
          nullable: true,
          is_pk: false,
          is_fk: false,
          ordinal: index,
        })),
        rows: queryResult.rows as any[][],
        total_rows: queryResult.rowCount,
        is_complete: true,
      };

      // Cache the result if caching is enabled
      if (useCache) {
        cacheService.setQueryResult(connectionId, sql, {
          columns: result.columns.map(col => col.name),
          rows: result.rows,
          executionTime: Date.now(),
          timestamp: Date.now(),
        });
      }

      return result;
    },
    enabled: !!connectionId && !!sql.trim(),
    staleTime: 2 * 60 * 1000,  // 2 minutes
    gcTime: 5 * 60 * 1000,     // 5 minutes (was cacheTime in v4)
    retry: (failureCount, error) => {
      // Don't retry on syntax errors or similar
      const errorMessage = error?.toString().toLowerCase() || '';
      if (errorMessage.includes('syntax') || errorMessage.includes('permission')) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Hook for fetching more results from a paginated query
 */
export function useFetchMore(connectionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cursorId: _cursorId }: { cursorId: string }): Promise<QueryPageResult> => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      // For now, fetch more is not directly supported in the new architecture
      // Return empty result since queries return all results at once
      return {
        rows: [],
        is_complete: true,
      };
    },
    onSuccess: (data, { cursorId: _cursorId }) => {
      // Update the query cache with new rows
      queryClient.setQueryData(
        ['query', connectionId],
        (old: QueryCursor | undefined) => {
          if (!old) return old;
          
          return {
            ...old,
            rows: [...old.rows, ...data.rows],
            is_complete: data.is_complete,
          };
        }
      );

      // Invalidate related queries if complete
      if (data.is_complete) {
        queryClient.invalidateQueries({
          queryKey: ['query', connectionId],
        });
      }
    },
    onError: (error) => {
      console.error('Failed to fetch more results:', error);
    },
  });
}

/**
 * Hook for cancelling an ongoing query
 */
export function useCancelQuery(connectionId: string | null) {
  return useMutation({
    mutationFn: async ({ cursorId }: { cursorId: string }) => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      await secureDatabaseService.cancelQuery(connectionId, cursorId);
    },
    onSuccess: () => {
      console.log('Query cancelled successfully');
    },
    onError: (error) => {
      console.error('Failed to cancel query:', error);
    },
  });
}

/**
 * Hook for executing non-query SQL statements (INSERT, UPDATE, DELETE)
 */
export function useExecuteSQL(connectionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sql }: { sql: string }) => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      const rowsAffected = await secureDatabaseService.executeStatement(connectionId, sql.trim());

      return { rows_affected: rowsAffected };
    },
    onSuccess: () => {
      // Invalidate all cached queries for this connection
      // since the data might have changed
      if (connectionId) {
        cacheService.invalidateConnection(connectionId);
        queryClient.invalidateQueries({
          queryKey: ['query', connectionId],
        });
        queryClient.invalidateQueries({
          queryKey: ['table', connectionId],
        });
        queryClient.invalidateQueries({
          queryKey: ['schema', connectionId],
        });
      }
    },
    onError: (error) => {
      console.error('Failed to execute SQL:', error);
    },
  });
}