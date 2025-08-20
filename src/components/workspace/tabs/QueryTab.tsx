import { useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useQueryData, useExecuteSQL } from '@/hooks/useQueryData';
import { DataViewer } from '@/components/DataViewer/DataViewer';
import { TabState } from '@/types/workspace';
import {
  Play,
  Square,
  Save,
  Share,
} from 'lucide-react';

interface QueryTabProps {
  tab: TabState;
}

export function QueryTab({ tab }: QueryTabProps) {
  const { theme } = useTheme();
  const { updateTabPayload, setTabDirty, setTabLoading, setTabError } = useWorkspaceStore();
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace());
  
  const [sql, setSql] = useState(tab.payload.sql || '');
  const [isExecuting, setIsExecuting] = useState(false);
  
  // Hooks for query execution
  const queryMutation = useExecuteSQL(tab.connectionId);
  const queryData = useQueryData(
    tab.connectionId,
    tab.payload.sql || '',
    { pageSize: 1000 }
  );

  const handleSqlChange = useCallback((value: string | undefined) => {
    const newSql = value || '';
    setSql(newSql);
    
    // Mark tab as dirty if SQL changed
    const isDirty = newSql !== (tab.payload.sql || '');
    setTabDirty(workspace!.id, tab.id, isDirty);
  }, [tab.payload.sql, workspace, tab.id, setTabDirty]);

  const handleExecuteQuery = useCallback(async () => {
    if (!sql.trim()) return;
    
    setIsExecuting(true);
    setTabLoading(workspace!.id, tab.id, true);
    setTabError(workspace!.id, tab.id, undefined);

    try {
      // Save SQL to tab payload
      updateTabPayload(workspace!.id, tab.id, { sql });
      
      // Execute the query
      if (sql.trim().toLowerCase().startsWith('select')) {
        // For SELECT queries, use the query data hook
        await queryData.refetch();
      } else {
        // For INSERT/UPDATE/DELETE, use execute mutation
        await queryMutation.mutateAsync({ sql });
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
  }, [sql, workspace, tab.id, updateTabPayload, setTabLoading, setTabError, setTabDirty, queryData, queryMutation]);

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
            {isExecuting ? (
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
            theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
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