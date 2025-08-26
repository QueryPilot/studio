import { memo } from "react";

interface QueryDataGridProps {
  connectionId: string;
  query: string;
  className?: string;
}

export const QueryDataGrid = memo(function QueryDataGrid({
  connectionId: _connectionId,
  query: _query,
  className,
}: QueryDataGridProps) {
  return (
    <div className={className}>
      {/* Placeholder for query data grid implementation */}
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Query data grid coming soon
      </div>
    </div>
  );
});