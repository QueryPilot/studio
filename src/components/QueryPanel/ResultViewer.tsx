import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, XCircle, Clipboard } from "lucide-react";
import { TableDataGridV2 } from "@/components/DataGridV2";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import { type ColumnMeta } from "@/types/database";

interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: unknown[][];
  rowCount: number;
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
}

export const ResultViewer = memo(function ResultViewer({
  result,
  className,
  gridId,
  isStreaming = false,
  viewMode,
}: ResultViewerProps) {
  const jsonContent = useMemo(() => {
    if (!result || result.error) {
      return "[]";
    }

    const objects = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });

    try {
      return JSON.stringify(objects, null, 2);
    } catch (err) {
      console.warn("[ResultViewer] Failed to stringify query results", err);
      return "[]";
    }
  }, [result]);

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
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4 pr-12">
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

  return (
    <div className={cn("overflow-hidden h-full flex flex-col", className)}>
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
