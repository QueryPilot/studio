import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useInfiniteTableData } from "./hooks/useInfiniteTableData";
import { useGridSelection } from "./hooks/useGridSelection";
import { useContextMenu } from "./hooks/useContextMenu";
import { FastRenderStrategy } from "./utils/fastRenderStrategy";
import { ScrollVelocityTracker } from "./utils/scrollVelocityTracker";
import { useTripleBuffer } from "./utils/tripleBufferManager";
import { OptimizedDataGridHeader } from "./components/OptimizedDataGridHeader";
import { DataGridSkeleton } from "./components/DataGridSkeleton";
import { DataGridStatusBar } from "./components/DataGridStatusBar";
import { CellValueRenderer } from "./cells/CellValueRenderer";
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
// import { CellEditService } from "@/services/cellEditService"; // TODO: Add inline editing later

interface OptimizedVirtualDataGridProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  className?: string;
}

// Memoized Cell Component with proper comparison
const VirtualCell = memo(
  function VirtualCell({
    value,
    columnName,
    columnIndex,
    rowIndex,
    isSelected,
    isFocused,
    onCellClick,
    onCellDoubleClick,
    onContextMenu,
  }: {
    value: CellValue | undefined;
    columnName: string;
    columnIndex: number;
    rowIndex: number;
    isSelected: boolean;
    isFocused: boolean;
    onCellClick: (rowIndex: number, columnIndex: number) => void;
    onCellDoubleClick: (rowIndex: number, columnIndex: number) => void;
    onContextMenu: (
      e: React.MouseEvent,
      rowIndex: number,
      columnIndex: number,
    ) => void;
  }) {
    const handleClick = useCallback(() => {
      onCellClick(rowIndex, columnIndex);
    }, [onCellClick, rowIndex, columnIndex]);

    const handleDoubleClick = useCallback(() => {
      onCellDoubleClick(rowIndex, columnIndex);
    }, [onCellDoubleClick, rowIndex, columnIndex]);

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        onContextMenu(e, rowIndex, columnIndex);
      },
      [onContextMenu, rowIndex, columnIndex],
    );

    return (
      <div
        className={cn(
          "virtual-cell px-2 py-1 text-xs border-r last:border-r-0",
          "cursor-pointer select-none relative overflow-hidden",
          isSelected && "bg-primary/20",
          isFocused && "ring-1 ring-primary ring-inset z-10",
        )}
        style={{
          borderColor: "hsl(var(--border) / 0.3)",
          contain: "layout style paint",
        }}
        role="gridcell"
        aria-colindex={columnIndex + 1}
        tabIndex={isFocused ? 0 : -1}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {value ? (
          <CellValueRenderer cell={value} columnName={columnName} />
        ) : (
          <span className="text-foreground/40">-</span>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison - only re-render if these change
    return (
      prevProps.value === nextProps.value &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isFocused === nextProps.isFocused &&
      prevProps.rowIndex === nextProps.rowIndex &&
      prevProps.columnIndex === nextProps.columnIndex
    );
  },
);

// Optimized Virtual Row with pooling support
const VirtualRow = memo(
  function VirtualRow({
    index,
    data,
    columns,
    style,
    gridTemplateColumns,
    isRowSelected,
    isCellSelected,
    isCellFocused,
    onCellClick,
    onCellDoubleClick,
    onCellContextMenu,
  }: {
    index: number;
    data: TableDataRow;
    columns: any[];
    style: React.CSSProperties;
    gridTemplateColumns: string;
    isRowSelected: boolean;
    isCellSelected: (rowIndex: number, columnIndex: number) => boolean;
    isCellFocused: (rowIndex: number, columnIndex: number) => boolean;
    onCellClick: (rowIndex: number, columnIndex: number) => void;
    onCellDoubleClick: (rowIndex: number, columnIndex: number) => void;
    onCellContextMenu: (
      e: React.MouseEvent,
      rowIndex: number,
      columnIndex: number,
    ) => void;
  }) {
    return (
      <div
        className={cn(
          "virtual-row absolute left-0",
          index % 2 === 0 && "bg-muted/5",
          isRowSelected && "bg-primary/10",
          !isRowSelected && "hover:bg-primary/5",
        )}
        style={{
          ...style,
          display: "grid",
          gridTemplateColumns,
          borderBottom: "1px solid hsl(var(--border) / 0.3)",
          height: FastRenderStrategy.ROW_HEIGHT,
          width: "max-content", // Allow row to extend to full width
          minWidth: "100%", // But at least fill viewport
          contain: "layout style paint",
        }}
        role="row"
        aria-rowindex={index + 1}
        data-row-index={index}
      >
        {columns.map((column, columnIndex) => {
          return (
            <VirtualCell
              key={`${index}-${columnIndex}`}
              value={data[column.name]}
              columnName={column.name}
              columnIndex={columnIndex}
              rowIndex={index}
              isSelected={isCellSelected(index, columnIndex)}
              isFocused={isCellFocused(index, columnIndex)}
              onCellClick={onCellClick}
              onCellDoubleClick={onCellDoubleClick}
              onContextMenu={onCellContextMenu}
            />
          );
        })}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Optimize re-renders - only if critical props change
    return (
      prevProps.index === nextProps.index &&
      prevProps.data === nextProps.data &&
      prevProps.isRowSelected === nextProps.isRowSelected &&
      prevProps.style.transform === nextProps.style.transform &&
      prevProps.gridTemplateColumns === nextProps.gridTemplateColumns
    );
  },
);

export const OptimizedVirtualDataGrid = memo(function OptimizedVirtualDataGrid({
  connectionId,
  database,
  table,
  schema,
  className,
}: OptimizedVirtualDataGridProps) {
  // Core refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const velocityTracker = useRef(new ScrollVelocityTracker());
  const rafIdRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);

  // State
  const [isScrolled, setIsScrolled] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  // Hooks
  const { copy } = useCopy();
  const { toast } = useToast();

  // Performance optimization hooks
  // const rowPool = useRowPool(300); // TODO: Integrate row pooling

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

  // Triple buffer for data management
  const {
    updateViewport,
    getRow,
    prefetch,
    getStats: getBufferStats,
  } = useTripleBuffer(rows, rows.length);

  // Pre-calculate grid template columns once
  const gridTemplateColumns = useMemo(() => {
    if (!columns.length) return "";
    // Use fixed width of 150px per column for now
    return columns.map(() => `150px`).join(" ");
  }, [columns]);

  // Pre-calculate column positions for horizontal scrolling
  const columnPositions = useMemo(() => {
    let pos = 0;
    return columns.map(() => {
      const start = pos;
      const width = 150;
      pos += width;
      return { start, width, end: pos };
    });
  }, [columns]);

  // Selection state
  const {
    selectedRows,
    selectedRowCount,
    focusedCell,
    handleCellClick,
    isCellSelected,
    isRowSelected,
    isCellFocused,
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

  // Optimized scroll handler with frame budgeting
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    // Cancel any pending frame
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;

      // Update velocity tracker
      velocityTracker.current.update(scrollTop);
      const velocity = velocityTracker.current.getVelocity();

      // Dynamic overscan based on velocity
      let overscan = 5; // Minimal base overscan
      if (Math.abs(velocity) > 2000) {
        overscan = 30; // Very fast
      } else if (Math.abs(velocity) > 1000) {
        overscan = 20; // Fast
      } else if (Math.abs(velocity) > 500) {
        overscan = 15; // Medium
      } else if (Math.abs(velocity) > 100) {
        overscan = 10; // Slow
      }

      // Calculate visible row range
      const rowRange = FastRenderStrategy.getRowsInViewport(
        scrollTop,
        containerHeight,
        rows.length,
        overscan,
        velocity > 0 ? "down" : velocity < 0 ? "up" : "none",
      );

      setVisibleRange({
        start: rowRange.start,
        end: rowRange.end,
      });

      // For now, disable horizontal virtualization to fix column visibility
      // We'll render all columns and let CSS handle the clipping

      // Update triple buffer viewport
      updateViewport(scrollTop, containerHeight, overscan);

      // Prefetch next rows in idle time
      if (Math.abs(velocity) < 100) {
        const prefetchStart = rowRange.end + 1;
        const prefetchEnd = Math.min(rows.length - 1, prefetchStart + 20);
        prefetch(prefetchStart, prefetchEnd);
      }

      setIsScrolled(scrollTop > 0);
      lastScrollTopRef.current = scrollTop;
      rafIdRef.current = null;
    });
  }, [rows.length, columns.length, columnPositions, updateViewport, prefetch]);

  // Setup scroll listener with passive flag
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Initial calculation

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [handleScroll]);

  // Cell handlers with memoization
  const handleCellClickOptimized = useCallback(
    (rowIndex: number, columnIndex: number) => {
      handleCellClick(rowIndex, columnIndex, {} as any);
    },
    [handleCellClick],
  );

  const handleCellDoubleClick = useCallback(
    (rowIndex: number, columnIndex: number) => {
      // TODO: Implement inline editing
      console.log("Double click on cell:", rowIndex, columnIndex);
    },
    [],
  );

  const handleCellContextMenuOptimized = useCallback(
    (e: React.MouseEvent, rowIndex: number, columnIndex: number) => {
      const row = getRow(rowIndex);
      const columnName = columns[columnIndex]?.name;
      if (row && columnName) {
        const value = row[columnName];
        handleContextMenu(e, rowIndex, columnIndex, value);
      }
    },
    [columns, getRow, handleContextMenu],
  );

  // Get selected row data
  const selectedRowData = useMemo(() => {
    return Array.from(selectedRows)
      .map((index) => getRow(index))
      .filter((row): row is TableDataRow => row !== null);
  }, [selectedRows, getRow]);

  // Copy handlers
  const menuItems = useMemo(() => {
    return createDataGridMenuItems({
      onShowPreview: () => {
        setShowPreview(true);
      },
      onCopyCellValue: () => {
        if (focusedCell) {
          const row = getRow(focusedCell.rowIndex);
          const column = columns[focusedCell.columnIndex];
          if (column && row) {
            const value = row[column.name];
            void copy(copyCellValue(value?.value || value));
          }
        }
      },
      onCopyRows: () =>
        selectedRowData.length > 0 &&
        void copy(copyRows(selectedRowData, columns)),
      onCopyAsJson: () =>
        selectedRowData.length > 0 &&
        void copy(formatRowsAsJson(selectedRowData)),
      onCopyAsCsv: () =>
        selectedRowData.length > 0 &&
        void copy(formatRowsAsCsv(selectedRowData, columns)),
      onCopyAsMarkdown: () =>
        selectedRowData.length > 0 &&
        void copy(formatRowsAsMarkdown(selectedRowData, columns)),
      onCopyAsSql: () =>
        selectedRowData.length > 0 &&
        void copy(formatRowsAsSql(selectedRowData, columns, table)),
      onDelete: () => {
        console.log("Delete selected rows:", selectedRowData);
      },
      hasSelection: selectedRowCount > 0,
      hasCellFocus: !!focusedCell,
    });
  }, [
    selectedRowData,
    columns,
    table,
    selectedRowCount,
    focusedCell,
    copy,
    getRow,
  ]);

  // Error handling
  useEffect(() => {
    if (error && error !== dismissedError) {
      const isConnectionError =
        error.toLowerCase().includes("connection") ||
        error.toLowerCase().includes("closed pool");
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

  // Early returns for loading/error states
  if (isLoading && !columns.length && !error) return <DataGridSkeleton />;
  if (error && !rows.length) return <DataGridErrorState error={error} />;
  if (
    !isLoading &&
    !isStreaming &&
    !rows.length &&
    columns.length > 0 &&
    !error
  ) {
    return <DataGridEmptyState />;
  }
  // Show skeleton while streaming initial data
  if (!rows.length && (isLoading || isStreaming) && !error) {
    return <DataGridSkeleton />;
  }

  // Calculate virtual container dimensions
  const totalHeight = rows.length * FastRenderStrategy.ROW_HEIGHT;
  const totalWidth = columnPositions[columnPositions.length - 1]?.end || 0;

  // Get visible rows with buffer data
  const visibleRows = [];
  for (
    let i = visibleRange.start;
    i <= visibleRange.end && i < rows.length;
    i++
  ) {
    const row = getRow(i);
    if (row) {
      visibleRows.push({
        index: i,
        data: row,
        style: {
          // Position rows directly after header (no gap)
          transform: `translate3d(0, ${
            i * FastRenderStrategy.ROW_HEIGHT
          }px, 0)`,
          willChange: "transform",
        },
      });
    }
  }

  // Buffer stats for development
  const bufferStats = getBufferStats?.();

  return (
    <div
      ref={containerRef}
      className={cn("h-full flex flex-col overflow-hidden relative", className)}
      role="grid"
      aria-rowcount={rows.length}
      aria-colcount={columns.length}
    >
      {/* Performance stats in development */}
      {process.env.NODE_ENV === "development" && bufferStats && (
        <div className="absolute top-2 right-2 z-50 text-xs bg-black text-white p-2 rounded opacity-75">
          Hit: {Math.round(bufferStats.hitRate * 100)}% | Rows:{" "}
          {visibleRows.length}/{rows.length} | Cols: {columns.length}
        </div>
      )}

      {/* Virtual Scroll Container */}
      <div
        ref={scrollContainerRef}
        className={cn(
          "flex-1 overflow-auto relative",
          showPreview && "pb-[200px]",
        )}
        style={{
          transform: "translateZ(0)",
          willChange: "scroll-position",
          contain: "strict",
        }}
      >
        {/* Header inside scroll container to sync horizontal scroll */}
        <OptimizedDataGridHeader
          tableInstance={tableInstance}
          getAdjustedColumnWidth={(col) => col.getSize?.() || 150}
          isScrolled={isScrolled}
          gridTemplateColumns={gridTemplateColumns}
        />

        {/* Virtual spacer for scrollbar */}
        <div
          style={{
            height: totalHeight,
            width: totalWidth,
            position: "relative",
            // paddingTop: '32px', // Reserve space for header
          }}
        >
          {/* Rendered Rows */}
          {visibleRows.map((virtualRow) => (
            <VirtualRow
              key={`row-${virtualRow.index}`}
              index={virtualRow.index}
              data={virtualRow.data}
              columns={columns}
              style={virtualRow.style}
              gridTemplateColumns={gridTemplateColumns}
              isRowSelected={isRowSelected(virtualRow.index)}
              isCellSelected={isCellSelected}
              isCellFocused={isCellFocused}
              onCellClick={handleCellClickOptimized}
              onCellDoubleClick={handleCellDoubleClick}
              onCellContextMenu={handleCellContextMenuOptimized}
            />
          ))}

          {/* Loading indicator */}
          {isStreaming && <DataGridLoadingIndicator tableWidth={totalWidth} />}
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

      {/* Error Dialog */}
      <ConnectionErrorDialog
        isOpen={showErrorDialog}
        error={error || ""}
        onRetry={() => {
          setShowErrorDialog(false);
          setDismissedError(null);
          void loadData({ connectionId, database, table, schema, limit: 100 });
        }}
        onDismiss={() => {
          setShowErrorDialog(false);
          if (error) setDismissedError(error);
        }}
      />
    </div>
  );
});
