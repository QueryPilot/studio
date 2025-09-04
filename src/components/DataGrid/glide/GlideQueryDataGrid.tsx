import { memo, useCallback, useMemo, useState, useEffect } from "react";
import { type GridCell, type Item, GridCellKind, type GridColumn } from "@glideapps/glide-data-grid";
import { EnhancedGlideWrapper } from "./EnhancedGlideWrapper";
import { type GlideQueryDataGridProps, type DataGridColumn } from "./types";
import { cn } from "@/lib/utils";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import { DataGridEmptyState } from "../components/DataGridStates";

export const GlideQueryDataGrid = memo(function GlideQueryDataGrid({
  connectionId: _connectionId,
  query: _query,
  className,
  data,
}: GlideQueryDataGridProps) {
  // Track column widths
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  
  // Track column order
  const [columnOrder, setColumnOrder] = useState<number[]>([]);
  
  // Track selected rows count
  const [selectedRowCount, setSelectedRowCount] = useState(0);
  
  // Initialize column order when columns change
  useEffect(() => {
    if (data?.columns && data.columns.length > 0 && columnOrder.length === 0) {
      setColumnOrder(data.columns.map((_, index) => index));
    }
  }, [data?.columns, columnOrder.length]);

  // Convert columns to Glide format with reordering
  const columns = useMemo<DataGridColumn[]>(() => {
    if (!data?.columns || data.columns.length === 0) return [];
    
    // Use column order if available, otherwise use default order
    const orderedIndices = columnOrder.length > 0 
      ? columnOrder 
      : data.columns.map((_, index) => index);
    
    return orderedIndices.map(originalIndex => {
      const col = data.columns[originalIndex];
      if (!col) return null;
      
      const colId = col || `col_${originalIndex}`;
      const baseWidth = Math.max(80, Math.min(200, col.length * 7 + 30));
      return {
        id: colId,
        name: col,
        title: col,
        width: columnWidths[colId] || baseWidth,
        grow: 0, // Allow manual resizing
        hasMenu: false,
      };
    }).filter(Boolean) as DataGridColumn[];
  }, [data?.columns, columnWidths, columnOrder]);

  // Detect data type from value
  const detectCellKind = useCallback((value: unknown): GridCellKind => {
    if (value === null || value === undefined) {
      return GridCellKind.Text;
    }
    
    if (typeof value === 'boolean') {
      return GridCellKind.Boolean;
    }
    
    if (typeof value === 'number' && !isNaN(value)) {
      return GridCellKind.Number;
    }
    
    return GridCellKind.Text;
  }, []);

  // Format display value
  const formatDisplayValue = useCallback((value: unknown): string => {
    if (value === null) return "NULL";
    if (value === undefined) return "";
    
    if (typeof value === 'boolean') {
      return value ? "TRUE" : "FALSE";
    }
    
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    
    if (value instanceof Date) {
      return value.toISOString();
    }
    
    return String(value);
  }, []);


  // Get cell content callback
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      
      if (!data?.rows[row] || !columns[col]) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        };
      }
      
      const column = columns[col];
      // Map to original column index for data access
      const originalColIndex = columnOrder.length > 0 ? columnOrder[col] : col;
      const value = data.rows[row][originalColIndex];
      const cellKind = detectCellKind(value);
      
      switch (cellKind) {
        case GridCellKind.Boolean:
          return {
            kind: GridCellKind.Boolean,
            data: value as boolean,
            allowOverlay: false,
            readonly: true,
          };
          
        case GridCellKind.Number:
          return {
            kind: GridCellKind.Number,
            data: value as number,
            displayData: formatDisplayValue(value),
            allowOverlay: false,
            readonly: true,
            contentAlign: "right", // Right-align numbers
          };
          
        default: {
          const textValue = formatDisplayValue(value);
          
          return {
            kind: GridCellKind.Text,
            data: textValue,
            displayData: textValue, // Let CSS handle overflow ellipsis
            allowOverlay: true,
            readonly: true,
            themeOverride: value === null ? {
              textLight: "var(--muted-foreground)",
            } : undefined,
          };
        }
      }
    },
    [data, columns, detectCellKind, formatDisplayValue]
  );

  // Get raw cell value for popup
  const getCellValue = useCallback(
    (cell: Item): unknown => {
      const [col, row] = cell;
      
      if (!data?.rows[row]) {
        return null;
      }
      
      return data.rows[row][col];
    },
    [data]
  );

  // Handle cell click
  const handleCellClicked = useCallback((cell: Item) => {
    const [col, row] = cell;
    console.log(`Query result cell clicked: [${col}, ${row}]`);
  }, []);
  
  // Calculate optimal column width based on content
  const calculateOptimalWidth = useCallback(
    (colIndex: number): number => {
      if (!columns[colIndex] || !data?.rows) return 150;
      
      const column = columns[colIndex];
      const headerWidth = column.name.length * 8 + 40; // Header text width
      
      // Sample first 100 rows to find max content width
      let maxContentWidth = headerWidth;
      const sampleSize = Math.min(100, data.rows.length);
      
      // Map to original column index for data access
      const originalColIndex = columnOrder.length > 0 ? columnOrder[colIndex] : colIndex;
      
      for (let i = 0; i < sampleSize; i++) {
        const value = data.rows[i][originalColIndex];
        const textLength = String(value || "").length;
        const contentWidth = textLength * 7 + 20; // Approximate char width
        maxContentWidth = Math.max(maxContentWidth, contentWidth);
      }
      
      // Cap at 500px max
      return Math.min(maxContentWidth, 500);
    },
    [columns, data?.rows, columnOrder]
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
  
  // Handle selection change
  const handleSelectionChange = useCallback((count: number) => {
    setSelectedRowCount(count);
  }, []);

  // Empty state
  if (!data || !data.rows || data.rows.length === 0) {
    return (
      <div className={cn("h-full flex flex-col", className)}>
        <DataGridEmptyState 
          title="No results"
          description="Execute a query to see results"
        />
      </div>
    );
  }

  return (
    <div className={cn("h-full flex flex-col", className)}>
      <div className="flex-1 overflow-hidden">
        <EnhancedGlideWrapper
          columns={columns}
          rows={data.rows.length}
          getCellContent={getCellContent}
          getCellValue={getCellValue}
          onCellClicked={handleCellClicked}
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
          onColumnMoved={handleColumnMoved}
          onSelectionChange={handleSelectionChange}
          className="h-full"
          freezeColumns={0}
          rowMarkers="none"
          headerHeight={28}
          rowHeight={28}
          isLoading={false}
        />
      </div>
      
      <DataGridStatusBar
        loadedRows={data.rows.length}
        selectedRows={selectedRowCount}
      />
    </div>
  );
});