import { memo } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatExecutionTime } from "@/utils/formatTime";
import { SelectionSummary } from "./SelectionSummary";
import type { GridRowModel, GridColumnV2 } from "../types";
import { type GridSelection } from "@glideapps/glide-data-grid";

interface DataGridStatusBarProps {
  loadedRows: number;
  estimatedTotal?: number;
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
  onViewDetails?: () => void;
  readOnlyReason?: string;
}

export const DataGridStatusBar = memo(function DataGridStatusBar({
  loadedRows,
  estimatedTotal,
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
  isStreaming = false,
  onViewDetails,
  readOnlyReason,
  className,
}: DataGridStatusBarProps) {
  const getRowCountDisplay = () => {
    if (estimatedTotal && estimatedTotal > loadedRows) {
      return `${loadedRows.toLocaleString()} / ${estimatedTotal.toLocaleString()} rows`;
    }

    if (hasMore) {
      return `${loadedRows.toLocaleString()} rows (loading more...)`;
    }

    return `${loadedRows.toLocaleString()} rows`;
  };

  const getProgressPercentage = () => {
    if (!estimatedTotal || estimatedTotal === 0) return 0;
    return Math.min(Math.round((loadedRows / estimatedTotal) * 100), 99);
  };

  // Show progress bar ONLY when we have estimatedTotal (table browsing)
  // For queries, we don't pass estimatedTotal, so only spinner shows (no flashing)
  const showProgressBar =
    isStreaming && estimatedTotal && estimatedTotal > loadedRows;

  const showStreamingSpinner = isStreaming && !showProgressBar;

  return (
    <div
      className={cn(
        "flex items-center justify-between h-8 -mb-0.5 border-t bg-background text-xs text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {readOnlyReason && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded border border-amber-500/20">
            <Eye className="h-3 w-3" />
            <span className="font-medium">{readOnlyReason}</span>
          </div>
        )}

        {selectedRows > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-primary font-medium">
                {selectedRows.toLocaleString()}{" "}
                {selectedRows !== 1 ? "rows" : "row"} selected
              </span>
              {onViewDetails && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={onViewDetails}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    View Details
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {selectedRowsData.length > 0 &&
              columns.length > 0 &&
              selectedRowIndices && (
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
      <div className="flex items-center gap-2">
        {showProgressBar && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-primary">
              Streaming {getProgressPercentage()}%
            </span>
            <div className="w-24 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${getProgressPercentage()}%` }}
              />
            </div>
            <span className="text-muted-foreground">•</span>
          </>
        )}
        {showStreamingSpinner && (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span className="text-primary">Streaming...</span>
            <span className="text-muted-foreground">•</span>
          </>
        )}
        <span>{getRowCountDisplay()}</span>
        {executionTime !== undefined && (
          <>
            <span className="text-muted-foreground">•</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help">
                  {formatExecutionTime(executionTime)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="space-y-1">
                  <div className="font-semibold mb-2">
                    Performance Breakdown
                  </div>
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
        )}
      </div>
    </div>
  );
});
