import { memo } from "react";
import { cn } from "@/lib/utils";

interface DataGridStatusBarProps {
  loadedRows: number;
  estimatedTotal?: number;
  hasMore?: boolean;
  selectedRows?: number;
  className?: string;
  pendingEdits?: number;
}

export const DataGridStatusBar = memo(function DataGridStatusBar({
  loadedRows,
  estimatedTotal,
  hasMore,
  selectedRows = 0,
  pendingEdits = 0,
  className,
}: DataGridStatusBarProps) {
  const getRowCountDisplay = () => {
    if (estimatedTotal && estimatedTotal > loadedRows) {
      return `${loadedRows.toLocaleString()} rows (~${estimatedTotal.toLocaleString()} total)`;
    }

    if (hasMore) {
      return `${loadedRows.toLocaleString()} rows (loading more...)`;
    }

    return `${loadedRows.toLocaleString()} rows`;
  };

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
      <div className="flex items-center gap-4">
        <span>{getRowCountDisplay()}</span>
      </div>
    </div>
  );
});
