import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { DataViewer } from '@/components/DataViewer/DataViewer';
import { TabState } from '@/types/workspace';
import {
  RefreshCw,
  Download,
  Share,
  Clock,
  Database,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface ResultTabProps {
  tab: TabState;
  resultId: string;
}

interface QueryResult {
  id: string;
  sql: string;
  status: 'success' | 'error' | 'cancelled';
  executedAt: Date;
  duration: number;
  affectedRows?: number;
  columns?: any[];
  rows?: any[];
  totalRows?: number;
  error?: string;
  connectionId: string;
}

export function ResultTab({ tab, resultId }: ResultTabProps) {
  const { updateTabPayload } = useWorkspaceStore();
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace());
  
  // Mock result data - in practice this would come from a query store or cache
  const [result] = useState<QueryResult>({
    id: resultId,
    sql: tab.payload.sql || 'SELECT * FROM users LIMIT 100;',
    status: 'success',
    executedAt: new Date(Date.now() - 30000), // 30 seconds ago
    duration: 245, // milliseconds
    affectedRows: 100,
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'email', type: 'varchar' },
      { name: 'name', type: 'varchar' },
      { name: 'created_at', type: 'timestamp' },
    ],
    rows: Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      email: `user${i + 1}@example.com`,
      name: `User ${i + 1}`,
      created_at: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    })),
    totalRows: 100,
    connectionId: tab.connectionId,
  });

  const [showSql, setShowSql] = useState(false);

  const handleRefresh = useCallback(() => {
    // In practice, this would re-execute the query
    console.log('Re-executing query for result:', resultId);
  }, [resultId]);

  const handleExport = useCallback(() => {
    // Export functionality
    console.log('Exporting result:', resultId);
  }, [resultId]);

  const handleShare = useCallback(() => {
    // Share functionality
    console.log('Sharing result:', resultId);
  }, [resultId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'cancelled':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'success':
        return 'default';
      case 'error':
        return 'destructive';
      case 'cancelled':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTimestamp = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  // Update tab title when result changes
  React.useEffect(() => {
    if (result) {
      updateTabPayload(workspace!.id, tab.id, { 
        resultId: result.id,
        sql: result.sql,
      });
    }
  }, [result, workspace, tab.id, updateTabPayload]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-2 border-b bg-background/95 backdrop-blur">
        {/* Result Info */}
        <div className="flex items-center gap-2">
          {getStatusIcon(result.status)}
          <span className="font-medium">Query Result</span>
          
          <Badge variant={getStatusVariant(result.status)}>
            {result.status}
          </Badge>
          
          {result.status === 'success' && result.totalRows && (
            <Badge variant="outline">
              {result.totalRows.toLocaleString()} rows
            </Badge>
          )}
          
          <Badge variant="outline">
            {formatDuration(result.duration)}
          </Badge>
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <Button
          onClick={() => setShowSql(!showSql)}
          size="sm"
          variant="outline"
        >
          {showSql ? 'Hide SQL' : 'Show SQL'}
        </Button>

        <Button
          onClick={handleRefresh}
          size="sm"
          variant="outline"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>

        <Button
          onClick={handleExport}
          size="sm"
          variant="outline"
          disabled={result.status !== 'success'}
        >
          <Download className="h-4 w-4" />
        </Button>

        <Button
          onClick={handleShare}
          size="sm"
          variant="outline"
          disabled
        >
          <Share className="h-4 w-4" />
        </Button>
      </div>

      {/* SQL Query Display */}
      {showSql && (
        <div className="border-b p-4 bg-muted/20">
          <div className="text-sm font-medium mb-2">Executed Query</div>
          <pre className="text-sm bg-background p-2 rounded border font-mono whitespace-pre-wrap">
            {result.sql}
          </pre>
          <div className="text-xs text-muted-foreground mt-2">
            Executed at {formatTimestamp(result.executedAt)}
          </div>
        </div>
      )}

      {/* Result Content */}
      <div className="flex-1 min-h-0">
        {result.status === 'error' ? (
          <div className="p-4 bg-destructive/10 text-destructive">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="h-4 w-4" />
              <h3 className="font-medium">Query Error</h3>
            </div>
            <pre className="text-sm whitespace-pre-wrap font-mono">
              {result.error || 'An unknown error occurred'}
            </pre>
            <div className="text-xs mt-2 opacity-75">
              Query executed at {formatTimestamp(result.executedAt)}
            </div>
          </div>
        ) : result.status === 'cancelled' ? (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-800 dark:text-yellow-200">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4" />
              <h3 className="font-medium">Query Cancelled</h3>
            </div>
            <p className="text-sm">
              The query was cancelled before completion.
            </p>
            <div className="text-xs mt-2 opacity-75">
              Cancelled after {formatDuration(result.duration)}
            </div>
          </div>
        ) : result.rows && result.columns ? (
          <DataViewer
            tableName="result"
            schema=""
            connectionId={tab.connectionId}
            onRowClick={() => {}}
          />
        ) : result.affectedRows !== undefined ? (
          // Non-SELECT query result
          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <h3 className="font-medium text-green-700 dark:text-green-300">
                Query Executed Successfully
              </h3>
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span>Affected rows: <strong>{result.affectedRows}</strong></span>
              </div>
              
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Duration: <strong>{formatDuration(result.duration)}</strong></span>
              </div>
              
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Executed at {formatTimestamp(result.executedAt)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">No result data available</p>
              <Button onClick={handleRefresh} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}