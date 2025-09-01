import { memo, useCallback, useMemo, useState, useEffect } from "react";
import { type GridCell, type Item, type GridColumn, type Rectangle } from "@glideapps/glide-data-grid";
import { EnhancedGlideWrapper } from "./EnhancedGlideWrapper";
import { useInfiniteTableData } from "../hooks/useInfiniteTableData";
import { cellValueToGridCell, type GlideTableDataGridProps, type DataGridColumn } from "./types";
import { cn } from "@/lib/utils";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import { DataGridErrorState, DataGridEmptyState } from "../components/DataGridStates";

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
    if (!tableColumns || tableColumns.length === 0) return [];
    
    // Use column order if available, otherwise use default order
    const orderedIndices = columnOrder.length > 0 
      ? columnOrder 
      : tableColumns.map((_, index) => index);
    
    return orderedIndices.map(originalIndex => {
      const col = tableColumns[originalIndex];
      if (!col) return null;
      
      const colId = col.name || `col_${originalIndex}`;
      const baseWidth = Math.max(80, Math.min(200, col.name.length * 7 + 40));
      return {
        id: colId,
        name: col.name,
        title: col.name,
        width: columnWidths[colId] || baseWidth,
        type: col.db_type,
        grow: 0, // Set to 0 to allow manual resizing
        hasMenu: false,
        themeOverride: {
          bgIconHeader: col.primary_key ? "rgba(59, 130, 246, 0.1)" : undefined,
        },
      };
    }).filter(Boolean) as DataGridColumn[];
  }, [tableColumns, columnWidths, columnOrder]);

  // Get cell content callback
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      
      if (!rows[row] || !columns[col]) {
        return {
          kind: 0, // GridCellKind.Text
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        };
      }
      
      const column = columns[col];
      const rowData = rows[row];
      
      // Debug: Log first row structure
      if (row === 0 && col === 0) {
        console.log("=== DEBUG: First row data ===");
        console.log("rowData type:", typeof rowData);
        console.log("rowData:", rowData);
        console.log("Is array?", Array.isArray(rowData));
        console.log("rowData[0]:", rowData[0]);
        console.log("rowData.id:", rowData.id);
        console.log("rowData keys:", Object.keys(rowData || {}));
      }
      
      // rowData is now always an object with column names as keys (TableDataRow)
      let value;
      if (typeof rowData === 'object' && rowData !== null) {
        // Access value by column name
        value = rowData[column.name];
      } else {
        value = null;
      }
      
      // Pass column width for text truncation
      return cellValueToGridCell(value, column.db_type, column.width);
    },
    [rows, columns]
  );

  // Calculate optimal column width based on content
  const calculateOptimalWidth = useCallback(
    (colIndex: number): number => {
      if (!columns[colIndex]) return 150;
      
      const column = columns[colIndex];
      const headerWidth = column.name.length * 8 + 40; // Header text width
      
      // Sample first 100 rows to find max content width
      let maxContentWidth = headerWidth;
      const sampleSize = Math.min(100, rows.length);
      
      for (let i = 0; i < sampleSize; i++) {
        const cellValue = rows[i]?.[column.name];
        const displayValue = cellValue?.value || cellValue;
        const textLength = String(displayValue || "").length;
        const contentWidth = textLength * 7 + 20; // Approximate char width
        maxContentWidth = Math.max(maxContentWidth, contentWidth);
      }
      
      // Cap at 500px max
      return Math.min(maxContentWidth, 500);
    },
    [columns, rows]
  );

  // Handle column resize
  const handleColumnResize = useCallback(
    (column: GridColumn, newSize: number, colIndex: number) => {
      if (columns[colIndex]?.id) {
        const colId = columns[colIndex].id;
        setColumnWidths(prev => ({
          ...prev,
          [colId]: newSize,
        }));
      }
    },
    [columns]
  );

  // Handle column move (drag and drop)
  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (startIndex === endIndex) return;
      
      setColumnOrder(prev => {
        const newOrder = [...prev];
        const [movedColumn] = newOrder.splice(startIndex, 1);
        newOrder.splice(endIndex, 0, movedColumn);
        return newOrder;
      });
    },
    []
  );

  // Handle column resize end (double-click to auto-size)
  const handleColumnResizeEnd = useCallback(
    (column: GridColumn, newSize: number, colIndex: number) => {
      // Check if this is a double-click (size is -1 or very small change)
      if (newSize < 0 || Math.abs(newSize - column.width) < 5) {
        const optimalWidth = calculateOptimalWidth(colIndex);
        if (columns[colIndex]?.id) {
          const colId = columns[colIndex].id;
          setColumnWidths(prev => ({
            ...prev,
            [colId]: optimalWidth,
          }));
        }
      }
    },
    [columns, calculateOptimalWidth]
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
      return value?.value || value;
    },
    [rows, columns]
  );

  // Handle cell click
  const handleCellClicked = useCallback((cell: Item) => {
    const [col, row] = cell;
    console.log(`Cell clicked: [${col}, ${row}]`);
  }, []);

  // Handle visible region change for infinite scrolling
  const handleVisibleRegionChanged = useCallback((range: Rectangle) => {
    // Use RAF for smooth updates
    requestAnimationFrame(() => {
      const newRange = { start: range.y, end: range.y + range.height };
      console.log('[GlideTableDataGrid] Visible range changed:', newRange);
      console.log('[GlideTableDataGrid] Total rows loaded:', rows.length);
      console.log('[GlideTableDataGrid] Has next page:', hasNextPage);
      setVisibleRange(newRange);
    });
  }, [rows.length, hasNextPage]);
  
  // Handle selection change
  const handleSelectionChange = useCallback((count: number) => {
    setSelectedRowCount(count);
  }, []);

  useEffect(() => {
    const endRow = visibleRange.end;
    const buffer = 500; // Load more when within 500 rows of the end
    const threshold = rows.length - buffer;
    
    console.log('[GlideTableDataGrid] Checking load more:');
    console.log('  - End row:', endRow);
    console.log('  - Total rows:', rows.length);
    console.log('  - Threshold:', threshold);
    console.log('  - Has next page:', hasNextPage);
    console.log('  - Should load more:', hasNextPage && endRow > threshold && !isLoadingMore);
    
    if (hasNextPage && endRow > threshold && !isLoadingMore) {
      console.log('[GlideTableDataGrid] Triggering loadMore!');
      loadMore();
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
        estimatedTotal={estimatedTotal}
        selectedRows={selectedRowCount}
      />
    </div>
  );
});