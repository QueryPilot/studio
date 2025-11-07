import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { databaseService } from "@/services/databaseService";
import type {
  TableStructure,
  TableStructureOptions,
} from "@/types/tableStructure";
import { tableStructureQueryKey } from "./queryKeys";

interface UseTableFullStructureParams {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  options?: TableStructureOptions;
  enabled?: boolean;
}

interface UseTableFullStructureReturn {
  structure: TableStructure | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export interface TableStructureQueryParams {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  options?: TableStructureOptions;
}

export async function fetchTableStructure(
  params: TableStructureQueryParams,
): Promise<TableStructure> {
  const { connectionId, database, schema, table, options } = params;

  if (!connectionId || !database || !table) {
    throw new Error("Connection, database, and table are required");
  }

  await databaseService.connectById(connectionId);

  return databaseService.getTableStructure(
    connectionId,
    database,
    schema,
    table,
    options,
  );
}

const defaultStructureOptions: TableStructureOptions = {
  includeIndexes: false,
  includeConstraints: false,
  includeTriggers: false,
  includeStatistics: false,
  includeForeignKeys: false,
};

function normalizeOptions(options?: TableStructureOptions): TableStructureOptions {
  if (!options) {
    return { ...defaultStructureOptions };
  }

  return {
    includeIndexes: options.includeIndexes ?? false,
    includeConstraints: options.includeConstraints ?? false,
    includeTriggers: options.includeTriggers ?? false,
    includeStatistics: options.includeStatistics ?? false,
    includeForeignKeys: options.includeForeignKeys ?? false,
  };
}

export function useTableFullStructure({
  connectionId,
  database,
  table,
  schema = "public",
  options,
  enabled = true,
}: UseTableFullStructureParams): UseTableFullStructureReturn {
  const queryClient = useQueryClient();

  const normalizedOptions = useMemo(
    () => normalizeOptions(options),
    [options],
  );

  const queryKey = tableStructureQueryKey({
    connectionId,
    database,
    schema,
    table,
    options: normalizedOptions as any,
  });

  const shouldEnable =
    enabled && Boolean(connectionId && database && table && schema);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey,
    queryFn: () =>
      fetchTableStructure({
        connectionId,
        database,
        schema,
        table,
        options: normalizedOptions,
      }),
    enabled: shouldEnable,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    structure: data ?? null,
    isLoading: shouldEnable && (isPending || isFetching),
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refresh,
  };
}

export function useTableColumns(params: UseTableFullStructureParams) {
  const { structure, isLoading, error } = useTableFullStructure({
    ...params,
    options: {
      ...params.options,
      includeIndexes: false,
      includeConstraints: false,
      includeTriggers: false,
      includeStatistics: false,
    },
  });

  return {
    columns: structure?.columns || [],
    isLoading,
    error,
  };
}

export function useTableForeignKeys(params: UseTableFullStructureParams) {
  const { structure, isLoading, error } = useTableFullStructure({
    ...params,
    options: {
      ...params.options,
      includeForeignKeys: true,
      includeConstraints: true,
    },
  });

  return {
    foreignKeys: structure?.foreignKeys || [],
    isLoading,
    error,
  };
}

export function useTableStatistics(params: UseTableFullStructureParams) {
  const { structure, isLoading, error, refresh } = useTableFullStructure({
    ...params,
    options: {
      ...params.options,
      includeStatistics: true,
    },
  });

  return {
    stats: structure?.stats,
    rowCount: structure?.rowCount,
    tableSize: structure?.size,
    isLoading,
    error,
    refresh,
  };
}
