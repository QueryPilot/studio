import { useState, useEffect, useCallback, useRef } from 'react';
import { tableDataService } from '@/services/tableDataService';
import type { 
  TableDataStream, 
  TableDataMeta, 
  SortSpec, 
  FilterSpec 
} from '@/types/tableData';

interface UseTableDataStreamOptions {
  connectionId: string;
  table: string;
  schema?: string;
  select?: string[];
  sorts?: SortSpec[];
  filters?: FilterSpec[];
  search?: string;
  limit?: number;
  autoFetch?: boolean;
}

interface UseTableDataStreamResult {
  meta?: TableDataMeta;
  rows: Record<string, any>[];
  loading: boolean;
  error?: Error;
  hasMore: boolean;
  fetchMore: () => Promise<void>;
  refresh: () => Promise<void>;
  updateFilters: (filters: FilterSpec[]) => Promise<void>;
  updateSorts: (sorts: SortSpec[]) => Promise<void>;
  updateSearch: (search?: string) => Promise<void>;
}

export function useTableDataStream(options: UseTableDataStreamOptions): UseTableDataStreamResult {
  const [meta, setMeta] = useState<TableDataMeta>();
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  
  const streamIdRef = useRef<string>();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetchData = useCallback(async (cursor?: string, append = false) => {
    console.log('[useTableDataStream] Starting fetch with options:', optionsRef.current);
    setLoading(true);
    setError(undefined);

    try {
      const stream = await tableDataService.fetchTableData(
        {
          connectionId: optionsRef.current.connectionId,
          table: optionsRef.current.table,
          schema: optionsRef.current.schema,
          select: optionsRef.current.select,
          sorts: optionsRef.current.sorts,
          filters: optionsRef.current.filters,
          search: optionsRef.current.search,
          cursor,
          limit: optionsRef.current.limit || 100
        },
        (stream) => {
          if (stream.meta) {
            setMeta(stream.meta);
          }
          
          if (stream.rows.length > 0) {
            if (append) {
              setRows(prev => [...prev, ...stream.rows]);
            } else {
              setRows(stream.rows);
            }
          }
          
          setNextCursor(stream.nextCursor);
          setHasMore(!!stream.nextCursor);
          
          if (stream.isComplete) {
            setLoading(false);
          }
          
          if (stream.error) {
            setError(new Error(stream.error.message));
            setLoading(false);
          }
        },
        (err) => {
          setError(err);
          setLoading(false);
        }
      );

      streamIdRef.current = stream.streamId;
    } catch (err) {
      setError(err as Error);
      setLoading(false);
    }
  }, []);

  const fetchMore = useCallback(async () => {
    if (!hasMore || loading || !nextCursor) return;
    await fetchData(nextCursor, true);
  }, [hasMore, loading, nextCursor, fetchData]);

  const refresh = useCallback(async () => {
    setRows([]);
    setNextCursor(undefined);
    await fetchData();
  }, [fetchData]);

  const updateFilters = useCallback(async (filters: FilterSpec[]) => {
    optionsRef.current.filters = filters;
    await refresh();
  }, [refresh]);

  const updateSorts = useCallback(async (sorts: SortSpec[]) => {
    optionsRef.current.sorts = sorts;
    await refresh();
  }, [refresh]);

  const updateSearch = useCallback(async (search?: string) => {
    optionsRef.current.search = search;
    await refresh();
  }, [refresh]);

  // Initial fetch
  useEffect(() => {
    if (options.autoFetch !== false && options.connectionId && options.table) {
      fetchData();
    }
  }, [options.connectionId, options.table, options.schema, options.autoFetch, fetchData]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (streamIdRef.current) {
        tableDataService.cancelStream(streamIdRef.current);
      }
    };
  }, []);

  return {
    meta,
    rows,
    loading,
    error,
    hasMore,
    fetchMore,
    refresh,
    updateFilters,
    updateSorts,
    updateSearch
  };
}