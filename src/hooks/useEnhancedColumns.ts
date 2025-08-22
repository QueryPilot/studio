import { useState, useEffect } from "react";
import { metadataCache } from "@/services/metadataCache";
import type { EnhancedColumnMeta } from "@/types/database";

interface UseEnhancedColumnsOptions {
  enabled?: boolean;
  onError?: (error: Error) => void;
}

interface UseEnhancedColumnsReturn {
  columns: EnhancedColumnMeta[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useEnhancedColumns(
  connectionId: string | null,
  schema: string,
  table: string,
  options: UseEnhancedColumnsOptions = {}
): UseEnhancedColumnsReturn {
  const { enabled = true, onError } = options;
  const [columns, setColumns] = useState<EnhancedColumnMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const fetchColumns = async () => {
    if (!connectionId || !enabled) {
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await metadataCache.getColumns(connectionId, schema, table);
      setColumns(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      console.error(`[useEnhancedColumns] Failed to fetch columns for ${schema}.${table}:`, error);
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    fetchColumns();
  }, [connectionId, schema, table, enabled]);
  
  return {
    columns,
    isLoading,
    error,
    refetch: fetchColumns,
  };
}

/**
 * Hook to prefetch metadata for multiple tables
 */
export function usePrefetchMetadata(
  connectionId: string | null,
  tables: Array<{ schema: string; table: string }>
) {
  useEffect(() => {
    if (!connectionId || tables.length === 0) {
      return;
    }
    
    // Prefetch in background
    metadataCache.prefetchTables(connectionId, tables).catch(err => {
      console.error('[usePrefetchMetadata] Prefetch failed:', err);
    });
  }, [connectionId, JSON.stringify(tables)]);
}