import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useInfiniteTableData } from "./hooks/useInfiniteTableData";
import { useGridSelection } from "./hooks/useGridSelection";
import { useContextMenu } from "./hooks/useContextMenu";
import { FastRenderStrategy } from "./utils/fastRenderStrategy";
import { ScrollVelocityTracker } from "./utils/scrollVelocityTracker";
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
import { CellValueRenderer } from "./cells/CellValueRenderer";
import { InlineCellEditor } from "./components/InlineCellEditor";

interface VirtualDataGridProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  className?: string;
}

// Virtual Row Component using divs with CSS Grid
const VirtualRow = memo(function VirtualRow({
  index,
  data,
  columns,
  style,
  isRowSelected,
  isCellSelected,
  isCellFocused,
  handlers,
  focusedCell,
}: {
  index: number;
  data: TableDataRow;
  columns: any[];
  style: React.CSSProperties;
  isRowSelected: boolean;
  isCellSelected: (rowIndex: number, columnIndex: number) => boolean;
  isCellFocused: (rowIndex: number, columnIndex: number) => boolean;
  handlers: any;
}) {
  const [editingCell, setEditingCell] = useState<number | null>(null);

  const handleDoubleClick = useCallback((columnIndex: number) => {
    setEditingCell(columnIndex);
  }, []);

  const handleEditComplete = useCallback(
    async (newValue: unknown) => {
      if (editingCell !== null) {
        await handlers.onCellUpdate?.(index, editingCell, newValue);
        setEditingCell(null);
      }
    },
    [editingCell, handlers, index]
  );

  const handleEditCancel = useCallback(() => {
    setEditingCell(null);
  }, []);

  const gridTemplateColumns = useMemo(
    () => columns.map(col => `${col.getSize?.() || 150}px`).join(' '),
    [columns]
  );

  return (
    <div
      className={cn(
        "virtual-row absolute left-0 right-0 flex",
        index % 2 === 0 && "bg-muted/5",
        isRowSelected && "bg-primary/10",
        !isRowSelected && "hover:bg-primary/5"
      )}
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns,
        borderBottom: '1px solid hsl(var(--border) / 0.3)',
        height: FastRenderStrategy.ROW_HEIGHT,
      }}
      role="row"
      aria-rowindex={index + 1}
    >
      {columns.map((column, columnIndex) => {
        const isSelected = isCellSelected(index, columnIndex);
        const isFocused = isCellFocused(index, columnIndex);
        const isEditing = editingCell === columnIndex;
        const value = data[column.name];

        return (
          <div
            key={`${index}-${columnIndex}`}
            className={cn(
              "virtual-cell px-2 py-1 text-xs border-r last:border-r-0",
              "cursor-pointer select-none relative overflow-hidden",
              isSelected && "bg-primary/20",
              isFocused && "ring-1 ring-primary ring-inset z-10",
              "focus:outline-none focus:ring-2 focus:ring-primary"
            )}
            style={{
              borderColor: 'hsl(var(--border) / 0.3)',
              contain: 'layout style paint',
            }}
            role="gridcell"
            aria-colindex={columnIndex + 1}
            tabIndex={isFocused ? 0 : -1}
            onClick={(e) => handlers.onClick?.(index, columnIndex, e)}
            onMouseDown={(e) => handlers.onMouseDown?.(index, columnIndex, e)}
            onMouseEnter={(e) => handlers.onMouseEnter?.(index, columnIndex, e)}
            onContextMenu={(e) => handlers.onContextMenu?.(index, columnIndex, e, value)}
            onDoubleClick={() => handleDoubleClick(columnIndex)}
          >
            {isEditing ? (
              <InlineCellEditor
                value={value}
                onSave={handleEditComplete}
                onCancel={handleEditCancel}
              />
            ) : (
              <CellValueRenderer cell={value || { value: null, value_type: 'Text' }} column={column} />
            )}
          </div>
        );
      })}
    </div>
  );
});

export const VirtualDataGrid = memo(function VirtualDataGrid({
  connectionId,
  database,
  table,
  schema,
  className,
}: VirtualDataGridProps) {
  // Core state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const velocityTracker = useRef(new ScrollVelocityTracker());
  const [isScrolled, setIsScrolled] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  // Hooks
  const { copy } = useCopy();
  const { toast } = useToast();

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

  // Selection state
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
    visibleRange,
  });

  const { menuPosition, closeMenu, handleContextMenu } = useContextMenu({
    onShowPreview: () => setShowPreview(true),
    onDelete: (rowIndices) => console.log("Delete rows:", rowIndices),
  });

  // Virtual scrolling with RAF and dynamic overscan
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    const handleScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        
        // Update velocity tracker
        velocityTracker.current.update(scrollTop);
        const velocity = velocityTracker.current.getVelocity();
        
        // Dynamic overscan based on velocity
        let overscan = 10; // Base overscan
        if (Math.abs(velocity) > 1000) {
          overscan = 50; // Very fast scrolling
        } else if (Math.abs(velocity) > 500) {
          overscan = 30; // Fast scrolling
        } else if (Math.abs(velocity) > 100) {
          overscan = 20; // Medium scrolling
        }

        // Calculate visible range
        const startIndex = Math.floor(scrollTop / FastRenderStrategy.ROW_HEIGHT);
        const endIndex = Math.ceil((scrollTop + containerHeight) / FastRenderStrategy.ROW_HEIGHT);
        
        setVisibleRange({
          start: Math.max(0, startIndex - overscan),
          end: Math.min(rows.length - 1, endIndex + overscan),
        });

        setIsScrolled(scrollTop > 0);
        rafId = null;
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Initial calculation

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [rows.length]);

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
    [rows, columns, connectionId, database, table, schema, toast]
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
        cellValue: unknown
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
    ]
  );

  // Get selected row data
  const selectedRowData = useMemo(() => {
    return Array.from(selectedRows)
      .map((index) => rows[index])
      .filter((row): row is TableDataRow => row !== undefined);
  }, [selectedRows, rows]);

  // Copy handlers
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

  const menuItems = useMemo(() => {
    return createDataGridMenuItems({
      onShowPreview: () => setShowPreview(true),
      onCopyCellValue: handleCopyCellValue,
      onCopyRows: handleCopyRows,
      onCopyAsJson: () => selectedRowData.length > 0 && void copy(formatRowsAsJson(selectedRowData)),
      onCopyAsCsv: () => selectedRowData.length > 0 && void copy(formatRowsAsCsv(selectedRowData, columns)),
      onCopyAsMarkdown: () => selectedRowData.length > 0 && void copy(formatRowsAsMarkdown(selectedRowData, columns)),
      onCopyAsSql: () => selectedRowData.length > 0 && void copy(formatRowsAsSql(selectedRowData, columns, table)),
      onDelete: () => console.log("Delete selected rows:", selectedRowData),
      hasSelection: selectedRowCount > 0,
      hasCellFocus: !!focusedCell,
    });
  }, [
    handleCopyCellValue,
    handleCopyRows,
    selectedRowData,
    columns,
    table,
    selectedRowCount,
    focusedCell,
    copy,
  ]);

  // Error handling
  useEffect(() => {
    if (error && error !== dismissedError) {
      const isConnectionError =
        error.toLowerCase().includes("closed pool") ||
        error.toLowerCase().includes("connection") ||
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

  // Early returns for loading/error states
  if (isLoading && !columns.length && !error) {
    return <DataGridSkeleton />;
  }

  if (error && !rows.length) {
    return <DataGridErrorState error={error} />;
  }

  if (!isLoading && !isStreaming && !rows.length && columns.length > 0 && !error) {
    return <DataGridEmptyState />;
  }

  // Calculate virtual container height
  const totalHeight = rows.length * FastRenderStrategy.ROW_HEIGHT;

  // Get visible rows for rendering
  const visibleRows = [];
  for (let i = visibleRange.start; i <= visibleRange.end && i < rows.length; i++) {
    const row = rows[i];
    if (row) {
      visibleRows.push({
        index: i,
        data: row,
        style: {
          transform: `translateY(${i * FastRenderStrategy.ROW_HEIGHT}px)`,
          willChange: 'transform',
        },
      });
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn("h-full flex flex-col overflow-hidden relative", className)}
      role="grid"
      aria-rowcount={rows.length}
      aria-colcount={columns.length}
    >
      {/* Header */}
      <DataGridHeader
        tableInstance={tableInstance}
        tableWidth={0}
        getAdjustedColumnWidth={(col) => col.getSize?.() || 150}
        isScrolled={isScrolled}
      />

      {/* Virtual Scroll Container */}
      <div
        ref={scrollContainerRef}
        className={cn(
          "flex-1 overflow-auto relative",
          showPreview && "pb-[200px]"
        )}
        style={{
          transform: 'translateZ(0)',
          willChange: 'scroll-position',
        }}
      >
        {/* Virtual Height Spacer */}
        <div
          style={{
            height: totalHeight,
            position: 'relative',
            width: '100%',
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
              isRowSelected={isRowSelected(virtualRow.index)}
              isCellSelected={isCellSelected}
              isCellFocused={isCellFocused}
              handlers={handlers}
            />
          ))}

          {/* Loading indicator */}
          {isStreaming && (
            <DataGridLoadingIndicator tableWidth={0} />
          )}
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
          onClose={() => setShowPreview(false)}
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
          void loadData({
            connectionId,
            database,
            table,
            schema,
            limit: 100,
          });
        }}
        onDismiss={() => {
          setShowErrorDialog(false);
          if (error) setDismissedError(error);
        }}
      />
    </div>
  );
});