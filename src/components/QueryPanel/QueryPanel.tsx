import { memo, useState, useCallback } from 'react';
import { QueryEditor } from './QueryEditor';
import { ResultViewer } from './ResultViewer';
import { QueryHistory } from './QueryHistory';
import { SavedQueries } from './SavedQueries';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Play, StopCircle, RefreshCw, History, BookmarkCheck } from 'lucide-react';
import { toast } from 'sonner';
import { tableDataService } from '@/services/tableDataService';
import { queryHistoryService } from '@/services/queryHistoryService';
import { cn } from '@/lib/utils';

interface QueryPanelProps {
  connectionId: string;
  database: string;
  schema?: string;
  dbType?: string;
  className?: string;
}

interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime?: number;
  error?: string;
}

export const QueryPanel = memo(function QueryPanel({
  connectionId,
  database,
  schema = 'public',
  dbType = 'postgres',
  className,
}: QueryPanelProps) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const handleExecute = useCallback(async (queryToExecute?: string) => {
    const sql = queryToExecute || query;
    
    if (!sql.trim()) {
      toast.error('Please enter a query to execute');
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
          signal: controller.signal 
        }
      );
      
      executionTime = Date.now() - startTime;
      
      // Transform response to our format
      queryResult = {
        columns: response.columns || [],
        rows: response.rows || [],
        rowCount: response.rows?.length || 0,
        executionTime,
      };
      
      setResult(queryResult);
      toast.success(`Query executed successfully (${queryResult.rowCount} rows)`);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast.info('Query execution cancelled');
        return;
      } else {
        executionTime = Date.now() - startTime;
        errorMessage = error.message || 'Failed to execute query';
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
  }, [query, connectionId, database]);

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

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20">
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant={isExecuting ? "destructive" : "default"}
            onClick={isExecuting ? handleCancel : () => handleExecute()}
            disabled={!query.trim() && !isExecuting}
          >
            {isExecuting ? (
              <>
                <StopCircle className="h-4 w-4 mr-1" />
                Cancel
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1" />
                Execute
              </>
            )}
          </Button>
          
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setQuery('');
              setResult(null);
            }}
            disabled={isExecuting}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Editor and Results */}
          <ResizablePanel defaultSize={70} minSize={30}>
            <ResizablePanelGroup direction="vertical" className="h-full">
              {/* Editor */}
              <ResizablePanel defaultSize={50} minSize={20}>
                <QueryEditor
                  connectionId={connectionId}
                  database={database}
                  schema={schema}
                  dbType={dbType}
                  value={query}
                  onChange={(value) => setQuery(value || '')}
                  onExecute={handleExecute}
                  height="100%"
                />
              </ResizablePanel>
              
              <ResizableHandle withHandle />
              
              {/* Results */}
              <ResizablePanel defaultSize={50} minSize={20}>
                <ResultViewer
                  result={result}
                  isLoading={isExecuting}
                  height="100%"
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          
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
                  <BookmarkCheck className="h-3 w-3 mr-1" />
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
        </ResizablePanelGroup>
      </div>
    </div>
  );
});