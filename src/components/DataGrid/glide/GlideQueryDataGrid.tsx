import { memo, useCallback, useMemo, useState } from "react";
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
  
  // Convert columns to Glide format
  const columns = useMemo<DataGridColumn[]>(() => {
    if (!data?.columns || data.columns.length === 0) return [];
    
    return data.columns.map((col, index) => {
      const colId = col || `col_${index}`;
      const baseWidth = Math.max(80, Math.min(200, col.length * 7 + 30));
      return {
        id: colId,
        name: col,
        title: col,
        width: columnWidths[colId] || baseWidth,
        grow: 0, // Allow manual resizing
      };
    });
  }, [data?.columns, columnWidths]);

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

  // Helper to truncate text based on column width
  const truncateText = useCallback((text: string, columnWidth: number): string => {
    const charWidth = 7;
    const padding = 16; // Balanced padding
    const ellipsisWidth = 21;
    
    const availableWidth = columnWidth - padding;
    const maxChars = Math.floor((availableWidth - ellipsisWidth) / charWidth);
    
    if (text.length <= maxChars || maxChars <= 0) {
      return text;
    }
    
    // Trim whitespace before adding ellipsis
    return text.substring(0, maxChars).trimEnd() + "...";
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
      const value = data.rows[row][col];
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
          const displayValue = truncateText(textValue, column.width);
          
          return {
            kind: GridCellKind.Text,
            data: textValue,
            displayData: displayValue,
            allowOverlay: true,
            readonly: true,
            themeOverride: value === null ? {
              textLight: "var(--muted-foreground)",
            } : undefined,
          };
        }
      }
    },
    [data, columns, detectCellKind, formatDisplayValue, truncateText]
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
          className="h-full"
          height={undefined} // Use parent height
          showSearch={false}
          freezeColumns={0}
          smoothScrollX={true}
          smoothScrollY={true}
          rowMarkers="none"
          headerHeight={28}
          rowHeight={28}
          isLoading={false}
        />
      </div>
      
      <DataGridStatusBar
        loadedRows={data.rows.length}
      />
    </div>
  );
});