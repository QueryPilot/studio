import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Copy,
  Download,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { QueryDataGrid } from "@/components/DataGrid";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-destructive/10 h-full",
          className,
        )}
      >
        <div className="flex flex-col items-center space-y-2 p-4">
          <XCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-semibold text-destructive">Query Error</p>
          <p className="text-xs text-destructive/80 text-center max-w-md">
            {result.error}
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

          <TabsContent value="json" className="flex-1 mt-2 mx-0">
            <ScrollArea className="h-full">
              <pre className="p-4 text-xs font-mono overflow-x-auto">
                {JSON.stringify(
                  result.rows.map((row) => {
                    const obj: Record<string, unknown> = {};
                    result.columns.forEach((col, i) => {
                      obj[col] = row[i];
                    });
                    return obj;
                  }),
                  null,
                  2,
                )}
              </pre>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
});
