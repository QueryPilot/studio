import { useState } from "react";
import { QueryEditor } from "./QueryEditor";
import { QueryResults } from "./QueryResults";
import { useConnectionStore, useQueryStore } from "@/stores";
import { queryService, QueryResult, QueryError } from "@/services/queryService";
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

      // Determine query type
      const queryType = queryService.getQueryType(query);

      let queryResult: QueryResult;

      if (queryType === "select") {
        queryResult = await queryService.executeQuery(activeConnection, query);
        setResults(queryResult);
        setLastResults(queryResult);

        setMessages([
          `Query executed successfully in ${queryResult.queryTime}ms`,
          `Returned ${queryResult.rowCount} row(s)`,
        ]);
      } else if (queryType === "update") {
        const result = await queryService.executeUpdate(
          activeConnection,
          query,
        );
        setMessages([
          `Query executed successfully in ${result.queryTime}ms`,
          `${result.affectedRows} row(s) affected`,
        ]);
      } else {
        // For DDL and other queries
        const result = await queryService.executeUpdate(
          activeConnection,
          query,
        );
        setMessages([`Query executed successfully in ${result.queryTime}ms`]);
      }

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
        <QueryEditor
          onExecute={handleExecuteQuery}
          initialValue="-- Write your SQL query here\n-- Press Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) to execute\n\nSELECT * FROM "
        />
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={40} minSize={20} className="flex flex-col">
        <Tabs defaultValue="results" className="h-full flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b flex-shrink-0">
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="messages">Messages</TabsTrigger>
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
              <QueryResults
                data={results.rows}
                columns={results.columns}
                queryTime={results.queryTime}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Execute a query to see results
              </div>
            )}
          </TabsContent>

          <TabsContent value="messages" className="flex-1 mt-0 p-4 overflow-auto">
            {messages.length > 0 ? (
              <div className="space-y-2">
                {messages.map((message, index) => (
                  <div key={index} className="text-sm">
                    <span className="text-muted-foreground">
                      [{new Date().toLocaleTimeString()}]
                    </span>{" "}
                    {message}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                No messages to display
              </div>
            )}
          </TabsContent>
        </Tabs>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
