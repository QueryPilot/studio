import {
  type GridCell,
  type GridColumn,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import type { CellValue } from "@/types/cellValue";

export interface GlideDataGridProps {
  connectionId: string;
  database: string;
  className?: string;
}

export interface GlideTableDataGridProps extends GlideDataGridProps {
  table: string;
  schema?: string;
}

export interface GlideQueryDataGridProps extends GlideDataGridProps {
  query: string;
  data?: {
    columns: string[];
    rows: unknown[][];
  };
}

export type DataGridColumn = GridColumn & {
  id: string;
  name: string;
  type?: string;
};

export interface DataGridState {
  columns: DataGridColumn[];
  rows: any[];
  isLoading: boolean;
  error: Error | null;
  totalRows: number;
  loadedRows: number;
}

// Helper to convert database types to Grid cell kinds
export const getGridCellKind = (type?: string): GridCellKind => {
  if (!type) return GridCellKind.Text;

  const lowerType = type.toLowerCase();

  if (
    lowerType.includes("int") ||
    lowerType.includes("numeric") ||
    lowerType.includes("decimal") ||
    lowerType.includes("float") ||
    lowerType.includes("double") ||
    lowerType.includes("real")
  ) {
    return GridCellKind.Number;
  }

  if (lowerType.includes("bool")) {
    return GridCellKind.Boolean;
  }

  if (lowerType.includes("date") || lowerType.includes("time")) {
    return GridCellKind.Text;
  }

  if (lowerType.includes("json") || lowerType.includes("array")) {
    return GridCellKind.Text;
  }

  return GridCellKind.Text;
};

// Helper to truncate text based on column width
const truncateText = (text: string, columnWidth: number): string => {
  // Approximate character width in pixels (for 12px font)
  const charWidth = 7;
  const padding = 16; // Balanced padding for borders
  const ellipsisWidth = 21; // Width for "..."

  const availableWidth = columnWidth - padding;
  const maxChars = Math.floor((availableWidth - ellipsisWidth) / charWidth);

  if (text.length <= maxChars || maxChars <= 0) {
    return text;
  }

  // Trim whitespace before adding ellipsis
  return text.substring(0, maxChars).trimEnd() + "...";
};

// Convert CellValue to GridCell
export const cellValueToGridCell = (
  value: CellValue | undefined | null,
  columnType?: string,
  columnWidth?: number,
): GridCell => {
  const kind = getGridCellKind(columnType);

  if (value === null || value === undefined) {
    return {
      kind: GridCellKind.Text,
      data: "NULL",
      displayData: "NULL",
      allowOverlay: false,
      readonly: true,
      contentAlign: "left",
    };
  }

  // Debug log the value structure
  if (typeof value === 'object' && value !== null && 'display_value' in value) {
    console.log("CellValue structure:", value);
  }
  
  // Handle CellValue structure from types/cellValue.ts
  let displayText = "";
  
  if (typeof value === 'object' && value !== null) {
    // Check for frontend CellValue structure (has 'value' property)
    if ('value' in value) {
      displayText = String(value.value);
    } else if ('display_value' in value) {
      // Fallback for backend CellValue structure
      displayText = String(value.display_value);
    } else {
      // If it's an object without expected properties, convert to string
      displayText = JSON.stringify(value);
    }
  } else {
    // For primitive values or other types
    displayText = String(value || "");
  }

  switch (kind) {
    case GridCellKind.Number:
      // Try to extract numeric value from various formats
      let numericValue = 0;
      if (typeof value === 'number') {
        numericValue = value;
      } else if (value?.value !== undefined) {
        numericValue = Number(value.value);
      } else if (displayText) {
        const parsed = parseFloat(displayText);
        numericValue = isNaN(parsed) ? 0 : parsed;
      }
      
      return {
        kind: GridCellKind.Number,
        data: numericValue,
        displayData: displayText,
        allowOverlay: false,
        readonly: true,
        contentAlign: "right", // Align numbers to the right
      };

    case GridCellKind.Boolean:
      // Handle boolean values
      let boolValue = false;
      if (typeof value === 'boolean') {
        boolValue = value;
      } else if (value?.value !== undefined) {
        boolValue = Boolean(value.value);
      } else if (displayText) {
        boolValue = displayText.toLowerCase() === 'true' || displayText === '1';
      }
      
      return {
        kind: GridCellKind.Boolean,
        data: boolValue,
        allowOverlay: false,
        readonly: true,
      };

    default: {
      let displayValue = displayText;

      // Apply manual truncation if column width is provided
      if (columnWidth) {
        displayValue = truncateText(displayValue, columnWidth);
      }

      return {
        kind: GridCellKind.Text,
        data: displayText,
        displayData: displayValue,
        allowOverlay: true, // Allow overlay for full text view
        readonly: true,
        contentAlign: "left",
      };
    }
  }
};
