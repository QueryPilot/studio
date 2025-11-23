import { memo } from "react";
import { IconAlertCircle, IconLoader2 } from '@tabler/icons-react';
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";

interface DataGridErrorStateProps {
  error: string;
  onRetry?: () => void;
  onReload?: () => void;
}

export const DataGridErrorState = memo(function DataGridErrorState({
  error,
  onRetry,
  onReload,
}: DataGridErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 select-text">
      <IconAlertCircle className="h-12 w-12 text-destructive mb-4" />
      <h3 className="text-lg font-semibold mb-2">Failed to load table data</h3>
      <p className="text-sm text-muted-foreground max-w-md text-center select-text mb-4">
        {error}
      </p>
      <div className="flex gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Clear IconFilter
          </Button>
        )}
        {onReload && (
          <Button variant="outline" size="sm" onClick={onReload}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
});

export const DataGridEmptyState = memo(function DataGridEmptyState({
  title = "Empty table",
  description = "No rows found in this table. Start adding data to see it displayed here.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <img
        src={logo}
        alt="Query Pilot"
        className="w-20 h-20 mb-4 opacity-40 dark:opacity-30"
      />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md text-center select-text">
        {description}
      </p>
    </div>
  );
});

interface DataGridLoadingIndicatorProps {
  tableWidth?: number;
  currentRows?: number;
  estimatedTotal?: number;
  isStreaming?: boolean;
}

export const DataGridLoadingIndicator = memo(function DataGridLoadingIndicator({
  currentRows,
  estimatedTotal,
  isStreaming = false,
}: DataGridLoadingIndicatorProps) {
  const showProgress =
    currentRows !== undefined && estimatedTotal !== undefined;
  const percentage = showProgress
    ? Math.min(Math.round((currentRows / estimatedTotal) * 100), 99)
    : undefined;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t w-full">
      <div className="flex items-center justify-center py-3 gap-3">
        <IconLoader2 className="h-4 w-4 animate-spin" />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {isStreaming ? "Streaming" : "Loading"}{" "}
            {showProgress &&
              `${currentRows.toLocaleString()} / ${estimatedTotal.toLocaleString()} rows`}
            {percentage !== undefined && ` (${percentage}%)`}
          </span>
          {showProgress && (
            <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${percentage}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface DataGridEndOfDataProps {
  rowCount: number;
  tableWidth: number;
}

export const DataGridEndOfData = memo(function DataGridEndOfData({
  rowCount,
  tableWidth,
}: DataGridEndOfDataProps) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0 text-center py-4 text-sm text-muted-foreground border-t bg-muted/20"
      style={{ width: `${tableWidth}px` }}
    >
      End of data ({rowCount.toLocaleString()} rows total)
    </div>
  );
});
