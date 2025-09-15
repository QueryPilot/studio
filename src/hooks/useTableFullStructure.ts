/**
 * React hook for fetching comprehensive table structure
 * Includes columns, indexes, constraints, triggers, and statistics
 */
import { useState, useEffect, useCallback } from "react";
import { databaseService } from "@/services/databaseService";
import type { TableStructure, TableStructureOptions } from "@/types/tableStructure";

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
  const [structure, setStructure] = useState<TableStructure | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStructure = useCallback(async () => {
    if (!connectionId || !database || !table || !enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const fullStructure = await databaseService.getTableStructure(
        connectionId,
        database,
        schema,
        table,
        options
      );

      setStructure(fullStructure);
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : "Failed to load table structure";
      setError(errorMessage);
      console.error("Error fetching table structure:", err);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, table, schema, enabled]); // Removed options from deps

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    void fetchStructure();
  }, [fetchStructure]);

  return {
    structure,
    isLoading,
    error,
    refresh: fetchStructure,
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
    }
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
    }
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
    }
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