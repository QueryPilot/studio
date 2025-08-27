import { memo, useState, useEffect } from "react";
import { useInfiniteTableData } from "./hooks/useInfiniteTableData";
import { DataGridHeader } from "./components/DataGridHeader";
import { DataGridRow } from "./components/DataGridRow";
import { DataGridSkeleton } from "./components/DataGridSkeleton";
import { DataGridStatusBar } from "./components/DataGridStatusBar";
import {
  DataGridErrorState,
  DataGridEmptyState,
  DataGridLoadingIndicator,
} from "./components/DataGridStates";
import { cn } from "@/lib/utils";

interface TableDataGridProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  className?: string;
}

export const TableDataGrid = memo(function TableDataGrid({
  connectionId,
  database,
  table,
  schema,
  className,
}: TableDataGridProps) {
  const {
    tableInstance,
    rowVirtualizer,
    containerRef,
    isLoading,
    isStreaming,
    error,
    hasNextPage,
    columns,
    rows,
    estimatedTotal,
  } = useInfiniteTableData({
    connectionId,
    database,
    table,
    schema,
  });

  const [containerWidth, setContainerWidth] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const tableRows = tableInstance.getRowModel().rows;

  // Monitor container width changes and scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
    };

    const handleScroll = () => {
      setIsScrolled(container.scrollTop > 0);
    };

    updateWidth();
    
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);
    
    container.addEventListener('scroll', handleScroll);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef]);

  // Show skeleton loader while initial data loads
  if (isLoading && !columns.length) {
    return <DataGridSkeleton />;
  }

  // Show error state
  if (error) {
    return <DataGridErrorState error={error} />;
  }

  // Show empty state only after loading is complete
  if (!isLoading && !isStreaming && !rows.length && columns.length > 0) {
    return <DataGridEmptyState />;
  }
  
  // Show skeleton if we don't have data yet but are still loading
  if (!rows.length && (isLoading || isStreaming)) {
    return <DataGridSkeleton />;
  }

  // Calculate total table width to ensure proper alignment
  const allColumns = tableInstance.getAllColumns();
  const minTableWidth = allColumns.reduce((acc, col) => acc + col.getSize(), 0);

  // Always use container width when available
  const tableWidth = containerWidth || minTableWidth;

  // Helper function to get adjusted column width
  const getAdjustedColumnWidth = (column: { getSize: () => number }, columnIndex?: number) => {
    const isLastColumn = columnIndex === allColumns.length - 1;
    
    if (containerWidth > 0) {
      if (isLastColumn) {
        // Last column takes all remaining space
        const otherColumnsWidth = allColumns.slice(0, -1).reduce((acc, col) => acc + col.getSize(), 0);
        const remainingSpace = containerWidth - otherColumnsWidth;
        // Ensure the last column has at least its minimum width
        return Math.max(remainingSpace, column.getSize());
      }
      // Other columns keep their original size
      return column.getSize();
    }
    
    return column.getSize();
  };

  return (
    <div className={cn("h-full flex flex-col overflow-hidden", className)}>
      {/* Single Scroll Container */}
      <div ref={containerRef} className="flex-1 w-full overflow-auto">
        <div
          style={{
            height: `${totalSize + 32}px`, // +32px for header height
            width: '100%',
            minWidth: `${tableWidth}px`,
            position: "relative",
          }}
        >
          {/* Sticky Header */}
          <DataGridHeader
            tableInstance={tableInstance}
            tableWidth={tableWidth}
            getAdjustedColumnWidth={getAdjustedColumnWidth}
            isScrolled={isScrolled}
          />

          {/* Virtualized Rows */}
          {virtualItems.map((virtualItem, index) => (
            <DataGridRow
              key={virtualItem.key}
              virtualItem={virtualItem}
              row={tableRows[virtualItem.index]}
              tableWidth={tableWidth}
              columns={columns}
              getAdjustedColumnWidth={getAdjustedColumnWidth}
              isLastRow={index === virtualItems.length - 1 && virtualItem.index === tableRows.length - 1}
            />
          ))}

          {/* Loading indicator for more data */}
          {isStreaming && <DataGridLoadingIndicator tableWidth={tableWidth} />}
        </div>
      </div>
      
      {/* Status Bar */}
      <DataGridStatusBar 
        loadedRows={rows.length}
        estimatedTotal={estimatedTotal || undefined}
        hasMore={hasNextPage || isStreaming}
      />
    </div>
  );
});