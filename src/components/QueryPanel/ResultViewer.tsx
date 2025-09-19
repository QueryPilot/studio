import { memo, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Copy,
  Download,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clipboard,
} from "lucide-react";
import { QueryDataGrid } from "@/components/DataGrid";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";

interface QueryResult {
  columns: string[];
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
}

export const ResultViewer = memo(function ResultViewer({
  result,
  isLoading = false,
  className,
  connectionId = "",
}: ResultViewerProps) {
  const [viewMode, setViewMode] = useState<"table" | "json">("table");

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

  const handleCopyToClipboard = () => {
    if (!result || result.error) return;

    const data =
      viewMode === "json"
        ? JSON.stringify(
            result.rows.map((row) => {
              const obj: Record<string, unknown> = {};
              result.columns.forEach((col, i) => {
                obj[col] = row[i];
              });
              return obj;
            }),
            null,
            2,
          )
        : result.rows
            .map((row) => row.map((cell) => String(cell ?? "")).join("\t"))
            .join("\n");

    navigator.clipboard
      .writeText(data)
      .then(() => {
        toast.success("Copied to clipboard");
      })
      .catch(() => {
        toast.error("Failed to copy to clipboard");
      });
  };

  const handleExport = (format: "json" | "csv") => {
    if (!result || result.error) return;

    let data: string;
    let mimeType: string;
    let filename: string;

    if (format === "json") {
      data = JSON.stringify(
        result.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          result.columns.forEach((col, i) => {
            obj[col] = row[i];
          });
          return obj;
        }),
        null,
        2,
      );
      mimeType = "application/json";
      filename = `query-result-${Date.now()}.json`;
    } else {
      // CSV format
      const csvRows = [
        result.columns.map((col) => `"${col}"`).join(","),
        ...result.rows.map((row) =>
          row
            .map((cell) => {
              if (cell === null) return "";
              if (
                typeof cell === "string" &&
                (cell.includes(",") ||
                  cell.includes('"') ||
                  cell.includes("\n"))
              ) {
                return `"${cell.replace(/"/g, '""')}"`;
              }
              return cell;
            })
            .join(","),
        ),
      ];
      data = csvRows.join("\n");
      mimeType = "text/csv";
      filename = `query-result-${Date.now()}.csv`;
    }

    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported as ${format.toUpperCase()}`);
  };

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <div className="flex flex-col items-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b border-primary"></div>
          <p className="text-sm text-muted-foreground">Executing query...</p>
        </div>
      </div>
    );
  }

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
      {/* Header with status and actions */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20 flex-shrink-0">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-xs font-medium">{result.rowCount} rows</span>
          </div>
          {result.executionTime && (
            <span className="text-xs text-muted-foreground">
              {result.executionTime}ms
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={handleCopyToClipboard}
          >
            <Copy className="h-3 w-3" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => {
              handleExport(viewMode === "json" ? "json" : "csv");
            }}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Results with tabs */}
      <div className="flex-1 min-h-0">
        <Tabs
          value={viewMode}
          onValueChange={(value) => {
            setViewMode(value as "table" | "json");
          }}
          className="h-full flex flex-col"
        >
          <TabsList className="grid w-full grid-cols-2 mx-3 mt-2 mb-0">
            <TabsTrigger value="table" className="text-xs">
              Table
            </TabsTrigger>
            <TabsTrigger value="json" className="text-xs">
              JSON
            </TabsTrigger>
          </TabsList>

          <TabsContent value="table" className="flex-1 mt-2 mx-0">
            <QueryDataGrid
              connectionId={connectionId}
              query=""
              data={
                result && !result.error
                  ? { columns: result.columns, rows: result.rows }
                  : undefined
              }
              className="h-full"
            />
          </TabsContent>

          <TabsContent value="json" className="flex-1 mt-2 mx-0 h-full">
            <JsonViewer content={jsonContent} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
});

interface JsonViewerProps {
  content: string;
}

const JsonViewer = memo(function JsonViewer({ content }: JsonViewerProps) {
  return (
    <div className="h-full px-3 pb-3">
      <div className="h-full overflow-hidden rounded-md border bg-background">
        <CodeEditor
          value={content}
          language="json"
          readOnly
          height="100%"
          className="h-full"
          lineNumbers
        />
      </div>
    </div>
  );
});
