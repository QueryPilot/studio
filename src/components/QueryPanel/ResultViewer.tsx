import { logger } from "@/lib/logger";
import { memo, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  IconAlertCircle,
  IconCircleX,
  IconCircleCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconClipboardCheck,
  IconDownload,
  IconCheck,
  IconPin,
  IconPinFilled,
} from "@tabler/icons-react";
import { TableDataGrid } from "@/components/DataGrid";
import { DataGridSkeleton } from "@/components/DataGrid/components/DataGridSkeleton";

import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import { type ColumnMeta } from "@/types/database";
import type { CellValue as BackendCellValue } from "@/services/backend";
import { normalizeBackendValue } from "@/services/tableDataTransform";
import { ExplainViewer } from "./ExplainViewer";
import type { MultiQueryResult } from "@/stores/tabStateStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { exportToCSV, type ExportOptions } from "@/utils/csvExport";
import { exportToJSON, type JsonExportOptions, type JsonFormat } from "@/utils/jsonExport";
import { copyInsertToClipboard, type InsertExportOptions } from "@/utils/sqlInsertExport";
import { copyMarkdownToClipboard } from "@/utils/markdownExport";
import { toast } from "sonner";

interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: unknown[][];
  rowCount: number;
  affectedRows?: number;
  executionTime?: number;
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;
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
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;

  // Multi-query results support - always controlled by parent
  multiResults?: MultiQueryResult[];
  activeResultIndex: number;
  onResultTabChange: (index: number) => void;

  // Pin support
  tabId?: string;
  pinnedResult?: QueryResult | null;
  pinnedResultQuery?: string;
  onPinResult?: () => void;
  onUnpinResult?: () => void;

  // EXPLAIN plan diff support
  currentQuery?: string;
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
  multiResults,
  activeResultIndex,
  onResultTabChange,
  schema,
  databaseType,
  pinnedResult,
  pinnedResultQuery,
  onPinResult,
  onUnpinResult,
  tabId: _tabId,
  currentQuery: _currentQuery,
}: ResultViewerProps) {
  const [activeTab, setActiveTab] = useState<"current" | "pinned">("current");

  const handleTabChange = (index: number) => {
    onResultTabChange(index);
  };

  const hasPinnedResult = Boolean(pinnedResult && !pinnedResult.error);
  const hasCurrentResult = Boolean(result && !isLoading);

  // If we have a pinned result alongside current result, show pin tabs
  if (hasPinnedResult && hasCurrentResult) {
    const displayResult = (activeTab === "pinned" ? pinnedResult : result) || null;
    const displayQuery = activeTab === "pinned" ? pinnedResultQuery : undefined;

    return (
      <div className={cn("flex flex-col h-full", className)}>
        {/* Pin tabs */}
        <div className="flex items-center gap-1 px-2 py-1 bg-secondary/30 border-b">
          <button
            onClick={() => setActiveTab("current")}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              "hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-primary/20",
              activeTab === "current" &&
                "bg-primary/15 text-foreground border border-primary/30 shadow-sm",
              activeTab !== "current" && "text-muted-foreground bg-secondary/40",
            )}
          >
            <span>Current Result</span>
          </button>
          <button
            onClick={() => setActiveTab("pinned")}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              "hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-primary/20",
              activeTab === "pinned" &&
                "bg-primary/15 text-foreground border border-primary/30 shadow-sm",
              activeTab !== "pinned" && "text-muted-foreground bg-secondary/40",
            )}
          >
            <IconPinFilled className="h-3 w-3" />
            <span>Pinned Result</span>
          </button>
          {activeTab === "pinned" && onUnpinResult && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnpinResult}
              className="h-7 ml-auto"
              title="Unpin result"
            >
              <IconPin className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Query info for pinned result */}
        {activeTab === "pinned" && displayQuery && (
          <div className="px-2 py-1.5 bg-muted/20 border-b text-xs text-muted-foreground font-mono truncate">
            {displayQuery.length > 100 ? `${displayQuery.substring(0, 100)}...` : displayQuery}
          </div>
        )}

        {/* Result content */}
        <div className="flex-1 min-h-0">
          <SingleResultView
            result={displayResult}
            isLoading={false}
            isStreaming={false}
            gridId={`${gridId}-${activeTab}`}
            viewMode={viewMode}
            cursorSetupMs={displayResult?.cursorSetupMs || cursorSetupMs}
            totalStreamingMs={displayResult?.totalStreamingMs || totalStreamingMs}
            fetchCount={displayResult?.fetchCount || fetchCount}
            networkMs={displayResult?.networkMs || networkMs}
            conversionMs={displayResult?.conversionMs || conversionMs}
            ipcSendMs={displayResult?.ipcSendMs || ipcSendMs}
            schema={schema}
            databaseType={databaseType}
            showPinButton={activeTab === "current"}
            isPinned={false}
            onPinResult={onPinResult}
            tabId={_tabId}
            currentQuery={_currentQuery}
          />
        </div>
      </div>
    );
  }

  // If we have multi-results, render tabbed interface
  if (multiResults && multiResults.length > 0) {
    const activeResult = multiResults[activeResultIndex];
    const actualResult = activeResult?.result || null;

    return (
      <div className={cn("flex flex-col h-full", className)}>
        {/* Horizontal tabs for each statement */}
        <div className="flex items-center gap-1 px-2 py-1 bg-secondary/30 border-b overflow-x-auto">
          {multiResults.map((mr, index) => {
            const isActive = index === activeResultIndex;
            const hasError = Boolean(mr.result.error);
            const rowCount = mr.result.rowCount || mr.result.affectedRows || 0;

            // Truncate statement to first 40 chars
            const displayText =
              mr.statement.length > 40
                ? `${mr.statement.substring(0, 40)}...`
                : mr.statement;

            return (
              <button
                key={index}
                onClick={() => {
                  handleTabChange(index);
                }}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  "hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-primary/20",
                  isActive &&
                    "bg-primary/15 text-foreground border border-primary/30 shadow-sm",
                  !isActive && "text-muted-foreground bg-secondary/40",
                  hasError && "text-destructive",
                )}
                title={mr.statement}
              >
                <span className="truncate max-w-[200px]">{displayText}</span>
                {!hasError && (
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary rounded">
                    {rowCount}
                  </span>
                )}
                {hasError && (
                  <IconCircleX className="h-3 w-3 text-destructive" />
                )}
              </button>
            );
          })}
        </div>

        {/* Result content for active tab */}
        <div className="flex-1 min-h-0">
          {actualResult && (
            <SingleResultView
              result={actualResult}
              isLoading={false}
              isStreaming={false}
              gridId={`${gridId}-stmt${activeResultIndex}`}
              viewMode={viewMode}
              cursorSetupMs={actualResult.cursorSetupMs}
              totalStreamingMs={actualResult.totalStreamingMs}
              fetchCount={actualResult.fetchCount}
              networkMs={actualResult.networkMs}
              conversionMs={actualResult.conversionMs}
              ipcSendMs={actualResult.ipcSendMs}
              schema={schema}
              databaseType={databaseType}
              tabId={_tabId}
              currentQuery={_currentQuery}
            />
          )}
        </div>
      </div>
    );
  }

  // Single result mode (existing behavior)
  return (
    <div className={cn("h-full", className)}>
      <SingleResultView
        result={result}
        isLoading={isLoading}
        isStreaming={isStreaming}
        gridId={gridId}
        viewMode={viewMode}
        cursorSetupMs={cursorSetupMs}
        totalStreamingMs={totalStreamingMs}
        fetchCount={fetchCount}
        networkMs={networkMs}
        conversionMs={conversionMs}
        ipcSendMs={ipcSendMs}
        schema={schema}
        databaseType={databaseType}
        showPinButton={!hasPinnedResult && hasCurrentResult}
        isPinned={hasPinnedResult}
        onPinResult={onPinResult}
      />
    </div>
  );
});

/**
 * Single result view component - extracted for reuse in both single and multi-result modes
 */
interface SingleResultViewProps {
  result: QueryResult | null;
  isLoading: boolean;
  isStreaming: boolean;
  gridId: string;
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;
  schema?: string;
  databaseType?: string;
  showPinButton?: boolean;
  isPinned?: boolean;
  onPinResult?: () => void;
  tabId?: string;
  currentQuery?: string;
}

interface ExportMenuProps {
  columns: string[];
  rows: unknown[][];
  schema?: string;
  databaseType?: string;
}

const ExportMenu = memo(function ExportMenu({ columns, rows, schema, databaseType }: ExportMenuProps) {
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
  const [alignNumeric, setAlignNumeric] = useState<"left" | "center" | "right">("right");

  const handleExportCSV = () => {
    const options: ExportOptions = {
      delimiter,
      includeHeaders,
      encoding: "utf-8",
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `query-export-${timestamp}.csv`;

    const result = exportToCSV(rows, columns, options, filename);

    if (result.success) {
      toast.success("CSV exported successfully", {
        description: `${result.rowCount.toLocaleString()} rows exported`,
      });
    } else {
      toast.error("Export failed", {
        description: result.error || "Unknown error",
      });
    }
  };

  const handleExportJSON = () => {
    const options: JsonExportOptions = {
      format: jsonFormat,
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `query-export-${timestamp}.json`;

    const result = exportToJSON(rows, columns, options, filename);

    if (result.success) {
      toast.success("JSON exported successfully", {
        description: `${result.rowCount.toLocaleString()} rows exported as ${jsonFormat}`,
      });
    } else {
      toast.error("Export failed", {
        description: result.error || "Unknown error",
      });
    }
  };

  const handleCopyInsert = async () => {
    const validTypes = ["postgresql", "mysql", "mariadb", "mssql", "sqlite"];
    const dbTypeToUse = databaseType && validTypes.includes(databaseType)
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
    const result = await copyMarkdownToClipboard(rows, columns, { alignNumeric });

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
      <DropdownMenuTrigger
        render={(props) => (
          <Button
            {...props}
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
          >
            <IconDownload className="h-3.5 w-3.5" />
            Export
          </Button>
        )}
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Export Format</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              setExportFormat("csv");
            }}
          >
            {exportFormat === "csv" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
            {exportFormat !== "csv" && <span className="w-3.5 mr-2" />}
            CSV (Comma Separated)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setExportFormat("json");
            }}
          >
            {exportFormat === "json" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
            {exportFormat !== "json" && <span className="w-3.5 mr-2" />}
            JSON (JavaScript Object)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setExportFormat("insert");
            }}
          >
            {exportFormat === "insert" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
            {exportFormat !== "insert" && <span className="w-3.5 mr-2" />}
            SQL INSERT Statements
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setExportFormat("markdown");
            }}
          >
            {exportFormat === "markdown" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
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
                {delimiter === "," && <IconCheck className="h-3.5 w-3.5 mr-2" />}
                {delimiter !== "," && <span className="w-3.5 mr-2" />}
                Comma (,)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDelimiter(";");
                }}
              >
                {delimiter === ";" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
                {delimiter !== ";" && <span className="w-3.5 mr-2" />}
                Semicolon (;)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDelimiter("\t");
                }}
              >
                {delimiter === "\t" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
                {delimiter !== "\t" && <span className="w-3.5 mr-2" />}
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
                {jsonFormat === "pretty" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
                {jsonFormat !== "pretty" && <span className="w-3.5 mr-2" />}
                Pretty (Indented)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setJsonFormat("compact");
                }}
              >
                {jsonFormat === "compact" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
                {jsonFormat !== "compact" && <span className="w-3.5 mr-2" />}
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
                {alignNumeric === "right" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
                {alignNumeric !== "right" && <span className="w-3.5 mr-2" />}
                Align Numbers Right
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAlignNumeric("left");
                }}
              >
                {alignNumeric === "left" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
                {alignNumeric !== "left" && <span className="w-3.5 mr-2" />}
                Align Numbers Left
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAlignNumeric("center");
                }}
              >
                {alignNumeric === "center" && <IconCheck className="h-3.5 w-3.5 mr-2" />}
                {alignNumeric !== "center" && <span className="w-3.5 mr-2" />}
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

const SingleResultView = memo(function SingleResultView({
  result,
  isLoading,
  isStreaming,
  gridId,
  viewMode,
  cursorSetupMs,
  totalStreamingMs,
  fetchCount,
  networkMs,
  conversionMs,
  ipcSendMs,
  schema,
  databaseType,
  showPinButton = false,
  isPinned = false,
  onPinResult,
  tabId: _tabId,
  currentQuery: _currentQuery,
}: SingleResultViewProps) {
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
      logger.warn("[ResultViewer] Failed to stringify query results", err);
      return "[]";
    }
  }, [result, viewMode]);

  // Show skeleton when loading/streaming and no result yet
  // Keep previous results visible during loading to avoid flashing
  if ((isLoading || isStreaming) && !result) {
    return (
      <div className="h-full">
        <DataGridSkeleton />
      </div>
    );
  }

  // Do not block rendering while loading; if we have any rows/columns, show them

  if (!result) {
    return (
      <div className="flex items-center justify-center bg-muted/10 h-full">
        <div className="flex flex-col items-center space-y-2 text-muted-foreground">
          <IconAlertCircle className="h-8 w-8" />
          <p className="text-xs">No results to display</p>
          <p className="text-xs">Execute a query to see results here</p>
        </div>
      </div>
    );
  }

  if (result.error) {
    return <ErrorDisplay error={result.error} />;
  }

  // Handle mutation results (UPDATE, DELETE, INSERT, TRUNCATE)
  // Special case: RETURNING clause queries have both affectedRows AND data to show
  if (result.affectedRows !== undefined && result.rows.length === 0) {
    return (
      <div className="flex items-center justify-center bg-muted/10 h-full">
        <div className="flex flex-col items-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <IconCircleCheck className="h-6 w-6 text-green-600 dark:text-green-500" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-xs font-medium text-foreground">
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
      <div className="flex items-center justify-center bg-muted/10 h-full">
        <div className="flex flex-col items-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <IconCircleCheck className="h-6 w-6 text-green-600 dark:text-green-500" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-xs font-medium text-foreground">
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

  const hasExportableData = result.rows.length > 0 && result.columns.length > 0;

  return (
    <div className="overflow-hidden h-full flex flex-col">
      {/* Banner for RETURNING clause queries */}
      {hasReturningData && (
        <div className="px-2 py-1.5 bg-green-500/10 border-b border-green-500/20 flex items-center gap-2">
          <IconCircleCheck className="h-4 w-4 text-green-600 dark:text-green-500 flex-shrink-0" />
          <span className="text-xs font-medium text-green-700 dark:text-green-400">
            {result.message || `${result.affectedRows} row(s) affected`}
          </span>
        </div>
      )}

      {/* Export button and pin button for results with data */}
      {hasExportableData && (
        <div className="px-2 py-1.5 border-b bg-muted/30 flex items-center justify-end gap-2">
          {showPinButton && onPinResult && (
            <Button
              variant="outline"
              size="sm"
              onClick={onPinResult}
              className="h-7 gap-1.5"
              title="Pin this result to keep it visible while running new queries"
            >
              {isPinned ? (
                <>
                  <IconPinFilled className="h-3.5 w-3.5" />
                  Pinned
                </>
              ) : (
                <>
                  <IconPin className="h-3.5 w-3.5" />
                  Pin Result
                </>
              )}
            </Button>
          )}
          <ExportMenu columns={result.columns} rows={result.rows} schema={schema} databaseType={databaseType} />
        </div>
      )}

      {viewMode === "explain" || viewMode === "raw" || viewMode === "stats" ? (
        <div className="h-full">
          <ExplainViewer
            result={{ columns: result.columns, rows: result.rows }}
            viewMode={viewMode}
            tabId={_tabId}
            currentQuery={_currentQuery}
          />
        </div>
      ) : viewMode === "table" ? (
        <div className="h-full px-1 pt-1">
          <TableDataGrid
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

interface ErrorDisplayProps {
  error: string;
  className?: string;
}

interface ParsedError {
  mainMessage: string;
  detail?: string;
  hint?: string;
  position?: string;
  failingRow?: string;
}

function parsePostgresError(error: string): ParsedError {
  const lines = error.split("\n");
  const parsed: ParsedError = {
    mainMessage: lines[0] || error,
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.startsWith("Detail: ") || line.startsWith("DETAIL: ")) {
      const detailText = line.substring(line.indexOf(":") + 1).trim();

      // Extract failing row if present
      const failingRowMatch = detailText.match(/Failing row contains \((.*)\)/);
      if (failingRowMatch) {
        parsed.failingRow = failingRowMatch[1];
        parsed.detail = detailText.substring(0, failingRowMatch.index).trim();
      } else {
        parsed.detail = detailText;
      }
    } else if (line.startsWith("Hint: ") || line.startsWith("HINT: ")) {
      parsed.hint = line.substring(line.indexOf(":") + 1).trim();
    } else if (line.startsWith("Position: ") || line.startsWith("LINE ")) {
      parsed.position = line;
    }
  }

  return parsed;
}

const ErrorDisplay = memo(function ErrorDisplay({
  error,
  className,
}: ErrorDisplayProps) {
  const [showFullRow, setShowFullRow] = useState(false);
  const [copied, setCopied] = useState(false);
  const parsed = useMemo(() => parsePostgresError(error), [error]);

  const handleCopyError = () => {
    navigator.clipboard
      .writeText(error)
      .then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 3000);
      })
      .catch(() => {
        // Silent fail
      });
  };

  // Format failing row data into readable chunks
  const formattedRowData = useMemo(() => {
    if (!parsed.failingRow) return null;

    // Split by commas but preserve commas in quotes/parens
    const parts: string[] = [];
    let current = "";
    let depth = 0;
    let inQuote = false;

    for (let i = 0; i < parsed.failingRow.length; i++) {
      const char = parsed.failingRow[i];

      if (char === '"' || char === "'") {
        inQuote = !inQuote;
        current += char;
      } else if (char === "(" || char === "{") {
        depth++;
        current += char;
      } else if (char === ")" || char === "}") {
        depth--;
        current += char;
      } else if (char === "," && depth === 0 && !inQuote) {
        parts.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }, [parsed.failingRow]);

  const shouldTruncate = formattedRowData && formattedRowData.length > 5;
  const displayedRowData =
    shouldTruncate && !showFullRow
      ? formattedRowData.slice(0, 5)
      : formattedRowData;

  return (
    <div className={cn("h-full overflow-auto", className)}>
      <div className="flex flex-col space-y-4 p-6 w-full">
        <div className="flex items-start gap-3">
          <IconCircleX className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-xs font-semibold text-destructive mb-1">
              Query Error
            </h3>
            <p className="text-xs text-destructive/90 font-medium select-text">
              {parsed.mainMessage}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0 hover:bg-destructive/20"
            onClick={handleCopyError}
            title={copied ? "Copied!" : "Copy error"}
          >
            {copied ? (
              <IconClipboardCheck className="h-4 w-4 text-green-600" />
            ) : (
              <IconCopy className="h-4 w-4 text-destructive/70" />
            )}
          </Button>
        </div>

        {parsed.detail && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-xs font-semibold text-destructive/70 mb-1.5">
              DETAIL
            </p>
            <p className="text-xs text-destructive/80 leading-relaxed select-text">
              {parsed.detail}
            </p>
          </div>
        )}

        {formattedRowData && (
          <div className="bg-muted/50 border border-border rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground">
                FAILING ROW DATA
              </p>
              {shouldTruncate && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setShowFullRow(!showFullRow);
                  }}
                >
                  {showFullRow ? (
                    <>
                      <IconChevronUp className="h-3 w-3 mr-1" />
                      Show less
                    </>
                  ) : (
                    <>
                      <IconChevronDown className="h-3 w-3 mr-1" />
                      Show all ({formattedRowData.length} fields)
                    </>
                  )}
                </Button>
              )}
            </div>
            <div className="space-y-1.5 font-mono text-xs">
              {displayedRowData?.map((part, idx) => (
                <div
                  key={idx}
                  className="flex gap-2 py-1.5 px-2 bg-background/50 rounded border border-border/50"
                >
                  <span className="text-muted-foreground font-semibold min-w-[2ch]">
                    {idx + 1}.
                  </span>
                  <span className="text-foreground break-all select-text">
                    {part}
                  </span>
                </div>
              ))}
              {shouldTruncate && !showFullRow && (
                <div className="text-xs text-muted-foreground italic pl-2 pt-1">
                  ... and {formattedRowData.length - 5} more fields
                </div>
              )}
            </div>
          </div>
        )}

        {parsed.hint && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1.5">
              HINT
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed select-text">
              {parsed.hint}
            </p>
          </div>
        )}

        {parsed.position && (
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-md p-3">
            <pre className="text-xs text-orange-700 dark:text-orange-300 font-mono select-text">
              {parsed.position}
            </pre>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center pt-2">
          Check your SQL syntax and connection status
        </p>
      </div>
    </div>
  );
});
