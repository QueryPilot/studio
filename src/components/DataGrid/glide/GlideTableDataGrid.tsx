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
  
  // Fetch table data using existing hook
  const {
    isLoading,
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

  // Convert columns to Glide format
  const columns = useMemo<DataGridColumn[]>(() => {
    if (!tableColumns || tableColumns.length === 0) return [];
    
    return tableColumns.map((col, index) => {
      const colId = col.name || `col_${index}`;
      const baseWidth = Math.max(80, Math.min(200, col.name.length * 7 + 40));
      return {
        id: colId,
        name: col.name,
        title: col.name,
        width: columnWidths[colId] || baseWidth,
        type: col.type,
        grow: 0, // Set to 0 to allow manual resizing
        themeOverride: {
          bgIconHeader: col.isPrimaryKey ? "rgba(59, 130, 246, 0.1)" : undefined,
        },
      };
    });
  }, [tableColumns, columnWidths]);

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
      const value = rowData[column.name];
      
      // Pass column width for text truncation
      return cellValueToGridCell(value, column.type, column.width);
    },
    [rows, columns]
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

  // Get raw cell value for popup
  const getCellValue = useCallback(
    (cell: Item): unknown => {
      const [col, row] = cell;
      
      if (!rows[row] || !columns[col]) {
        return null;
      }
      
      const column = columns[col];
      const rowData = rows[row];
      const value = rowData[column.name];
      
      return value?.value !== undefined ? value.value : value;
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
      setVisibleRange({ start: range.y, end: range.y + range.height });
    });
  }, []);

  useEffect(() => {
    const endRow = visibleRange.end;
    const buffer = 100; // Load more when within 100 rows of the end
    
    if (hasNextPage && endRow > rows.length - buffer) {
      loadMore();
    }
  }, [visibleRange.end, rows.length, hasNextPage, loadMore]);

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
          onVisibleRegionChanged={handleVisibleRegionChanged}
          className="h-full w-full"
          showSearch={false}
          freezeColumns={0}
          smoothScrollX={true}
          smoothScrollY={true}
          rowMarkers="none"
          headerHeight={28}
          rowHeight={28}
          isLoading={isLoading}
          estimatedTotal={estimatedTotal || undefined}
        />
      </div>
      
      <DataGridStatusBar
        loadedRows={rows.length}
        estimatedTotal={estimatedTotal}
        selectedRowCount={0}
        isStreaming={false}
      />
    </div>
  );
});