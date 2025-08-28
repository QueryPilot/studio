import { memo, useState, useEffect, useCallback, useMemo } from "react";
import { useInfiniteTableData } from "./hooks/useInfiniteTableData";
import { useOptimizedGridSelection } from "./hooks/useOptimizedGridSelection";
import { useContextMenu } from "./hooks/useContextMenu";
import { gridPerformanceMonitor } from "./utils/performanceMonitor";
import { DataGridHeader } from "./components/DataGridHeader";
import { OptimizedDataGridRow } from "./components/OptimizedDataGridRow";
import { DataGridSkeleton } from "./components/DataGridSkeleton";
import { DataGridStatusBar } from "./components/DataGridStatusBar";
import {
  DataGridContextMenu,
  createDataGridMenuItems,
} from "./components/DataGridContextMenu";
import { AsyncGridDataPreview } from "./components/AsyncGridDataPreview";
import {
  DataGridErrorState,
  DataGridEmptyState,
  DataGridLoadingIndicator,
} from "./components/DataGridStates";
import { ConnectionErrorDialog } from "./components/ConnectionErrorDialog";
import {
  formatRowsAsJson,
  formatRowsAsCsv,
  formatRowsAsMarkdown,
  formatRowsAsSql,
  copyCellValue,
  copyRows,
} from "./utils/dataFormatters";
import { useCopy } from "@/hooks/useCopy";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { TableDataRow } from "@/services/tableDataTypes";
import { CellEditService } from "@/services/cellEditService";

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
  // All hooks must be called unconditionally at the top
  const [containerWidth, setContainerWidth] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const { copy } = useCopy();
  const { toast } = useToast();

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
    loadData,
  } = useInfiniteTableData({
    connectionId,
    database,
    table,
    schema,
  });

  // Calculate visible range for selection optimization
  const virtualItems = rowVirtualizer.getVirtualItems();
  const visibleRange = useMemo(() => {
    return {
      start: virtualItems[0]?.index ?? 0,
      end: virtualItems[virtualItems.length - 1]?.index ?? 0,
    };
  }, [virtualItems]);

  const {
    selectedRows,
    selectedRowCount,
    focusedCell,
    selectionRange,
    handleCellClick,
    handleCellMouseDown,
    handleCellMouseEnter,
    handleKeyDown,
    clearSelection,
    isCellSelected,
    isRowSelected,
    isCellFocused,
    setFocusedCell,
  } = useOptimizedGridSelection({
    totalRows: rows.length,
    totalColumns: columns.length,
    visibleRange,
  });

  const { menuPosition, closeMenu, handleContextMenu } = useContextMenu({
    onShowPreview: () => {
      setShowPreview(true);
    },
    onDelete: (rowIndices) => {
      console.log("Delete rows:", rowIndices);
      // TODO: Implement delete functionality
    },
  });

  // Reset selection when table changes (tab switch)
  useEffect(() => {
    clearSelection();
    setShowPreview(false);
    setFocusedCell(null);
  }, [connectionId, database, table, schema, clearSelection, setFocusedCell]);

  // Enable performance monitoring in development
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      gridPerformanceMonitor.start();
      return () => {
        gridPerformanceMonitor.stop();
      };
    }
    return undefined;
  }, []);

  // Show error dialog when error occurs
  useEffect(() => {
    console.log("[TableDataGrid] Error state changed:", {
      error,
      dismissedError,
    });

    if (error && error !== dismissedError) {
      console.log("[TableDataGrid] Processing error:", error);

      const isConnectionError =
        error.toLowerCase().includes("closed pool") ||
        error.toLowerCase().includes("connection timeout") ||
        error.toLowerCase().includes("connection not found") ||
        error.toLowerCase().includes("connection error") ||
        error.toLowerCase().includes("table data read failed"); // Add this to catch the specific error

      console.log("[TableDataGrid] Is connection error?", isConnectionError);

      if (isConnectionError) {
        // Show dialog for connection errors
        console.log("[TableDataGrid] Showing error dialog");
        setShowErrorDialog(true);
      } else {
        // Show toast for other errors
        console.log("[TableDataGrid] Showing toast for error");
        toast({
          title: "Database Error",
          description: error,
          variant: "destructive",
        });
        setDismissedError(error);
      }
    }
  }, [error, dismissedError, toast]);

  // Get selected row data
  const selectedRowData = useMemo(() => {
    return Array.from(selectedRows)
      .map((index) => rows[index])
      .filter((row): row is TableDataRow => row !== undefined);
  }, [selectedRows, rows]);

  // Handle cell update
  const handleCellUpdate = useCallback(
    async (rowIndex: number, columnIndex: number, newValue: unknown) => {
      const row = rows[rowIndex];
      const column = columns[columnIndex];

      if (!row || !column) {
        toast({
          title: "Update Error",
          description: "Unable to update cell: invalid row or column",
          variant: "destructive",
        });
        return;
      }

      // Don't allow editing primary keys
      if (column.is_pk) {
        toast({
          title: "Update Error",
          description: "Primary key columns cannot be edited",
          variant: "destructive",
        });
        return;
      }

      // Extract primary keys from the row
      const primaryKeys = CellEditService.extractPrimaryKeys(row, columns);

      if (Object.keys(primaryKeys).length === 0) {
        toast({
          title: "Update Error",
          description: "Unable to update: no primary key found",
          variant: "destructive",
        });
        return;
      }

      // Validate the value
      if (!CellEditService.validateValue(newValue, column)) {
        toast({
          title: "Validation Error",
          description: `Invalid value for column ${column.name} (${column.db_type})`,
          variant: "destructive",
        });
        return;
      }

      // Perform the update
      const result = await CellEditService.updateCell({
        connectionId,
        database,
        table,
        schema,
        column: column.name,
        primaryKeys,
        newValue,
      });

      if (result.success) {
        toast({
          title: "Cell Updated",
          description: result.message,
        });

        // Update the local row data
        // This would trigger a re-fetch in a real implementation

        row[column.name] = newValue;
      } else {
        toast({
          title: "Update Failed",
          description: result.error || "Failed to update cell",
          variant: "destructive",
        });
      }
    },
    [rows, columns, connectionId, database, table, schema, toast],
  );

  // Stable event handlers for optimization
  const handlers = useMemo(
    () => ({
      onClick: handleCellClick,
      onMouseDown: handleCellMouseDown,
      onMouseEnter: handleCellMouseEnter,
      onContextMenu: (
        rowIndex: number,
        columnIndex: number,
        event: React.MouseEvent,
        cellValue: unknown,
      ) => {
        handleContextMenu(event, rowIndex, columnIndex, cellValue);
      },
      onCellUpdate: handleCellUpdate,
    }),
    [
      handleCellClick,
      handleCellMouseDown,
      handleCellMouseEnter,
      handleContextMenu,
      handleCellUpdate,
    ],
  );

  const handleShowPreview = useCallback(() => {
    setShowPreview(true);
  }, []);

  const handleCopyCellValue = useCallback(() => {
    if (focusedCell && rows[focusedCell.rowIndex]) {
      const row = rows[focusedCell.rowIndex];
      const column = columns[focusedCell.columnIndex];
      if (column && row) {
        const value = row[column.name];
        void copy(copyCellValue(value?.value || value));
      }
    }
  }, [focusedCell, rows, columns, copy]);

  const handleCopyRows = useCallback(() => {
    if (selectedRowData.length > 0) {
      void copy(copyRows(selectedRowData, columns));
    }
  }, [selectedRowData, columns, copy]);

  const handleCopyAsJson = useCallback(() => {
    if (selectedRowData.length > 0) {
      void copy(formatRowsAsJson(selectedRowData));
    }
  }, [selectedRowData, copy]);

  const handleCopyAsCsv = useCallback(() => {
    if (selectedRowData.length > 0) {
      void copy(formatRowsAsCsv(selectedRowData, columns));
    }
  }, [selectedRowData, columns, copy]);

  const handleCopyAsMarkdown = useCallback(() => {
    if (selectedRowData.length > 0) {
      void copy(formatRowsAsMarkdown(selectedRowData, columns));
    }
  }, [selectedRowData, columns, copy]);

  const handleCopyAsSql = useCallback(() => {
    if (selectedRowData.length > 0) {
      void copy(formatRowsAsSql(selectedRowData, columns, table));
    }
  }, [selectedRowData, columns, table, copy]);

  const handleDelete = useCallback(() => {
    console.log("Delete selected rows:", selectedRowData);
    // TODO: Implement delete with confirmation
  }, [selectedRowData]);

  const handleErrorRetry = useCallback(() => {
    setShowErrorDialog(false);
    setDismissedError(null);
    // Reload the data
    if (connectionId && table) {
      void loadData({
        connectionId,
        database,
        table,
        schema,
        limit: 100,
      });
    }
  }, [connectionId, database, table, schema, loadData]);

  const handleErrorDismiss = useCallback(() => {
    setShowErrorDialog(false);
    if (error) {
      setDismissedError(error);
    }
  }, [error]);

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

    container.addEventListener("scroll", handleScroll);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", handleScroll);
    };
  }, [containerRef]);

  // Calculate total table width to ensure proper alignment
  const allColumns = tableInstance.getAllColumns();
  const minTableWidth = allColumns.reduce((acc, col) => acc + col.getSize(), 0);

  // Always use container width when available
  const tableWidth = containerWidth > 0 ? containerWidth : minTableWidth;

  // Helper function to get adjusted column width
  const getAdjustedColumnWidth = (
    column: { getSize: () => number },
    columnIndex?: number,
  ) => {
    const isLastColumn = columnIndex === allColumns.length - 1;

    if (containerWidth > 0) {
      if (isLastColumn) {
        // Last column takes all remaining space
        const otherColumnsWidth = allColumns
          .slice(0, -1)
          .reduce((acc, col) => acc + col.getSize(), 0);
        const remainingSpace = containerWidth - otherColumnsWidth;
        // Ensure the last column has at least its minimum width
        return Math.max(remainingSpace, column.getSize());
      }
      // Other columns keep their original size
      return column.getSize();
    }

    return column.getSize();
  };

  // Handle keyboard navigation at the grid level
  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // If Tab is pressed and no cell is focused, focus the first cell
      if (event.key === "Tab" && !focusedCell) {
        event.preventDefault();
        setFocusedCell({ rowIndex: 0, columnIndex: 0 });
        requestAnimationFrame(() => {
          const firstCell = document.querySelector(
            '[tabindex="0"]',
          ) as HTMLElement;
          firstCell?.focus();
        });
        return;
      }

      // Handle navigation if we have a focused cell
      if (focusedCell) {
        handleKeyDown(event, rows.length, columns.length);

        // Focus the cell element after navigation
        if (event.key === "Tab" || event.key.startsWith("Arrow")) {
          event.preventDefault();
          requestAnimationFrame(() => {
            const focusedElement = document.querySelector(
              '[tabindex="0"]',
            ) as HTMLElement;
            focusedElement?.focus();
          });
        }
      }
    },
    [handleKeyDown, focusedCell, rows.length, columns.length, setFocusedCell],
  );

  // Determine if this is a connection error that shouldn't block the UI
  const isConnectionError =
    error &&
    (error.toLowerCase().includes("closed pool") ||
      error.toLowerCase().includes("connection timeout") ||
      error.toLowerCase().includes("connection not found") ||
      error.toLowerCase().includes("connection error") ||
      error.toLowerCase().includes("table data read failed"));

  // console.log("[TableDataGrid] Render check:", {
  //   error,
  //   isConnectionError,
  //   isLoading,
  //   hasRows: rows.length > 0,
  //   hasColumns: columns.length > 0,
  //   showErrorDialog,
  // });

  // Early return conditions moved AFTER all hooks
  // Show skeleton loader while initial data loads
  if (isLoading && !columns.length && !error) {
    return <DataGridSkeleton />;
  }

  // For non-connection errors without data, show error state
  if (error && !isConnectionError && !rows.length) {
    return <DataGridErrorState error={error} />;
  }

  // Show empty state only after loading is complete
  if (
    !isLoading &&
    !isStreaming &&
    !rows.length &&
    columns.length > 0 &&
    !error
  ) {
    return <DataGridEmptyState />;
  }

  // Show skeleton if we don't have data yet but are still loading
  if (!rows.length && (isLoading || isStreaming) && !error) {
    return <DataGridSkeleton />;
  }

  // If we have no data and there's an error, show a graceful empty state
  if (!rows.length && error) {
    return (
      <>
        <DataGridEmptyState />
        <ConnectionErrorDialog
          isOpen={showErrorDialog}
          error={error}
          onRetry={handleErrorRetry}
          onDismiss={handleErrorDismiss}
        />
      </>
    );
  }

  return (
    <div
      className={cn("h-full flex flex-col overflow-hidden relative", className)}
      data-grid-container
      onKeyDown={handleGridKeyDown}
      tabIndex={-1}
    >
      {/* Single Scroll Container */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 w-full overflow-auto",
          showPreview && "pb-[200px]", // Add padding when preview is open
        )}
      >
        <div
          style={{
            height: `${totalSize + 32}px`, // +32px for header height
            width: "100%",
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

          {/* Virtualized Rows with Optimization */}
          {virtualItems.map((virtualItem, index) => (
            <OptimizedDataGridRow
              key={virtualItem.key}
              virtualItem={virtualItem}
              row={tableRows[virtualItem.index]}
              tableWidth={tableWidth}
              columns={columns}
              getAdjustedColumnWidth={getAdjustedColumnWidth}
              isLastRow={
                index === virtualItems.length - 1 &&
                virtualItem.index === tableRows.length - 1
              }
              isRowSelected={isRowSelected(virtualItem.index)}
              isCellSelected={isCellSelected}
              isCellFocused={isCellFocused}
              handlers={handlers}
              selectionRange={selectionRange}
              focusedCell={focusedCell}
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

      {/* Preview Panel with Async Rendering */}
      {showPreview && (
        <AsyncGridDataPreview
          isOpen={showPreview}
          onClose={() => {
            setShowPreview(false);
          }}
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

      {/* Connection Error Dialog */}
      <ConnectionErrorDialog
        isOpen={showErrorDialog}
        error={error || ""}
        onRetry={handleErrorRetry}
        onDismiss={handleErrorDismiss}
      />
    </div>
  );
});
