import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ColumnMeta {
  name: string;
  db_type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  is_fk: boolean;
  ordinal: number;
}

interface QueryOptions {
  page_size?: number;
  max_rows?: number;
  timeout_ms?: number;
}

interface QueryBeginResponse {
  cursor_id: string;
  columns: ColumnMeta[];
  rows: any[][];
  total_rows?: number;
  is_complete: boolean;
}

interface QueryFetchResponse {
  rows: any[][];
  page: number;
  is_complete: boolean;
}

interface PaginatedResult {
  cursorId: string;
  columns: ColumnMeta[];
  rows: any[][];
  currentPage: number;
  totalRows?: number;
  isComplete: boolean;
  hasMore: boolean;
}

interface UsePaginatedQueryReturn {
  result: PaginatedResult | null;
  isLoading: boolean;
  error: string | null;
  execute: () => Promise<void>;
  fetchNext: () => Promise<void>;
  fetchPrevious: () => Promise<void>;
  reset: () => void;
  close: () => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 1000;
const MAX_CACHED_PAGES = 5;

export function usePaginatedQuery(
  sql: string,
  connectionId: string,
  options?: QueryOptions
): UsePaginatedQueryReturn {
  const [result, setResult] = useState<PaginatedResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedPages, setCachedPages] = useState<Map<number, any[][]>>(new Map());
  const cursorIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);

  const execute = useCallback(async () => {
    if (!connectionId || !sql.trim()) {
      setError('Invalid connection or query');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Close existing cursor if any
      if (cursorIdRef.current) {
        try {
          await invoke('db_query_close', { cursorId: cursorIdRef.current });
        } catch (e) {
          console.warn('Failed to close previous cursor:', e);
        }
      }

      const response = await invoke<QueryBeginResponse>('db_query_begin', {
        connectionId,
        sql,
        params: null,
        opts: {
          page_size: options?.page_size || DEFAULT_PAGE_SIZE,
          max_rows: options?.max_rows,
          timeout_ms: options?.timeout_ms || 30000,
        },
      });

      cursorIdRef.current = response.cursor_id;
      
      // Cache first page
      const newCache = new Map<number, any[][]>();
      newCache.set(0, response.rows);
      setCachedPages(newCache);

      setResult({
        cursorId: response.cursor_id,
        columns: response.columns,
        rows: response.rows,
        currentPage: 0,
        totalRows: response.total_rows,
        isComplete: response.is_complete,
        hasMore: !response.is_complete,
      });
    } catch (err) {
      console.error('Query execution failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [sql, connectionId, options]);

  const fetchNext = useCallback(async () => {
    if (!result || result.isComplete || isFetchingRef.current) return;

    const nextPage = result.currentPage + 1;

    // Check cache first
    if (cachedPages.has(nextPage)) {
      const cachedRows = cachedPages.get(nextPage)!;
      setResult(prev => ({
        ...prev!,
        rows: [...prev!.rows, ...cachedRows],
        currentPage: nextPage,
      }));
      return;
    }

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const response = await invoke<QueryFetchResponse>('db_query_fetch', {
        cursorId: result.cursorId,
        page: nextPage,
        pageSize: options?.page_size || DEFAULT_PAGE_SIZE,
      });

      // Update cache
      setCachedPages(prev => {
        const newCache = new Map(prev);
        newCache.set(nextPage, response.rows);
        
        // Limit cache size
        if (newCache.size > MAX_CACHED_PAGES) {
          const keysToDelete = Array.from(newCache.keys())
            .sort((a, b) => a - b)
            .slice(0, newCache.size - MAX_CACHED_PAGES);
          keysToDelete.forEach(key => newCache.delete(key));
        }
        
        return newCache;
      });

      setResult(prev => ({
        ...prev!,
        rows: [...prev!.rows, ...response.rows],
        currentPage: nextPage,
        isComplete: response.is_complete,
        hasMore: !response.is_complete,
      }));
    } catch (err) {
      console.error('Failed to fetch next page:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [result, cachedPages, options]);

  const fetchPrevious = useCallback(async () => {
    if (!result || result.currentPage === 0) return;

    const prevPage = result.currentPage - 1;
    
    // For previous pages, we need to re-fetch from the beginning
    // This is a simplified implementation - in production you might want
    // to implement bidirectional cursors or cache management
    setResult(prev => ({
      ...prev!,
      currentPage: prevPage,
      rows: prev!.rows.slice(0, (prevPage + 1) * (options?.page_size || DEFAULT_PAGE_SIZE)),
    }));
  }, [result, options]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setCachedPages(new Map());
    cursorIdRef.current = null;
  }, []);

  const close = useCallback(async () => {
    if (!cursorIdRef.current) return;

    try {
      await invoke('db_query_close', { cursorId: cursorIdRef.current });
    } catch (err) {
      console.warn('Failed to close cursor:', err);
    } finally {
      reset();
    }
  }, [reset]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cursorIdRef.current) {
        invoke('db_query_close', { cursorId: cursorIdRef.current }).catch(err => {
          console.warn('Failed to close cursor on unmount:', err);
        });
      }
    };
  }, []);

  // Cancel ongoing query on sql/connection change
  useEffect(() => {
    return () => {
      if (cursorIdRef.current && isFetchingRef.current) {
        invoke('db_query_cancel', { queryId: cursorIdRef.current }).catch(err => {
          console.warn('Failed to cancel query:', err);
        });
      }
    };
  }, [sql, connectionId]);

  return {
    result,
    isLoading,
    error,
    execute,
    fetchNext,
    fetchPrevious,
    reset,
    close,
  };
}