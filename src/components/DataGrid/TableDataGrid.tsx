import { memo, useState, useEffect, useCallback, useMemo } from "react";
import { useInfiniteTableData } from "./hooks/useInfiniteTableData";
import { useGridSelection } from "./hooks/useGridSelection";
import { useContextMenu } from "./hooks/useContextMenu";
import { DataGridHeader } from "./components/DataGridHeader";
import { DataGridRow } from "./components/DataGridRow";
import { DataGridSkeleton } from "./components/DataGridSkeleton";
import { DataGridStatusBar } from "./components/DataGridStatusBar";
import { DataGridContextMenu, createDataGridMenuItems } from "./components/DataGridContextMenu";
import { GridDataPreview } from "./components/GridDataPreview";
import {
  DataGridErrorState,
  DataGridEmptyState,
  DataGridLoadingIndicator,
} from "./components/DataGridStates";
import {
  formatRowsAsJson,
  formatRowsAsCsv,
  formatRowsAsMarkdown,
  formatRowsAsSql,
  copyCellValue,
  copyRows,
} from "./utils/dataFormatters";
import { useCopy } from "@/hooks/useCopy";
import { cn } from "@/lib/utils";
import type { TableDataRow } from '@/services/tableDataTypes';

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
  const [showPreview, setShowPreview] = useState(false);
  const { copy } = useCopy();

  const {
    selectedRows,
    selectedRowCount,
    focusedCell,
    handleCellClick,
    handleCellMouseDown,
    handleCellMouseEnter,
    isCellSelected,
    isRowSelected,
    isCellFocused,
  } = useGridSelection({
    totalRows: rows.length,
    totalColumns: columns.length,
  });

  const { menuPosition, closeMenu, handleContextMenu } = useContextMenu({
    onShowPreview: () => setShowPreview(true),
    onDelete: async (rowIndices) => {
      console.log('Delete rows:', rowIndices);
      // TODO: Implement delete functionality
    },
  });

  // Get selected row data
  const selectedRowData = useMemo(() => {
    return Array.from(selectedRows)
      .map(index => rows[index])
      .filter((row): row is TableDataRow => row !== undefined);
  }, [selectedRows, rows]);

  // Context menu handlers
  const handleCellContextMenu = useCallback((rowIndex: number, columnIndex: number, event: React.MouseEvent, cellValue: any) => {
    handleContextMenu(event, rowIndex, columnIndex, cellValue);
  }, [handleContextMenu]);

  const handleShowPreview = useCallback(() => {
    setShowPreview(true);
  }, []);

  const handleCopyCellValue = useCallback(() => {
    if (focusedCell && rows[focusedCell.rowIndex]) {
      const row = rows[focusedCell.rowIndex];
      const column = columns[focusedCell.columnIndex];
      if (column && row) {
        const value = row[column.name];
        copy(copyCellValue(value?.value || value));
      }
    }
  }, [focusedCell, rows, columns, copy]);

  const handleCopyRows = useCallback(() => {
    if (selectedRowData.length > 0) {
      copy(copyRows(selectedRowData, columns));
    }
  }, [selectedRowData, columns, copy]);

  const handleCopyAsJson = useCallback(() => {
    if (selectedRowData.length > 0) {
      copy(formatRowsAsJson(selectedRowData));
    }
  }, [selectedRowData, copy]);

  const handleCopyAsCsv = useCallback(() => {
    if (selectedRowData.length > 0) {
      copy(formatRowsAsCsv(selectedRowData, columns));
    }
  }, [selectedRowData, columns, copy]);

  const handleCopyAsMarkdown = useCallback(() => {
    if (selectedRowData.length > 0) {
      copy(formatRowsAsMarkdown(selectedRowData, columns));
    }
  }, [selectedRowData, columns, copy]);

  const handleCopyAsSql = useCallback(() => {
    if (selectedRowData.length > 0) {
      copy(formatRowsAsSql(selectedRowData, columns, table));
    }
  }, [selectedRowData, columns, table, copy]);

  const handleDelete = useCallback(() => {
    console.log('Delete selected rows:', selectedRowData);
    // TODO: Implement delete with confirmation
  }, [selectedRowData]);

  const menuItems = useMemo(() => {
    return createDataGridMenuItems({
      onShowPreview: handleShowPreview,
      onCopyCellValue: handleCopyCellValue,
      onCopyRows: handleCopyRows,
      onCopyAsJson: handleCopyAsJson,
      onCopyAsCsv: handleCopyAsCsv,
      onCopyAsMarkdown: handleCopyAsMarkdown,
      onCopyAsSql: handleCopyAsSql,
      onDelete: handleDelete,
      hasSelection: selectedRowCount > 0,
      hasCellFocus: !!focusedCell,
    });
  }, [
    handleShowPreview,
    handleCopyCellValue,
    handleCopyRows,
    handleCopyAsJson,
    handleCopyAsCsv,
    handleCopyAsMarkdown,
    handleCopyAsSql,
    handleDelete,
    selectedRowCount,
    focusedCell,
  ]);

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
    <div className={cn("h-full flex flex-col overflow-hidden relative", className)} data-grid-container>
      {/* Single Scroll Container */}
      <div ref={containerRef} className={cn(
        "flex-1 w-full overflow-auto",
        showPreview && "pb-[200px]" // Add padding when preview is open
      )}>
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
              isRowSelected={isRowSelected(virtualItem.index)}
              isCellSelected={isCellSelected}
              isCellFocused={isCellFocused}
              onCellClick={handleCellClick}
              onCellMouseDown={handleCellMouseDown}
              onCellMouseEnter={handleCellMouseEnter}
              onCellContextMenu={handleCellContextMenu}
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
        selectedRows={selectedRowCount}
      />
      
      
      {/* Preview Panel - Inside grid container */}
      {showPreview && (
        <GridDataPreview
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          selectedRows={selectedRowData}
          columns={columns}
        />
      )}
      
      {/* Context Menu - Outside grid container */}
      <DataGridContextMenu
        position={menuPosition}
        items={menuItems}
        onClose={closeMenu}
      />
    </div>
  );
});