import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { cacheService } from '@/services/cacheService';

// Types for filtering and sorting
export interface ColumnFilter {
  column: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than' | 'is_null' | 'is_not_null';
  value: string | number | boolean | null;
}

export interface SortConfig {
  column: string;
  direction: 'asc' | 'desc';
}

interface TableMeta {
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'materialized_view';
  row_estimate?: number;
  size_bytes?: number;
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

interface TableDataResult {
  columns: ColumnMeta[];
  rows: any[][];
  total_rows?: number;
  is_complete: boolean;
}

/**
 * Hook for fetching table schema information
 */
export function useTableSchema(
  connectionId: string | null,
  database?: string,
  schema?: string
) {
  return useQuery({
    queryKey: ['schema', connectionId, database, schema],
    queryFn: async (): Promise<TableMeta[]> => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      // Check cache first
      const cached = await cacheService.getSchema(connectionId);
      if (cached) {
        return cached.tables || [];
      }

      // Fetch from backend
      const result = await invoke<TableMeta[]>('db_list_tables', {
        connectionId,
        database: database || '',
        schema: schema || 'public',
      });

      // Cache the result
      await cacheService.setSchema(connectionId, result || [], [], []);

      return result || [];
    },
    enabled: !!connectionId,
    staleTime: 5 * 60 * 1000,  // 5 minutes
    gcTime: 10 * 60 * 1000,    // 10 minutes
  });
}

/**
 * Hook for fetching table column information
 */
export function useTableColumns(
  connectionId: string | null,
  database: string,
  schema: string,
  table: string
) {
  return useQuery({
    queryKey: ['columns', connectionId, database, schema, table],
    queryFn: async (): Promise<ColumnMeta[]> => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      const result = await invoke<ColumnMeta[]>('db_table_columns', {
        connectionId,
        database,
        schema,
        table,
      });

      return result || [];
    },
    enabled: !!connectionId && !!database && !!schema && !!table,
    staleTime: 10 * 60 * 1000,  // 10 minutes
    gcTime: 20 * 60 * 1000,     // 20 minutes
  });
}

/**
 * Hook for fetching table data with filtering and sorting
 */
export function useTableData(
  connectionId: string | null,
  schema: string,
  table: string,
  filters?: ColumnFilter[],
  sort?: SortConfig,
  pageSize: number = 100,
  offset: number = 0
) {
  const queryKey = ['table', connectionId, schema, table, filters, sort, pageSize, offset];

  return useQuery({
    queryKey,
    queryFn: async (): Promise<TableDataResult> => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      // Check cache first (only for first page with no filters/sort)
      if (offset === 0 && (!filters || filters.length === 0) && !sort) {
        const cached = cacheService.getTableData(connectionId, schema, table, offset, pageSize);
        if (cached) {
          return {
            columns: cached.columns.map(col => ({
              name: col,
              db_type: 'unknown',
              nullable: true,
              is_pk: false,
              is_fk: false,
              ordinal: 0,
            })),
            rows: cached.rows,
            total_rows: cached.totalCount,
            is_complete: cached.rows.length < pageSize,
          };
        }
      }

      // Build SQL query with filters and sort
      const sql = buildTableQuery(schema, table, filters, sort, pageSize, offset);

      // Execute query
      const result = await invoke<TableDataResult>('db_query_begin', {
        connectionId,
        sql,
        options: { pageSize },
      });

      // Cache the result (only first page with no filters/sort)
      if (offset === 0 && (!filters || filters.length === 0) && !sort) {
        await cacheService.setTableData(
          connectionId,
          schema,
          table,
          offset,
          pageSize,
          {
            columns: result.columns.map(col => col.name),
            rows: result.rows,
            totalCount: result.total_rows || result.rows.length,
            timestamp: Date.now(),
          }
        );
      }

      return result;
    },
    enabled: !!connectionId && !!schema && !!table,
    staleTime: 1 * 60 * 1000,   // 1 minute
    gcTime: 5 * 60 * 1000,      // 5 minutes
  });
}

/**
 * Hook for getting estimated row count of a table
 */
export function useTableRowCount(
  connectionId: string | null,
  database: string,
  schema: string,
  table: string
) {
  return useQuery({
    queryKey: ['row-count', connectionId, database, schema, table],
    queryFn: async (): Promise<number> => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      const result = await invoke<number>('db_estimate_count', {
        connectionId,
        database,
        schema,
        table,
      });

      return result || 0;
    },
    enabled: !!connectionId && !!database && !!schema && !!table,
    staleTime: 5 * 60 * 1000,   // 5 minutes
    gcTime: 15 * 60 * 1000,     // 15 minutes
  });
}

/**
 * Hook for optimistic cell updates
 */
export function useUpdateCell(
  connectionId: string | null,
  schema: string,
  table: string
) {
  const queryClient = useQueryClient();

  interface UpdateParams {
    rowId: string;
    column: string;
    newValue: any;
    value?: any;
    oldValue?: any;
  }

  return useMutation({
    mutationFn: async ({ rowId, column, newValue }: UpdateParams) => {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      const result = await invoke('db_update_cell', {
        connectionId,
        update: {
          row_id: rowId,
          column,
          value: newValue,
        },
      });

      return result;
    },
    onMutate: async ({ rowId, column, newValue, oldValue }: UpdateParams) => {
      // Cancel outgoing queries to prevent overwriting optimistic update
      await queryClient.cancelQueries({
        queryKey: ['table', connectionId, schema, table],
      });

      // Snapshot previous value
      const previous = queryClient.getQueryData(['table', connectionId, schema, table]);

      // Optimistically update the UI
      queryClient.setQueryData(['table', connectionId, schema, table], (old: any) => {
        if (!old || !old.rows) return old;

        const newRows = [...old.rows];
        const rowIndex = newRows.findIndex(row => {
          // Assuming first column contains row ID or use a different strategy
          return row[0] === rowId;
        });

        if (rowIndex >= 0) {
          const columnIndex = old.columns.findIndex((col: ColumnMeta) => col.name === column);
          if (columnIndex >= 0) {
            const newRow = [...newRows[rowIndex]];
            newRow[columnIndex] = newValue;
            newRows[rowIndex] = newRow;
          }
        }

        return { ...old, rows: newRows };
      });

      return { previous, rowId, column, oldValue };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(
          ['table', connectionId, schema, table],
          context.previous
        );
      }
      console.error('Failed to update cell:', error);
    },
    onSettled: () => {
      // Invalidate and refetch after mutation
      queryClient.invalidateQueries({
        queryKey: ['table', connectionId, schema, table],
      });

      // Also invalidate cache
      if (connectionId) {
        cacheService.invalidateTable(connectionId, schema, table);
      }
    },
  });
}

/**
 * Helper function to build SQL query with filters and sorting
 */
function buildTableQuery(
  schema: string,
  table: string,
  filters?: ColumnFilter[],
  sort?: SortConfig,
  limit?: number,
  offset?: number
): string {
  const quotedTable = `"${schema}"."${table}"`;
  let sql = `SELECT * FROM ${quotedTable}`;

  // Add WHERE clause for filters
  if (filters && filters.length > 0) {
    const whereConditions = filters.map(filter => {
      const quotedColumn = `"${filter.column}"`;
      
      switch (filter.operator) {
        case 'equals':
          return `${quotedColumn} = ${formatValue(filter.value)}`;
        case 'not_equals':
          return `${quotedColumn} != ${formatValue(filter.value)}`;
        case 'contains':
          return `${quotedColumn} ILIKE ${formatValue(`%${filter.value}%`)}`;
        case 'not_contains':
          return `${quotedColumn} NOT ILIKE ${formatValue(`%${filter.value}%`)}`;
        case 'starts_with':
          return `${quotedColumn} ILIKE ${formatValue(`${filter.value}%`)}`;
        case 'ends_with':
          return `${quotedColumn} ILIKE ${formatValue(`%${filter.value}`)}`;
        case 'greater_than':
          return `${quotedColumn} > ${formatValue(filter.value)}`;
        case 'less_than':
          return `${quotedColumn} < ${formatValue(filter.value)}`;
        case 'is_null':
          return `${quotedColumn} IS NULL`;
        case 'is_not_null':
          return `${quotedColumn} IS NOT NULL`;
        default:
          return `${quotedColumn} = ${formatValue(filter.value)}`;
      }
    });

    sql += ` WHERE ${whereConditions.join(' AND ')}`;
  }

  // Add ORDER BY clause
  if (sort) {
    sql += ` ORDER BY "${sort.column}" ${sort.direction.toUpperCase()}`;
  }

  // Add LIMIT and OFFSET
  if (limit) {
    sql += ` LIMIT ${limit}`;
  }
  if (offset) {
    sql += ` OFFSET ${offset}`;
  }

  return sql;
}

/**
 * Helper function to format SQL values
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}