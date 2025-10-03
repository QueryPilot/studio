/**
 * React hook for fetching comprehensive table structure
 * Includes columns, indexes, constraints, triggers, and statistics
 */
import useSWR from "swr";
import { useCallback } from "react";
import { databaseService } from "@/services/databaseService";
import type {
  TableStructure,
  TableStructureOptions,
} from "@/types/tableStructure";

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

export function useTableFullStructure({
  connectionId,
  database,
  table,
  schema = "public",
  options = {},
  enabled = true,
}: UseTableFullStructureParams): UseTableFullStructureReturn {
  const { data, isLoading, error, mutate } = useSWR(
    enabled
      ? [
          "table-full-structure",
          connectionId,
          database,
          table,
          schema,
          options,
          enabled,
        ]
      : null,
    async () => {
      if (!connectionId || !database || !table || !enabled) return;

      try {
        // Ensure connection mapping is established
        await databaseService.connectById(connectionId);

        const fullStructure = await databaseService.getTableStructure(
          connectionId,
          database,
          schema,
          table,
          options,
        );
        console.log(">>>", "fullStructure", fullStructure);
        return fullStructure;
      } catch (err) {
        console.error("Error fetching table structure:", err);
        throw err;
      }
    },
  );

  const refresh = useCallback(async () => {
    try {
      // Ensure connection mapping is established
      await databaseService.connectById(connectionId);

      const fullStructure = await databaseService.getTableStructure(
        connectionId,
        database,
        schema,
        table,
        options,
      );
      console.log(">>>", "fullStructure", fullStructure);
      void mutate(fullStructure);
    } catch (err) {
      console.error("Error refreshing table structure:", err);
      throw err;
    }
  }, [mutate, connectionId, database, schema, table, options]);

  return {
    structure: data || null,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Helper hook to get just the columns (backward compatibility)
 */
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

/**
 * Helper hook to get foreign key relationships
 */
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

/**
 * Helper hook to get table statistics
 */
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
