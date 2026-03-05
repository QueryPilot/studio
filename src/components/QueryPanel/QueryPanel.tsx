import { logger } from "@/lib/logger";
import {
  memo,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useDeferredValue,
} from "react";
import { QueryEditor } from "./QueryEditor";
import { ResultViewer } from "./ResultViewer";
import { QueryToolbar } from "./QueryToolbar";
import { QueryOutline } from "./QueryOutline";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { toast } from "sonner";

import { tableStreamingService } from "@/services/tableStreamingService";
import { cn } from "@/lib/utils";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useShallow } from "zustand/react/shallow";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabStateStore, type QueryResult } from "@/stores/tabStateStore";
import type { ColumnMeta } from "@/types/database";
import type { SqlDialect } from "@/components/CodeEditor/types";
import type { ViewMode } from "@/types/viewMode";
import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import {
  handleMutationCache,
  isMutationQuery,
  isSelectQuery,
} from "@/lib/cacheManager";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { parseMutationTables } from "@/utils/sqlParser";
import { eventBus } from "@/services/eventBus";
import { schemaCache } from "@/services/schemaCache";
import { trackQuery } from "@/services/queryTracker";
import { trackQueryExecution } from "@/services/aiContextService";
import { SaveQueryDialog } from "@/components/QueryHistory";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { editorRegistry } from "@/services/editorRegistry";
import { clearRustSchema, syncSchemaToRust } from "@/hooks/useRustSchemaSync";
import { clearCompletionCache } from "@/components/CodeEditor/languages/sql/optimized-completion";
import { clearProviderCache } from "@/components/CodeEditor/languages/sql/metadataProvider";

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

const QUERY_STORE_SYNC_DEBOUNCE_MS = 150;
const TAB_METADATA_SYNC_DEBOUNCE_MS = 1000;

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
  const loadTabStateAsync = useTabStateStore(
    (state) => state.loadTabStateAsync,
  );
  // Shallow comparison prevents re-render when only result/isExecuting/isStreaming change.
  // Those fields are tracked in local state and written TO the store — not read back reactively.
  // Without useShallow, every setQueryState call creates a new object ref → double render.
  const globalState = useTabStateStore(
    useShallow((state) => {
      const qs = state.queryStates.get(tabId);
      if (!qs) return null;
      return {
        query: qs.query,
        result: qs.result, // initial hydration only (when tab moves between panels)
        isExecuting: qs.isExecuting,
        isStreaming: qs.isStreaming,
        viewMode: qs.viewMode,
        selectedDialect: qs.selectedDialect,
        inTransaction: qs.inTransaction,
        lastExecutedQuery: qs.lastExecutedQuery,
        lastSelectQuery: qs.lastSelectQuery,
      };
    }),
  );
  // Subscribe to boolean only — avoids re-rendering when another panel gets focused
  const isPanelFocused = usePanelFocusStore(
    (state) => state.focusedPanelId === panelId,
  );

  // Load persisted tab state from IndexedDB on mount
  useEffect(() => {
    void loadTabStateAsync(tabId);
  }, [tabId, loadTabStateAsync]);

  // Track if we've synced from persistence
  const hasLoadedFromPersistence = useRef(false);

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
  // Cancellation is handled by tableStreamingService.cancel() — no local AbortController needed.
  // We use isExecutingRef as the guard for whether a cancel is valid.
  const [viewMode, setViewModeInternal] = useState<ViewMode>(
    globalState?.viewMode || "table",
  );
  // Track if the current result is from an EXPLAIN query
  const [isExplainResult, setIsExplainResult] = useState(false);

  // Dialect selection: "auto" means auto-detect, otherwise use selected dialect
  const [selectedDialect, setSelectedDialect] = useState<SqlDialect | "auto">(
    globalState?.selectedDialect || "auto",
  );
  const [detectedDialect, setDetectedDialect] =
    useState<SqlDialect>("postgresql");
  const deferredQuery = useDeferredValue(query);
  const hasQuery = query.trim().length > 0;

  // Results panel visibility - hidden by default, shown when query executes
  const [showResults, setShowResults] = useState(result !== null);

  // Outline panel visibility - hidden by default, toggleable via toolbar
  const [showOutline, setShowOutline] = useState(false);

  // Save query dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Get transaction state from persisted store
  const inTransaction = globalState?.inTransaction || false;

  // Keep latest query and query-state metadata in refs so hot-path callbacks stay stable.
  const queryRef = useRef(query);
  const lastExecutedQueryRef = useRef(globalState?.lastExecutedQuery || "");
  const lastSelectQueryRef = useRef(globalState?.lastSelectQuery || null);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    lastExecutedQueryRef.current = globalState?.lastExecutedQuery || "";
  }, [globalState?.lastExecutedQuery]);

  useEffect(() => {
    lastSelectQueryRef.current = globalState?.lastSelectQuery || null;
  }, [globalState?.lastSelectQuery]);

  // Sync persisted state to local state when loaded from IndexedDB
  // This runs once when globalState first becomes available
  useEffect(() => {
    if (globalState && !hasLoadedFromPersistence.current) {
      hasLoadedFromPersistence.current = true;
      // Only sync persisted fields (query, viewMode, selectedDialect)
      // Don't override if local state already has content from initialSql
      if (globalState.query && !query) {
        setQueryInternal(globalState.query);
      }
      setViewModeInternal(globalState.viewMode);
      if (globalState.selectedDialect) {
        setSelectedDialect(globalState.selectedDialect);
      }
    }
  }, [globalState, query]);

  // Editor ref for focusing
  const editorRef = useRef<SqlEditorRef>(null);

  // Register editor with the global registry for AI commands
  useEffect(() => {
    const editorId = `${panelId}:${tabId}`;

    // Register this editor
    editorRegistry.register({
      id: editorId,
      connectionId,
      database,
      schema,
      getRef: () => editorRef.current,
    });

    // Cleanup on unmount
    return () => {
      editorRegistry.unregister(editorId);
    };
  }, [panelId, tabId, connectionId, database, schema]);

  // Update focused editor when panel focus changes
  useEffect(() => {
    const editorId = `${panelId}:${tabId}`;
    if (isPanelFocused) {
      editorRegistry.setFocusedEditor(editorId);
    } else {
      editorRegistry.clearFocusedEditor(editorId);
    }
  }, [isPanelFocused, panelId, tabId]);

  // Wrapper setters that update ONLY local state (Zustand sync happens in useEffect)
  const setQuery = useCallback((value: string) => {
    queryRef.current = value;
    setQueryInternal((prev) => (prev === value ? prev : value));
  }, []);

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

  const setViewMode = useCallback(
    (value: ViewMode) => {
      setViewModeInternal(value);
    },
    [],
  );

  const updateTabMetadata = useWorkbenchStore(
    (state) => state.updateTabMetadata,
  );

  const effectiveConnectionId = useMemo(
    () => connectionId || "",
    [connectionId],
  );

  // Get profile ID from connection for saving queries
  const profileId = useMemo(() => {
    if (!effectiveConnectionId) return undefined;
    const connection = useConnectionStore.getState().getConnection(effectiveConnectionId);
    return connection?.profile.id;
  }, [effectiveConnectionId]);

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

  // Async sync: keep fast-changing query debounced while syncing execution state immediately.
  const isInitialStateSync = useRef(true);
  const isInitialQuerySync = useRef(true);
  const querySyncTimerRef = useRef<number | null>(null);

  // Sync execution state to tabStateStore. `result` is intentionally NOT a
  // dependency — during streaming, every batch triggers setResult which would
  // fire this effect, calling setQueryState (new Map + AI sync) per batch.
  // Result is synced once when isStreaming flips to false (see resultRef usage
  // below) and again in handleExecute after final setResult.
  const resultRef = useRef(result);
  resultRef.current = result;

  useEffect(() => {
    if (isInitialStateSync.current) {
      isInitialStateSync.current = false;
      return;
    }

    // When streaming ends, include the final result in the sync.
    // During streaming or executing, skip result to avoid churning the store.
    const includeResult = !isStreaming && !isExecuting;
    setQueryState(
      tabId,
      {
        ...(includeResult ? { result: resultRef.current } : {}),
        isExecuting,
        isStreaming,
        viewMode,
        selectedDialect,
        hasUnsavedChanges:
          queryRef.current.trim() !== lastExecutedQueryRef.current.trim(),
      },
      // Pass connection context for AI sync
      { connectionId: effectiveConnectionId, database, schema },
    );
  }, [
    isExecuting,
    isStreaming,
    viewMode,
    selectedDialect,
    tabId,
    setQueryState,
    effectiveConnectionId,
    database,
    schema,
  ]);

  useEffect(() => {
    if (isInitialQuerySync.current) {
      isInitialQuerySync.current = false;
      return;
    }

    if (querySyncTimerRef.current) {
      clearTimeout(querySyncTimerRef.current);
      querySyncTimerRef.current = null;
    }

    querySyncTimerRef.current = window.setTimeout(() => {
      querySyncTimerRef.current = null;
      setQueryState(
        tabId,
        {
          query,
          hasUnsavedChanges: query.trim() !== lastExecutedQueryRef.current.trim(),
        },
        { connectionId: effectiveConnectionId, database, schema },
      );
    }, QUERY_STORE_SYNC_DEBOUNCE_MS);
  }, [
    query,
    tabId,
    setQueryState,
    effectiveConnectionId,
    database,
    schema,
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
      }, TAB_METADATA_SYNC_DEBOUNCE_MS);
    },
    [panelId, tabId, updateTabMetadata],
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      setQuery(value);
      persistSql(value);
    },
    [persistSql, setQuery],
  );

  useEffect(() => {
    return () => {
      if (querySyncTimerRef.current) {
        clearTimeout(querySyncTimerRef.current);
        querySyncTimerRef.current = null;
        const latestQuery = queryRef.current;
        setQueryState(
          tabId,
          {
            query: latestQuery,
            hasUnsavedChanges:
              latestQuery.trim() !== lastExecutedQueryRef.current.trim(),
          },
          { connectionId: effectiveConnectionId, database, schema },
        );
      }
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [
    tabId,
    setQueryState,
    effectiveConnectionId,
    database,
    schema,
  ]);

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
        fallbackQuery: queryRef.current,
        fallbackQueryLength: queryRef.current.length,
      });

      let sql =
        queryToExecute ?? editorRef.current?.getValue() ?? queryRef.current;

      logger.info("[handleExecute] Before trim:", {
        sql,
        sqlLength: sql.length,
      });

      // Clean up the SQL - remove trailing semicolons as they cause issues
      sql = sql.trim().replace(/;\s*$/, "");

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

      // Auto-switch view mode based on query type
      if (isExplain) {
        setViewMode("explain");
      } else {
        // Reset to table view for regular queries (in case user was viewing explain results)
        setViewMode("table");
      }

      setIsExecuting(true);
      setIsStreaming(true);
      // Keep previous result so the grid stays MOUNTED (avoids expensive remount
      // of GlideDataGrid canvas + 20 hooks in BaseDataGrid). The first streaming
      // batch will overwrite it with new data. Only clear if previous was an error
      // or had no rows (grid wasn't mounted anyway).
      setResult((prev) => {
        if (prev && !prev.error && prev.rows.length > 0) return prev;
        return null;
      });

      let executionTime = 0;
      let errorMessage: string | undefined;
      const t0 = performance.now();

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

        // Throttle progressive renders. First batch renders SYNCHRONOUSLY
        // (no setTimeout/RAF delay) so data appears as fast as possible.
        // Subsequent batches are coalesced into RAF frames with a minimum gap.
        const renderedCountRef = { current: 0 };
        const hasRenderedOnce = { current: false };
        const MIN_UPDATE_INTERVAL_MS = 32; // ~2 frames — was 120ms, way too sluggish
        let lastUpdateTime = 0;

        const commitSnapshot = () => {
          const latestTotal = accumulatedRows.length;
          setResult((prev) => {
            if (!prev) {
              return {
                columns: currentColumns,
                columnMeta: currentColumnMeta,
                rows: accumulatedRows,
                rowCount: latestTotal,
                executionTime: 0,
              };
            }
            return {
              ...prev,
              columns: currentColumns,
              columnMeta: currentColumnMeta,
              rows: accumulatedRows,
              rowCount: latestTotal,
            };
          });
        };

        const scheduleUpdate = () => {
          const total = accumulatedRows.length;
          if (total === 0) return;

          // First render: commit IMMEDIATELY — no setTimeout/RAF indirection.
          // This shaves ~20ms off time-to-first-pixel.
          if (!hasRenderedOnce.current) {
            hasRenderedOnce.current = true;
            renderedCountRef.current = total;
            lastUpdateTime = performance.now();
            commitSnapshot();
            return;
          }

          // Already have a pending update queued — let it coalesce more rows.
          if (pendingTimeout !== undefined) return;

          const now = performance.now();
          const delay = Math.max(MIN_UPDATE_INTERVAL_MS - (now - lastUpdateTime), 0);

          pendingTimeout = window.setTimeout(() => {
            pendingTimeout = undefined;
            lastUpdateTime = performance.now();

            if (rafId !== undefined) return;
            rafId = requestAnimationFrame(() => {
              rafId = undefined;
              const currentTotal = accumulatedRows.length;
              if (currentTotal <= renderedCountRef.current) return;
              renderedCountRef.current = currentTotal;
              commitSnapshot();
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
              logger.info("[QueryPanel perf] columns received", { ms: Math.round(performance.now() - t0) });
            }
            if (progress.newRows && progress.newRows.length > 0) {
              accumulatedRows.push(...progress.newRows);
              rowCount = accumulatedRows.length;
              if (!hasRenderedOnce.current) {
                logger.info("[QueryPanel perf] first batch", { rows: progress.newRows.length, ms: Math.round(performance.now() - t0) });
              }
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
          // Pass query timeout from preferences (0 = no timeout)
          usePreferencesStore.getState().queryTimeoutSecs || undefined,
        );

        const final = await streamPromise;
        logger.info("[QueryPanel perf] stream resolved", { rows: accumulatedRows.length, ms: Math.round(performance.now() - t0) });

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
          rows: accumulatedRows,
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

        logger.info("[QueryPanel perf] final setResult done", { ms: Math.round(performance.now() - t0) });

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
            if (effectiveConnectionId.trim()) {
              clearCompletionCache(effectiveConnectionId);
              clearProviderCache(effectiveConnectionId);
            }

            if (affectedTables.length > 0) {
              const { invalidateTable, invalidateSchema } =
                useDataInvalidationStore.getState();

              if (isDDL) {
                affectedTables.forEach(({ schema: tableSchema }) => {
                  const targetSchema = tableSchema ?? schema;
                  logger.info(
                    `[QueryPanel] DDL detected - invalidating schema: ${targetSchema}`,
                  );
                  schemaCache.invalidateSchema(
                    effectiveConnectionId,
                    targetSchema,
                  );
                  invalidateSchema(
                    effectiveConnectionId,
                    database,
                    targetSchema,
                  );

                  // Ensure Rust and editor caches don't serve stale metadata
                  void clearRustSchema(effectiveConnectionId, targetSchema).then(
                    () => syncSchemaToRust(effectiveConnectionId, targetSchema),
                  );
                });
              }

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
            const lastSelectQuery = lastSelectQueryRef.current;
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
        lastExecutedQueryRef.current = sql;
        if (isSelect) {
          lastSelectQueryRef.current = sql;
        }

        // Track successful query in history
        void trackQuery({
          query: sql,
          connectionId: effectiveConnectionId,
          database,
          schema,
          executionTimeMs: executionTime,
          rowCount: final.totalRows ?? rowCount,
          success: true,
          source: "editor",
        });

        // Track for AI agent context
        void trackQueryExecution({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          query: sql,
          connectionId: effectiveConnectionId,
          database,
          schema,
          executedAt: Date.now(),
          executionTimeMs: executionTime,
          rowCount: final.totalRows ?? rowCount,
          success: true,
        });

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

          // Track failed query in history
          void trackQuery({
            query: sql,
            connectionId: effectiveConnectionId,
            database,
            schema,
            success: false,
            error: errorMessage,
            source: "editor",
          });

          // Track for AI agent context
          void trackQueryExecution({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            query: sql,
            connectionId: effectiveConnectionId,
            database,
            schema,
            executedAt: Date.now(),
            success: false,
            error: errorMessage,
          });
        }
      } finally {
        isExecutingRef.current = false;
        setIsExecuting(false);
        setIsStreaming(false);
        // Execution complete
      }
    },
    [
      effectiveConnectionId,
      database,
      schema,
      setIsExecuting,
      setIsStreaming,
      setResult,
      tabId,
      setQueryState,
      setViewMode,
    ],
  );

  const handleCancel = useCallback(() => {
    if (isExecutingRef.current) {
      isExecutingRef.current = false;
      setIsExecuting(false);
      setIsStreaming(false);

      // Cancel backend streaming — rejects the streamQuery promise with AbortError
      tableStreamingService.cancel();

      toast.info("Query cancelled");
    }
  }, [setIsExecuting, setIsStreaming]);

  const handleBeautify = useCallback(() => {
    const currentQuery = editorRef.current?.getValue() ?? queryRef.current;
    if (!currentQuery.trim()) return;

    if (editorRef.current) {
      editorRef.current.format();
      const formattedQuery = editorRef.current.getValue();
      if (formattedQuery !== currentQuery) {
        persistSql(formattedQuery);
        toast.success("Query formatted");
      }
      return;
    }

    // Fallback (should not happen in normal editor flow)
    setQuery(currentQuery);
  }, [persistSql, setQuery]);


  const toggleResults = useCallback(() => {
    setShowResults((prev) => !prev);
  }, []);
  const toggleOutline = useCallback(() => {
    setShowOutline((prev) => !prev);
  }, []);
  const closeOutline = useCallback(() => {
    setShowOutline(false);
  }, []);

  // Auto-show results panel when query execution starts or completes
  useEffect(() => {
    if (isExecuting || result !== null) {
      setShowResults(true);
    }
  }, [isExecuting, result]);

  // Subscribe to event bus for keyboard shortcuts
  useEffect(() => {
    const handleFormat = () => {
      // Check if THIS panel should handle the event
      if (usePanelFocusStore.getState().focusedPanelId !== panelId) return;
      logger.info("🟢 QueryPanel handling format event");
      handleBeautify();
    };

    const handleExecuteEvent = () => {
      if (usePanelFocusStore.getState().focusedPanelId !== panelId) return;
      logger.info("🟢 QueryPanel handling execute event");
      void handleExecute();
    };

    const handleSaveQuery = () => {
      if (usePanelFocusStore.getState().focusedPanelId !== panelId) return;
      if (!queryRef.current.trim()) {
        toast.error("No query to save");
        return;
      }
      logger.info("🟢 QueryPanel handling save query event");
      setShowSaveDialog(true);
    };

    const handleToggleResults = () => {
      if (usePanelFocusStore.getState().focusedPanelId !== panelId) return;
      logger.info("🟢 QueryPanel handling toggle results event");
      toggleResults();
    };

    // Subscribe ALWAYS - handlers check focus
    eventBus.on("query-editor:format", handleFormat);
    eventBus.on("query-editor:execute", handleExecuteEvent);
    eventBus.on("query-editor:save", handleSaveQuery);
    eventBus.on("query-panel:toggle-results", handleToggleResults);

    return () => {
      eventBus.off("query-editor:format", handleFormat);
      eventBus.off("query-editor:execute", handleExecuteEvent);
      eventBus.off("query-editor:save", handleSaveQuery);
      eventBus.off("query-panel:toggle-results", handleToggleResults);
    };
  }, [handleBeautify, handleExecute, toggleResults]);

  // Focus panel when QueryPanel is clicked or focused
  const handleFocusPanel = useCallback(() => {
    if (panelId) {
      const state = useWorkbenchStore.getState();
      state.focusPanel(panelId);
    }
  }, [panelId]);

  // Auto-focus editor when this panel becomes focused via keyboard navigation (Cmd+[ / Cmd+])
  // but NOT when focus is already within the panel (e.g., user clicked a search input in results)
  const panelContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isPanelFocused) {
      requestAnimationFrame(() => {
        // Don't steal focus if something within this panel is already focused
        const activeEl = document.activeElement;
        if (
          activeEl &&
          panelContainerRef.current?.contains(activeEl) &&
          activeEl !== panelContainerRef.current
        ) {
          return;
        }
        editorRef.current?.focus();
      });
    }
  }, [isPanelFocused]);

  return (
    <div
      ref={panelContainerRef}
      className={cn("flex flex-col h-full", className)}
      onMouseDown={handleFocusPanel}
    >
      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full rounded-xl overflow-hidden"
        >
          {/* Editor and Results */}
          <ResizablePanel
            defaultSize="100"
            minSize="30"
            className="rounded-xl overflow-hidden"
          >
            <ResizablePanelGroup orientation="vertical" className="h-full">
              {/* Editor */}
              <ResizablePanel
                defaultSize="50"
                minSize="20"
                className="border-none"
              >
                <ResizablePanelGroup orientation="horizontal" className="h-full">
                  {/* Editor Panel */}
                  <ResizablePanel
                    defaultSize="75"
                    minSize="30"
                    className="flex flex-col relative"
                  >
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
                      onChange={handleEditorChange}
                      onExecute={handleExecute}
                      isExecuting={isExecuting}
                      height="100%"
                      dialectOverride={
                        selectedDialect === "auto" ? undefined : selectedDialect
                      }
                      onDialectDetected={setDetectedDialect}
                      extraBottomPadding={100}
                    />
                    {/* Toolbar */}
                    <QueryToolbar
                      isExecuting={isExecuting}
                      hasQuery={hasQuery}
                      showResults={showResults}
                      showOutline={showOutline}
                      viewMode={viewMode}
                      focused={isPanelFocused}
                      dialect={selectedDialect}
                      detectedDialect={detectedDialect}
                      isExplainResult={isExplainResult}
                      onExecute={() => handleExecute()}
                      onCancel={handleCancel}
                      onBeautify={handleBeautify}
                      onToggleResults={toggleResults}
                      onToggleOutline={toggleOutline}
                      onViewModeChange={setViewMode}
                      onDialectChange={setSelectedDialect}
                    />
                  </ResizablePanel>

                  {/* Query Outline Sidebar - RESIZABLE RIGHT SIDE */}
                  {showOutline && (
                    <>
                      <ResizableHandle className="bg-border !w-0.5 hover:bg-primary/50 transition-colors" />
                      <ResizablePanel
                        defaultSize="25"
                        minSize="15"
                        maxSize="50"
                      >
                        <div className="h-full flex flex-col overflow-hidden bg-muted/30">
                          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 shrink-0">
                            <span className="text-xs font-medium text-muted-foreground">
                              Query Outline
                            </span>
                            <button
                              onClick={closeOutline}
                              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Close Outline"
                            >
                              <svg
                                className="w-3.5 h-3.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                          <div className="flex-1 min-h-0 overflow-auto">
                            <QueryOutline
                              sql={deferredQuery}
                              dialect={
                                selectedDialect === "auto"
                                  ? detectedDialect
                                  : selectedDialect
                              }
                              onNavigate={(position) => {
                                editorRef.current?.setCursorPosition(position);
                              }}
                            />
                          </div>
                        </div>
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </ResizablePanel>

              {showResults && (
                <>
                  <div className="px-1">
                    <ResizableHandle className="bg-secondary !h-1 rounded-xl" />
                  </div>

                  {/* Results */}
                  <ResizablePanel defaultSize="50" minSize="20">
                    <div className="flex flex-col h-full">
                      {/* Results */}
                      <div className="flex-1 min-h-0">
                        <ResultViewer
                          result={result}
                          isLoading={isExecuting}
                          isStreaming={isStreaming}
                          connectionId={effectiveConnectionId}
                          database={database}
                          databaseType={dbType}
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
        </ResizablePanelGroup>
      </div>

      {/* Save Query Dialog */}
      <SaveQueryDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        query={query}
        profileId={profileId}
        database={database}
        schema={schema}
      />
    </div>
  );
});
