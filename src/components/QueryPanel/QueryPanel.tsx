import { logger } from "@/lib/logger";
import {
  memo,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  useReducer,
} from "react";
import { QueryEditor } from "./QueryEditor";
import { ResultViewer } from "./ResultViewer";
import { QueryHistory } from "./QueryHistory";
import { SavedQueries } from "./SavedQueries";
import { QueryToolbar } from "./QueryToolbar";
import { isExplainResult as checkIsExplainResult } from "./ExplainViewer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { IconHistory, IconStar } from "@tabler/icons-react";
import { toast } from "sonner";

import { tableStreamingService } from "@/services/tableStreamingService";
import { queryHistoryService } from "@/services/queryHistoryService";
import { cn } from "@/lib/utils";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabStateStore, type QueryResult } from "@/stores/tabStateStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import type { ColumnMeta } from "@/types/database";
import { formatSql } from "@/utils/codeFormatter";
import type { SqlDialect } from "@/components/CodeEditor/types";
import type { QueryEditorRef } from "./QueryEditor";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import {
  handleMutationCache,
  isMutationQuery,
  isSelectQuery,
} from "@/lib/cacheManager";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { parseMutationTables } from "@/utils/sqlParser";
import {
  parseSqlStatements,
  hasMultipleStatements,
} from "@/utils/sqlStatementParser";
import { eventBus } from "@/services/eventBus";
import type { MultiQueryResult } from "@/stores/tabStateStore";

interface QueryPanelProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: string;
  schema?: string;
  dbType?: string;
  className?: string;
  initialSql?: string;
}

// ============================================================================
// STATE REDUCER - Consolidates 11+ useState into single reducer
// Reduces re-renders from state cascade
// ============================================================================
interface QueryPanelState {
  query: string;
  result: QueryResult | null;
  isExecuting: boolean;
  isStreaming: boolean;
  showHistory: boolean;
  appliedLimit: { originalSql: string; limit: number } | null;
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  selectedDialect: SqlDialect | "auto";
  detectedDialect: SqlDialect;
  showResults: boolean;
  isExplainResult: boolean;
}

type QueryPanelAction =
  | { type: "SET_QUERY"; payload: string }
  | { type: "SET_RESULT"; payload: QueryResult | null }
  | { type: "SET_IS_EXECUTING"; payload: boolean }
  | { type: "SET_IS_STREAMING"; payload: boolean }
  | { type: "SET_SHOW_HISTORY"; payload: boolean }
  | {
      type: "SET_APPLIED_LIMIT";
      payload: { originalSql: string; limit: number } | null;
    }
  | {
      type: "SET_VIEW_MODE";
      payload: "table" | "json" | "explain" | "raw" | "stats";
    }
  | { type: "SET_SELECTED_DIALECT"; payload: SqlDialect | "auto" }
  | { type: "SET_DETECTED_DIALECT"; payload: SqlDialect }
  | { type: "SET_SHOW_RESULTS"; payload: boolean }
  | { type: "SET_IS_EXPLAIN_RESULT"; payload: boolean }
  | { type: "START_EXECUTION" }
  | {
      type: "END_EXECUTION";
      payload: { result: QueryResult | null; error?: string };
    }
  | { type: "BATCH_UPDATE"; payload: Partial<QueryPanelState> };

function queryPanelReducer(
  state: QueryPanelState,
  action: QueryPanelAction,
): QueryPanelState {
  switch (action.type) {
    case "SET_QUERY":
      return { ...state, query: action.payload };
    case "SET_RESULT":
      return {
        ...state,
        result: action.payload,
        showResults: action.payload !== null,
      };
    case "SET_IS_EXECUTING":
      return { ...state, isExecuting: action.payload };
    case "SET_IS_STREAMING":
      return { ...state, isStreaming: action.payload };
    case "SET_SHOW_HISTORY":
      return { ...state, showHistory: action.payload };
    case "SET_APPLIED_LIMIT":
      return { ...state, appliedLimit: action.payload };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.payload };
    case "SET_SELECTED_DIALECT":
      return { ...state, selectedDialect: action.payload };
    case "SET_DETECTED_DIALECT":
      return { ...state, detectedDialect: action.payload };
    case "SET_SHOW_RESULTS":
      return { ...state, showResults: action.payload };
    case "SET_IS_EXPLAIN_RESULT":
      return { ...state, isExplainResult: action.payload };
    case "START_EXECUTION":
      return {
        ...state,
        isExecuting: true,
        isStreaming: true,
        result: null,
        isExplainResult: false,
      };
    case "END_EXECUTION":
      return {
        ...state,
        isExecuting: false,
        isStreaming: false,
        result: action.payload.result,
        showResults: action.payload.result !== null,
      };
    case "BATCH_UPDATE":
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

type GlobalQueryState = ReturnType<
  typeof useTabStateStore.getState
>["queryStates"] extends Map<string, infer T>
  ? T
  : never;

function createInitialState(
  globalState: GlobalQueryState | undefined,
  initialSql: string,
): QueryPanelState {
  return {
    query: globalState?.query ?? initialSql,
    result: globalState?.result || null,
    isExecuting: globalState?.isExecuting || false,
    isStreaming: globalState?.isStreaming || false,
    showHistory: false,
    appliedLimit: globalState?.appliedLimit || null,
    viewMode: globalState?.viewMode || "table",
    selectedDialect: globalState?.selectedDialect || "auto",
    detectedDialect: "postgresql",
    showResults: globalState?.result !== null,
    isExplainResult: false,
  };
}

export const QueryPanel = memo(function QueryPanel({
  panelId,
  tabId,
  connectionId,
  database,
  schema = "public",
  dbType = "postgres",
  className,
  initialSql = "",
}: QueryPanelProps) {
  // Use global tab state store to persist across panel moves
  const setQueryState = useTabStateStore((state) => state.setQueryState);
  const globalState = useTabStateStore((state) => state.queryStates.get(tabId));
  const focusedPanelId = useWorkbenchStore((state) => state.focusedPanelId);
  const isPanelFocused = focusedPanelId === panelId;

  // Consolidated state using reducer - reduces re-renders from state cascade
  const [state, dispatch] = useReducer(
    queryPanelReducer,
    { globalState, initialSql },
    ({ globalState: gs, initialSql: sql }) => createInitialState(gs, sql),
  );

  const {
    query,
    result,
    isExecuting,
    isStreaming,
    showHistory,
    appliedLimit,
    viewMode,
    selectedDialect,
    detectedDialect,
    showResults,
    isExplainResult,
  } = state;

  // AbortController still needs separate state (not serializable)
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  // Get transaction state from persisted store
  const inTransaction = globalState?.inTransaction || false;

  // Editor ref for focusing
  const editorRef = useRef<QueryEditorRef>(null);

  // Refs for auto-refresh race condition prevention
  const pendingRefreshRef = useRef<number | null>(null);
  const isExecutingRef = useRef<boolean>(false);

  // Sync isExecutingRef with isExecuting state for stable reference in callbacks
  useEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);

  // Cleanup pending auto-refresh on unmount
  useEffect(() => {
    return () => {
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }
    };
  }, []);

  // Memoized action dispatchers - stable references prevent child re-renders
  const setQuery = useCallback(
    (value: string) => {
      dispatch({ type: "SET_QUERY", payload: value });
      // Mark as having unsaved changes when query is modified
      const lastExecutedQuery = globalState?.lastExecutedQuery || "";
      const hasChanges = value.trim() !== lastExecutedQuery.trim();
      setQueryState(tabId, { hasUnsavedChanges: hasChanges });
    },
    [tabId, setQueryState, globalState?.lastExecutedQuery],
  );

  const setResult = useCallback(
    (
      value:
        | QueryResult
        | null
        | ((prev: QueryResult | null) => QueryResult | null),
    ) => {
      if (typeof value === "function") {
        // For functional updates, we need to get current state
        dispatch({ type: "SET_RESULT", payload: value(result) });
      } else {
        dispatch({ type: "SET_RESULT", payload: value });
      }
    },
    [result],
  );

  const setIsExecuting = useCallback((value: boolean) => {
    dispatch({ type: "SET_IS_EXECUTING", payload: value });
  }, []);

  const setIsStreaming = useCallback((value: boolean) => {
    dispatch({ type: "SET_IS_STREAMING", payload: value });
  }, []);

  const setAppliedLimit = useCallback(
    (value: { originalSql: string; limit: number } | null) => {
      dispatch({ type: "SET_APPLIED_LIMIT", payload: value });
    },
    [],
  );

  const setViewMode = useCallback(
    (value: "table" | "json" | "explain" | "raw" | "stats") => {
      dispatch({ type: "SET_VIEW_MODE", payload: value });
    },
    [],
  );

  const setSelectedDialect = useCallback((value: SqlDialect | "auto") => {
    dispatch({ type: "SET_SELECTED_DIALECT", payload: value });
  }, []);

  const setDetectedDialect = useCallback((value: SqlDialect) => {
    dispatch({ type: "SET_DETECTED_DIALECT", payload: value });
  }, []);

  const setShowResults = useCallback((value: boolean) => {
    dispatch({ type: "SET_SHOW_RESULTS", payload: value });
  }, []);

  const smartQueryLimit = usePreferencesStore((state) => state.smartQueryLimit);
  const updateTabMetadata = useWorkbenchStore(
    (state) => state.updateTabMetadata,
  );

  const activeConnectionId = useWorkspaceSelectionStore(
    (state) => state.connectionId,
  );

  const effectiveConnectionId = useMemo(
    () => connectionId || activeConnectionId || "",
    [connectionId, activeConnectionId],
  );

  useEffect(() => {
    if (!connectionId && activeConnectionId && panelId && tabId) {
      updateTabMetadata(panelId, tabId, {
        connectionId: activeConnectionId,
      });
    }
  }, [connectionId, activeConnectionId, panelId, tabId, updateTabMetadata]);

  const queryGridId = useMemo(
    () => `query:${effectiveConnectionId}:${database}:${schema}:${tabId}`,
    [effectiveConnectionId, database, schema, tabId],
  );

  // IconKeyboard services for command registration
  const keyboardServices = useKeyboardServicesOptional();

  // Debug: IconCheck if keyboardServices is available
  useEffect(() => {
    logger.info("[QueryPanel] keyboardServices:", {
      available: !!keyboardServices,
      commandService: !!keyboardServices?.commandService,
      tabId,
    });
  }, [keyboardServices, tabId]);

  useEffect(() => {
    const next = initialSql;
    if (next !== query) {
      setQuery(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSql]);

  // Async sync: Batch update Zustand store when local state changes (after initial mount)
  // Single effect reduces re-renders from 6 to 1
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Batch all state updates into single Zustand update
    setQueryState(tabId, {
      query,
      result,
      isExecuting,
      isStreaming,
      appliedLimit,
      viewMode,
      selectedDialect,
    });
  }, [
    query,
    result,
    isExecuting,
    isStreaming,
    appliedLimit,
    viewMode,
    selectedDialect,
    tabId,
    setQueryState,
  ]);

  // Cleanup global state when component fully unmounts (tab closed, not just moved)
  // We don't clear on unmount because tab might just be moving between panels
  // Instead, workbenchStore should call clearQueryState when tab is actually removed

  const lastPersistedRef = useRef<string>(globalState?.query ?? initialSql);
  const persistTimerRef = useRef<number | null>(null);
  const persistSql = useCallback(
    (value: string) => {
      if (!panelId || !tabId) return;
      if (value === lastPersistedRef.current) return;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      persistTimerRef.current = window.setTimeout(() => {
        lastPersistedRef.current = value;
        updateTabMetadata(panelId, tabId, { sql: value });
      }, 250);
    },
    [panelId, tabId, updateTabMetadata],
  );
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, []);

  /**
   * Execute multiple SQL statements sequentially.
   * Shows progress and accumulates results in a tabbed interface.
   */
  const handleMultiQueryExecute = useCallback(
    async (statements: string[], signal?: AbortSignal) => {
      if (statements.length === 0) return;

      logger.info(
        `[handleMultiQueryExecute] Executing ${statements.length} statements`,
      );

      setIsExecuting(true);
      setIsStreaming(false);
      setResult(null);

      const multiResults: MultiQueryResult[] = [];
      let hasError = false;

      // Clear any previous multi-results
      setQueryState(tabId, { multiResults: [], activeResultIndex: 0 });

      for (let i = 0; i < statements.length; i++) {
        if (hasError || signal?.aborted) break; // Stop on first error or cancellation

        const stmt = statements[i];
        if (!stmt || !stmt.trim()) continue;

        const startTime = Date.now();
        logger.info(
          `[handleMultiQueryExecute] Executing statement ${i + 1}/${
            statements.length
          }`,
        );

        // Show progress toast
        toast.info(`Executing statement ${i + 1} of ${statements.length}...`, {
          id: `multi-query-progress`,
          duration: Infinity,
        });

        try {
          // Execute statement using existing logic - we'll reuse the streaming service
          const pageSize = 2500;
          let currentColumns: string[] = [];
          let currentColumnMeta: ColumnMeta[] = [];
          const accumulatedRows: unknown[][] = [];

          const streamPromise = tableStreamingService.streamQuery(
            effectiveConnectionId,
            `${tabId}-stmt${i}`,
            stmt.trim(),
            pageSize,
            (progress) => {
              if (progress.started && progress.columns) {
                currentColumns = progress.columns.map((c) => c.name);
                currentColumnMeta = progress.columns as unknown as ColumnMeta[];
              }
              if (progress.newRows && progress.newRows.length > 0) {
                accumulatedRows.push(...progress.newRows);
              }
            },
            (err: unknown) => {
              logger.error(
                `[handleMultiQueryExecute] Stream error for statement ${
                  i + 1
                }:`,
                err,
              );
            },
            smartQueryLimit ?? undefined,
            () => {
              /* Skip limit callback for multi-query */
            },
            signal,
          );

          const final = await streamPromise;
          const endTime = Date.now();
          const executionTime = final.executionTimeMs ?? endTime - startTime;

          // Determine statement type and build appropriate result
          const sqlUpper = stmt.trim().toUpperCase();
          const hasReturning = sqlUpper.includes(" RETURNING ");
          const wasMutation = isMutationQuery(stmt);
          const isDDL =
            sqlUpper.startsWith("CREATE ") ||
            sqlUpper.startsWith("ALTER ") ||
            sqlUpper.startsWith("DROP ");
          const isTransaction =
            sqlUpper === "BEGIN" ||
            sqlUpper === "COMMIT" ||
            sqlUpper === "ROLLBACK";

          let affectedRows: number | undefined;
          let message: string | undefined;

          if (wasMutation && hasReturning && accumulatedRows.length > 0) {
            affectedRows = final.totalRows ?? accumulatedRows.length;
            message = `${affectedRows} row(s) affected`;
          } else if (wasMutation && !hasReturning) {
            affectedRows = final.totalRows ?? 0;
          } else if (isDDL && accumulatedRows.length === 0) {
            message = "Query executed successfully";
          } else if (isTransaction) {
            message =
              sqlUpper === "BEGIN"
                ? "Transaction started"
                : sqlUpper === "COMMIT"
                ? "Transaction committed"
                : "Transaction rolled back";
          }

          multiResults.push({
            statementIndex: i,
            statement: stmt.trim(),
            result: {
              columns: currentColumns,
              columnMeta: currentColumnMeta,
              rows: [...accumulatedRows],
              rowCount: final.totalRows ?? accumulatedRows.length,
              affectedRows,
              message,
              executionTime,
              cursorSetupMs: final.cursorSetupMs,
              totalStreamingMs: final.totalStreamingMs,
              fetchCount: final.fetchCount,
              networkMs: final.networkMs,
              conversionMs: final.conversionMs,
              ipcSendMs: final.ipcSendMs,
            },
            startTime,
            endTime,
          });
        } catch (error) {
          hasError = true;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          multiResults.push({
            statementIndex: i,
            statement: stmt.trim(),
            result: {
              columns: [],
              rows: [],
              rowCount: 0,
              error: errorMessage,
              executionTime: Date.now() - startTime,
            },
            startTime,
            endTime: Date.now(),
          });

          toast.error(`Error in statement ${i + 1}: ${errorMessage}`, {
            id: `multi-query-progress`,
            duration: 5000,
          });

          logger.error(
            `[handleMultiQueryExecute] Error in statement ${i + 1}:`,
            error,
          );
        }
      }

      // Dismiss progress toast
      toast.dismiss(`multi-query-progress`);

      // Update state with all results
      setQueryState(tabId, {
        multiResults,
        activeResultIndex: 0,
        hasUnsavedChanges: false,
        lastExecutedQuery: statements.join(";\n"),
      });

      setIsExecuting(false);

      // Show completion toast
      const successCount = multiResults.filter((r) => !r.result.error).length;
      const errorCount = multiResults.length - successCount;

      if (errorCount === 0) {
        toast.success(`✓ Executed ${successCount} statement(s) successfully`);
      } else {
        toast.warning(
          `Executed ${successCount} statement(s), ${errorCount} failed`,
        );
      }

      logger.info(
        `[handleMultiQueryExecute] Completed: ${successCount} succeeded, ${errorCount} failed`,
      );
    },
    [
      setIsExecuting,
      setIsStreaming,
      setResult,
      setQueryState,
      tabId,
      effectiveConnectionId,
      smartQueryLimit,
    ],
  );

  const handleExecute = useCallback(
    async (queryToExecute?: string) => {
      // Cancel any pending auto-refresh since user is manually executing
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }

      console.log("[QueryPanel.handleExecute] ===== EXECUTE CALLED =====");
      console.log("[QueryPanel.handleExecute] queryToExecute:", queryToExecute);
      console.log(
        "[QueryPanel.handleExecute] queryToExecute type:",
        typeof queryToExecute,
      );
      console.log("[QueryPanel.handleExecute] query (fallback):", query);

      logger.info("[handleExecute] Called with:", {
        queryToExecute,
        queryToExecuteLength: queryToExecute?.length || 0,
        fallbackQuery: query,
        fallbackQueryLength: query.length || 0,
      });

      let sql = queryToExecute ?? query;

      logger.info("[handleExecute] Before trim:", {
        sql,
        sqlLength: sql.length || 0,
      });

      if (!sql || !sql.trim()) {
        logger.info("[handleExecute] EMPTY QUERY - Showing error toast");
        toast.error("Please enter a query to execute");
        return;
      }

      // If the editor passed an explicit statement (selection or current block),
      // treat it as a single statement and SKIP multi-statement detection.
      // (Use strict type check so empty string still counts as explicit.)
      const shouldSkipMultiCheck = typeof queryToExecute === "string";

      console.log(
        "[QueryPanel.handleExecute] shouldSkipMultiCheck:",
        shouldSkipMultiCheck,
      );
      console.log(
        "[QueryPanel.handleExecute] hasMultipleStatements(sql):",
        hasMultipleStatements(sql),
      );

      // Check if this is a multi-statement query (only when not forced single)
      // Don't trim trailing semicolons yet - we need them for parsing
      if (!shouldSkipMultiCheck && hasMultipleStatements(sql)) {
        console.log(
          "[QueryPanel.handleExecute] ===== MULTI-STATEMENT PATH =====",
        );
        const statements = parseSqlStatements(sql).map((s) => s.text);
        logger.info(
          `[handleExecute] Multi-statement query detected: ${statements.length} statements`,
        );

        // Create abort controller for multi-query execution
        const controller = new AbortController();
        setAbortController(controller);

        try {
          await handleMultiQueryExecute(statements, controller.signal);
        } finally {
          setAbortController(null);
        }
        return;
      }

      console.log(
        "[QueryPanel.handleExecute] ===== SINGLE-STATEMENT PATH =====",
      );
      // Single statement execution - clean up trailing semicolons
      sql = sql.trim().replace(/;\s*$/, "");

      logger.info("[handleExecute] After trim and semicolon removal:", {
        sql,
        sqlLength: sql.length || 0,
        isEmpty: !sql,
      });

      if (!sql) {
        logger.info("[handleExecute] EMPTY QUERY - Showing error toast");
        toast.error("Please enter a query to execute");
        return;
      }

      // Clear multi-results for single query execution
      setQueryState(tabId, {
        multiResults: undefined,
        activeResultIndex: undefined,
      });

      setIsExecuting(true);
      setIsStreaming(true);
      setResult(null);

      // Create abort controller for cancellation
      const controller = new AbortController();
      setAbortController(controller);

      let executionTime = 0;
      let queryResult: QueryResult | null = null;
      let errorMessage: string | undefined;

      try {
        // Stream results directly; no wrapping/pagination or SQL rewriting
        const pageSize = 2500; // Increased from 1000 for better performance
        let started = false;
        let currentColumns: string[] = [];
        let currentColumnMeta: ColumnMeta[] = [];
        let rowCount = 0;
        const accumulatedRows: unknown[][] = [];
        let rafId: number | undefined;
        let pendingTimeout: number | undefined;

        // Throttle updates using requestAnimationFrame with a minimum spacing
        const renderedCountRef = { current: 0 };
        const hasRenderedOnce = { current: false };
        const MIN_UPDATE_INTERVAL_MS = 120;
        let lastUpdateTime = 0;

        const scheduleUpdate = (force = false) => {
          if (pendingTimeout !== undefined && !force) return; // Update already queued

          const now = performance.now();
          const delay = force
            ? 0
            : Math.max(MIN_UPDATE_INTERVAL_MS - (now - lastUpdateTime), 0);

          if (pendingTimeout !== undefined && force) {
            clearTimeout(pendingTimeout);
            pendingTimeout = undefined;
          }

          pendingTimeout = window.setTimeout(() => {
            pendingTimeout = undefined;
            lastUpdateTime = performance.now();

            if (!force && rafId !== undefined) return; // Already scheduled in this frame

            if (rafId !== undefined && force) {
              cancelAnimationFrame(rafId);
              rafId = undefined;
            }

            rafId = requestAnimationFrame(() => {
              rafId = undefined;

              // Don't render until we have rows - keeps skeleton visible
              if (accumulatedRows.length === 0) {
                return;
              }

              // First render is synchronous to avoid flash, subsequent use startTransition
              if (!hasRenderedOnce.current) {
                hasRenderedOnce.current = true;
                renderedCountRef.current = accumulatedRows.length;
                setResult({
                  columns: currentColumns,
                  columnMeta: currentColumnMeta,
                  rows: accumulatedRows.slice(0),
                  rowCount: accumulatedRows.length,
                  executionTime: 0,
                });
                return;
              }

              // Use startTransition for streaming updates to keep UI responsive
              startTransition(() => {
                setResult((prev) => {
                  if (!prev) {
                    return null;
                  }
                  const already = renderedCountRef.current;
                  const total = accumulatedRows.length;
                  if (total <= already) {
                    return prev;
                  }
                  const newRows = accumulatedRows.slice(already);
                  renderedCountRef.current = total;
                  return {
                    ...prev,
                    rows: [...prev.rows, ...newRows],
                    rowCount: total,
                  };
                });
              });
            });
          }, delay);
        };

        if (!effectiveConnectionId) {
          throw new Error("No active connection selected");
        }

        const streamPromise = tableStreamingService.streamQuery(
          effectiveConnectionId,
          tabId,
          sql,
          pageSize,
          (progress) => {
            if (progress.started && progress.columns && !started) {
              started = true;
              currentColumns = progress.columns.map((c) => c.name);
              currentColumnMeta = progress.columns as unknown as ColumnMeta[];
              // Don't render empty table - wait for first batch
            }
            if (progress.newRows && progress.newRows.length > 0) {
              // Accumulate rows
              accumulatedRows.push(...progress.newRows);
              rowCount = accumulatedRows.length;

              // Schedule throttled update (max 60 FPS)
              scheduleUpdate();
            }
          },
          (err: unknown) => {
            let msg: string;
            if (err instanceof Error) msg = err.message;
            else if (typeof err === "string") msg = err;
            else if (err && typeof err === "object") msg = JSON.stringify(err);
            else msg = "Stream error";
            toast.error(msg);
          },
          smartQueryLimit ?? undefined, // Convert null to undefined for backend
          (originalSql, appliedLimit) => {
            setAppliedLimit({ originalSql, limit: appliedLimit });
          },
          controller.signal,
        );

        const final = await streamPromise;

        if (pendingTimeout !== undefined) {
          clearTimeout(pendingTimeout);
          pendingTimeout = undefined;
        }

        // Cancel any pending animation frame - we'll do immediate final update
        if (rafId !== undefined) {
          cancelAnimationFrame(rafId);
          rafId = undefined;
        }

        // Use backend's actual database execution time, not frontend timer
        executionTime = final.executionTimeMs ?? 0;

        // Detect query type for proper result display
        const sqlUpper = sql.trim().toUpperCase();
        const hasReturning = sqlUpper.includes(" RETURNING ");
        const wasMutation = isMutationQuery(sql);
        const isTransaction =
          sqlUpper === "BEGIN" ||
          sqlUpper === "COMMIT" ||
          sqlUpper === "ROLLBACK" ||
          sqlUpper.startsWith("ROLLBACK TO ") ||
          sqlUpper.startsWith("SAVEPOINT ") ||
          sqlUpper.startsWith("RELEASE SAVEPOINT ") ||
          sqlUpper === "START TRANSACTION";
        const isConfig =
          sqlUpper.startsWith("SET ") || sqlUpper.startsWith("RESET ");
        const isDDL =
          sqlUpper.startsWith("CREATE ") ||
          sqlUpper.startsWith("ALTER ") ||
          sqlUpper.startsWith("DROP ");
        const isMaintenance =
          sqlUpper.startsWith("VACUUM") ||
          sqlUpper.startsWith("ANALYZE") ||
          sqlUpper.startsWith("REINDEX");

        let affectedRows: number | undefined;
        let message: string | undefined;

        // For mutation queries with RETURNING, show both data and affected rows
        if (wasMutation && hasReturning && accumulatedRows.length > 0) {
          affectedRows = final.totalRows ?? accumulatedRows.length;
          message = `${affectedRows} row(s) affected`;
        }
        // For mutation queries without RETURNING, just show affected rows
        else if (wasMutation && !hasReturning) {
          affectedRows = final.totalRows ?? 0;
        }
        // For DDL queries, add success message if no rows returned
        else if (isDDL && accumulatedRows.length === 0) {
          message = "Query executed successfully";
        }
        // For transaction control commands
        else if (isTransaction) {
          if (
            sqlUpper.startsWith("BEGIN") ||
            sqlUpper.startsWith("START TRANSACTION")
          ) {
            message = "Transaction started";
            setQueryState(tabId, { inTransaction: true });
            toast.success("Transaction started", {
              description:
                "This tab now has an active transaction. All queries in this tab will be part of this transaction until you COMMIT or ROLLBACK.",
              duration: 5000,
            });
          } else if (sqlUpper.startsWith("COMMIT")) {
            message = "Transaction committed successfully";
            setQueryState(tabId, { inTransaction: false });
          } else if (sqlUpper.startsWith("ROLLBACK")) {
            message = "Transaction rolled back successfully";
            setQueryState(tabId, { inTransaction: false });
          } else if (sqlUpper.startsWith("SAVEPOINT")) {
            message = "Savepoint created";
          } else if (sqlUpper.startsWith("RELEASE SAVEPOINT")) {
            message = "Savepoint released";
          }
        }
        // For configuration commands
        else if (isConfig && accumulatedRows.length === 0) {
          message = sqlUpper.startsWith("SET ")
            ? "Configuration parameter set"
            : "Configuration parameter reset";
        }
        // For maintenance commands
        else if (isMaintenance && accumulatedRows.length === 0) {
          message = "Maintenance command completed successfully";
        }

        // CRITICAL: Direct state update (bypass RAF) to ensure ALL rows are immediately visible
        // This fixes the issue where RAF throttling could cause the last batch to not render
        // Create new array reference to force React re-render
        setResult({
          columns: currentColumns,
          columnMeta: currentColumnMeta,
          rows: [...accumulatedRows], // New array reference forces React to detect change
          rowCount: final.totalRows ?? accumulatedRows.length,
          affectedRows,
          message,
          executionTime,
          cursorSetupMs: final.cursorSetupMs,
          totalStreamingMs: final.totalStreamingMs,
          fetchCount: final.fetchCount,
          networkMs: final.networkMs,
          conversionMs: final.conversionMs,
          ipcSendMs: final.ipcSendMs,
        });

        // Streaming complete - stop streaming indicator
        setIsStreaming(false);

        // Detect EXPLAIN results and auto-switch to explain view
        const isExplain = checkIsExplainResult(currentColumns, accumulatedRows);
        if (isExplain) {
          dispatch({ type: "SET_IS_EXPLAIN_RESULT", payload: true });
          dispatch({ type: "SET_VIEW_MODE", payload: "explain" });
          logger.info(
            "[QueryPanel] EXPLAIN result detected - switching to explain view",
          );
        } else {
          // Reset explain-specific UI when returning to normal results
          if (isExplainResult) {
            dispatch({ type: "SET_IS_EXPLAIN_RESULT", payload: false });
          }
          if (
            viewMode === "explain" ||
            viewMode === "raw" ||
            viewMode === "stats"
          ) {
            dispatch({ type: "SET_VIEW_MODE", payload: "table" });
          }
        }

        // Handle mutations and auto-refresh
        if (effectiveConnectionId) {
          if (wasMutation) {
            // Clear cache
            handleMutationCache(sql, effectiveConnectionId);
            logger.info("[QueryPanel] Mutation detected - cache invalidated");

            // NEW: Broadcast invalidation to all components displaying affected tables
            const affectedTables = parseMutationTables(sql);
            if (affectedTables.length > 0) {
              const { invalidateTable } = useDataInvalidationStore.getState();
              affectedTables.forEach(({ schema, table }) => {
                logger.info(
                  `[QueryPanel] Invalidating table: ${
                    schema ?? "public"
                  }.${table}`,
                );
                invalidateTable(
                  effectiveConnectionId,
                  database,
                  schema ?? "public",
                  table,
                );
              });
            } else {
              logger.warn(
                "[QueryPanel] Mutation detected but no tables parsed from SQL:",
                sql,
              );
            }

            // Auto-refresh: Re-run last SELECT query to show updated data
            const lastSelectQuery = globalState?.lastSelectQuery;
            if (lastSelectQuery) {
              // Cancel any pending refresh
              if (pendingRefreshRef.current) {
                clearTimeout(pendingRefreshRef.current);
              }

              // Guard against concurrent execution
              if (!isExecuting) {
                toast.info("Data modified - Refreshing results...");
                pendingRefreshRef.current = window.setTimeout(() => {
                  pendingRefreshRef.current = null;
                  if (!isExecutingRef.current) {
                    void handleExecute(lastSelectQuery);
                  }
                }, 100);
              }
            }
          }
        }

        // Store SELECT queries for auto-refresh after mutations
        const isSelect = isSelectQuery(sql);

        // Clear unsaved changes flag and update last executed query
        setQueryState(tabId, {
          hasUnsavedChanges: false,
          lastExecutedQuery: sql,
          ...(isSelect ? { lastSelectQuery: sql } : {}),
        });

        queryResult = {
          columns: final.columns.map((c) => c.name),
          columnMeta: final.columns as unknown as ColumnMeta[],
          rows: [], // Don't store rows again - already in state
          rowCount: final.totalRows ?? rowCount,
          affectedRows,
          executionTime,
        };
      } catch (error) {
        // IconCheck if this is a user cancellation
        const isCancellation =
          (error instanceof Error && error.name === "AbortError") ||
          (error instanceof Error && error.message.includes("cancelled")) ||
          (error instanceof Error && error.message.includes("interrupted"));

        if (isCancellation) {
          // User cancelled - don't show as error
          logger.info("Query cancelled by user");
          return; // Exit early, no toast (already shown in handleCancel)
        } else {
          // Extract detailed error message
          if (error instanceof Error) {
            errorMessage = error.message;
          } else if (typeof error === "string") {
            errorMessage = error;
          } else if (error && typeof error === "object" && "message" in error) {
            errorMessage = String(error.message);
          } else {
            errorMessage =
              "An unknown error occurred while executing the query";
          }

          setResult({
            columns: [],
            rows: [],
            rowCount: 0,
            error: errorMessage,
          });

          // Show error toast with full details
          toast.error(errorMessage, {
            duration: 5000,
            description: "Check the console for more details",
          });

          logger.error("Query execution failed:", error);
        }
      } finally {
        setIsExecuting(false);
        setIsStreaming(false);
        setAbortController(null);

        // IconDeviceFloppy to history (skip if cancelled)
        const wasCancelled = controller.signal.aborted;
        if (sql.trim() && !wasCancelled) {
          await queryHistoryService.addEntry({
            connectionId: effectiveConnectionId,
            database,
            query: sql,
            executedAt: new Date(),
            executionTime,
            rowCount: queryResult?.rowCount,
            error: errorMessage,
          });
        }
      }
    },
    [
      query,
      effectiveConnectionId,
      database,
      smartQueryLimit,
      setIsExecuting,
      setIsStreaming,
      setResult,
      setAppliedLimit,
      viewMode,
      isExplainResult,
    ],
  );

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setIsExecuting(false);
      setIsStreaming(false);
      setAbortController(null);

      toast.info("Query cancelled");
    }
  }, [abortController, setIsExecuting, setIsStreaming]);

  const handleSelectQuery = useCallback(
    (selectedQuery: string) => {
      setQuery(selectedQuery);
      persistSql(selectedQuery);
    },
    [persistSql, setQuery],
  );

  const handleBeautify = useCallback(() => {
    if (!query.trim()) return;

    // Map dbType to SqlDialect
    const dialectMap: Record<string, SqlDialect> = {
      postgres: "postgresql",
      mysql: "mysql",
      sqlite: "sqlite",
      mariadb: "mysql",
      sqlserver: "mssql",
      mssql: "mssql",
      oracle: "plsql",
    };

    const dialect = dialectMap[dbType.toLowerCase()] || "postgresql";
    const beautified = formatSql(query, dialect);

    if (beautified !== query) {
      setQuery(beautified);
      persistSql(beautified);
      toast.success("Query formatted");
    }
  }, [query, dbType, persistSql, setQuery]);

  // Handle EXPLAIN ANALYZE - wraps query with EXPLAIN and executes
  const handleExplain = useCallback(() => {
    // Clean up the query - remove trailing semicolons before wrapping
    const sql = query.trim().replace(/;\s*$/, "");
    if (!sql) {
      toast.error("Please enter a query to explain");
      return;
    }

    // Generate dialect-specific EXPLAIN statement
    const dbTypeLower = dbType.toLowerCase();
    let explainSql: string;

    if (dbTypeLower === "postgres" || dbTypeLower === "postgresql") {
      // PostgreSQL: EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`;
    } else if (dbTypeLower === "mysql" || dbTypeLower === "mariadb") {
      // MySQL: EXPLAIN ANALYZE
      explainSql = `EXPLAIN ANALYZE ${sql}`;
    } else if (dbTypeLower === "sqlite") {
      // SQLite: EXPLAIN QUERY PLAN
      explainSql = `EXPLAIN QUERY PLAN ${sql}`;
    } else if (dbTypeLower === "sqlserver" || dbTypeLower === "mssql") {
      // SQL Server: Use SET STATISTICS PROFILE which works in single batch
      explainSql = `SET STATISTICS PROFILE ON; ${sql}`;
    } else {
      // Default to basic EXPLAIN
      explainSql = `EXPLAIN ${sql}`;
    }

    logger.info("[handleExplain] Running:", {
      explainSql,
      originalSql: sql,
      dbType: dbTypeLower,
    });

    // Execute the explain query
    handleExecute(explainSql);
  }, [query, dbType, handleExecute]);

  const toggleHistory = useCallback(() => {
    dispatch({ type: "SET_SHOW_HISTORY", payload: !showHistory });
  }, [showHistory]);

  const toggleResults = useCallback(() => {
    dispatch({ type: "SET_SHOW_RESULTS", payload: !showResults });
  }, [showResults]);

  // Auto-show results panel when query execution starts or completes
  useEffect(() => {
    if (isExecuting || result !== null) {
      setShowResults(true);
    }
  }, [isExecuting, result]);

  const focusEditor = useCallback(() => {
    editorRef.current?.focus();
  }, []);

  // Subscribe to event bus for keyboard shortcuts
  // Track if this panel is focused using a ref to avoid re-subscribing
  const isFocusedRef = useRef(false);

  useEffect(() => {
    // Update focus state
    isFocusedRef.current =
      panelId === useWorkbenchStore.getState().focusedPanelId;

    const unsubscribe = useWorkbenchStore.subscribe((state) => {
      isFocusedRef.current = panelId === state.focusedPanelId;
    });

    return unsubscribe;
  }, [panelId]);

  useEffect(() => {
    const handleFormat = () => {
      // IconCheck if THIS panel should handle the event
      if (!isFocusedRef.current) return;
      logger.info("🟢 QueryPanel handling format event");
      handleBeautify();
    };

    const handleToggleHistory = () => {
      if (!isFocusedRef.current) return;
      logger.info("🟢 QueryPanel handling toggle history event");
      toggleHistory();
    };

    const handleExecuteEvent = () => {
      if (!isFocusedRef.current) return;
      logger.info("🟢 QueryPanel handling execute event");
      handleExecute();
    };

    const handleExplainEvent = () => {
      if (!isFocusedRef.current) return;
      logger.info("🟢 QueryPanel handling explain event");
      handleExplain();
    };

    // Subscribe ALWAYS - handlers check focus
    eventBus.on("query-editor:format", handleFormat);
    eventBus.on("query-editor:toggle-history", handleToggleHistory);
    eventBus.on("query-editor:execute", handleExecuteEvent);
    eventBus.on("query-editor:explain", handleExplainEvent);

    return () => {
      eventBus.off("query-editor:format", handleFormat);
      eventBus.off("query-editor:toggle-history", handleToggleHistory);
      eventBus.off("query-editor:execute", handleExecuteEvent);
      eventBus.off("query-editor:explain", handleExplainEvent);
    };
  }, [handleBeautify, toggleHistory, handleExecute, handleExplain]);

  // Focus panel when QueryPanel is clicked or focused
  const handleFocusPanel = useCallback(() => {
    if (panelId) {
      const state = useWorkbenchStore.getState();
      state.focusPanel(panelId);
    }
  }, [panelId]);

  return (
    <div
      className={cn("flex flex-col h-full", className)}
      onMouseDown={handleFocusPanel}
      onFocus={handleFocusPanel}
    >
      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full rounded-xl overflow-hidden"
        >
          {/* Editor and Results */}
          <ResizablePanel
            defaultSize={showHistory ? 70 : 100}
            minSize={30}
            className="rounded-xl overflow-hidden"
          >
            <ResizablePanelGroup direction="vertical" className="h-full">
              {/* Editor */}
              <ResizablePanel
                defaultSize={50}
                minSize={20}
                className="border-none"
              >
                <div className="flex flex-col h-full relative">
                  {/* Transaction indicator badge */}
                  {inTransaction && (
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 bg-yellow-500/90 dark:bg-yellow-600/90 text-yellow-950 dark:text-yellow-50 text-xs font-medium rounded-md shadow-md backdrop-blur-sm border border-yellow-600/20">
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      IN TRANSACTION
                    </div>
                  )}
                  <QueryEditor
                    ref={editorRef}
                    connectionId={effectiveConnectionId}
                    database={database}
                    schema={schema}
                    dbType={dbType}
                    value={query}
                    onChange={(value) => {
                      const nextValue = value ?? "";
                      setQuery(nextValue);
                      persistSql(nextValue);
                    }}
                    onExecute={handleExecute}
                    isExecuting={isExecuting}
                    height="100%"
                    dialectOverride={
                      selectedDialect === "auto" ? undefined : selectedDialect
                    }
                    onDialectDetected={setDetectedDialect}
                  />
                  {/* Toolbar */}
                  <QueryToolbar
                    isExecuting={isExecuting}
                    query={query}
                    showHistory={showHistory}
                    showResults={showResults}
                    viewMode={viewMode}
                    appliedLimit={appliedLimit?.limit}
                    focused={isPanelFocused}
                    dialect={selectedDialect}
                    detectedDialect={detectedDialect}
                    isExplainResult={isExplainResult}
                    onExecute={() => handleExecute()}
                    onCancel={handleCancel}
                    onBeautify={handleBeautify}
                    onToggleHistory={toggleHistory}
                    onToggleResults={toggleResults}
                    onViewModeChange={setViewMode}
                    onDialectChange={setSelectedDialect}
                    onFocusEditor={focusEditor}
                  />
                </div>
              </ResizablePanel>

              {showResults && (
                <>
                  <div className="px-1">
                    <ResizableHandle className="bg-secondary !h-1 rounded-xl" />
                  </div>

                  {/* Results */}
                  <ResizablePanel defaultSize={50} minSize={20}>
                    <div className="flex flex-col h-full">
                      {/* Results */}
                      <div className="flex-1 min-h-0">
                        <ResultViewer
                          result={result}
                          isLoading={isExecuting}
                          isStreaming={isStreaming}
                          connectionId={effectiveConnectionId}
                          database={database}
                          height="100%"
                          gridId={queryGridId}
                          viewMode={viewMode}
                          cursorSetupMs={result?.cursorSetupMs}
                          totalStreamingMs={result?.totalStreamingMs}
                          fetchCount={result?.fetchCount}
                          networkMs={result?.networkMs}
                          conversionMs={result?.conversionMs}
                          ipcSendMs={result?.ipcSendMs}
                          multiResults={globalState?.multiResults}
                          activeResultIndex={globalState?.activeResultIndex}
                          onResultTabChange={(index) => {
                            setQueryState(tabId, { activeResultIndex: index });
                          }}
                        />
                      </div>
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {showHistory && (
            <>
              <ResizableHandle className="bg-secondary w-1" />

              {/* IconHistory and Saved Queries */}
              <ResizablePanel defaultSize={30} minSize={20}>
                <Tabs
                  defaultValue="history"
                  className="h-full flex flex-col px-1 rounded-xl"
                  enableShortcuts={true}
                  tabGroupId={`query-history-${tabId}`}
                  focused={isPanelFocused && showHistory}
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger
                      value="history"
                      tabIndex={0}
                    >
                      <IconHistory className="mr-1" />
                      IconHistory
                    </TabsTrigger>
                    <TabsTrigger value="saved" tabIndex={1}>
                      <IconStar className="mr-1" />
                      Saved
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="history" className="flex-1 mt-0">
                    <QueryHistory
                      connectionId={effectiveConnectionId}
                      database={database}
                      onSelectQuery={handleSelectQuery}
                    />
                  </TabsContent>
                  <TabsContent value="saved" className="flex-1 mt-0">
                    <SavedQueries
                      connectionId={effectiveConnectionId}
                      database={database}
                      currentQuery={query}
                      onSelectQuery={handleSelectQuery}
                    />
                  </TabsContent>
                </Tabs>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
});
