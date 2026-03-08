import { useState, useCallback, useEffect, useRef, memo } from "react";
import { toast } from "sonner";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import { MongoDBAdapter } from "@/adapters/mongodb";
import { MongoQueryToolbar } from "./MongoQueryToolbar";
import { logger } from "@/lib/logger";
import { eventBus } from "@/services/eventBus";
import {
  normalizeMongoResult,
  type MongoExecutionResult,
  type MongoOperationKind,
} from "./mongo-result-state";

interface MongoQueryPanelProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: string;
  className?: string;
  initialQuery?: string;
}

const DEFAULT_QUERY = `{
  "find": "collection_name",
  "filter": {},
  "limit": 20
}`;

export const MongoQueryPanel = memo(function MongoQueryPanel({
  panelId: _panelId,
  tabId: _tabId,
  connectionId,
  database,
  className,
  initialQuery = DEFAULT_QUERY,
}: MongoQueryPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<MongoExecutionResult | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const handleFocusPanel = useCallback(() => {
    // Focus panel when interacting
  }, []);

  const handleExecute = useCallback(async () => {
    if (!query.trim()) return;

    setIsExecuting(true);
    setResult(null);
    setExecutionTime(null);
    const startTime = performance.now();

    try {
      let parsedQuery;
      let operation: MongoOperationKind = "unknown";
      let collection: string | undefined;
      try {
        parsedQuery = JSON.parse(query);
      } catch (e) {
        throw new Error("Invalid JSON: " + (e as Error).message, {
          cause: e,
        });
      }

      const adapter = new MongoDBAdapter(connectionId);
      
      let queryResult;

      if (parsedQuery.find) {
        operation = "find";
        const findCollection = parsedQuery.find as string;
        collection = findCollection;
        const filter = parsedQuery.filter || {};
        const options = {
          limit: parsedQuery.limit,
          skip: parsedQuery.skip,
          sort: parsedQuery.sort,
          projection: parsedQuery.projection,
        };
        
        logger.info("[MongoQueryPanel] Executing find", { collection: findCollection, filter, options });
        queryResult = await adapter.findDocuments(findCollection, filter, options);
        
      } else if (parsedQuery.aggregate) {
        operation = "aggregate";
        const aggregateCollection = parsedQuery.aggregate as string;
        collection = aggregateCollection;
        const pipeline = parsedQuery.pipeline || [];
        
        if (!Array.isArray(pipeline)) {
          throw new Error("Pipeline must be an array");
        }

        logger.info("[MongoQueryPanel] Executing aggregate", { collection: aggregateCollection, pipelineLength: pipeline.length });
        queryResult = await adapter.aggregate(aggregateCollection, pipeline);

      } else if (parsedQuery.command) {
        operation = "command";
        logger.info("[MongoQueryPanel] Executing command", parsedQuery.command);
        queryResult = await adapter.runCommand(parsedQuery.command);

      } else if (parsedQuery.insert) {
        operation = "insert";
        const insertCollection = parsedQuery.insert as string;
        collection = insertCollection;
        const docs = parsedQuery.documents || parsedQuery.document;
        
        if (Array.isArray(docs)) {
             queryResult = await adapter.insertDocuments(insertCollection, docs);
        } else {
             queryResult = await adapter.insertDocument(insertCollection, docs);
        }
      } else if (parsedQuery.update) {
        operation = "update";
        const updateCollection = parsedQuery.update as string;
        collection = updateCollection;
        const filter = parsedQuery.filter || {};
        const update = parsedQuery.updateDoc || parsedQuery.update;
        
        queryResult = await adapter.updateDocument(updateCollection, filter, update);
      } else if (parsedQuery.delete) {
        operation = "delete";
        const deleteCollection = parsedQuery.delete as string;
        collection = deleteCollection;
        const filter = parsedQuery.filter || {};
        
        queryResult = await adapter.deleteDocument(deleteCollection, filter);
      } else if (parsedQuery.count) {
          operation = "count";
          const countCollection = parsedQuery.count as string;
          collection = countCollection;
          const filter = parsedQuery.filter;
          queryResult = await adapter.countDocuments(countCollection, filter);
      } else {
        operation = "command";
        logger.info("[MongoQueryPanel] Unknown format, attempting as runCommand", parsedQuery);
        queryResult = await adapter.runCommand(parsedQuery);
      }

      const endTime = performance.now();
      setExecutionTime(endTime - startTime);
      setResult(
        normalizeMongoResult({
          operation,
          result: queryResult,
          collection,
        }),
      );
      toast.success("Query executed successfully");

    } catch (err) {
      logger.error("[MongoQueryPanel] Execution failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Execution failed", { description: msg });
      setResult(
        normalizeMongoResult({
          operation: "command",
          error: err,
        }),
      );
    } finally {
      setIsExecuting(false);
    }
  }, [query, connectionId]);

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(query);
      setQuery(JSON.stringify(parsed, null, 2));
      toast.success("JSON formatted");
    } catch {
      toast.error("Invalid JSON, cannot format");
    }
  }, [query]);

  const handleClearResults = useCallback(() => {
    setResult(null);
    setExecutionTime(null);
  }, []);

  // Subscribe to global keyboard shortcuts via event bus
  // The global keyboardHandler intercepts shortcuts (Cmd+Enter, Alt+F, etc.)
  // and emits events, so we listen here (same pattern as QueryPanel/SqlEditor)
  useEffect(() => {
    const hasFocus = () =>
      editorContainerRef.current?.contains(document.activeElement) ?? false;

    const handleExecuteEvent = () => {
      if (!hasFocus()) return;
      void handleExecute();
    };

    const handleFormatEvent = () => {
      if (!hasFocus()) return;
      handleFormat();
    };

    const handleClearEvent = () => {
      if (!hasFocus()) return;
      handleClearResults();
    };

    eventBus.on("query-editor:execute", handleExecuteEvent);
    eventBus.on("query-editor:format", handleFormatEvent);
    eventBus.on("query-editor:clear", handleClearEvent);

    return () => {
      eventBus.off("query-editor:execute", handleExecuteEvent);
      eventBus.off("query-editor:format", handleFormatEvent);
      eventBus.off("query-editor:clear", handleClearEvent);
    };
  }, [handleExecute, handleFormat, handleClearResults]);

  return (
    <div
      className={cn("flex flex-col h-full bg-background", className)}
      onMouseDown={handleFocusPanel}
      onFocus={handleFocusPanel}
    >
      <ResizablePanelGroup orientation="vertical" className="h-full rounded-xl overflow-hidden">
        {/* Top: Editor */}
        <ResizablePanel defaultSize="40" minSize="20" className="flex flex-col">
          <div ref={editorContainerRef} className="flex-1 min-h-0 relative flex flex-col">
            <CodeEditor
              value={query}
              onChange={setQuery}
              language="json"
              connectionId={connectionId}
              database={database}
              onExecute={handleExecute} // Cmd+Enter support
              className="flex-1"
            />
            <MongoQueryToolbar
              isExecuting={isExecuting}
              onExecute={handleExecute}
              onCancel={() => {}} // Mongo adapter doesn't seem to support cancel yet
              onFormat={handleFormat}
              onClear={handleClearResults}
              hasQuery={!!query.trim()}
              hasResults={result !== null}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle className="bg-secondary hover:bg-primary/50 transition-colors h-1" />

        {/* Bottom: Results */}
        <ResizablePanel defaultSize="60" minSize="20">
          <div className="h-full flex flex-col bg-muted/10">
            {executionTime !== null && (
              <div className="px-3 py-1 text-xs text-muted-foreground border-b bg-muted/20 flex justify-between">
                <span>Results</span>
                <span>{executionTime.toFixed(2)}ms</span>
              </div>
            )}
            <div className="flex-1 min-h-0 relative">
               {result ? (
                 <CodeEditor
                   value={result.formattedText}
                   language="json"
                   readOnly={true}
                   lineNumbers={true}
                   className="h-full"
                 />
               ) : (
                 <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                   Run a query to see results
                 </div>
               )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
});
