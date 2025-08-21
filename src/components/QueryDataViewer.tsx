import { useState } from 'react';
import { DataViewer } from './DataViewer/DataViewer';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QueryDataViewerProps {
  data: any[];
  columns: string[];
  queryTime?: number;
  error?: string;
  connectionId?: string;
  className?: string;
}

/**
 * Adapter component that wraps DataViewer for displaying query results.
 * Provides query-specific UI elements while leveraging DataViewer's features.
 */
export function QueryDataViewer({
  data,
  columns,
  queryTime,
  error,
  connectionId,
  className
}: QueryDataViewerProps) {
  const [virtualTableName] = useState(`query_result_${Date.now()}`);

  if (error) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold mb-2">Query Error</div>
            <pre className="text-sm whitespace-pre-wrap">{error}</pre>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No results to display
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <DataViewerWrapper
        data={data}
        columns={columns}
        connectionId={connectionId}
        queryTime={queryTime}
      />
    </div>
  );
}

/**
 * Wrapper component that provides data directly to DataViewer
 * instead of having it fetch from a real table
 */
function DataViewerWrapper({
  data,
  columns,
  connectionId,
  queryTime
}: {
  data: any[];
  columns: string[];
  connectionId?: string;
  queryTime?: number;
}) {
  return (
    <DataViewer
      tableName="Query Results"
      connectionId={connectionId}
      preloadedData={{
        data,
        columns,
        totalRows: data.length,
        queryTime
      }}
    />
  );
}