/**
 * Skeleton loading component for DataTable showing 10 placeholder rows
 */
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { type ColumnDefinition, VIRTUALIZATION_CONFIG } from '../types';

interface TableSkeletonProps {
  columns: ColumnDefinition[];
  rowCount?: number;
  className?: string;
}

const TableSkeleton = memo(function TableSkeleton({
  columns,
  rowCount = 10,
  className,
}: TableSkeletonProps) {
  // Create skeleton rows
  const skeletonRows = Array.from({ length: rowCount }, (_, index) => index);

  return (
    <div className={cn("w-full overflow-hidden", className)}>
      {/* Header skeleton */}
      <div
        className="flex border-b bg-muted/20 sticky top-0 z-10"
        style={{ height: VIRTUALIZATION_CONFIG.HEADER_HEIGHT }}
      >
        {columns.map((column) => (
          <div
            key={`header-skeleton-${column.id}`}
            className="flex items-center px-2 border-r last:border-r-0"
            style={{
              width: column.width || VIRTUALIZATION_CONFIG.DEFAULT_COLUMN_WIDTH,
              minWidth: column.minWidth || VIRTUALIZATION_CONFIG.MIN_COLUMN_WIDTH,
            }}
          >
            <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
          </div>
        ))}
      </div>

      {/* Skeleton rows */}
      <div className="relative">
        {skeletonRows.map((rowIndex) => (
          <div
            key={`skeleton-row-${rowIndex}`}
            className={cn(
              "flex border-b last:border-b-0",
              rowIndex % 2 === 0 ? "bg-background" : "bg-muted/20"
            )}
            style={{ height: VIRTUALIZATION_CONFIG.ROW_HEIGHT }}
          >
            {columns.map((column) => (
              <div
                key={`skeleton-cell-${rowIndex}-${column.id}`}
                className="flex items-center px-2 border-r last:border-r-0"
                style={{
                  width: column.width || VIRTUALIZATION_CONFIG.DEFAULT_COLUMN_WIDTH,
                  minWidth: column.minWidth || VIRTUALIZATION_CONFIG.MIN_COLUMN_WIDTH,
                }}
              >
                <div
                  className="h-3 bg-muted rounded animate-pulse"
                  style={{
                    width: `${Math.random() * 60 + 20}%`, // Random width between 20-80%
                    animationDelay: `${Math.random() * 0.5}s`, // Stagger animations
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

export { TableSkeleton };