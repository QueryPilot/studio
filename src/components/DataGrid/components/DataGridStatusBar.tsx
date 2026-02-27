import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { IconLoader2, IconEye, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatExecutionTime } from "@/utils/formatTime";
import { SelectionSummary } from "./SelectionSummary";
import { IdentifierColumnsSelector } from "./IdentifierColumnsSelector";
import type { GridRowModel, GridColumnV2, IdentifierSelectorConfig } from "../types";
import { type GridSelection } from "@glideapps/glide-data-grid";

// ============================================================================
// Sub-components (memoized independently)
// ============================================================================

/**
 * Read-only indicator badge
 */
const ReadOnlyBadge = memo(function ReadOnlyBadge({
  reason,
}: {
  reason: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg border border-amber-500/20">
      <span className="font-medium">{reason}</span>
    </div>
  );
});

/**
 * Row count display
 */
const RowCountDisplay = memo(function RowCountDisplay({
  loadedRows,
  estimatedTotal,
  isEstimatedCount,
  hasMore,
}: {
  loadedRows: number;
  estimatedTotal?: number;
  isEstimatedCount?: boolean;
  hasMore?: boolean;
}) {
  const display = useMemo(() => {
    // Only show estimated total if there's actually more to load
    if (estimatedTotal && estimatedTotal > loadedRows && hasMore) {
      // Add ~ prefix if count is estimated (not exact)
      const prefix = isEstimatedCount ? "~" : "";
      return `${loadedRows.toLocaleString()} / ${prefix}${estimatedTotal.toLocaleString()} rows`;
    }

    if (hasMore) {
      return `${loadedRows.toLocaleString()} rows (loading more...)`;
    }

    // When all data is loaded, show exact count (no ~)
    return `${loadedRows.toLocaleString()} rows`;
  }, [loadedRows, estimatedTotal, isEstimatedCount, hasMore]);

  return <span>{display}</span>;
});

/**
 * Streaming progress indicator (with progress bar)
 */
const StreamingProgress = memo(function StreamingProgress({
  loadedRows,
  estimatedTotal,
}: {
  loadedRows: number;
  estimatedTotal: number;
}) {
  const percentage = useMemo(() => {
    if (!estimatedTotal || estimatedTotal === 0) return 0;
    return Math.min(Math.round((loadedRows / estimatedTotal) * 100), 99);
  }, [loadedRows, estimatedTotal]);

  return (
    <>
      <IconLoader2 className="h-3 w-3 animate-spin" />
      <span className="text-primary">Streaming {percentage}%</span>
      <div className="w-24 h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-muted-foreground">•</span>
    </>
  );
});

/**
 * Simple streaming spinner (no progress bar)
 */
const StreamingSpinner = memo(function StreamingSpinner() {
  return (
    <>
      <IconLoader2 className="h-3 w-3 animate-spin text-primary" />
      <span className="text-primary">Streaming...</span>
      <span className="text-muted-foreground">•</span>
    </>
  );
});

/**
 * Processing indicator for batch/paste operations
 */
const ProcessingIndicator = memo(function ProcessingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-primary/10 text-primary rounded-lg border border-primary/20">
      <IconLoader2 className="h-3 w-3 animate-spin" />
      <span className="font-medium">Processing...</span>
    </div>
  );
});

/**
 * Execution time with performance breakdown tooltip
 */
const ExecutionTimeDisplay = memo(function ExecutionTimeDisplay({
  executionTime,
  networkMs,
  conversionMs,
  fetchCount,
}: {
  executionTime: number;
  networkMs?: number;
  conversionMs?: number;
  fetchCount?: number;
}) {
  return (
    <>
      <span className="text-muted-foreground">•</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="text-muted-foreground cursor-help">
              {formatExecutionTime(executionTime)}
            </span>
          }
        />
        <TooltipContent side="top" className="text-xs">
          <div className="space-y-1">
            <div className="font-semibold mb-2">Performance Breakdown</div>
            <div className="flex justify-between gap-4">
              <span>Total:</span>
              <span className="font-mono">
                {formatExecutionTime(executionTime)} ({executionTime}ms)
              </span>
            </div>
            {networkMs !== undefined && (
              <div className="flex justify-between gap-4">
                <span>Network/DB:</span>
                <span className="font-mono">
                  {networkMs}ms (
                  {((networkMs / executionTime) * 100).toFixed(1)}%)
                </span>
              </div>
            )}
            {conversionMs !== undefined && (
              <div className="flex justify-between gap-4">
                <span>Conversion:</span>
                <span className="font-mono">
                  {conversionMs}ms (
                  {((conversionMs / executionTime) * 100).toFixed(1)}%)
                </span>
              </div>
            )}
            {fetchCount !== undefined && (
              <div className="flex justify-between gap-4">
                <span>Batches:</span>
                <span className="font-mono">{fetchCount}</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </>
  );
});

/**
 * Selection info with view details button
 */
const SelectionInfo = memo(function SelectionInfo({
  selectedRows,
  onViewDetails,
  showSeparator,
}: {
  selectedRows: number;
  onViewDetails?: () => void;
  showSeparator: boolean;
}) {
  return (
    <div
      className={cn("flex items-center gap-1.5", {
        "pl-2": showSeparator,
      })}
    >
      <span className="text-primary font-medium">
        {selectedRows} {selectedRows !== 1 ? "rows" : "row"} selected
      </span>
      {onViewDetails && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onViewDetails}
              >
                <IconEye className="h-3 w-3" />
              </Button>
            }
          />
          <TooltipContent side="top" className="text-xs">
            View Details
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

interface DataGridStatusBarProps {
  loadedRows: number;
  estimatedTotal?: number;
  isEstimatedCount?: boolean; // True if count is estimated, false if exact
  hasMore?: boolean;
  selectedRows?: number;
  selectedRowsData?: GridRowModel[];
  selectedRowIndices?: Set<number>;
  allRows?: GridRowModel[];
  columns?: GridColumnV2[];
  gridSelection?: {
    rows: Set<number>;
    columns?: Set<number>;
    current?: {
      range?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };
  };
  className?: string;
  executionTime?: number;
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  isStreaming?: boolean;
  /** Whether a batch/paste operation is in progress */
  isProcessing?: boolean;
  onViewDetails?: () => void;
  readOnlyReason?: string;
  /** Callback to select custom row identifier columns for non-PK tables */
  onSelectIdentifierColumns?: () => void;
  /** State and handlers for the identifier selector popover */
  identifierSelector?: IdentifierSelectorConfig;
  /** Callback to refresh materialized view - only shown for materialized views */
  onRefreshMaterializedView?: () => void;
  /** Whether the materialized view is currently being refreshed */
  isRefreshingMatView?: boolean;
}

export const DataGridStatusBar = memo(function DataGridStatusBar({
  loadedRows,
  estimatedTotal,
  isEstimatedCount,
  hasMore,
  selectedRows = 0,
  selectedRowsData = [],
  selectedRowIndices,
  allRows = [],
  columns = [],
  gridSelection,
  executionTime,
  fetchCount,
  networkMs,
  conversionMs,
  cursorSetupMs: _cursorSetupMs,
  totalStreamingMs: _totalStreamingMs,
  isStreaming = false,
  isProcessing = false,
  onViewDetails,
  readOnlyReason,
  onSelectIdentifierColumns,
  identifierSelector,
  onRefreshMaterializedView,
  isRefreshingMatView = false,
  className,
}: DataGridStatusBarProps) {
  // Show progress bar ONLY when we have estimatedTotal (table browsing)
  const showProgressBar =
    isStreaming && estimatedTotal && estimatedTotal > loadedRows;
  const showStreamingSpinner = isStreaming && !showProgressBar;

  // Determine if we should show selection summary
  const showSelectionSummary =
    selectedRowsData.length > 0 &&
    columns.length > 0 &&
    selectedRowIndices !== undefined;

  return (
    <div
      className={cn(
        "flex items-center justify-between h-8 border-t bg-background text-xs text-muted-foreground pr-2 pt-[3px]",
        className,
      )}
    >
      {/* Left side: Processing indicator and selection info */}
      <div className="flex items-center gap-3">
        {isProcessing && <ProcessingIndicator />}

        {selectedRows > 0 && (
          <div className="flex items-center gap-3">
            <SelectionInfo
              selectedRows={selectedRows}
              onViewDetails={onViewDetails}
              showSeparator={false}
            />
            {selectedRowIndices && showSelectionSummary && (
              <SelectionSummary
                selectedRows={selectedRowsData}
                selectedRowIndices={selectedRowIndices}
                allRows={allRows}
                columns={columns}
                gridSelection={gridSelection as unknown as GridSelection}
              />
            )}
          </div>
        )}
      </div>

      {/* Right side: Read-only badge, refresh, progress, row count, timing */}
      <div className="flex items-center gap-2">
        {readOnlyReason && (
          <ReadOnlyBadge reason={readOnlyReason} />
        )}

        {onSelectIdentifierColumns && identifierSelector && (
          <IdentifierColumnsSelector
            open={identifierSelector.open}
            tableName={identifierSelector.tableName}
            availableColumns={identifierSelector.availableColumns}
            selectedColumns={identifierSelector.selectedColumns}
            onOpen={onSelectIdentifierColumns}
            onToggleColumn={identifierSelector.onToggleColumn}
            onClear={identifierSelector.onClear}
            onCancel={identifierSelector.onCancel}
            triggerClassName={cn(
              readOnlyReason
                ? "text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300"
                : "text-muted-foreground hover:text-foreground",
            )}
          />
        )}

        {readOnlyReason && onRefreshMaterializedView && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 disabled:opacity-50"
                  onClick={onRefreshMaterializedView}
                  disabled={isRefreshingMatView}
                >
                  <IconRefresh className={cn("h-3.5 w-3.5", isRefreshingMatView && "animate-spin")} />
                </Button>
              }
            />
            <TooltipContent side="top" className="text-xs">
              {isRefreshingMatView ? "Refreshing..." : "Refresh Materialized View"}
            </TooltipContent>
          </Tooltip>
        )}

        {showProgressBar && estimatedTotal && (
          <StreamingProgress
            loadedRows={loadedRows}
            estimatedTotal={estimatedTotal}
          />
        )}

        {showStreamingSpinner && <StreamingSpinner />}

        <RowCountDisplay
          loadedRows={loadedRows}
          estimatedTotal={estimatedTotal}
          isEstimatedCount={isEstimatedCount}
          hasMore={hasMore}
        />

        {executionTime !== undefined && (
          <ExecutionTimeDisplay
            executionTime={executionTime}
            networkMs={networkMs}
            conversionMs={conversionMs}
            fetchCount={fetchCount}
          />
        )}
      </div>
    </div>
  );
});
