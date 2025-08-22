import { useEffect, useRef, useCallback } from 'react';
import { DataViewer } from './DataViewer/DataViewer';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { Button } from '@/components/ui/button';

interface QueryDataViewerProps {
  // For static data (non-paginated)
  data?: any[];
  columns?: string[];
  queryTime?: number;
  error?: string;
  // For paginated queries
  sql?: string;
  connectionId?: string;
  usePagination?: boolean;
  onExecute?: () => void;
  className?: string;
}

/**
 * Adapter component that wraps DataViewer for displaying query results.
 * Supports both static data and paginated queries via cursor management.
 */
export function QueryDataViewer({
  data,
  columns,
  queryTime,
  error,
  sql,
  connectionId,
  usePagination = false,
  onExecute,
  className
}: QueryDataViewerProps) {
  // Use paginated query if enabled and SQL is provided
  if (usePagination && sql && connectionId) {
    return (
      <PaginatedQueryViewer
        sql={sql}
        connectionId={connectionId}
        onExecute={onExecute}
        className={className}
      />
    );
  }

  // Static data display
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
        columns={columns || []}
        connectionId={connectionId}
        queryTime={queryTime}
      />
    </div>
  );
}

/**
 * Wrapper component for static data
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

/**
 * Component for paginated query results
 */
function PaginatedQueryViewer({
  sql,
  connectionId,
  onExecute,
  className
}: {
  sql: string;
  connectionId: string;
  onExecute?: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const allDataRef = useRef<any[]>([]);
  
  const {
    result,
    isLoading,
    error,
    execute,
    fetchNext,
    reset,
    close,
  } = usePaginatedQuery(sql, connectionId, {
    page_size: 1000,
    timeout_ms: 30000,
  });

  // Execute query on mount or when SQL changes
  useEffect(() => {
    if (sql && connectionId) {
      allDataRef.current = [];
      execute();
      onExecute?.();
    }
    return () => {
      close();
    };
  }, [sql, connectionId]);

  // Accumulate all fetched data
  useEffect(() => {
    if (result) {
      // Convert rows to objects for DataViewer
      const newData = result.rows.map((row, idx) => {
        const obj: Record<string, any> = { 
          _row_id: `row-${allDataRef.current.length + idx}` 
        };
        result.columns.forEach((col, colIdx) => {
          obj[col.name] = row[colIdx];
        });
        return obj;
      });
      
      // Only add new data not already in allDataRef
      const startIdx = allDataRef.current.length;
      const endIdx = startIdx + newData.length;
      if (endIdx > allDataRef.current.length) {
        allDataRef.current = [...allDataRef.current.slice(0, startIdx), ...newData];
      }
    }
  }, [result]);

  // Set up infinite scroll
  const setupInfiniteScroll = useCallback(() => {
    if (!result || result.isComplete) return;

    const options = {
      root: containerRef.current,
      rootMargin: '500px',
      threshold: 0,
    };

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (entry && entry.isIntersecting && !isLoading && result.hasMore) {
        fetchNext();
      }
    }, options);

    if (loadMoreTriggerRef.current) {
      observerRef.current.observe(loadMoreTriggerRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [result, isLoading, fetchNext]);

  useEffect(() => {
    return setupInfiniteScroll();
  }, [setupInfiniteScroll]);

  if (error) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold mb-2">Query Error</div>
            <pre className="text-sm whitespace-pre-wrap">{error}</pre>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                allDataRef.current = [];
                reset();
                execute();
              }}
              className="mt-3"
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!result && isLoading) {
    return (
      <div className={cn("flex flex-col h-full items-center justify-center", className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <div className="text-muted-foreground">Executing query...</div>
      </div>
    );
  }

  if (!result || result.rows.length === 0) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          {result ? 'Query returned no results' : 'No data to display'}
        </div>
      </div>
    );
  }

  const columns = result.columns.map(col => col.name);

  return (
    <div ref={containerRef} className={cn("flex flex-col h-full relative", className)}>
      <DataViewer
        tableName="Query Results"
        connectionId={connectionId}
        preloadedData={{
          data: allDataRef.current,
          columns,
          totalRows: result.totalRows,
        }}
      />
      
      {/* Infinite scroll trigger */}
      {!result.isComplete && (
        <div 
          ref={loadMoreTriggerRef}
          className="h-1"
          style={{ 
            position: 'absolute', 
            bottom: '100px', 
            left: 0, 
            right: 0,
            pointerEvents: 'none' 
          }}
        />
      )}
      
      {/* Loading indicator */}
      {isLoading && result && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-background/95 backdrop-blur rounded-full px-4 py-2 shadow-lg border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading more rows...</span>
          </div>
        </div>
      )}

      {/* Status bar */}
      {result && (
        <div className="absolute top-0 right-0 p-2 bg-background/95 backdrop-blur rounded-bl-lg">
          <div className="text-xs text-muted-foreground">
            {allDataRef.current.length} rows loaded
            {result.totalRows && ` of ~${result.totalRows.toLocaleString()}`}
            {!result.isComplete && ' (more available)'}
          </div>
        </div>
      )}
    </div>
  );
}