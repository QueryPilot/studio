import { memo } from 'react';
import { cn } from '@/lib/utils';

interface DataGridStatusBarProps {
  loadedRows: number;
  estimatedTotal?: number;
  hasMore?: boolean;
  selectedRows?: number;
  className?: string;
}

export const DataGridStatusBar = memo(function DataGridStatusBar({
  loadedRows,
  estimatedTotal,
  hasMore,
  selectedRows = 0,
  className
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
    <div className={cn(
      "flex items-center justify-between px-3 py-1.5 border-t bg-muted/30 text-xs text-muted-foreground",
      className
    )}>
      <div className="flex items-center gap-4">
        {selectedRows > 0 && (
          <span className="text-primary">
            {selectedRows} row{selectedRows !== 1 ? 's' : ''} selected
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span>{getRowCountDisplay()}</span>
      </div>
    </div>
  );
});