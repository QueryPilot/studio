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
  TableDataStream,
} from "@/services/tableDataTypes";
import type { ColumnMeta } from "@/types/database";

// State interface for the hook
interface TableDataState {
  isLoading: boolean;
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

// Return type for the hook
interface UseTableDataReturn extends TableDataState {
  loadData: (params: TableDataParams) => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  stop: () => Promise<void>;
  clearData: () => void;
}

/**
 * Hook for managing table data loading with streaming support
 * Redesigned with stable callbacks and proper state management
 */
export function useTableData(): UseTableDataReturn {
  // State management
  const [state, setState] = useState<TableDataState>({
    isLoading: false,
    isStreaming: false,
    error: null,
    columns: [],
    rows: [],
    hasNextPage: false,
    nextCursor: null,
    pageSize: 100,
    totalLoadedRows: 0,
    estimatedTotal: null,
  });

  // Refs for cleanup and current state tracking
  const currentStreamRef = useRef<TableDataStream | null>(null);
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
      if (currentStreamRef.current) {
        void currentStreamRef.current.stop();
      }
    };
  }, []);

  // Handle stream metadata - STABLE callback with NO dependencies
  const handleMeta = useCallback((meta: TableDataMetaEvent) => {
    console.log("[useTableData] Received metadata:", meta);
    if (!isMountedRef.current) return;

    setState((prev) => ({
      ...prev,
      columns: meta.columns,
      pageSize: meta.page_size,
      isLoading: false,
      isStreaming: true,
      error: null,
    }));
  }, []); // NO dependencies = stable callback

  // Handle stream data rows - STABLE callback with NO dependencies
  const handleRows = useCallback((rowsEvent: TableDataRowsEvent) => {
    console.log("[useTableData] Received rows:", rowsEvent.rows.length, "rows");
    console.log(">>> rows sample:", rowsEvent.rows[0]);
    if (!isMountedRef.current) return;

    setState((prev) => {
      // Check if we're in the initial load (no cursor) or loading more
      const isInitialLoad = !prev.nextCursor;
      const newRows = isInitialLoad
        ? rowsEvent.rows // Replace all rows on initial load
        : [...prev.rows, ...rowsEvent.rows]; // Append on load more

      return {
        ...prev,
        rows: newRows,
        hasNextPage: Boolean(rowsEvent.next_cursor),
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
      isStreaming: false,
      hasNextPage: false,
    }));
    currentStreamRef.current = null;
  }, []); // NO dependencies = stable callback

  // Handle stream errors - STABLE callback with NO dependencies
  const handleError = useCallback((error: TableDataErrorEvent) => {
    console.error("[useTableData] Stream error:", error);
    if (!isMountedRef.current) return;

    setState((prev) => ({
      ...prev,
      isLoading: false,
      isStreaming: false,
      error: `${error.code}: ${error.message}`,
      hasNextPage: false,
    }));
    currentStreamRef.current = null;
  }, []); // NO dependencies = stable callback

  // Stop current stream if active - STABLE callback
  const stopCurrentStream = useCallback(async () => {
    if (currentStreamRef.current) {
      await currentStreamRef.current.stop();
      currentStreamRef.current = null;
    }
  }, []);

  // Load data with new parameters - STABLE callback with NO dependencies
  const loadData = useCallback(async (params: TableDataParams) => {
    console.log("[useTableData] loadData called with params:", params);
    if (!isMountedRef.current) return;

    try {
      // Stop any existing stream
      if (currentStreamRef.current) {
        await currentStreamRef.current.stop();
        currentStreamRef.current = null;
      }

      // Store current parameters for refresh/pagination
      currentParamsRef.current = params;

      // Reset state
      console.log("[useTableData] Resetting state");
      setState((prev) => ({
        ...prev,
        isLoading: true,
        isStreaming: false,
        error: null,
        rows: [],
        hasNextPage: false,
        nextCursor: null,
        totalLoadedRows: 0,
        estimatedTotal: null,
      }));

      // Start new stream
      console.log("[useTableData] Starting new stream");
      const stream = await tableDataService.startTableDataStream(params, {
        onMeta: handleMeta,
        onRows: handleRows,
        onDone: handleDone,
        onError: handleError,
      });

      currentStreamRef.current = stream;
      console.log(
        "[useTableData] Stream started successfully:",
        stream.streamId,
      );
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

    // Prevent multiple concurrent loadMore calls
    if (isLoadingMoreRef.current) {
      console.log("[useTableData] loadMore already in progress, skipping");
      return;
    }

    if (
      !currentParamsRef.current ||
      !currentState.nextCursor ||
      currentState.isLoading ||
      currentState.isStreaming ||
      !isMountedRef.current
    ) {
      return;
    }

    isLoadingMoreRef.current = true;

    const nextParams: TableDataParams = {
      ...currentParamsRef.current,
      cursor: currentState.nextCursor,
    };

    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const stream = await tableDataService.startTableDataStream(nextParams, {
        onMeta: handleMeta,
        onRows: handleRows,
        onDone: handleDone,
        onError: handleError,
      });

      currentStreamRef.current = stream;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load more data";
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (isMountedRef.current) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
      }
    } finally {
      isLoadingMoreRef.current = false;
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

  // Stop current stream - STABLE callback
  const stop = useCallback(async () => {
    await stopCurrentStream();
    if (isMountedRef.current) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isStreaming: false,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // NO dependencies = stable callback

  // Clear all data - STABLE callback
  const clearData = useCallback(() => {
    void stopCurrentStream();
    currentParamsRef.current = null;
    if (isMountedRef.current) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
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
