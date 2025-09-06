import { memo, useCallback, useMemo, useState, useEffect } from "react";
import {
  type GridCell,
  type Item,
  type GridColumn,
  type Rectangle,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import { EnhancedGlideWrapper } from "./EnhancedGlideWrapper";
import { useInfiniteTableData } from "../hooks/useInfiniteTableData";
import {
  cellValueToGridCell,
  shouldUseFullWidth,
  type GlideTableDataGridProps,
  type DataGridColumn,
} from "./types";
import { cn } from "@/lib/utils";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import {
  DataGridErrorState,
  DataGridEmptyState,
} from "../components/DataGridStates";

export const GlideTableDataGrid = memo(function GlideTableDataGrid({
  connectionId,
  database,
  table,
  schema,
  className,
}: GlideTableDataGridProps) {
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });
  const [selectedRowCount, setSelectedRowCount] = useState(0);

  // Fetch table data using existing hook
  const {
    isLoading,
    isLoadingMore,
    error,
    columns: tableColumns,
    rows,
    estimatedTotal,
    loadMore,
    hasNextPage,
  } = useInfiniteTableData({
    connectionId,
    database,
    table,
    schema,
  });

  // Track column widths
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  // Track column order
  const [columnOrder, setColumnOrder] = useState<number[]>([]);
  
  // Initialize column order when columns change
  useEffect(() => {
    if (tableColumns && tableColumns.length > 0 && columnOrder.length === 0) {
      setColumnOrder(tableColumns.map((_, index) => index));
    }
  }, [tableColumns, columnOrder.length]);

  // Convert columns to Glide format with reordering
  const columns = useMemo<DataGridColumn[]>(() => {
    console.log(`[GlideTableDataGrid] Converting ${tableColumns?.length || 0} columns to Glide format`);
    if (!tableColumns || tableColumns.length === 0) return [];

    // Use column order if available, otherwise use default order
    const orderedIndices =
      columnOrder.length > 0
        ? columnOrder
        : tableColumns.map((_, index) => index);

    return orderedIndices
      .map((originalIndex) => {
        const col = tableColumns[originalIndex];
        if (!col) return null;

        const colId = col.name || `col_${originalIndex}`;
        
        // Calculate base width - use full content width for date/time/number columns
        let baseWidth;
        if (shouldUseFullWidth(col.db_type)) {
          // For date/time/number columns, calculate based on typical content length
          if (col.db_type?.toLowerCase().includes("timestamp")) {
            // Timestamps like "2025-08-31T10:44:52" need ~160px
            baseWidth = 180;
          } else if (col.db_type?.toLowerCase().includes("date")) {
            // Dates like "2025-08-31" need ~100px
            baseWidth = 120;
          } else if (col.db_type?.toLowerCase().includes("time")) {
            // Times like "10:44:52" need ~80px
            baseWidth = 100;
          } else {
            // Numbers - use header width or minimum 100px
            baseWidth = Math.max(100, col.name.length * 8 + 40);
          }
        } else {
          // Text columns - use standard calculation
          baseWidth = Math.max(80, Math.min(200, col.name.length * 7 + 40));
        }
        
        return {
          id: colId,
          name: col.name,
          title: col.name,
          width: columnWidths[colId] || baseWidth,
          type: col.db_type,
          grow: 0, // Set to 0 to allow manual resizing
          hasMenu: false,
          themeOverride: {
            bgIconHeader: (col as any).primary_key
              ? "rgba(59, 130, 246, 0.1)"
              : undefined,
          },
        };
      })
      .filter(Boolean) as DataGridColumn[];
  }, [tableColumns, columnWidths, columnOrder]);

  // Get cell content callback
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;

      if (!rows[row] || !columns[col]) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        };
      }

      const column = columns[col];
      const rowData = rows[row];

      // Access value by column name
      const value = rowData[column.name];
      // Convert cell value to grid cell with column width for proper truncation
      return cellValueToGridCell(value, column.type, 'width' in column ? column.width : undefined);
    },
    [rows, columns],
  );

  // Calculate optimal column width based on content
  const calculateOptimalWidth = useCallback(
    (colIndex: number): number => {
      if (!columns[colIndex]) return 150;

      const column = columns[colIndex];
      const headerWidth = column.name.length * 8 + 40; // Header text width

      // Create a canvas for accurate text measurement
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return headerWidth;
      
      // Use the same font as the grid
      ctx.font = '400 12px Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif';

      // Sample all rows (or up to 1000 for performance)
      let maxContentWidth = headerWidth;
      const sampleSize = Math.min(1000, rows.length);

      for (let i = 0; i < sampleSize; i++) {
        const cellValue = rows[i]?.[column.name];
        const displayValue = cellValue?.value || cellValue;
        const textValue = String(displayValue || "");
        
        // Measure actual text width
        const textWidth = ctx.measureText(textValue).width;
        const contentWidth = textWidth + 16; // Add padding
        maxContentWidth = Math.max(maxContentWidth, contentWidth);
      }

      // Cap at 800px max for readability
      return Math.min(maxContentWidth, 800);
    },
    [columns, rows],
  );

  // Handle column resize
  const handleColumnResize = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number) => {
      if (columns[colIndex]?.id) {
        const colId = columns[colIndex].id;
        setColumnWidths((prev) => ({
          ...prev,
          [colId]: newSize,
        }));
      }
    },
    [columns],
  );

  // Handle column move (drag and drop)
  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (startIndex === endIndex) return;

      setColumnOrder((prev) => {
        const newOrder = [...prev];
        const [movedColumn] = newOrder.splice(startIndex, 1);
        newOrder.splice(endIndex, 0, movedColumn);
        return newOrder;
      });
    },
    [],
  );

  // Handle column resize end (double-click to auto-size)
  const handleColumnResizeEnd = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number) => {
      // Check if this is a double-click (size is -1 indicates auto-size request)
      if (newSize < 0) {
        const optimalWidth = calculateOptimalWidth(colIndex);
        if (columns[colIndex]?.id) {
          const colId = columns[colIndex].id;
          setColumnWidths((prev) => ({
            ...prev,
            [colId]: optimalWidth,
          }));
        }
      }
      // For normal resize end, the width is already set by handleColumnResize
    },
    [columns, calculateOptimalWidth],
  );

  // Get raw cell value for popup
  const getCellValue = useCallback(
    (cell: Item): unknown => {
      const [col, row] = cell;

      if (!rows[row] || !columns[col]) {
        return null;
      }

      const column = columns[col];
      const rowData = rows[row];
      // rowData is now an object with column names as keys
      const value = rowData[column.name];

      // Return the actual CellValue structure (value property contains the data)
      return value?.value ?? value;
    },
    [rows, columns],
  );

  // Handle cell click
  const handleCellClicked = useCallback((cell: Item) => {
    const [col, row] = cell;
    console.log(`Cell clicked: [${col}, ${row}]`);
  }, []);

  // Handle visible region change for infinite scrolling
  const handleVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      // Use RAF for smooth updates
      requestAnimationFrame(() => {
        const newRange = { start: range.y, end: range.y + range.height };
        setVisibleRange(newRange);
      });
    },
    [],
  );

  // Handle selection change
  const handleSelectionChange = useCallback((count: number) => {
    setSelectedRowCount(count);
  }, []);

  useEffect(() => {
    const endRow = visibleRange.end;
    const buffer = 500; // Load more when within 500 rows of the end
    const threshold = rows.length - buffer;

    if (hasNextPage && endRow > threshold && !isLoadingMore) {
      void loadMore();
    }
  }, [visibleRange.end, rows.length, hasNextPage, isLoadingMore, loadMore]);

  // Error state
  if (error) {
    return (
      <div className={cn("h-full flex flex-col", className)}>
        <DataGridErrorState error={error} />
      </div>
    );
  }

  // Empty state
  if (!isLoading && rows.length === 0) {
    return (
      <div className={cn("h-full flex flex-col", className)}>
        <DataGridEmptyState />
      </div>
    );
  }

  return (
    <div className={cn("h-full w-full flex flex-col", className)}>
      <div className="flex-1 w-full min-h-0">
        <EnhancedGlideWrapper
          columns={columns}
          rows={rows.length}
          getCellContent={getCellContent}
          getCellValue={getCellValue}
          onCellClicked={handleCellClicked}
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
          onColumnMoved={handleColumnMoved}
          onVisibleRegionChanged={handleVisibleRegionChanged}
          onSelectionChange={handleSelectionChange}
          className="h-full w-full"
          freezeColumns={0}
          rowMarkers="none"
          headerHeight={28}
          rowHeight={28}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          estimatedTotal={estimatedTotal || undefined}
        />
      </div>

      <DataGridStatusBar
        loadedRows={rows.length}
        estimatedTotal={estimatedTotal || undefined}
        selectedRows={selectedRowCount}
      />
    </div>
  );
});
