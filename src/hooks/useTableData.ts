import { useMutation, useQueryClient } from "@tanstack/react-query";
import { secureDatabaseService } from "@/services/secureDatabaseService";
import { cacheService } from "@/services/cacheService";
import { useTableDataStream } from "@/hooks/useTableDataStream";
import type { FilterSpec, SortSpec } from "@/types/tableData";

// Legacy types for backward compatibility
export interface ColumnFilter {
  column: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "starts_with"
    | "ends_with"
    | "greater_than"
    | "less_than"
    | "is_null"
    | "is_not_null";
  value: string | number | boolean | null;
}

export interface SortConfig {
  column: string;
  direction: "asc" | "desc";
}

// Convert legacy filter to new format
function convertFilter(filter: ColumnFilter): FilterSpec {
  const operatorMap: Record<string, FilterSpec['operator']> = {
    equals: "=",
    not_equals: "!=",
    contains: "LIKE",
    not_contains: "NOT LIKE",
    starts_with: "LIKE",
    ends_with: "LIKE",
    greater_than: ">",
    less_than: "<",
    is_null: "IS NULL",
    is_not_null: "IS NOT NULL",
  };
  
  let value = filter.value;
  if (filter.operator === "contains" || filter.operator === "not_contains") {
    value = `%${String(filter.value)}%`;
  } else if (filter.operator === "starts_with") {
    value = `${String(filter.value)}%`;
  } else if (filter.operator === "ends_with") {
    value = `%${String(filter.value)}`;
  }
  
  return {
    column: filter.column,
    operator: operatorMap[filter.operator] || "=",
    value,
  };
}

// Convert legacy sort to new format
function convertSort(sort: SortConfig): SortSpec {
  return {
    column: sort.column,
    direction: sort.direction === "asc" ? "asc" : "desc",
  };
}

interface TableMeta {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view";
  row_estimate?: number;
  size_bytes?: number;
}

// Using ColumnMeta from secureDatabaseService which returns the backend type
interface ColumnMeta {
  name: string;
  db_type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  is_fk: boolean;
  ordinal: number;
  precision?: number | null;
  scale?: number | null;
}

interface TableDataResult {
  columns: ColumnMeta[];
  rows: any[][];
  total_rows?: number;
  is_complete: boolean;
}

/**
 * Hook for fetching table column information
 */
export function useTableColumns(
  connectionId: string | null,
  database: string,
  schema: string,
  table: string,
) {
  const streamResult = useTableDataStream({
    connectionId: connectionId || '',
    table,
    schema,
    limit: 0, // Just get metadata
    autoFetch: !!connectionId && !!database && !!schema && !!table,
  });

  // Convert stream meta to column format
  const columns: ColumnMeta[] = streamResult.meta?.columns.map((col, index) => ({
    name: col.name,
    db_type: col.dbType,
    nullable: col.nullable,
    default: col.default || null,
    is_pk: col.isPk || false,
    is_fk: col.isFk || false,
    ordinal: index,
    precision: col.precision || null,
    scale: col.scale || null,
  })) || [];

  return {
    data: columns,
    isLoading: streamResult.loading,
    error: streamResult.error,
  };
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
  offset: number = 0,
) {
  // Convert legacy filters and sorts to new format
  const convertedFilters = filters?.map(convertFilter);
  const convertedSorts = sort ? [convertSort(sort)] : [];

  console.log('[useTableData] Using streaming with:', {
    connectionId,
    table,
    schema,
    filters: convertedFilters,
    sorts: convertedSorts,
    limit: pageSize,
    autoFetch: !!connectionId && !!schema && !!table
  });

  // Use the new streaming hook
  const streamResult = useTableDataStream({
    connectionId: connectionId || '',
    table,
    schema,
    filters: convertedFilters,
    sorts: convertedSorts,
    limit: pageSize,
    autoFetch: !!connectionId && !!schema && !!table,
  });

  // Convert stream result to legacy format
  const columns: ColumnMeta[] = streamResult.meta?.columns.map((col, index) => ({
    name: col.name,
    db_type: col.dbType,
    nullable: col.nullable,
    default: col.default || null,
    is_pk: col.isPk || false,
    is_fk: col.isFk || false,
    ordinal: index,
    precision: col.precision || null,
    scale: col.scale || null,
  })) || [];

  // Convert rows from object format to array format
  const rows: unknown[][] = streamResult.rows.map(row => {
    return columns.map(col => row[col.name] as unknown);
  });

  const result: TableDataResult = {
    columns,
    rows,
    total_rows: streamResult.rows.length,
    is_complete: !streamResult.hasMore,
  };

  return {
    data: result,
    isLoading: streamResult.loading,
    error: streamResult.error,
    refetch: streamResult.refresh,
    isFetching: streamResult.loading,
  };
}

/**
 * Hook for getting estimated row count of a table
 */
export function useTableRowCount(
  connectionId: string | null,
  database: string,
  schema: string,
  table: string,
) {
  // Use streaming hook with limit 0 to just get metadata
  const streamResult = useTableDataStream({
    connectionId: connectionId || '',
    table,
    schema,
    limit: 0,
    autoFetch: !!connectionId && !!database && !!schema && !!table,
  });

  return {
    data: streamResult.rows.length || 0, // Using actual row count
    isLoading: streamResult.loading,
    error: streamResult.error,
  };
}

/**
 * Hook for optimistic cell updates
 */
export function useUpdateCell(
  connectionId: string | null,
  schema: string,
  table: string,
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
        throw new Error("Connection ID is required");
      }

      // Use the new updateCell method
      const rowsAffected = await secureDatabaseService.updateCell(
        connectionId,
        {
          schema,
          table,
          column,
          pk: { id: rowId }, // TODO: This needs proper primary key handling
          newValue,
        },
      );

      return { rows_affected: rowsAffected };
    },
    onMutate: async ({ rowId, column, newValue, oldValue }: UpdateParams) => {
      // Cancel outgoing queries to prevent overwriting optimistic update
      await queryClient.cancelQueries({
        queryKey: ["table", connectionId, schema, table],
      });

      // Snapshot previous value
      const previous = queryClient.getQueryData([
        "table",
        connectionId,
        schema,
        table,
      ]);

      // Optimistically update the UI
      queryClient.setQueryData(
        ["table", connectionId, schema, table],
        (old: any) => {
          if (!old || !old.rows) return old;

          const newRows = [...old.rows];
          const rowIndex = newRows.findIndex((row) => {
            // Assuming first column contains row ID or use a different strategy
            return row[0] === rowId;
          });

          if (rowIndex >= 0) {
            const columnIndex = old.columns.findIndex(
              (col: ColumnMeta) => col.name === column,
            );
            if (columnIndex >= 0) {
              const newRow = [...newRows[rowIndex]];
              newRow[columnIndex] = newValue;
              newRows[rowIndex] = newRow;
            }
          }

          return { ...old, rows: newRows };
        },
      );

      return { previous, rowId, column, oldValue };
    },
    onError: (error, _variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(
          ["table", connectionId, schema, table],
          context.previous,
        );
      }
      console.error("Failed to update cell:", error);
    },
    onSettled: () => {
      // Invalidate and refetch after mutation
      queryClient.invalidateQueries({
        queryKey: ["table", connectionId, schema, table],
      });

      // Also invalidate cache
      if (connectionId) {
        cacheService.invalidateTable(connectionId, schema, table);
      }
    },
  });
}

