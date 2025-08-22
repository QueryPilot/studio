import { useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { defineThemes } from '@/components/QueryEditor/monacoTheme';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useQueryStore } from '@/stores/queryStore';
import { useQueryData, useExecuteQueryWithCancellation } from '@/hooks/useQueryData';
import { DataViewer } from '@/components/DataViewer/DataViewer';
import { type TabState } from '@/types/workspace';
import {
  Play,
  Square,
  Save,
  Share,
  X,
} from 'lucide-react';

interface QueryTabProps {
  tab: TabState;
}

export function QueryTab({ tab }: QueryTabProps) {
  const { theme } = useTheme();
  const { updateTabPayload, setTabDirty, setTabLoading, setTabError } = useWorkspaceStore();
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace());
  const { getActiveQueriesForConnection, cancelQuery } = useQueryStore();
  
  const [sql, setSql] = useState(tab.payload.sql || '');
  const [isExecuting, setIsExecuting] = useState(false);
  
  // Hooks for query execution
  const enhancedQueryMutation = useExecuteQueryWithCancellation(tab.connectionId);
  const queryData = useQueryData(
    tab.connectionId,
    tab.payload.sql || '',
    { pageSize: 1000 }
  );
  
  // Get active queries for this tab's connection
  const activeQueries = tab.connectionId 
    ? getActiveQueriesForConnection(tab.connectionId)
    : [];

  const handleSqlChange = useCallback((value: string | undefined) => {
    const newSql = value || '';
    setSql(newSql);
    
    // Auto-save SQL content to tab payload so it persists when switching connections
    updateTabPayload(workspace!.id, tab.id, { sql: newSql });
    
    // Mark tab as dirty if SQL changed from last saved state
    const isDirty = newSql !== (tab.payload.sql || '');
    setTabDirty(workspace!.id, tab.id, isDirty);
  }, [tab.payload.sql, workspace, tab.id, setTabDirty, updateTabPayload]);

  const handleExecuteQuery = useCallback(async () => {
    if (!sql.trim()) return;
    
    setIsExecuting(true);
    setTabLoading(workspace!.id, tab.id, true);
    setTabError(workspace!.id, tab.id, undefined);

    try {
      // Save SQL to tab payload
      updateTabPayload(workspace!.id, tab.id, { sql });
      
      // Execute the query with cancellation support
      if (sql.trim().toLowerCase().startsWith('select')) {
        // For SELECT queries, use enhanced query mutation for cancellation support
        await enhancedQueryMutation.mutateAsync({ sql });
        // Also trigger the query data refetch for UI display
        await queryData.refetch();
      } else {
        // For INSERT/UPDATE/DELETE, use enhanced mutation
        await enhancedQueryMutation.mutateAsync({ sql });
      }
      
      // Mark tab as not dirty after successful execution
      setTabDirty(workspace!.id, tab.id, false);
      
    } catch (error) {
      console.error('Query execution failed:', error);
      setTabError(workspace!.id, tab.id, error?.toString() || 'Query failed');
    } finally {
      setIsExecuting(false);
      setTabLoading(workspace!.id, tab.id, false);
    }
  }, [sql, workspace, tab.id, updateTabPayload, setTabLoading, setTabError, setTabDirty, queryData, enhancedQueryMutation]);

  const handleCancelQueries = useCallback(async () => {
    try {
      await Promise.all(
        activeQueries.map(query => cancelQuery(query.id))
      );
      setIsExecuting(false);
      setTabLoading(workspace!.id, tab.id, false);
    } catch (error) {
      console.error('Failed to cancel queries:', error);
      setIsExecuting(false);
      setTabLoading(workspace!.id, tab.id, false);
    }
  }, [activeQueries, cancelQuery, workspace, tab.id, setTabLoading]);

  const handleCancelSingleQuery = useCallback(async (queryId: string) => {
    try {
      await cancelQuery(queryId);
    } catch (error) {
      console.error('Failed to cancel query:', error);
    }
  }, [cancelQuery]);

  const handleSaveQuery = useCallback(() => {
    updateTabPayload(workspace!.id, tab.id, { sql });
    setTabDirty(workspace!.id, tab.id, false);
  }, [sql, workspace, tab.id, updateTabPayload, setTabDirty]);

  return (
    <div className="flex flex-col h-full">
      {/* Query Editor */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 p-2 border-b bg-background/95 backdrop-blur">
          <Button
            onClick={handleExecuteQuery}
            disabled={isExecuting || !sql.trim()}
            size="sm"
            className="gap-2"
          >
            {isExecuting || activeQueries.length > 0 ? (
              <>
                <Square className="h-4 w-4" />
                Executing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Execute
              </>
            )}
          </Button>
          
          {activeQueries.length > 0 && (
            <Button
              onClick={handleCancelQueries}
              size="sm"
              variant="destructive"
              className="gap-2"
            >
              <Square className="h-4 w-4" />
              Cancel All
            </Button>
          )}
          
          <Button
            onClick={handleSaveQuery}
            disabled={!tab.isDirty}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            Save
          </Button>
          
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled
          >
            <Share className="h-4 w-4" />
            Share
          </Button>
          
          <div className="flex-1" />
          
          {/* Active queries display */}
          <div className="flex items-center gap-1">
            {activeQueries.map((query) => (
              <div
                key={query.id}
                className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 rounded text-xs"
              >
                <span className="text-blue-700 dark:text-blue-300">
                  Query running...
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCancelSingleQuery(query.id)}
                  className="h-4 w-4 p-0 text-red-600 hover:text-red-700"
                  title="Cancel this query"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
          
          {tab.isDirty && (
            <span className="text-sm text-muted-foreground">
              Unsaved changes
            </span>
          )}
        </div>

        {/* Monaco Editor */}
        <div className="flex-1">
          <Editor
            language="sql"
            theme={theme === 'dark' ? 'devdb-dark' : 'devdb-light'}
            beforeMount={(monaco) => {
              defineThemes(monaco);
            }}
            value={sql}
            onChange={handleSqlChange}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              roundedSelection: false,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              bracketPairColorization: { enabled: true },
              suggest: {
                showKeywords: true,
                showSnippets: true,
              },
            }}
          />
        </div>
      </div>

      {/* Results Panel */}
      {(queryData.data || tab.error) && (
        <div className="flex-1 min-h-0 border-t">
          {tab.error ? (
            <div className="p-4 bg-destructive/10 text-destructive">
              <h3 className="font-medium mb-2">Query Error</h3>
              <pre className="text-sm whitespace-pre-wrap font-mono">
                {tab.error}
              </pre>
            </div>
          ) : queryData.data ? (
            <DataViewer
              tableName="query_result"
              schema=""
              connectionId={tab.connectionId}
              onRowClick={() => {}}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}