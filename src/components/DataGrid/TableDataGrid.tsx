import { memo, useState, useEffect, useCallback, useMemo } from "react";
import { useInfiniteTableData } from "./hooks/useInfiniteTableData";
import { useGridSelection } from "./hooks/useGridSelection";
import { useContextMenu } from "./hooks/useContextMenu";
import { gridPerformanceMonitor } from "./utils/performanceMonitor";
import { useRowPool } from "./utils/rowComponentPool";
import { FastRenderStrategy } from "./utils/fastRenderStrategy";
import { DataGridHeader } from "./components/DataGridHeader";
import { DataGridSkeleton } from "./components/DataGridSkeleton";
import { DataGridStatusBar } from "./components/DataGridStatusBar";
import type { CellValue } from "@/types/cellValue";
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
  // Core state
  const [containerWidth, setContainerWidth] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [currentOverscan, setCurrentOverscan] = useState(20);

  // Hooks
  const { copy } = useCopy();
  const { toast } = useToast();

  // Performance optimizations
  const rowPool = useRowPool(300);

  const {
    tableInstance,
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

  // Direct row access - simpler and more reliable
  const getRow = useCallback((index: number) => rows[index] || null, [rows]);
  const getStats = useCallback(
    () => ({ hitRate: 1, hits: 0, misses: 0, swaps: 0 }),
    [],
  );

  // Calculate visible range for selection optimization
  const visibleRange = useMemo(() => {
    if (!containerRef.current) return { start: 0, end: 0 };

    const containerHeight = containerRef.current.clientHeight;
    return FastRenderStrategy.getVisibleRange(scrollTop, containerHeight);
  }, [scrollTop]);

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
  } = useGridSelection({
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
    },
  });

  // High-performance scroll handling with RAF and dynamic overscan
  const [scrollDirection, setScrollDirection] = useState<
    "up" | "down" | "none"
  >("none");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    let lastScrollTop = 0;

    const handleScroll = () => {
      // Cancel any pending frame
      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const newScrollTop = container.scrollTop;
        const scrollDelta = Math.abs(newScrollTop - lastScrollTop);

        // Set scroll direction for asymmetric overscan
        if (newScrollTop > lastScrollTop) {
          setScrollDirection("down");
        } else if (newScrollTop < lastScrollTop) {
          setScrollDirection("up");
        } else {
          setScrollDirection("none");
        }

        // Optimized dynamic overscan - reduced for better FPS
        // Max 50 rows to keep DOM elements under control
        let overscan = 20; // Base overscan (reduced from 100)

        if (scrollDelta > 100) {
          overscan = 50; // Very fast scrolling (max)
        } else if (scrollDelta > 50) {
          overscan = 45; // Fast scrolling
        } else if (scrollDelta > 25) {
          overscan = 40; // Medium fast
        } else if (scrollDelta > 10) {
          overscan = 30; // Medium scrolling
        } else if (scrollDelta > 5) {
          overscan = 25; // Slow scrolling
        }

        setScrollTop(newScrollTop);
        setIsScrolled(newScrollTop > 0);
        setCurrentOverscan(overscan);

        lastScrollTop = newScrollTop;
        rafId = null;
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    // Initial call to set up the view
    handleScroll();

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Reset selection when table changes
  useEffect(() => {
    clearSelection();
    setShowPreview(false);
    setFocusedCell(null);
  }, [connectionId, database, table, schema, clearSelection, setFocusedCell]);

  // Performance monitoring in development
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      gridPerformanceMonitor.start();
      return () => {
        gridPerformanceMonitor.stop();
      };
    }
    return undefined;
  }, []);

  // Error handling
  useEffect(() => {
    if (error && error !== dismissedError) {
      const isConnectionError =
        error.toLowerCase().includes("closed pool") ||
        error.toLowerCase().includes("connection timeout") ||
        error.toLowerCase().includes("connection not found") ||
        error.toLowerCase().includes("connection error") ||
        error.toLowerCase().includes("table data read failed");

      if (isConnectionError) {
        setShowErrorDialog(true);
      } else {
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

  // Cell update handler
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

      if (column.is_pk) {
        toast({
          title: "Update Error",
          description: "Primary key columns cannot be edited",
          variant: "destructive",
        });
        return;
      }

      const primaryKeys = CellEditService.extractPrimaryKeys(row, columns);

      if (Object.keys(primaryKeys).length === 0) {
        toast({
          title: "Update Error",
          description: "Unable to update: no primary key found",
          variant: "destructive",
        });
        return;
      }

      if (!CellEditService.validateValue(newValue, column)) {
        toast({
          title: "Validation Error",
          description: `Invalid value for column ${column.name} (${column.db_type})`,
          variant: "destructive",
        });
        return;
      }

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

        row[column.name] = newValue as CellValue;
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

  // Event handlers
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

  // Copy handlers
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
  }, [selectedRowData]);

  // Error dialog handlers
  const handleErrorRetry = useCallback(() => {
    setShowErrorDialog(false);
    setDismissedError(null);
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

  // Monitor container width changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  // Calculate table dimensions
  const allColumns = tableInstance.getAllColumns();
  const minTableWidth = allColumns.reduce(
    (acc, col: any) => acc + (col.getSize?.() ?? 150),
    0,
  );
  const tableWidth = containerWidth > 0 ? containerWidth : minTableWidth;

  const getAdjustedColumnWidth = (column: any, columnIndex?: number) => {
    const columnSize = column.getSize?.() ?? 150;
    const isLastColumn = columnIndex === allColumns.length - 1;

    if (containerWidth > 0) {
      if (isLastColumn) {
        const otherColumnsWidth = allColumns
          .slice(0, -1)
          .reduce((acc, col: any) => acc + (col.getSize?.() ?? 150), 0);
        const remainingSpace = containerWidth - otherColumnsWidth;
        return Math.max(remainingSpace, columnSize);
      }
      return columnSize;
    }

    return columnSize;
  };

  // Keyboard navigation
  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Tab" && !focusedCell) {
        event.preventDefault();
        setFocusedCell({ rowIndex: 0, columnIndex: 0 });
        requestAnimationFrame(() => {
          const firstCell =
            document.querySelector<HTMLElement>('[tabindex="0"]');
          firstCell?.focus();
        });
        return;
      }

      if (focusedCell) {
        handleKeyDown(event, rows.length, columns.length);

        if (event.key === "Tab" || event.key.startsWith("Arrow")) {
          event.preventDefault();
          requestAnimationFrame(() => {
            const focusedElement =
              document.querySelector<HTMLElement>('[tabindex="0"]');
            focusedElement?.focus();
          });
        }
      }
    },
    [handleKeyDown, focusedCell, rows.length, columns.length, setFocusedCell],
  );

  // Error states
  const isConnectionError =
    error &&
    (error.toLowerCase().includes("closed pool") ||
      error.toLowerCase().includes("connection timeout") ||
      error.toLowerCase().includes("connection not found") ||
      error.toLowerCase().includes("connection error") ||
      error.toLowerCase().includes("table data read failed"));

  // Early returns for loading/error states
  if (isLoading && !columns.length && !error) {
    return <DataGridSkeleton />;
  }

  if (error && !isConnectionError && !rows.length) {
    return <DataGridErrorState error={error} />;
  }

  if (
    !isLoading &&
    !isStreaming &&
    !rows.length &&
    columns.length > 0 &&
    !error
  ) {
    return <DataGridEmptyState />;
  }

  if (!rows.length && (isLoading || isStreaming) && !error) {
    return <DataGridSkeleton />;
  }

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

  // Calculate visible rows using optimized strategy
  // Use actual scroll position from container if available, fallback to state
  const actualScrollTop = containerRef.current?.scrollTop ?? scrollTop;
  const containerHeight = containerRef.current?.clientHeight || 600;
  const rowsInViewport = FastRenderStrategy.getRowsInViewport(
    actualScrollTop,
    containerHeight,
    rows.length,
    currentOverscan,
    scrollDirection,
  );

  // Optimize visible rows calculation - limit max rendered rows
  const MAX_VISIBLE_ROWS = 500; // Increased limit for better coverage with higher overscan
  const visibleRows = [];
  const totalToRender = Math.min(
    rowsInViewport.end - rowsInViewport.start + 1,
    MAX_VISIBLE_ROWS,
  );

  // If we're limiting rows, center them around the current viewport
  let startIdx = rowsInViewport.start;
  let endIdx = rowsInViewport.end;

  if (totalToRender === MAX_VISIBLE_ROWS) {
    const center = Math.floor((rowsInViewport.start + rowsInViewport.end) / 2);
    startIdx = Math.max(0, center - Math.floor(MAX_VISIBLE_ROWS / 2));
    endIdx = Math.min(rows.length - 1, startIdx + MAX_VISIBLE_ROWS - 1);
  }

  for (let i = startIdx; i <= endIdx; i++) {
    const row = getRow(i);
    if (row) {
      visibleRows.push({
        index: i,
        data: row,
        top: FastRenderStrategy.getRowTop(i),
      });
    }
  }

  // Performance stats for development
  const bufferStats = getStats();

  return (
    <div
      className={cn("h-full flex flex-col overflow-hidden relative", className)}
      data-grid-container
      onKeyDown={handleGridKeyDown}
      tabIndex={-1}
    >
      {/* Performance indicator in development */}
      {process.env.NODE_ENV === "development" && bufferStats && (
        <div className="absolute top-2 right-2 z-50 text-xs bg-black text-white p-2 rounded opacity-75">
          Buffer Hit Rate: {Math.round(bufferStats.hitRate * 100)}% | Overscan:{" "}
          {currentOverscan}
        </div>
      )}

      {/* Single Scroll Container with optimized rendering */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 w-full overflow-auto",
          showPreview && "pb-[200px]",
        )}
        style={{
          // Enable GPU acceleration
          transform: "translateZ(0)",
          willChange: "scroll-position",
        }}
      >
        <div
          style={{
            height: FastRenderStrategy.getTotalHeight(rows.length),
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

          {/* Optimized Virtualized Rows */}
          {visibleRows.map((virtualRow) => (
            <DataGridRow
              key={`row-${virtualRow.index}`}
              index={virtualRow.index}
              data={virtualRow.data}
              top={virtualRow.top}
              tableWidth={tableWidth}
              columns={columns}
              getAdjustedColumnWidth={getAdjustedColumnWidth}
              isRowSelected={isRowSelected(virtualRow.index)}
              isCellSelected={isCellSelected}
              isCellFocused={isCellFocused}
              handlers={handlers}
              selectionRange={selectionRange}
              focusedCell={focusedCell}
              pool={rowPool}
            />
          ))}

          {/* Loading indicator */}
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

      {/* Preview Panel */}
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

      {/* Context Menu */}
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

// Optimized Row Component with pooling
interface OptimizedDataGridRowProps {
  index: number;
  data: TableDataRow;
  top: number;
  tableWidth: number;
  columns: any[];
  getAdjustedColumnWidth: (column: any, index?: number) => number;
  isRowSelected: boolean;
  isCellSelected: (rowIndex: number, columnIndex: number) => boolean;
  isCellFocused: (rowIndex: number, columnIndex: number) => boolean;
  handlers: any;
  selectionRange?: any;
  focusedCell?: any;
  pool?: any;
}

const DataGridRow = memo(function DataGridRow({
  index,
  data,
  top,
  tableWidth,
  columns,
  getAdjustedColumnWidth,
  isRowSelected,
  isCellSelected,
  isCellFocused,
  handlers,
}: OptimizedDataGridRowProps) {
  const rowClassName = useMemo(() => {
    return cn(
      "absolute w-full border-b transition-colors",
      index % 2 === 0 && "bg-muted/10",
      isRowSelected && "bg-primary/10",
      !isRowSelected && "hover:bg-primary/5",
    );
  }, [index, isRowSelected]);

  const rowStyle = useMemo(
    () => ({
      top,
      height: FastRenderStrategy.ROW_HEIGHT,
      width: tableWidth,
    }),
    [top, tableWidth],
  );

  return (
    <div data-index={index} className={rowClassName} style={rowStyle}>
      <table className="table-fixed w-full h-full" style={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
        <tbody>
          <tr style={{ height: `${FastRenderStrategy.ROW_HEIGHT}px` }}>
            {columns.map((column, columnIndex) => (
              <OptimizedCell
                key={`${index}-${columnIndex}`}
                rowIndex={index}
                columnIndex={columnIndex}
                value={data[column.name]}
                width={getAdjustedColumnWidth(column, columnIndex)}
                isSelected={isCellSelected(index, columnIndex)}
                isFocused={isCellFocused(index, columnIndex)}
                handlers={handlers}
              />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
});

// Optimized Cell Component
interface CellProps {
  rowIndex: number;
  columnIndex: number;
  value: any;
  width: number;
  isSelected: boolean;
  isFocused: boolean;
  handlers: any;
}

const OptimizedCell = memo(
  function OptimizedCell({
    rowIndex,
    columnIndex,
    value,
    width,
    isSelected,
    isFocused,
    handlers,
  }: CellProps) {
    const cellClassName = useMemo(
      () =>
        cn(
          "px-1.5 py-0.5 text-xs text-foreground/80 dark:text-foreground/70 border-r last:border-r-0",
          "cursor-pointer select-none relative overflow-hidden",
          isSelected && "bg-primary/20",
          isFocused && "ring-1 ring-primary ring-inset z-10",
          "focus:outline-none focus:ring-2 focus:ring-primary",
        ),
      [isSelected, isFocused],
    );

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        handlers.onClick?.(rowIndex, columnIndex, e);
      },
      [handlers, rowIndex, columnIndex],
    );

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        handlers.onMouseDown?.(rowIndex, columnIndex, e);
      },
      [handlers, rowIndex, columnIndex],
    );

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        handlers.onContextMenu?.(rowIndex, columnIndex, e, value);
      },
      [handlers, rowIndex, columnIndex, value],
    );

    return (
      <td
        className={cellClassName}
        style={{
          width,
          minWidth: width,
          maxWidth: width,
        }}
        tabIndex={isFocused ? 0 : -1}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
      >
        <div className="truncate">
          {(() => {
            const displayValue = value?.value ?? value;
            if (displayValue == null) return "-";
            if (typeof displayValue === "object") {
              return JSON.stringify(displayValue);
            }
            return String(displayValue);
          })()}
        </div>
      </td>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.value === nextProps.value &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isFocused === nextProps.isFocused &&
      prevProps.width === nextProps.width
    );
  },
);
