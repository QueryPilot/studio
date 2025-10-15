import { memo } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface DataGridStatusBarProps {
  loadedRows: number;
  estimatedTotal?: number;
  hasMore?: boolean;
  selectedRows?: number;
  className?: string;
  pendingEdits?: number;
  executionTime?: number;
  isStreaming?: boolean;
}

export const DataGridStatusBar = memo(function DataGridStatusBar({
  loadedRows,
  estimatedTotal,
  hasMore,
  selectedRows = 0,
  pendingEdits = 0,
  executionTime,
  isStreaming = false,
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

  const showProgress =
    isStreaming && estimatedTotal && estimatedTotal > loadedRows;

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-1.5 border-t bg-background text-xs text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        {pendingEdits > 0 && (
          <span className="text-amber-600">
            {pendingEdits} pending {pendingEdits === 1 ? "change" : "changes"}
          </span>
        )}
        {selectedRows > 0 && (
          <span className="text-primary">
            {selectedRows} row{selectedRows !== 1 ? "s" : ""} selected
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {showProgress && (
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
        <span>{getRowCountDisplay()}</span>
        {executionTime !== undefined && (
          <>
            <span className="text-muted-foreground">•</span>
            <span className="text-muted-foreground">{executionTime}ms</span>
          </>
        )}
      </div>
    </div>
  );
});
