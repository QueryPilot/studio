import { memo, useState, useCallback, useEffect, useMemo } from "react";
import { QueryEditor } from "./QueryEditor";
import { ResultViewer } from "./ResultViewer";
import { QueryHistory } from "./QueryHistory";
import { SavedQueries } from "./SavedQueries";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Play, StopCircle, History, Star } from "lucide-react";
import { toast } from "sonner";

import { streamingTableService } from "@/services/streamingTableService";
import { queryHistoryService } from "@/services/queryHistoryService";
import { cn } from "@/lib/utils";
import {
  useShortcut,
  useKeybindingHint,
  KeyboardScope,
} from "@/services/keyboard";
import {
  useSyncQueryState,
  useSyncEditorState,
} from "@/services/keyboard/integration/storeIntegration";
import useWorkbenchStore from "@/stores/workbenchStore";
import type { ColumnMeta } from "@/types/database";

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

interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: unknown[][];
  rowCount: number;
  executionTime?: number;
  error?: string;
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
  const [query, setQuery] = useState(initialSql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [hasSelection] = useState(false);
  const updateTabMetadata = useWorkbenchStore(
    (state) => state.updateTabMetadata,
  );

  const queryGridId = useMemo(
    () => `query:${connectionId}:${database}:${schema}:${tabId}`,
    [connectionId, database, schema, tabId],
  );

  useEffect(() => {
    setQuery(initialSql);
  }, [initialSql]);

  const persistSql = useCallback(
    (value: string) => {
      if (!panelId || !tabId) return;
      updateTabMetadata(panelId, tabId, { sql: value });
    },
    [panelId, tabId, updateTabMetadata],
  );

  // Sync state with keyboard context
  useSyncQueryState(isExecuting, !!result);
  useSyncEditorState(hasSelection, query !== "", false);

  const handleExecute = useCallback(
    async (queryToExecute?: string) => {
      let sql = queryToExecute || query;

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
        const scheduleUpdate = () => {
          if (rafId !== undefined) return; // Already scheduled

          rafId = requestAnimationFrame(() => {
            rafId = undefined;
            setResult((prev) => {
              if (!prev) {
                // First update
                return {
                  columns: currentColumns,
                  columnMeta: currentColumnMeta,
                  rows: [...accumulatedRows],
                  rowCount: accumulatedRows.length,
                  executionTime: 0,
                };
              }
              // Update with accumulated rows
              return {
                ...prev,
                rows: [...accumulatedRows],
                rowCount: accumulatedRows.length,
              };
            });
          });
        };

        const streamPromise = streamingTableService.streamQuery(
          connectionId,
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
          (err) => {
            toast.error(err.message || "Stream error");
          },
        );

        const final = await streamPromise;

        // Cancel any pending animation frame
        if (rafId !== undefined) {
          cancelAnimationFrame(rafId);
        }

        // Use backend's actual database execution time, not frontend timer
        executionTime = final.executionTimeMs ?? 0;

        // Final update with all rows and execution time
        setResult({
          columns: currentColumns,
          columnMeta: currentColumnMeta,
          rows: accumulatedRows,
          rowCount: final.totalRows ?? accumulatedRows.length,
          executionTime,
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
        toast.success(
          `Query executed successfully (${
            final.totalRows ?? final.rows.length
          } rows)`,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          toast.info("Query execution cancelled");
          return;
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

        // Save to history
        if (sql.trim() && !controller.signal.aborted) {
          await queryHistoryService.addEntry({
            connectionId,
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
    [query, connectionId, database],
  );

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setIsExecuting(false);
      setAbortController(null);
    }
  }, [abortController]);

  const handleSelectQuery = useCallback(
    (selectedQuery: string) => {
      setQuery(selectedQuery);
      persistSql(selectedQuery);
    },
    [persistSql],
  );

  const handleBeautify = useCallback(() => {
    // Basic SQL formatting
    if (!query.trim()) return;

    const beautified = query
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s*(=|<|>|<=|>=|!=|<>)\s*/g, " $1 ")
      .replace(/\bSELECT\b/gi, "SELECT")
      .replace(/\bFROM\b/gi, "\nFROM")
      .replace(/\bWHERE\b/gi, "\nWHERE")
      .replace(/\bJOIN\b/gi, "\nJOIN")
      .replace(/\bINNER\s+JOIN\b/gi, "\nINNER JOIN")
      .replace(/\bLEFT\s+JOIN\b/gi, "\nLEFT JOIN")
      .replace(/\bRIGHT\s+JOIN\b/gi, "\nRIGHT JOIN")
      .replace(/\bORDER\s+BY\b/gi, "\nORDER BY")
      .replace(/\bGROUP\s+BY\b/gi, "\nGROUP BY")
      .replace(/\bHAVING\b/gi, "\nHAVING")
      .trim();

    setQuery(beautified);
    persistSql(beautified);
    toast.success("Query formatted");
  }, [query, persistSql]);

  // Removed cmd+enter shortcut - now handled directly by CodeMirror editor

  useShortcut("alt+f", handleBeautify, {
    when: "queryEditor.focus && query",
    preventDefault: true,
    description: "Format SQL",
  });

  useShortcut(
    "alt+h",
    () => {
      setShowHistory((prev) => !prev);
    },
    {
      when: "queryEditor.focus",
      preventDefault: true,
      description: "Toggle history",
    },
  );

  // Get keybinding hints for UI
  const executeHint = useKeybindingHint("query.execute");
  const beautifyHint = useKeybindingHint("query.beautify");

  // Focus panel when QueryPanel is clicked or focused
  const handleFocusPanel = useCallback(() => {
    if (panelId) {
      const state = useWorkbenchStore.getState();
      state.focusPanel(panelId);
    }
  }, [panelId]);

  return (
    <KeyboardScope context="queryEditor">
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
                <ResizablePanel defaultSize={50} minSize={20}>
                  <QueryEditor
                    connectionId={connectionId}
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
                    height="100%"
                  />
                </ResizablePanel>

                {/* Toolbar - Compact and cozy */}
                <div className="flex items-center justify-end gap-1 px-2 py-1 border-y bg-muted/20 flex-shrink-0">
                  <Button
                    size="sm"
                    variant={isExecuting ? "destructive" : "default"}
                    onClick={isExecuting ? handleCancel : () => handleExecute()}
                    disabled={!query.trim() && !isExecuting}
                    className="h-7 text-xs"
                    title={
                      isExecuting
                        ? "Cancel execution"
                        : executeHint
                        ? `Execute query (${executeHint})`
                        : "Execute query"
                    }
                  >
                    {isExecuting ? (
                      <>
                        <StopCircle className="h-3.5 w-3.5 mr-1" />
                        Cancel
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 mr-1" />
                        Execute
                      </>
                    )}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleBeautify}
                    disabled={isExecuting || !query.trim()}
                    className="h-7 text-xs"
                    title={
                      beautifyHint
                        ? `Format SQL (${beautifyHint})`
                        : "Format SQL"
                    }
                  >
                    Beautify
                  </Button>

                  <div className="w-px h-4 bg-border mx-1" />

                  <Button
                    size="sm"
                    variant={showHistory ? "secondary" : "ghost"}
                    onClick={() => {
                      setShowHistory(!showHistory);
                    }}
                    className="h-7 text-xs"
                    title="Toggle history panel (⌥+H)"
                  >
                    <History className="h-3.5 w-3.5 mr-1" />
                    History
                  </Button>
                </div>

                {/* Results */}
                <ResizablePanel defaultSize={50} minSize={20}>
                  <ResultViewer
                    result={result}
                    isLoading={isExecuting}
                    isStreaming={isStreaming}
                    connectionId={connectionId}
                    database={database}
                    height="100%"
                    gridId={queryGridId}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>

            {showHistory && (
              <>
                <ResizableHandle />

                {/* History and Saved Queries */}
                <ResizablePanel defaultSize={30} minSize={20}>
                  <Tabs defaultValue="history" className="h-full flex flex-col">
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
                        connectionId={connectionId}
                        database={database}
                        onSelectQuery={handleSelectQuery}
                      />
                    </TabsContent>
                    <TabsContent value="saved" className="flex-1 mt-0">
                      <SavedQueries
                        connectionId={connectionId}
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
    </KeyboardScope>
  );
});
