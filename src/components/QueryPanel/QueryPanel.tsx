import { memo, useState, useCallback, useEffect } from "react";
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
import { tableDataService } from "@/services/tableDataService";
import { queryHistoryService } from "@/services/queryHistoryService";
import { cn } from "@/lib/utils";

interface QueryPanelProps {
  connectionId: string;
  database: string;
  schema?: string;
  dbType?: string;
  className?: string;
}

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTime?: number;
  error?: string;
}

export const QueryPanel = memo(function QueryPanel({
  connectionId,
  database,
  schema = "public",
  dbType = "postgres",
  className,
}: QueryPanelProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const handleExecute = useCallback(
    async (queryToExecute?: string) => {
      const sql = queryToExecute || query;

      if (!sql.trim()) {
        toast.error("Please enter a query to execute");
        return;
      }

      setIsExecuting(true);
      setResult(null);

      // Create abort controller for cancellation
      const controller = new AbortController();
      setAbortController(controller);

      const startTime = Date.now();
      let executionTime = 0;
      let queryResult: QueryResult | null = null;
      let errorMessage: string | undefined;

      try {
        const response = await tableDataService.executeQuery(
          connectionId,
          database,
          sql,
          {
            limit: 1000,
            signal: controller.signal,
          },
        );

        executionTime = Date.now() - startTime;

        // Transform response to our format
        queryResult = {
          columns: response.columns,
          rows: response.rows,
          rowCount: response.rows.length,
          executionTime,
        };

        setResult(queryResult);
        toast.success(
          `Query executed successfully (${queryResult.rowCount} rows)`,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          toast.info("Query execution cancelled");
          return;
        } else {
          executionTime = Date.now() - startTime;
          errorMessage = error instanceof Error ? error.message : "Failed to execute query";
          setResult({
            columns: [],
            rows: [],
            rowCount: 0,
            error: errorMessage,
          });
          toast.error(errorMessage);
        }
      } finally {
        setIsExecuting(false);
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

  const handleSelectQuery = useCallback((selectedQuery: string) => {
    setQuery(selectedQuery);
  }, []);

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
    toast.success("Query formatted");
  }, [query]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) to execute
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!isExecuting && query.trim()) {
          void handleExecute();
        }
      }
      // Option+F (Mac) or Alt+F (Windows/Linux) to beautify
      else if (e.altKey && e.key === "f") {
        e.preventDefault();
        if (query.trim()) {
          handleBeautify();
        }
      }
      // Option+H (Mac) or Alt+H (Windows/Linux) to toggle history
      else if (e.altKey && e.key === "h") {
        e.preventDefault();
        setShowHistory((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [query, isExecuting, handleExecute, handleBeautify]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Editor and Results */}
          <ResizablePanel defaultSize={showHistory ? 70 : 100} minSize={30}>
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
                    setQuery(value || "");
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
                    isExecuting ? "Cancel execution" : "Execute query (⌘+Enter)"
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
                  title="Format SQL (⌥+F)"
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
                  connectionId={connectionId}
                  height="100%"
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          {showHistory && (
            <>
              <ResizableHandle withHandle />

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
  );
});
