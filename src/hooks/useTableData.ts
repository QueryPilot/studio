/**
 * React hook for using TableDataService in components
 * Provides state management and cleanup for table data streaming
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { tableDataService } from "@/services/tableDataService";
import type {
  TableDataParams,
  TableDataRow,
  TableDataMetaEvent,
  TableDataRowsEvent,
  TableDataErrorEvent,
} from "@/services/tableDataTypes";
import type { ColumnMeta } from "@/types/database";

// State interface for the hook
interface TableDataState {
  isLoading: boolean;
  isLoadingMore: boolean;
  isStreaming: boolean;
  error: string | null;
  columns: ColumnMeta[];
  rows: TableDataRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
  pageSize: number;
  totalLoadedRows: number;
  estimatedTotal: number | null;
}

// Initial state interface for the hook
export interface UseTableDataInitialState {
  rows?: TableDataRow[];
  columns?: ColumnMeta[];
  nextCursor?: string | null;
  hasNextPage?: boolean;
  totalLoadedRows?: number;
  estimatedTotal?: number | null;
}

// Return type for the hook
interface UseTableDataReturn extends TableDataState {
  loadData: (params: TableDataParams, initialState?: UseTableDataInitialState) => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  stop: () => Promise<void>;
  clearData: () => void;
}

/**
 * Hook for managing table data loading with streaming support
 * Redesigned with stable callbacks and proper state management
 */
export function useTableData(initialState?: UseTableDataInitialState): UseTableDataReturn {
  // State management - if we have initial state with data, don't show loading
  const hasInitialData = initialState?.rows && initialState.rows.length > 0;
  
  if (hasInitialData) {
    console.log(`[useTableData] Initializing with cached data: ${initialState.rows?.length} rows`);
  }
  
  const [state, setState] = useState<TableDataState>({
    isLoading: false,  // Never show loading if we have cached data
    isLoadingMore: false,
    isStreaming: false,
    error: null,
    columns: initialState?.columns || [],
    rows: initialState?.rows || [],
    hasNextPage: initialState?.hasNextPage || false,
    nextCursor: initialState?.nextCursor || null,
    pageSize: 100,
    totalLoadedRows: initialState?.totalLoadedRows || initialState?.rows?.length || 0,
    estimatedTotal: initialState?.estimatedTotal || null,
  });

  // Refs for current state tracking
  const currentParamsRef = useRef<TableDataParams | null>(null);
  const isMountedRef = useRef(true);
  const stateRef = useRef(state);
  const isLoadingMoreRef = useRef(false);

  // Update state ref when state changes
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Handle stream metadata - STABLE callback with NO dependencies
  const handleMeta = useCallback((meta: TableDataMetaEvent) => {
    console.log("[useTableData] Received metadata:", meta);
    console.log(`[useTableData] Number of columns: ${meta.columns?.length || 0}`);
    if (!isMountedRef.current) return;

    setState((prev) => ({
      ...prev,
      columns: meta.columns,
      pageSize: meta.page_size,
      isLoading: false,
      isLoadingMore: false,
      isStreaming: true,
      error: null,
    }));
  }, []); // NO dependencies = stable callback

  // Handle stream data rows - STABLE callback with NO dependencies
  const handleRows = useCallback((rowsEvent: TableDataRowsEvent) => {
    console.log("[useTableData] Received rows:", rowsEvent.rows.length, "rows");
    console.log("[useTableData] Next cursor:", rowsEvent.next_cursor);
    console.log("[useTableData] Estimated total:", rowsEvent.estimated_total);
    console.log(">>> rows sample:", rowsEvent.rows[0]);
    if (!isMountedRef.current) return;

    setState((prev) => {
      // Check if we're in the initial load (rows empty) or loading more
      const isInitialLoad = prev.rows.length === 0;
      const newRows = isInitialLoad
        ? rowsEvent.rows // Replace all rows on initial load
        : [...prev.rows, ...rowsEvent.rows]; // Append on load more

      const hasMore = Boolean(rowsEvent.next_cursor);
      console.log("[useTableData] Total rows after update:", newRows.length);
      console.log("[useTableData] Has next page:", hasMore);
      console.log("[useTableData] Next cursor value:", rowsEvent.next_cursor);

      return {
        ...prev,
        rows: newRows,
        hasNextPage: hasMore,
        nextCursor: rowsEvent.next_cursor || null,
        totalLoadedRows: newRows.length,
        estimatedTotal: rowsEvent.estimated_total || prev.estimatedTotal,
      };
    });
  }, []); // NO dependencies = stable callback

  // Handle stream completion - STABLE callback with NO dependencies
  const handleDone = useCallback(() => {
    console.log("[useTableData] Stream completed");
    if (!isMountedRef.current) return;

    setState((prev) => ({
      ...prev,
      isLoading: false,
      isLoadingMore: false,
      isStreaming: false,
      // Keep hasNextPage from previous state - it was set correctly by handleRows
    }));
  }, []); // NO dependencies = stable callback

  // Handle stream errors - STABLE callback with NO dependencies
  const handleError = useCallback((error: TableDataErrorEvent) => {
    console.error("[useTableData] Stream error:", error);
    if (!isMountedRef.current) return;

    setState((prev) => ({
      ...prev,
      isLoading: false,
      isLoadingMore: false,
      isStreaming: false,
      error: `${error.code}: ${error.message}`,
      hasNextPage: false,
    }));
  }, []); // NO dependencies = stable callback

  // Load data with new parameters - STABLE callback with NO dependencies
  const loadData = useCallback(async (params: TableDataParams, loadInitialState?: UseTableDataInitialState) => {
    console.log("[useTableData] loadData called with params:", params);
    if (!isMountedRef.current) return;

    try {
      // Store current parameters for refresh/pagination
      currentParamsRef.current = params;

      // If initial state provided, use it instead of loading
      if (loadInitialState?.rows && loadInitialState.rows.length > 0) {
        console.log("[useTableData] Using initial state with", loadInitialState.rows.length, "rows");
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isLoadingMore: false,
          isStreaming: false,
          error: null,
          columns: loadInitialState.columns || prev.columns,
          rows: loadInitialState.rows,
          hasNextPage: loadInitialState.hasNextPage || false,
          nextCursor: loadInitialState.nextCursor || null,
          totalLoadedRows: loadInitialState.totalLoadedRows || loadInitialState.rows.length,
          estimatedTotal: loadInitialState.estimatedTotal || null,
        }));
        return; // Skip actual data loading
      }

      // Reset state for initial load
      console.log("[useTableData] Resetting state");
      setState((prev) => ({
        ...prev,
        isLoading: true,
        isLoadingMore: false,
        isStreaming: false,
        error: null,
        rows: [],
        hasNextPage: false,
        nextCursor: null,
        totalLoadedRows: 0,
        estimatedTotal: null,
      }));

      // Load data with offset 0 for initial load
      const paramsWithOffset = { ...params, offset: 0 };
      console.log("[useTableData] Loading data");
      await tableDataService.loadTableData(paramsWithOffset, {
        onMeta: handleMeta,
        onRows: handleRows,
        onDone: handleDone,
        onError: handleError,
      });

      console.log("[useTableData] Data loaded successfully");
    } catch (error) {
      console.error("[useTableData] Error loading data:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load table data";
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (isMountedRef.current) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // NO dependencies = stable callback

  // Load more data (pagination) - STABLE callback using refs
  const loadMore = useCallback(async () => {
    const currentState = stateRef.current;

    console.log("[useTableData] loadMore called");
    console.log("[useTableData] Current rows:", currentState.rows.length);
    console.log("[useTableData] Next cursor:", currentState.nextCursor);
    console.log("[useTableData] Has next page:", currentState.hasNextPage);

    // Prevent multiple concurrent loadMore calls
    if (isLoadingMoreRef.current) {
      console.log("[useTableData] loadMore already in progress, skipping");
      return;
    }

    if (
      !currentParamsRef.current ||
      !currentState.nextCursor ||
      currentState.isLoading ||
      currentState.isLoadingMore ||
      !isMountedRef.current
    ) {
      console.log("[useTableData] loadMore blocked - conditions not met");
      console.log("  - has params:", !!currentParamsRef.current);
      console.log("  - has cursor:", !!currentState.nextCursor);
      console.log("  - not loading:", !currentState.isLoading);
      console.log("  - not loading more:", !currentState.isLoadingMore);
      console.log("  - is mounted:", isMountedRef.current);
      return;
    }

    isLoadingMoreRef.current = true;

    const nextParams: TableDataParams = {
      ...currentParamsRef.current,
      offset: currentState.totalLoadedRows, // Use current row count as offset
    };

    try {
      setState((prev) => ({ ...prev, isLoadingMore: true, error: null }));

      await tableDataService.loadTableData(nextParams, {
        onMeta: handleMeta,
        onRows: handleRows,
        onDone: handleDone,
        onError: handleError,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load more data";
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (isMountedRef.current) {
        setState((prev) => ({
          ...prev,
          isLoadingMore: false,
          error: errorMessage,
        }));
      }
    } finally {
      isLoadingMoreRef.current = false;
      setState((prev) => ({ ...prev, isLoadingMore: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // NO dependencies = stable callback

  // Refresh current data - STABLE callback using refs
  const refresh = useCallback(async () => {
    if (!currentParamsRef.current) {
      return;
    }

    // Remove cursor for fresh start
    const refreshParams: TableDataParams = {
      ...currentParamsRef.current,
      cursor: undefined,
    };

    // Use internal loadData directly to avoid circular dependencies
    await loadData(refreshParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // NO dependencies = stable callback

  // Stop loading - STABLE callback
  const stop = useCallback(async () => {
    if (isMountedRef.current) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isLoadingMore: false,
        isStreaming: false,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // NO dependencies = stable callback

  // Clear all data - STABLE callback
  const clearData = useCallback(() => {
    currentParamsRef.current = null;
    if (isMountedRef.current) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isLoadingMore: false,
        isStreaming: false,
        error: null,
        columns: [],
        rows: [],
        hasNextPage: false,
        nextCursor: null,
        totalLoadedRows: 0,
        estimatedTotal: null,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // NO dependencies = stable callback

  return {
    ...state,
    loadData,
    loadMore,
    refresh,
    stop,
    clearData,
  };
}
