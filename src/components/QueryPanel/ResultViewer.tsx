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
  gridId: string;
  isStreaming?: boolean;
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;

  // Multi-query results support
  multiResults?: MultiQueryResult[];
  activeResultIndex?: number;
  onResultTabChange?: (index: number) => void;
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
  activeResultIndex = 0,
  onResultTabChange,
}: ResultViewerProps) {
  // Local state for tab switching (falls back to prop)
  const [localActiveIndex, setLocalActiveIndex] = useState(activeResultIndex);

  // Use controlled or uncontrolled mode
  const currentActiveIndex = onResultTabChange
    ? activeResultIndex
    : localActiveIndex;
  const handleTabChange = (index: number) => {
    if (onResultTabChange) {
      onResultTabChange(index);
    } else {
      setLocalActiveIndex(index);
    }
  };

  // If we have multi-results, render tabbed interface
  if (multiResults && multiResults.length > 0) {
    const activeResult = multiResults[currentActiveIndex];
    const actualResult = activeResult?.result || null;

    return (
      <div className={cn("flex flex-col h-full", className)}>
        {/* Horizontal tabs for each statement */}
        <div className="flex items-center gap-1 px-2 py-1 bg-secondary/30 border-b overflow-x-auto">
          {multiResults.map((mr, index) => {
            const isActive = index === currentActiveIndex;
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
              gridId={`${gridId}-stmt${currentActiveIndex}`}
              viewMode={viewMode}
              cursorSetupMs={actualResult.cursorSetupMs}
              totalStreamingMs={actualResult.totalStreamingMs}
              fetchCount={actualResult.fetchCount}
              networkMs={actualResult.networkMs}
              conversionMs={actualResult.conversionMs}
              ipcSendMs={actualResult.ipcSendMs}
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
}

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

      {viewMode === "explain" || viewMode === "raw" || viewMode === "stats" ? (
        <div className="h-full">
          <ExplainViewer
            result={{ columns: result.columns, rows: result.rows }}
            viewMode={viewMode}
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
