import { logger } from "@/lib/logger";
import {
  memo,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  startTransition,
} from "react";
import { QueryEditor } from "./QueryEditor";
import { ResultViewer } from "./ResultViewer";
import { QueryHistory } from "./QueryHistory";
import { SavedQueries } from "./SavedQueries";
import { QueryToolbar } from "./QueryToolbar";
import { QueryOutline } from "./QueryOutline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { IconHistory, IconStar } from '@tabler/icons-react';
import { toast } from "sonner";

import { tableStreamingService } from "@/services/tableStreamingService";
import { queryHistoryService } from "@/services/queryHistoryService";
import { cn } from "@/lib/utils";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabStateStore, type QueryResult } from "@/stores/tabStateStore";
import type { ColumnMeta } from "@/types/database";
import { formatSql } from "@/utils/codeFormatter";
import type { SqlDialect } from "@/components/CodeEditor/types";
import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { handleMutationCache, isMutationQuery, isSelectQuery } from "@/lib/cacheManager";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { parseMutationTables } from "@/utils/sqlParser";
import { eventBus } from "@/services/eventBus";

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

  const [query, setQueryInternal] = useState<string>(
    globalState?.query ?? initialSql,
  );
  const [result, setResultInternal] = useState<QueryResult | null>(
    globalState?.result || null,
  );
  const [isExecuting, setIsExecutingInternal] = useState(
    globalState?.isExecuting || false,
  );
  const [isStreaming, setIsStreamingInternal] = useState(
    globalState?.isStreaming || false,
  );
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [appliedLimit, setAppliedLimitInternal] = useState<{
    originalSql: string;
    limit: number;
  } | null>(globalState?.appliedLimit || null);
  const [viewMode, setViewModeInternal] = useState<"table" | "json" | "explain" | "raw" | "stats">(
    globalState?.viewMode || "table",
  );
  // Track if the current result is from an EXPLAIN query
  const [isExplainResult, setIsExplainResult] = useState(false);

  // Dialect selection: "auto" means auto-detect, otherwise use selected dialect
  const [selectedDialect, setSelectedDialect] = useState<SqlDialect | "auto">(
    globalState?.selectedDialect || "auto"
  );
  const [detectedDialect, setDetectedDialect] = useState<SqlDialect>("postgresql");
  
  // Results panel visibility - hidden by default, shown when query executes
  const [showResults, setShowResults] = useState(result !== null);

  // Outline panel visibility - default false, can be toggled via toolbar in future
  const [showOutline, _setShowOutline] = useState(false);
  // Suppress unused setter warning - will be used when outline toggle is added to toolbar
  void _setShowOutline;

  // Get transaction state from persisted store
  const inTransaction = globalState?.inTransaction || false;

  // Editor ref for focusing
  const editorRef = useRef<SqlEditorRef>(null);

  // Wrapper setters that update ONLY local state (Zustand sync happens in useEffect)
  const setQuery = useCallback(
    (value: string) => {
      setQueryInternal(value);
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
        setResultInternal(value);
      } else {
        setResultInternal(value);
      }
    },
    [],
  );

  const setIsExecuting = useCallback((value: boolean) => {
    setIsExecutingInternal(value);
  }, []);

  const setIsStreaming = useCallback((value: boolean) => {
    setIsStreamingInternal(value);
  }, []);

  const setAppliedLimit = useCallback(
    (value: { originalSql: string; limit: number } | null) => {
      setAppliedLimitInternal(value);
    },
    [],
  );

  const setViewMode = useCallback((value: "table" | "json" | "explain" | "raw" | "stats") => {
    setViewModeInternal(value);
  }, []);

  const smartQueryLimit = usePreferencesStore((state) => state.smartQueryLimit);
  const updateTabMetadata = useWorkbenchStore(
    (state) => state.updateTabMetadata,
  );

  const effectiveConnectionId = useMemo(
    () => connectionId || "",
    [connectionId],
  );

  useEffect(() => {
    // Connection ID is now always passed from parent
  }, [connectionId, panelId, tabId, updateTabMetadata]);

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

  // Ref to track if execution is in progress (prevents double-execution from duplicate events)
  const isExecutingRef = useRef(false);

  const handleExecute = useCallback(
    async (queryToExecute?: string) => {
      // Guard against double execution (e.g., from both keymap and eventBus)
      if (isExecutingRef.current) {
        logger.info("[handleExecute] Skipped - already executing");
        return;
      }
      isExecutingRef.current = true;

      logger.info("[handleExecute] Called with:", {
        queryToExecute,
        queryToExecuteLength: queryToExecute?.length || 0,
        fallbackQuery: query,
        fallbackQueryLength: query.length,
      });

      let sql = queryToExecute ?? query;

      logger.info("[handleExecute] Before trim:", {
        sql,
        sqlLength: sql.length,
      });

      // Clean up the SQL - remove trailing semicolons as they cause issues
      sql = sql.trim().replace(/;\s*$/, "");

      // Smart Query Limit
      // Only apply if enabled, it's a SELECT query, not an EXPLAIN, and no explicit LIMIT exists
      const isSelect = isSelectQuery(sql);
      const hasLimit = /\bLIMIT\b/i.test(sql);
      const isExplainQuery = sql.trim().toUpperCase().startsWith("EXPLAIN");

      if (
        smartQueryLimit &&
        smartQueryLimit > 0 &&
        isSelect &&
        !isExplainQuery &&
        !hasLimit
      ) {
        setAppliedLimit({ originalSql: sql, limit: smartQueryLimit });
        sql = `${sql} LIMIT ${smartQueryLimit}`;
        logger.info(`[handleExecute] Applied smart limit: ${smartQueryLimit}`);
      } else {
        setAppliedLimit(null);
      }

      logger.info("[handleExecute] After trim and semicolon removal:", {
        sql,
        sqlLength: sql.length,
        isEmpty: !sql,
      });

      if (!sql) {
        logger.info("[handleExecute] EMPTY QUERY - Showing error toast");
        toast.error("Please enter a query to execute");
        isExecutingRef.current = false;
        return;
      }

      // Detect if this is an EXPLAIN query
      const sqlUpper = sql.trim().toUpperCase();
      const isExplain = sqlUpper.startsWith("EXPLAIN");
      setIsExplainResult(isExplain);

      // Auto-switch to explain view mode for EXPLAIN queries
      if (isExplain) {
        setViewMode("explain");
      }

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
          sqlUpper.startsWith("SET ") ||
          sqlUpper.startsWith("RESET ");
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
          if (sqlUpper.startsWith("BEGIN") || sqlUpper.startsWith("START TRANSACTION")) {
            message = "Transaction started";
            setQueryState(tabId, { inTransaction: true });
            toast.success("Transaction started", {
              description: "This tab now has an active transaction. All queries in this tab will be part of this transaction until you COMMIT or ROLLBACK.",
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
                  `[QueryPanel] Invalidating table: ${schema ?? "public"}.${table}`,
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
              toast.info("Data modified - Refreshing results...");
              // Schedule refresh after current query completes
              setTimeout(() => {
                void handleExecute(lastSelectQuery);
              }, 100);
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
        isExecutingRef.current = false;
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
      tabId,
      setQueryState,
      setViewMode,
      globalState?.lastSelectQuery,
    ],
  );

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      isExecutingRef.current = false;
      setIsExecuting(false);
      setIsStreaming(false);
      setAbortController(null);

      // Cancel backend streaming
      tableStreamingService.cancel();

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
      // SQL Server: Use SET STATISTICS PROFILE
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

    // Execute the explain query (handleExecute auto-switches to explain view mode)
    void handleExecute(explainSql);
  }, [query, dbType, handleExecute]);

  const toggleHistory = useCallback(() => {
    setShowHistory((prev) => !prev);
  }, []);

  const toggleResults = useCallback(() => {
    setShowResults((prev) => !prev);
  }, []);

  // Auto-show results panel when query execution starts or completes
  useEffect(() => {
    if (isExecuting || result !== null) {
      setShowResults(true);
    }
  }, [isExecuting, result]);

  // Subscribe to event bus for keyboard shortcuts
  // Track if this panel is focused using a ref to avoid re-subscribing
  const isFocusedRef = useRef(false);
  
  useEffect(() => {
    // Update focus state
    isFocusedRef.current = (panelId === useWorkbenchStore.getState().focusedPanelId);
    
    const unsubscribe = useWorkbenchStore.subscribe((state) => {
      isFocusedRef.current = (panelId === state.focusedPanelId);
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
      void handleExecute();
    };

    // Subscribe ALWAYS - handlers check focus
    eventBus.on("query-editor:format", handleFormat);
    eventBus.on("query-editor:toggle-history", handleToggleHistory);
    eventBus.on("query-editor:execute", handleExecuteEvent);

    return () => {
      eventBus.off("query-editor:format", handleFormat);
      eventBus.off("query-editor:toggle-history", handleToggleHistory);
      eventBus.off("query-editor:execute", handleExecuteEvent);
    };
  }, [handleBeautify, toggleHistory, handleExecute]);

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
                <div className="flex h-full relative">
                  {/* Query Outline Sidebar */}
                  {showOutline && (
                    <div className="w-48 border-r flex-shrink-0 overflow-auto">
                      <QueryOutline
                        sql={query}
                        onNavigate={(line) => {
                          editorRef.current?.revealLine(line);
                        }}
                      />
                    </div>
                  )}
                  <div className="flex flex-col flex-1 min-w-0 relative">
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
                      setQuery(value);
                      persistSql(value);
                    }}
                    onExecute={handleExecute}
                    isExecuting={isExecuting}
                    height="100%"
                    dialectOverride={selectedDialect === "auto" ? undefined : selectedDialect}
                    onDialectDetected={setDetectedDialect}
                  />
                  {/* Toolbar */}
                  <QueryToolbar
                    isExecuting={isExecuting}
                    query={query}
                    showHistory={showHistory}
                    showResults={showResults}
                    viewMode={viewMode}
                    focused={isPanelFocused}
                    dialect={selectedDialect}
                    detectedDialect={detectedDialect}
                    isExplainResult={isExplainResult}
                    onExecute={() => handleExecute()}
                    onCancel={handleCancel}
                    onBeautify={handleBeautify}
                    onExplain={handleExplain}
                    onToggleHistory={toggleHistory}
                    onToggleResults={toggleResults}
                    onViewModeChange={setViewMode}
                    onDialectChange={setSelectedDialect}
                  />
                  </div>
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
                      className="text-xs"
                      tabIndex={0}
                    >
                      <IconHistory className="h-3 w-3 mr-1" />
                      IconHistory
                    </TabsTrigger>
                    <TabsTrigger value="saved" className="text-xs" tabIndex={1}>
                      <IconStar className="h-3 w-3 mr-1" />
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
