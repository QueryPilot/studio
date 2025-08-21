import { useState, useEffect } from "react";
import { QueryEditor } from "./QueryEditor";
import { QueryDataViewer } from "./QueryDataViewer";
import { useConnectionStore, useQueryStore } from "@/stores";
import {
  queryService,
  type QueryResult,
  type QueryError,
} from "@/services/queryService";
import { schemaService } from "@/services/schemaService";
import { splitSqlStatements, getStatementType } from "@/utils/sqlParser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

export function QueryWorkspace() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { addToHistory, setLastResults } = useQueryStore();
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<QueryResult | null>(null);
  const [error, setError] = useState<QueryError | null>(null);
  const [messages, setMessages] = useState<string[]>([]);

  const activeConnection = Array.from(connections.values()).find(
    (c) => c.config.id === activeConnectionId,
  )?.config;

  // Refresh schema when connection changes
  useEffect(() => {
    if (activeConnectionId) {
      // Clear old schema and fetch new one
      schemaService.clearCache(activeConnectionId);
      schemaService.getSchema(activeConnectionId).catch((err) => {
        console.warn("[QueryWorkspace] Failed to refresh schema:", err);
      });
    }
  }, [activeConnectionId]);

  const handleExecuteQuery = async (query: string) => {
    if (!activeConnection) {
      setError({ message: "No active connection selected" });
      return;
    }

    setIsExecuting(true);
    setError(null);
    setResults(null);
    setMessages([]);

    try {
      const startTime = Date.now();

      // Split the query into individual statements
      const statements = splitSqlStatements(query);

      if (statements.length === 0) {
        setMessages(["No valid SQL statements to execute"]);
        return;
      }

      const statementMessages: string[] = [];
      let lastSelectResult: QueryResult | null = null;

      // Execute each statement separately
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const stmtType = getStatementType(statement);

        try {
          if (stmtType === "select") {
            const queryResult = await queryService.executeQuery(
              activeConnection,
              statement,
            );
            lastSelectResult = queryResult;

            statementMessages.push(
              `Statement ${i + 1}: SELECT executed in ${
                queryResult.queryTime
              }ms, returned ${queryResult.rowCount} row(s)`,
            );
          } else if (
            stmtType === "update" ||
            stmtType === "insert" ||
            stmtType === "delete"
          ) {
            const result = await queryService.executeUpdate(
              activeConnection,
              statement,
            );
            statementMessages.push(
              `Statement ${i + 1}: ${stmtType.toUpperCase()} executed in ${
                result.queryTime
              }ms, ${result.affectedRows} row(s) affected`,
            );
          } else {
            // For DDL and other queries
            const result = await queryService.executeUpdate(
              activeConnection,
              statement,
            );
            statementMessages.push(
              `Statement ${i + 1}: ${
                stmtType === "ddl" ? "DDL" : stmtType.toUpperCase()
              } executed in ${result.queryTime}ms`,
            );
          }
        } catch (stmtError: any) {
          // If any statement fails, stop execution and show error
          const errorMsg = stmtError.message || `Statement ${i + 1} failed`;
          throw new Error(`${errorMsg}\n\nFailed statement:\n${statement}`);
        }
      }

      // Show results from the last SELECT statement if any
      if (lastSelectResult) {
        setResults(lastSelectResult);
        setLastResults(lastSelectResult);
      }

      // Display all execution messages
      setMessages([
        `Executed ${statements.length} statement(s) in ${
          Date.now() - startTime
        }ms`,
        ...statementMessages,
      ]);

      // Add to history
      addToHistory({
        query,
        connectionId: activeConnection.id,
        connectionName: activeConnection.name,
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
        rowCount: results?.rowCount,
      });
    } catch (err: any) {
      const error: QueryError = {
        message: err.message || "Query execution failed",
        details: err.details,
      };
      setError(error);

      // Add failed query to history
      addToHistory({
        query,
        connectionId: activeConnection.id,
        connectionName: activeConnection.name,
        executedAt: new Date().toISOString(),
        duration: 0,
        error: error.message,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  if (!activeConnection) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Connection Selected</h3>
          <p className="text-sm text-muted-foreground">
            Please select or create a database connection to start querying
          </p>
        </div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="vertical" className="h-full w-full">
      <ResizablePanel defaultSize={60} minSize={30} className="h-full">
        <QueryEditor onExecute={handleExecuteQuery} initialValue="" />
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={40} minSize={20} className="flex flex-col">
        <Tabs defaultValue="results" className="h-full flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b flex-shrink-0 h-8 p-0.5">
            <TabsTrigger value="results" className="text-xs h-6">
              Results
            </TabsTrigger>
            <TabsTrigger value="messages" className="text-xs h-6">
              Messages
            </TabsTrigger>
          </TabsList>

          <TabsContent value="results" className="flex-1 mt-0 overflow-auto">
            {isExecuting ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">
                  Executing query...
                </span>
              </div>
            ) : error ? (
              <div className="p-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-1">Query Error</div>
                    <div className="font-mono text-sm">{error.message}</div>
                    {error.details && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs">
                          Details
                        </summary>
                        <pre className="mt-1 text-xs whitespace-pre-wrap">
                          {error.details}
                        </pre>
                      </details>
                    )}
                  </AlertDescription>
                </Alert>
              </div>
            ) : results ? (
              <QueryDataViewer
                data={results.rows}
                columns={results.columns}
                queryTime={results.queryTime}
                connectionId={activeConnectionId || undefined}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Execute a query to see results
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="messages"
            className="flex-1 mt-0 p-4 overflow-auto"
          >
            {messages.length > 0 ? (
              <div className="space-y-1">
                {messages.map((message, index) => (
                  <div key={index} className="text-xs">
                    <span className="text-muted-foreground">
                      [{new Date().toLocaleTimeString()}]
                    </span>{" "}
                    {message}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-xs">
                No messages to display
              </div>
            )}
          </TabsContent>
        </Tabs>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
