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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { History, Star } from "lucide-react";
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
import { useConnectionStore } from "@/stores/connectionStoreNew";

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
  const [viewMode, setViewModeInternal] = useState<"table" | "json">(
    globalState?.viewMode || "table",
  );

  // Wrapper setters that update ONLY local state (Zustand sync happens in useEffect)
  const setQuery = useCallback((value: string) => {
    setQueryInternal(value);
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

  const setAppliedLimit = useCallback(
    (value: { originalSql: string; limit: number } | null) => {
      setAppliedLimitInternal(value);
    },
    [],
  );

  const setViewMode = useCallback((value: "table" | "json") => {
    setViewModeInternal(value);
  }, []);

  const smartQueryLimit = usePreferencesStore((state) => state.smartQueryLimit);
  const updateTabMetadata = useWorkbenchStore(
    (state) => state.updateTabMetadata,
  );

  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
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
    });
  }, [
    query,
    result,
    isExecuting,
    isStreaming,
    appliedLimit,
    viewMode,
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

  const handleExecute = useCallback(
    async (queryToExecute?: string) => {
      let sql = queryToExecute ?? query;

      // Clean up the SQL - remove trailing semicolons as they cause issues
      sql = sql.trim().replace(/;\s*$/, "");

      if (!sql) {
        toast.error("Please enter a query to execute");
        return;
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

        // Throttle updates using requestAnimationFrame
        const renderedCountRef = { current: 0 };
        const scheduleUpdate = (force = false) => {
          if (!force && rafId !== undefined) return; // Already scheduled

          if (rafId !== undefined && force) {
            cancelAnimationFrame(rafId);
            rafId = undefined;
          }

          rafId = requestAnimationFrame(() => {
            rafId = undefined;
            // Use startTransition for streaming updates to keep UI responsive
            // Users can still type SQL, click buttons while results stream in
            startTransition(() => {
              setResult((prev) => {
                if (!prev) {
                  renderedCountRef.current = accumulatedRows.length;
                  return {
                    columns: currentColumns,
                    columnMeta: currentColumnMeta,
                    rows: accumulatedRows.slice(0),
                    rowCount: accumulatedRows.length,
                    executionTime: 0,
                  };
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
        };

        if (!effectiveConnectionId) {
          throw new Error("No active connection selected");
        }

        const streamPromise = tableStreamingService.streamQuery(
          effectiveConnectionId,
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
        );

        const final = await streamPromise;

        // Cancel any pending animation frame - we'll do immediate final update
        if (rafId !== undefined) {
          cancelAnimationFrame(rafId);
          rafId = undefined;
        }

        // Use backend's actual database execution time, not frontend timer
        executionTime = final.executionTimeMs ?? 0;

        // CRITICAL: Direct state update (bypass RAF) to ensure ALL rows are immediately visible
        // This fixes the issue where RAF throttling could cause the last batch to not render
        // Create new array reference to force React re-render
        setResult({
          columns: currentColumns,
          columnMeta: currentColumnMeta,
          rows: [...accumulatedRows], // New array reference forces React to detect change
          rowCount: final.totalRows ?? accumulatedRows.length,
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

        queryResult = {
          columns: final.columns.map((c) => c.name),
          columnMeta: final.columns as unknown as ColumnMeta[],
          rows: [], // Don't store rows again - already in state
          rowCount: final.totalRows ?? rowCount,
          executionTime,
        };
      } catch (error) {
        // Check if this is a user cancellation
        const isCancellation =
          (error instanceof Error && error.name === "AbortError") ||
          (error instanceof Error && error.message.includes("cancelled")) ||
          (error instanceof Error && error.message.includes("interrupted"));

        if (isCancellation) {
          // User cancelled - don't show as error
          console.log("Query cancelled by user");
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

          console.error("Query execution failed:", error);
        }
      } finally {
        setIsExecuting(false);
        setIsStreaming(false);
        setAbortController(null);

        // Save to history (skip if cancelled)
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
    ],
  );

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
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
                <div className="flex flex-col h-full">
                  <QueryEditor
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
                  />
                  {/* Toolbar */}
                  <QueryToolbar
                    isExecuting={isExecuting}
                    query={query}
                    showHistory={showHistory}
                    viewMode={viewMode}
                    appliedLimit={appliedLimit?.limit}
                    onExecute={() => handleExecute()}
                    onCancel={handleCancel}
                    onBeautify={handleBeautify}
                    onToggleHistory={() => {
                      setShowHistory(!showHistory);
                    }}
                    onViewModeChange={setViewMode}
                  />
                </div>
              </ResizablePanel>

              <div className="px-1">
                <ResizableHandle className="bg-secondary !h-1 rounded-lg" />
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
            </ResizablePanelGroup>
          </ResizablePanel>

          {showHistory && (
            <>
              <ResizableHandle className="bg-secondary w-1" />

              {/* History and Saved Queries */}
              <ResizablePanel defaultSize={30} minSize={20}>
                <Tabs
                  defaultValue="history"
                  className="h-full flex flex-col px-1 rounded-lg"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="history" className="text-xs">
                      <History className="h-3 w-3 mr-1" />
                      History
                    </TabsTrigger>
                    <TabsTrigger value="saved" className="text-xs">
                      <Star className="h-3 w-3 mr-1" />
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
