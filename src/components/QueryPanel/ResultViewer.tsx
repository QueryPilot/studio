import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, XCircle, Clipboard, CheckCircle } from "lucide-react";
import { TableDataGridV2 } from "@/components/DataGridV2";
import { DataGridSkeleton } from "@/components/DataGridV2/components/DataGridSkeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import { type ColumnMeta } from "@/types/database";
import type { CellValue as BackendCellValue } from "@/services/backend";
import { normalizeBackendValue } from "@/services/tableDataTransform";

interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: unknown[][];
  rowCount: number;
  affectedRows?: number;
  executionTime?: number;
  error?: string;
}

interface ResultViewerProps {
  result: QueryResult | null;
  isLoading?: boolean;
  className?: string;
  height?: string;
  connectionId?: string;
  database?: string;
  gridId: string;
  isStreaming?: boolean;
  viewMode: "table" | "json";
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;
}

export const ResultViewer = memo(function ResultViewer({
  result,
  isLoading = false,
  className,
  gridId,
  isStreaming = false,
  viewMode,
  cursorSetupMs,
  totalStreamingMs,
  fetchCount,
  networkMs,
  conversionMs,
  ipcSendMs,
}: ResultViewerProps) {
  const jsonContent = useMemo(() => {
    // Skip expensive JSON computation when in table mode
    if (viewMode !== "json") {
      return "[]";
    }

    if (!result || result.error) {
      return "[]";
    }

    const objects = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        const rawValue = row[i] as BackendCellValue | undefined;
        obj[col] = normalizeBackendValue(rawValue);
      });
      return obj;
    });

    try {
      return JSON.stringify(objects, null, 2);
    } catch (err) {
      console.warn("[ResultViewer] Failed to stringify query results", err);
      return "[]";
    }
  }, [result, viewMode]);

  // Show skeleton when loading and no result yet
  if (isLoading && !result) {
    return (
      <div className={cn("h-full", className)}>
        <DataGridSkeleton />
      </div>
    );
  }

  // Do not block rendering while loading; if we have any rows/columns, show them

  if (!result) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/10 h-full",
          className,
        )}
      >
        <div className="flex flex-col items-center space-y-2 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">No results to display</p>
          <p className="text-xs">Execute a query to see results here</p>
        </div>
      </div>
    );
  }

  if (result.error) {
    const handleCopyError = () => {
      navigator.clipboard
        .writeText(result.error || "")
        .then(() => {
          toast.success("Error message copied to clipboard");
        })
        .catch(() => {
          toast.error("Failed to copy to clipboard");
        });
    };

    return (
      <div
        className={cn(
          "flex items-center justify-center bg-destructive/5 h-full",
          className,
        )}
      >
        <div className="flex flex-col items-center space-y-3 p-6 max-w-2xl w-full">
          <XCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-semibold text-destructive">Query Error</p>
          <div className="relative w-full">
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4 pr-12 overflow-auto max-h-[400px]">
              <pre className="text-xs text-destructive/90 whitespace-pre-wrap break-words font-mono select-text">
                {result.error}
              </pre>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8 hover:bg-destructive/20"
              onClick={handleCopyError}
              title="Copy error message"
            >
              <Clipboard className="h-4 w-4 text-destructive/70" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Check your SQL syntax and connection status
          </p>
        </div>
      </div>
    );
  }

  // Handle mutation results (UPDATE, DELETE, INSERT, TRUNCATE)
  // Special case: RETURNING clause queries have both affectedRows AND data to show
  if (result.affectedRows !== undefined && result.rows.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/10 h-full",
          className,
        )}
      >
        <div className="flex flex-col items-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-500" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground">
              Query executed successfully
            </p>
            <p className="text-2xl font-bold text-foreground">
              {result.affectedRows.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">rows affected</p>
          </div>
          {result.executionTime !== undefined && (
            <div className="pt-2 border-t border-border/50 w-full flex justify-center">
              <p className="text-xs text-muted-foreground font-mono">
                {result.executionTime}ms
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Handle DDL and other queries with success messages but no rows (CREATE, ALTER, DROP)
  if (result.message && result.rows.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/10 h-full",
          className,
        )}
      >
        <div className="flex flex-col items-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-500" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground">
              {result.message}
            </p>
          </div>
          {result.executionTime !== undefined && (
            <div className="pt-2 border-t border-border/50 w-full flex justify-center">
              <p className="text-xs text-muted-foreground font-mono">
                {result.executionTime}ms
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // For RETURNING clause queries: show banner with affected rows count above the data
  const hasReturningData = result.affectedRows !== undefined && result.rows.length > 0;

  return (
    <div className={cn("overflow-hidden h-full flex flex-col", className)}>
      {/* Banner for RETURNING clause queries */}
      {hasReturningData && (
        <div className="px-2 py-1.5 bg-green-500/10 border-b border-green-500/20 flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-500 flex-shrink-0" />
          <span className="text-sm font-medium text-green-700 dark:text-green-400">
            {result.message || `${result.affectedRows} row(s) affected`}
          </span>
        </div>
      )}

      {viewMode === "table" ? (
        <div className="h-full px-1 pt-1">
          <TableDataGridV2
            mode="query"
            gridId={gridId}
            data={
              !result.error
                ? {
                    columns: result.columns,
                    rows: result.rows,
                    columnMeta: result.columnMeta,
                  }
                : undefined
            }
            executionTime={result.executionTime}
            cursorSetupMs={cursorSetupMs}
            totalStreamingMs={totalStreamingMs}
            fetchCount={fetchCount}
            networkMs={networkMs}
            conversionMs={conversionMs}
            ipcSendMs={ipcSendMs}
            isStreaming={isStreaming}
            className="h-full"
            error={result.error ?? null}
          />
        </div>
      ) : (
        <div className="h-full pt-1">
          <JsonViewer content={jsonContent} />
        </div>
      )}
    </div>
  );
});

interface JsonViewerProps {
  content: string;
}

const JsonViewer = memo(function JsonViewer({ content }: JsonViewerProps) {
  return (
    <div className="h-full overflow-hidden px-1 bg-background">
      <CodeEditor
        value={content}
        language="json"
        readOnly
        height="100%"
        className="h-full"
        lineNumbers
      />
    </div>
  );
});
