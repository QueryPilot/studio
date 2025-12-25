import { logger } from "@/lib/logger";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useReducer,
} from "react";
import { debounce } from "lodash";
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
import { IconHistory, IconStar, IconListTree } from "@tabler/icons-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabStateStore } from "@/stores/tabStateStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { formatSql } from "@/utils/codeFormatter";
import type { SqlDialect } from "@/components/CodeEditor/types";
import type { QueryEditorRef } from "./QueryEditor";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import {
  parseSqlStatements,
  hasMultipleStatements,
} from "@/utils/sqlStatementParser";
import { eventBus } from "@/services/eventBus";
import { useQueryExecution } from "./hooks/useQueryExecution";
import { useTransactionState } from "./hooks/useTransactionState";
import { databaseService } from "@/services/databaseService";

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
// STATE REDUCER - UI state only (execution state moved to useQueryExecution hook)
// ============================================================================
interface QueryPanelState {
  query: string;
  showHistory: boolean;
  showOutline: boolean;
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  selectedDialect: SqlDialect | "auto";
  detectedDialect: SqlDialect;
  showResults: boolean;
  isExplainResult: boolean;
}

type QueryPanelAction =
  | { type: "SET_QUERY"; payload: string }
  | { type: "SET_SHOW_HISTORY"; payload: boolean }
  | { type: "SET_SHOW_OUTLINE"; payload: boolean }
  | {
      type: "SET_VIEW_MODE";
      payload: "table" | "json" | "explain" | "raw" | "stats";
    }
  | { type: "SET_SELECTED_DIALECT"; payload: SqlDialect | "auto" }
  | { type: "SET_DETECTED_DIALECT"; payload: SqlDialect }
  | { type: "SET_SHOW_RESULTS"; payload: boolean }
  | { type: "SET_IS_EXPLAIN_RESULT"; payload: boolean }
  | { type: "BATCH_UPDATE"; payload: Partial<QueryPanelState> };

function queryPanelReducer(
  state: QueryPanelState,
  action: QueryPanelAction,
): QueryPanelState {
  switch (action.type) {
    case "SET_QUERY":
      return { ...state, query: action.payload };
    case "SET_SHOW_HISTORY":
      return { ...state, showHistory: action.payload };
    case "SET_SHOW_OUTLINE":
      return { ...state, showOutline: action.payload };
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
    showHistory: false,
    showOutline: false,
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
  const pinResult = useTabStateStore((state) => state.pinResult);
  const unpinResult = useTabStateStore((state) => state.unpinResult);
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
    showHistory,
    showOutline,
    viewMode,
    selectedDialect,
    detectedDialect,
    showResults,
    isExplainResult,
  } = state;

  const smartQueryLimit = usePreferencesStore((state) => state.smartQueryLimit);
  const activeConnectionId = useWorkspaceSelectionStore(
    (state) => state.connectionId,
  );

  const effectiveConnectionId = useMemo(
    () => connectionId || activeConnectionId || "",
    [connectionId, activeConnectionId],
  );

  // ============================================================================
  // HOOKS - Execution and transaction state managed by dedicated hooks
  // ============================================================================
  const {
    isExecuting,
    isStreaming,
    result,
    appliedLimit,
    execute,
    executeMulti,
    cancel: cancelExecution,
  } = useQueryExecution({
    connectionId: effectiveConnectionId,
    database,
    tabId,
    smartQueryLimit: smartQueryLimit ?? undefined,
  });

  const { inTransaction } = useTransactionState({
    tabId,
  });

  // Editor ref for focusing
  const editorRef = useRef<QueryEditorRef>(null);

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

  const updateTabMetadata = useWorkbenchStore(
    (state) => state.updateTabMetadata,
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
  // Note: Execution state (result, isExecuting, isStreaming, appliedLimit) is synced by useQueryExecution hook
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Batch UI state updates into single Zustand update
    setQueryState(tabId, {
      query,
      viewMode,
      selectedDialect,
    });
  }, [
    query,
    viewMode,
    selectedDialect,
    tabId,
    setQueryState,
  ]);

  // Cleanup global state when component fully unmounts (tab closed, not just moved)
  // We don't clear on unmount because tab might just be moving between panels
  // Instead, workbenchStore should call clearQueryState when tab is actually removed

  const lastPersistedRef = useRef<string>(globalState?.query ?? initialSql);
  const persistSqlRef = useRef<ReturnType<typeof debounce> | null>(null);
  const metadataRef = useRef({ panelId, tabId, updateTabMetadata });

  // Keep metadata ref current
  useEffect(() => {
    metadataRef.current = { panelId, tabId, updateTabMetadata };
  }, [panelId, tabId, updateTabMetadata]);

  // Create stable debounced function once
  useEffect(() => {
    const abortController = new AbortController();

    const persistSql = debounce((value: string) => {
      if (abortController.signal.aborted) return;
      if (value === lastPersistedRef.current) return;
      lastPersistedRef.current = value;

      const { panelId, tabId, updateTabMetadata } = metadataRef.current;
      if (!panelId || !tabId) return; // Guard against undefined
      updateTabMetadata(panelId, tabId, { sql: value });
    }, 250);

    persistSqlRef.current = persistSql;

    return () => {
      abortController.abort();
      persistSql.cancel();
    };
  }, []); // Empty deps - create once, cleanup on unmount

  /**
   * Execute query - wrapper that handles multi-statement detection
   * and delegates to the hook's execute/executeMulti functions
   */
  const handleExecute = useCallback(
    async (queryToExecute?: string) => {
      const sql = queryToExecute ?? query;

      if (!sql || !sql.trim()) {
        toast.error("Please enter a query to execute");
        return;
      }

      // If the editor passed an explicit statement (selection or current block),
      // treat it as a single statement and SKIP multi-statement detection.
      const shouldSkipMultiCheck = typeof queryToExecute === "string";

      // Check if this is a multi-statement query (only when not forced single)
      if (!shouldSkipMultiCheck && hasMultipleStatements(sql)) {
        const statements = parseSqlStatements(sql).map((s) => s.text);
        logger.info(
          `[handleExecute] Multi-statement query detected: ${statements.length} statements`,
        );
        await executeMulti(statements);
        return;
      }

      // Single statement execution - clean up trailing semicolons
      const cleanSql = sql.trim().replace(/;\s*$/, "");
      if (!cleanSql) {
        toast.error("Please enter a query to execute");
        return;
      }

      await execute(cleanSql);
    },
    [query, execute, executeMulti],
  );

  /**
   * Cancel running query - delegates to hook
   */
  const handleCancel = useCallback(() => {
    cancelExecution();
    toast.info("Query cancelled");
  }, [cancelExecution]);

  const handleGotoDefinition = useCallback(
    async (event: {
      type: "table" | "column";
      name: string;
      schema?: string;
      table?: string;
    }) => {
      if (event.type !== "table") {
        return;
      }

      const targetSchema = event.schema || schema || "public";

      try {
        const ddl = await databaseService.getObjectDefinition(
          connectionId,
          database,
          targetSchema,
          event.name,
          "table"
        );

        const { focusedPanelId, addTab, panelContents, focusPanel } =
          useWorkbenchStore.getState();

        let targetPanelId = focusedPanelId;
        if (!targetPanelId && panelContents.size > 0) {
          const firstPanelId = Array.from(panelContents.keys())[0];
          if (firstPanelId) {
            targetPanelId = firstPanelId;
            focusPanel(firstPanelId);
          }
        }

        if (!targetPanelId) return;

        const tabId = `ddl-${targetSchema}-${event.name}-${Date.now()}`;

        addTab(targetPanelId, tabId, {
          type: "query",
          title: `DDL: ${event.name}`,
          connectionId,
          database,
          schema: targetSchema,
          sql: ddl,
        });

        toast.success(`Opened DDL for ${targetSchema}.${event.name}`);
      } catch (error) {
        logger.error("Failed to fetch DDL:", error);
        toast.error(
          `Failed to fetch DDL for ${event.name}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
    [connectionId, database, schema]
  );

  const handleSelectQuery = useCallback(
    (selectedQuery: string) => {
      setQuery(selectedQuery);
      persistSqlRef.current?.(selectedQuery);
    },
    [setQuery],
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
      // Update CodeMirror editor directly (initialValue is not reactive)
      editorRef.current?.setValue(beautified);
      setQuery(beautified);
      persistSqlRef.current?.(beautified);
      toast.success("Query formatted");
    }
  }, [query, dbType, setQuery]);

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

  const toggleOutline = useCallback(() => {
    dispatch({ type: "SET_SHOW_OUTLINE", payload: !showOutline });
  }, [showOutline]);

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

  // Use refs for stable handler identity
  const handlersRef = useRef({
    format: () => {},
    execute: () => {},
    toggleHistory: () => {},
    explain: () => {},
  });

  // Update refs when handlers change (doesn't change identity)
  useEffect(() => {
    handlersRef.current.format = handleBeautify;
    handlersRef.current.execute = handleExecute;
    handlersRef.current.toggleHistory = toggleHistory;
    handlersRef.current.explain = handleExplain;
  }, [handleBeautify, handleExecute, toggleHistory, handleExplain]);

  // Subscribe once with stable wrapper
  useEffect(() => {
    const onFormat = () => {
      if (!isFocusedRef.current) return;
      logger.info("🟢 QueryPanel handling format event");
      handlersRef.current.format();
    };

    const onToggleHistory = () => {
      if (!isFocusedRef.current) return;
      logger.info("🟢 QueryPanel handling toggle history event");
      handlersRef.current.toggleHistory();
    };

    const onExecute = () => {
      if (!isFocusedRef.current) return;
      logger.info("🟢 QueryPanel handling execute event");
      handlersRef.current.execute();
    };

    const onExplain = () => {
      if (!isFocusedRef.current) return;
      logger.info("🟢 QueryPanel handling explain event");
      handlersRef.current.explain();
    };

    eventBus.on("query-editor:format", onFormat);
    eventBus.on("query-editor:toggle-history", onToggleHistory);
    eventBus.on("query-editor:execute", onExecute);
    eventBus.on("query-editor:explain", onExplain);

    return () => {
      eventBus.off("query-editor:format", onFormat);
      eventBus.off("query-editor:toggle-history", onToggleHistory);
      eventBus.off("query-editor:execute", onExecute);
      eventBus.off("query-editor:explain", onExplain);
    };
  }, []); // Empty deps - subscribe once

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
                      persistSqlRef.current?.(nextValue);
                    }}
                    onExecute={handleExecute}
                    onGotoDefinition={handleGotoDefinition}
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
                    showOutline={showOutline}
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
                    onToggleOutline={toggleOutline}
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
                          schema={schema}
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
                          multiResults={globalState?.multiResults}
                          activeResultIndex={globalState?.activeResultIndex ?? 0}
                          onResultTabChange={(index) => {
                            setQueryState(tabId, { activeResultIndex: index });
                          }}
                          tabId={tabId}
                          pinnedResult={globalState?.pinnedResult}
                          pinnedResultQuery={globalState?.pinnedResultQuery}
                          onPinResult={() => {
                            pinResult(tabId);
                            toast.success("Result pinned", {
                              description: "This result will remain visible while you run new queries",
                            });
                          }}
                          onUnpinResult={() => {
                            unpinResult(tabId);
                            toast.success("Result unpinned");
                          }}
                          currentQuery={globalState?.lastExecutedQuery}
                        />
                      </div>
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {(showHistory || showOutline) && (
            <>
              <ResizableHandle className="bg-secondary w-1" />

              {/* History, Outline, and Saved Queries */}
              <ResizablePanel defaultSize={30} minSize={20}>
                <Tabs
                  defaultValue={showOutline ? "outline" : "history"}
                  className="h-full flex flex-col px-1 rounded-xl"
                  enableShortcuts={true}
                  tabGroupId={`query-side-panel-${tabId}`}
                  focused={isPanelFocused && (showHistory || showOutline)}
                >
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger
                      value="outline"
                      tabIndex={0}
                      className={cn(!showOutline && "hidden")}
                    >
                      <IconListTree className="mr-1" />
                      Outline
                    </TabsTrigger>
                    <TabsTrigger
                      value="history"
                      tabIndex={1}
                      className={cn(!showHistory && "hidden")}
                    >
                      <IconHistory className="mr-1" />
                      History
                    </TabsTrigger>
                    <TabsTrigger
                      value="saved"
                      tabIndex={2}
                      className={cn(!showHistory && "hidden")}
                    >
                      <IconStar className="mr-1" />
                      Saved
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="outline" className="flex-1 mt-0">
                    <QueryOutline
                      sql={query}
                      onNavigate={() => {
                        editorRef.current?.focus();
                      }}
                    />
                  </TabsContent>
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
