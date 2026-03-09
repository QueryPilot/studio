import { logger } from "@/lib/logger";
import type { ViewMode } from "@/types/viewMode";

import { memo, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  IconAlertCircle,
  IconCircleX,
  IconClipboard,
  IconCircleCheck,
  IconDownload,
  IconCopy,
  IconCheck,
  IconSparkles,
} from "@tabler/icons-react";
import { QueryResultGrid } from "@/components/DataGrid";
import { DataGridSkeleton } from "@/components/DataGrid/components/DataGridSkeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import { type ColumnMeta } from "@/types/database";
import type { RawCellValue } from "@/services/backend";
import { normalizeBackendValue } from "@/services/tableDataTransform";
import { exportToCSV, type ExportOptions } from "@/utils/csvExport";
import {
  exportToJSON,
  type JsonExportOptions,
  type JsonFormat,
} from "@/utils/jsonExport";
import {
  copyInsertToClipboard,
  type InsertExportOptions,
} from "@/utils/sqlInsertExport";
import { copyMarkdownToClipboard } from "@/utils/markdownExport";
import { ExplainViewer } from "./ExplainViewer";
import { DbType, getParadigm, type DatabaseParadigm } from "@/types/connection";
import type { QueryExecutionStatus } from "./queryExecutionState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { writeClipboardText } from "@/lib/clipboard";

interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: unknown[][];
  rowCount: number;
  affectedRows?: number;
  executionTime?: number;
  message?: string;
  error?: string;
}

interface ResultViewerProps {
  result: QueryResult | null;
  isLoading?: boolean;
  className?: string;
  height?: string;
  connectionId?: string;
  database?: string;
  schema?: string;
  databaseType?: string;
  gridId: string;
  isStreaming?: boolean;
  viewMode: ViewMode;
  executionStatus?: QueryExecutionStatus;
  /** Callback to send the error + SQL to the AI panel for fixing */
  onFixWithAI?: (error: string) => void;
  onRefreshResults?: () => void;
  refreshNotice?: string;
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;
}

interface ExportMenuProps {
  columns: string[];
  rows: unknown[][];
  schema?: string;
  databaseType?: string;
}

// Database type mapping - defined at module level to avoid recreation on each render
const DB_TYPE_MAP: Record<string, DbType> = {
  postgresql: DbType.PostgreSQL,
  postgres: DbType.PostgreSQL,
  mysql: DbType.MySQL,
  mariadb: DbType.MariaDB,
  sqlite: DbType.SQLite,
  mssql: DbType.SQLServer,
  sqlserver: DbType.SQLServer,
  mongodb: DbType.MongoDB,
  mongo: DbType.MongoDB,
  redis: DbType.Redis,
};

const ExportMenu = memo(function ExportMenu({
  columns,
  rows,
  schema,
  databaseType,
}: ExportMenuProps) {
  type ExportFormat = "csv" | "json" | "insert" | "markdown";
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");

  // CSV options
  const [delimiter, setDelimiter] = useState<"," | ";" | "\t">(",");
  const [includeHeaders, setIncludeHeaders] = useState(true);

  // JSON options
  const [jsonFormat, setJsonFormat] = useState<JsonFormat>("pretty");

  // INSERT options
  const [tableName, setTableName] = useState("table_name");
  const [batchMode, setBatchMode] = useState(true);

  // Markdown options
  const [alignNumeric, setAlignNumeric] = useState<"left" | "center" | "right">(
    "right",
  );

  const handleExportCSV = async () => {
    const options: ExportOptions = {
      delimiter,
      includeHeaders,
      encoding: "utf-8",
    };
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const filename = `query-export-${timestamp}.csv`;
    const result = await exportToCSV(rows, columns, options, filename);
    if (result.success) {
      toast.success("CSV exported successfully", {
        description: `${result.rowCount.toLocaleString()} rows exported`,
      });
    } else if (result.error !== "Export cancelled") {
      toast.error("Export failed", {
        description: result.error || "Unknown error",
      });
    }
  };

  const handleExportJSON = async () => {
    const options: JsonExportOptions = { format: jsonFormat };
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const filename = `query-export-${timestamp}.json`;
    const result = await exportToJSON(rows, columns, options, filename);
    if (result.success) {
      toast.success("JSON exported successfully", {
        description: `${result.rowCount.toLocaleString()} rows exported as ${jsonFormat}`,
      });
    } else if (result.error !== "Export cancelled") {
      toast.error("Export failed", {
        description: result.error || "Unknown error",
      });
    }
  };

  const handleCopyInsert = async () => {
    const validTypes = ["postgresql", "mysql", "mariadb", "mssql", "sqlite"];
    const dbTypeToUse =
      databaseType && validTypes.includes(databaseType)
        ? (databaseType as InsertExportOptions["databaseType"])
        : "postgresql";
    const options: InsertExportOptions = {
      tableName,
      schema,
      databaseType: dbTypeToUse,
      batchMode,
    };
    const result = await copyInsertToClipboard(rows, columns, options);
    if (result.success) {
      toast.success("Copied as INSERT statements", {
        description: `${result.rowCount.toLocaleString()} rows copied to clipboard`,
      });
    } else {
      toast.error("Copy failed", {
        description: result.error || "Unknown error",
      });
    }
  };

  const handleCopyMarkdown = async () => {
    const result = await copyMarkdownToClipboard(rows, columns, {
      alignNumeric,
    });
    if (result.success) {
      toast.success("Copied as Markdown table", {
        description: `${result.rowCount.toLocaleString()} rows copied to clipboard`,
      });
    } else {
      toast.error("Copy failed", {
        description: result.error || "Unknown error",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
        <IconDownload className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Export Format</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              setExportFormat("csv");
            }}
          >
            {exportFormat === "csv" && (
              <IconCheck className="h-3.5 w-3.5 mr-2" />
            )}
            {exportFormat !== "csv" && <span className="w-3.5 mr-2" />}
            CSV (Comma Separated)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setExportFormat("json");
            }}
          >
            {exportFormat === "json" && (
              <IconCheck className="h-3.5 w-3.5 mr-2" />
            )}
            {exportFormat !== "json" && <span className="w-3.5 mr-2" />}
            JSON (JavaScript Object)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setExportFormat("insert");
            }}
          >
            {exportFormat === "insert" && (
              <IconCheck className="h-3.5 w-3.5 mr-2" />
            )}
            {exportFormat !== "insert" && <span className="w-3.5 mr-2" />}
            SQL INSERT Statements
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setExportFormat("markdown");
            }}
          >
            {exportFormat === "markdown" && (
              <IconCheck className="h-3.5 w-3.5 mr-2" />
            )}
            {exportFormat !== "markdown" && <span className="w-3.5 mr-2" />}
            Markdown Table
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {exportFormat === "csv" && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                CSV Options
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  setDelimiter(",");
                }}
              >
                {delimiter === "," ? (
                  <IconCheck className="h-3.5 w-3.5 mr-2" />
                ) : (
                  <span className="w-3.5 mr-2" />
                )}
                Comma (,)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDelimiter(";");
                }}
              >
                {delimiter === ";" ? (
                  <IconCheck className="h-3.5 w-3.5 mr-2" />
                ) : (
                  <span className="w-3.5 mr-2" />
                )}
                Semicolon (;)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDelimiter("\t");
                }}
              >
                {delimiter === "\t" ? (
                  <IconCheck className="h-3.5 w-3.5 mr-2" />
                ) : (
                  <span className="w-3.5 mr-2" />
                )}
                Tab
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={includeHeaders}
              onCheckedChange={setIncludeHeaders}
            >
              Include Headers
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleExportCSV}
              className="bg-primary/10 text-primary font-medium"
            >
              <IconDownload className="h-3.5 w-3.5 mr-2" />
              Download CSV
            </DropdownMenuItem>
          </>
        )}

        {exportFormat === "json" && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                JSON Options
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  setJsonFormat("pretty");
                }}
              >
                {jsonFormat === "pretty" ? (
                  <IconCheck className="h-3.5 w-3.5 mr-2" />
                ) : (
                  <span className="w-3.5 mr-2" />
                )}
                Pretty (Indented)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setJsonFormat("compact");
                }}
              >
                {jsonFormat === "compact" ? (
                  <IconCheck className="h-3.5 w-3.5 mr-2" />
                ) : (
                  <span className="w-3.5 mr-2" />
                )}
                Compact (Minified)
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleExportJSON}
              className="bg-primary/10 text-primary font-medium"
            >
              <IconDownload className="h-3.5 w-3.5 mr-2" />
              Download JSON
            </DropdownMenuItem>
          </>
        )}

        {exportFormat === "insert" && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                INSERT Options
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <div className="px-3 py-2">
              <label className="text-xs text-muted-foreground mb-1 block">
                Table Name
              </label>
              <input
                type="text"
                value={tableName}
                onChange={(e) => {
                  setTableName(e.target.value);
                }}
                className="w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="table_name"
              />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={batchMode}
              onCheckedChange={setBatchMode}
            >
              Batch Mode (Single INSERT)
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleCopyInsert}
              className="bg-primary/10 text-primary font-medium"
            >
              <IconCopy className="h-3.5 w-3.5 mr-2" />
              Copy INSERT
            </DropdownMenuItem>
          </>
        )}

        {exportFormat === "markdown" && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                Markdown Options
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  setAlignNumeric("right");
                }}
              >
                {alignNumeric === "right" ? (
                  <IconCheck className="h-3.5 w-3.5 mr-2" />
                ) : (
                  <span className="w-3.5 mr-2" />
                )}
                Align Numbers Right
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAlignNumeric("left");
                }}
              >
                {alignNumeric === "left" ? (
                  <IconCheck className="h-3.5 w-3.5 mr-2" />
                ) : (
                  <span className="w-3.5 mr-2" />
                )}
                Align Numbers Left
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAlignNumeric("center");
                }}
              >
                {alignNumeric === "center" ? (
                  <IconCheck className="h-3.5 w-3.5 mr-2" />
                ) : (
                  <span className="w-3.5 mr-2" />
                )}
                Align Numbers Center
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleCopyMarkdown}
              className="bg-primary/10 text-primary font-medium"
            >
              <IconCopy className="h-3.5 w-3.5 mr-2" />
              Copy Markdown
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export const ResultViewer = memo(function ResultViewer({
  result,
  isLoading = false,
  className,
  schema,
  databaseType,
  gridId,
  isStreaming = false,
  viewMode,
  executionStatus = "idle",
  cursorSetupMs,
  totalStreamingMs,
  fetchCount,
  networkMs,
  conversionMs,
  ipcSendMs: _ipcSendMs,
  onFixWithAI,
  onRefreshResults,
  refreshNotice,
}: ResultViewerProps) {
  // Determine paradigm from database type
  const paradigm: DatabaseParadigm = useMemo(() => {
    if (!databaseType) return "sql";

    const normalizedType = databaseType.toLowerCase();
    const dbType = DB_TYPE_MAP[normalizedType];

    return dbType ? getParadigm(dbType) : "sql";
  }, [databaseType]);

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
        const rawValue = row[i] as RawCellValue | undefined;
        obj[col] = normalizeBackendValue(rawValue);
      });
      return obj;
    });

    try {
      return JSON.stringify(objects, null, 2);
    } catch (err) {
      logger.warn("[ResultViewer] Failed to stringify query results", err);
      return "[]";
    }
  }, [result, viewMode]);

  // Show skeleton when loading/streaming and no result yet
  if ((isLoading || isStreaming) && !result) {
    return (
      <div className={cn("h-full", className)}>
        <DataGridSkeleton />
      </div>
    );
  }

  if (!result && executionStatus === "cancelled") {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/10 h-full",
          className,
        )}
      >
        <div className="flex max-w-md flex-col items-center space-y-3 p-6 text-center">
          <IconAlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Query cancelled</p>
          <p className="text-xs text-muted-foreground">
            Execution stopped before a result set was completed.
          </p>
          {onRefreshResults && (
            <Button size="sm" variant="outline" onClick={onRefreshResults}>
              Refresh results
            </Button>
          )}
        </div>
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
          <IconAlertCircle className="h-8 w-8" />
          <p className="text-sm">No results to display</p>
          <p className="text-xs">Execute a query to see results here</p>
        </div>
      </div>
    );
  }

  if (result.error) {
    const handleCopyError = () => {
      writeClipboardText(result.error || "")
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
          <IconCircleX className="h-10 w-10 text-destructive" />
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
              <IconClipboard className="h-4 w-4 text-destructive/70" />
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            {onFixWithAI && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => { onFixWithAI(result.error || ""); }}
              >
                <IconSparkles className="h-3.5 w-3.5" />
                Fix with AI
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Check your SQL syntax and connection status
            </p>
          </div>
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
            <IconCircleCheck className="h-6 w-6 text-green-600 dark:text-green-500" />
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
            <IconCircleCheck className="h-6 w-6 text-green-600 dark:text-green-500" />
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
  const hasReturningData =
    result.affectedRows !== undefined && result.rows.length > 0;

  return (
    <div className={cn("overflow-hidden h-full flex flex-col", className)}>
      {(executionStatus === "streaming" || executionStatus === "cancelled") && (
        <div className="px-2 py-1.5 border-b border-border/60 bg-muted/20 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {executionStatus === "streaming"
              ? "Streaming results..."
              : "Query cancelled. Showing partial results."}
          </span>
          {executionStatus === "cancelled" && onRefreshResults && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onRefreshResults}
            >
              Refresh results
            </Button>
          )}
        </div>
      )}

      {refreshNotice && executionStatus !== "streaming" && (
        <div className="px-2 py-1.5 border-b border-amber-500/20 bg-amber-500/10 flex items-center justify-between gap-3">
          <span className="text-xs text-amber-800 dark:text-amber-300">
            {refreshNotice}
          </span>
          {onRefreshResults && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onRefreshResults}
            >
              Refresh results
            </Button>
          )}
        </div>
      )}

      {/* Banner for RETURNING clause queries */}
      {hasReturningData && (
        <div className="px-2 py-1.5 bg-green-500/10 border-b border-green-500/20 flex items-center gap-2">
          <IconCircleCheck className="h-4 w-4 text-green-600 dark:text-green-500 shrink-0" />
          <span className="text-sm font-medium text-green-700 dark:text-green-400">
            {result.message || `${result.affectedRows} row(s) affected`}
          </span>
        </div>
      )}

      {(viewMode === "explain" ||
        viewMode === "raw" ||
        viewMode === "stats") && (
        <div className="h-full">
          <ExplainViewer
            result={{ columns: result.columns, rows: result.rows }}
            databaseType={databaseType}
            viewMode={viewMode}
          />
        </div>
      )}

      {viewMode === "table" && (
        <div className="h-full px-1 pt-1">
          <QueryResultGrid
            gridId={gridId}
            paradigm={paradigm}
            data={
              !result.error
                ? {
                    columns: result.columns,
                    rows: result.rows,
                    columnMeta: result.columnMeta,
                    rowCount: result.rowCount,
                  }
                : undefined
            }
            executionTime={result.executionTime}
            cursorSetupMs={cursorSetupMs}
            totalStreamingMs={totalStreamingMs}
            fetchCount={fetchCount}
            networkMs={networkMs}
            conversionMs={conversionMs}
            isStreaming={isStreaming}
            className="h-full"
            error={result.error ?? null}
            toolbarActions={
              <ExportMenu
                columns={result.columns}
                rows={result.rows}
                schema={schema}
                databaseType={databaseType}
              />
            }
          />
        </div>
      )}

      {viewMode === "json" && (
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
