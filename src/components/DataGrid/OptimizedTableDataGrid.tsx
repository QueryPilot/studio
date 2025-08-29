import { memo, useState, useCallback, useMemo, useRef } from "react";
import { useInfiniteTableData } from "./hooks/useInfiniteTableData";
import { useGridSelection } from "./hooks/useGridSelection";
import { useContextMenu } from "./hooks/useContextMenu";
import { FastRenderStrategy } from "./utils/fastRenderStrategy";
import { OptimizedDataGridRow } from "./components/OptimizedDataGridRow";
import { DataGridHeader } from "./components/DataGridHeader";
import { DataGridSkeleton } from "./components/DataGridSkeleton";
import { DataGridStatusBar } from "./components/DataGridStatusBar";
import {
  DataGridContextMenu,
  createDataGridMenuItems,
} from "./components/DataGridContextMenu";
import {
  DataGridErrorState,
  DataGridEmptyState,
  DataGridLoadingIndicator,
} from "./components/DataGridStates";
import "./styles/dataGrid.css";
import type { TableDataRow } from "@/services/tableDataTypes";

interface OptimizedTableDataGridProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  className?: string;
}

export const OptimizedTableDataGrid = memo(function OptimizedTableDataGrid({
  connectionId,
  database,
  table,
  schema,
  className,
}: OptimizedTableDataGridProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [currentOverscan, setCurrentOverscan] = useState(20);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const lastScrollTop = useRef(0);

  const {
    tableInstance,
    isLoading,
    error,
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

  // Calculate visible range
  const visibleRange = useMemo(() => {
    if (!containerRef.current) return { start: 0, end: 0 };
    const containerHeight = containerRef.current.clientHeight;
    return FastRenderStrategy.getVisibleRange(scrollTop, containerHeight);
  }, [scrollTop]);

  // Optimized selection with batching
  const {
    focusedCell,
    selectionRange,
    clearSelection,
    setFocusedCell,
  } = useGridSelection({
    totalRows: rows.length,
    totalColumns: columns.length,
    visibleRange,
  });

  // Calculate selection state per row (batched)
  const rowSelectionStates = useMemo(() => {
    if (!selectionRange) return new Map();
    
    const states = new Map<number, { isInRange: boolean; selectedCols: Set<number> }>();
    const { start, end } = selectionRange;
    const minRow = Math.min(start.rowIndex, end.rowIndex);
    const maxRow = Math.max(start.rowIndex, end.rowIndex);
    const minCol = Math.min(start.columnIndex, end.columnIndex);
    const maxCol = Math.max(start.columnIndex, end.columnIndex);

    for (let row = minRow; row <= maxRow; row++) {
      const selectedCols = new Set<number>();
      for (let col = minCol; col <= maxCol; col++) {
        selectedCols.add(col);
      }
      states.set(row, { isInRange: true, selectedCols });
    }
    
    return states;
  }, [selectionRange]);

  // EVENT DELEGATION - Single handler for all cell interactions
  const handleTableMouseDown = useCallback((e: React.MouseEvent) => {
    const cell = (e.target as HTMLElement).closest('[data-row-index][data-col-index]');
    if (!cell) return;
    
    const rowIndex = parseInt(cell.getAttribute('data-row-index')!, 10);
    const colIndex = parseInt(cell.getAttribute('data-col-index')!, 10);
    
    // Start selection
    setFocusedCell({ rowIndex, columnIndex: colIndex });
    
    // Handle drag selection
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const moveCell = (moveEvent.target as HTMLElement).closest('[data-row-index][data-col-index]');
      if (!moveCell) return;
      
      const moveRow = parseInt(moveCell.getAttribute('data-row-index')!, 10);
      const moveCol = parseInt(moveCell.getAttribute('data-col-index')!, 10);
      
      // Update selection range
      // This would update selectionRange state
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    e.preventDefault();
  }, [setFocusedCell]);

  const handleTableClick = useCallback((e: React.MouseEvent) => {
    const cell = (e.target as HTMLElement).closest('[data-row-index][data-col-index]');
    if (!cell) return;
    
    const rowIndex = parseInt(cell.getAttribute('data-row-index')!, 10);
    const colIndex = parseInt(cell.getAttribute('data-col-index')!, 10);
    
    setFocusedCell({ rowIndex, columnIndex: colIndex });
  }, [setFocusedCell]);

  const handleTableDoubleClick = useCallback((e: React.MouseEvent) => {
    const cell = (e.target as HTMLElement).closest('[data-row-index][data-col-index]');
    if (!cell) return;
    
    // Start editing
    const rowIndex = parseInt(cell.getAttribute('data-row-index')!, 10);
    const colIndex = parseInt(cell.getAttribute('data-col-index')!, 10);
    
    console.log('Edit cell:', rowIndex, colIndex);
  }, []);

  // Optimized scroll handler with dynamic overscan
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    
    scrollRafRef.current = requestAnimationFrame(() => {
      const container = containerRef.current!;
      const newScrollTop = container.scrollTop;
      const scrollDelta = Math.abs(newScrollTop - lastScrollTop.current);
      
      // Dynamic overscan based on scroll speed
      let overscan = 20;
      if (scrollDelta > 100) overscan = 50;
      else if (scrollDelta > 50) overscan = 40;
      else if (scrollDelta > 25) overscan = 30;
      else if (scrollDelta > 10) overscan = 25;
      
      setScrollTop(newScrollTop);
      setCurrentOverscan(overscan);
      lastScrollTop.current = newScrollTop;
      scrollRafRef.current = null;
    });
  }, []);

  // Calculate rows to render with overscan
  const rowsToRender = useMemo(() => {
    const { start, end } = FastRenderStrategy.getRowsInViewport(
      scrollTop,
      containerRef.current?.clientHeight || 600,
      rows.length,
      currentOverscan,
      scrollTop > lastScrollTop.current ? 'down' : 'up'
    );
    
    return rows.slice(start, end + 1).map((row, idx) => ({
      row,
      virtualItem: {
        index: start + idx,
        start: (start + idx) * FastRenderStrategy.ROW_HEIGHT,
        size: FastRenderStrategy.ROW_HEIGHT,
      },
    }));
  }, [scrollTop, rows, currentOverscan]);

  // Total height for scrollbar
  const totalHeight = FastRenderStrategy.getTotalHeight(rows.length);

  if (isLoading && rows.length === 0) {
    return <DataGridSkeleton />;
  }

  if (error) {
    return <DataGridErrorState error={error} onRetry={() => loadData({ connectionId, database, table, schema, limit: 100 })} />;
  }

  if (!rows.length) {
    return <DataGridEmptyState />;
  }

  return (
    <div className={`data-grid-wrapper ${className || ''}`}>
      <div 
        ref={containerRef}
        className="data-grid-container"
        onScroll={handleScroll}
        onMouseDown={handleTableMouseDown}
        onClick={handleTableClick}
        onDoubleClick={handleTableDoubleClick}
        role="table"
        aria-rowcount={rows.length}
        aria-colcount={columns.length}
      >
        {/* Header */}
        <div className="grid-header" role="rowgroup">
          <div className="grid-row" role="row">
            {columns.map((column, idx) => (
              <div
                key={column.name}
                className="grid-cell"
                role="columnheader"
                style={{ width: `${150}px` }}
              >
                {column.name}
              </div>
            ))}
          </div>
        </div>
        
        {/* Body with virtual scrolling */}
        <div 
          className="grid-body" 
          role="rowgroup"
          style={{ height: `${totalHeight}px` }}
        >
          {rowsToRender.map(({ row, virtualItem }) => {
            const selectionState = rowSelectionStates.get(virtualItem.index);
            return (
              <OptimizedDataGridRow
                key={virtualItem.index}
                virtualItem={virtualItem}
                row={tableInstance?.getRowModel().rows[virtualItem.index]}
                columns={columns}
                getAdjustedColumnWidth={(col, idx) => 150}
                isRowInSelection={selectionState?.isInRange || false}
                selectedColumns={selectionState?.selectedCols || new Set()}
                focusedColumn={
                  focusedCell?.rowIndex === virtualItem.index 
                    ? focusedCell.columnIndex 
                    : null
                }
              />
            );
          })}
        </div>
      </div>
      
      {/* Status Bar */}
      <DataGridStatusBar
        loadedRows={rows.length}
        estimatedTotal={estimatedTotal}
        hasMore={false}
        selectedRows={rowSelectionStates.size}
      />
    </div>
  );
});