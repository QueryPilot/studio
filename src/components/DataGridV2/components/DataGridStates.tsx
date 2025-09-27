import { memo } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";

interface DataGridErrorStateProps {
  error: string;
}

export const DataGridErrorState = memo(function DataGridErrorState({
  error,
}: DataGridErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 select-text">
      <AlertCircle className="h-12 w-12 text-destructive mb-4" />
      <h3 className="text-lg font-semibold mb-2">Failed to load table data</h3>
      <p className="text-sm text-muted-foreground max-w-md text-center select-text">
        {error}
      </p>
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
        alt="DevDB Studio"
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
}

export const DataGridLoadingIndicator = memo(function DataGridLoadingIndicator(
  _: DataGridLoadingIndicatorProps,
) {
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t w-full">
      <div className="flex items-center justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-xs text-muted-foreground">
          Loading more rows...
        </span>
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