import { logger } from "@/lib/logger";
import {
  type GridCell,
  type GridColumn,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import type { CellValue } from "@/types/cellValue";
import type { ColumnMeta as TableColumnMeta } from "@/types/database";

// Create a singleton canvas context for text measurement
let measurementCanvas: HTMLCanvasElement | null = null;
let measurementCtx: CanvasRenderingContext2D | null = null;

const getMeasurementContext = (): CanvasRenderingContext2D | null => {
  if (typeof document === "undefined") {
    return null;
  }

  if (!measurementCtx) {
    try {
      measurementCanvas = document.createElement("canvas");
      measurementCtx = measurementCanvas.getContext("2d");
    } catch (e) {
      logger.warn("Failed to create canvas context for text measurement:", e);
      return null;
    }
  }
  return measurementCtx;
};

// Measure text width and truncate with ellipsis if needed
export const truncateTextToWidth = (
  text: string,
  maxWidth: number,
  font: string = "400 12px Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif",
): string => {
  if (!text) return text;

  const ctx = getMeasurementContext();
  if (!ctx) {
    // Fallback to character-based truncation if canvas not available
    const avgCharWidth = 7;
    const maxChars = Math.floor(maxWidth / avgCharWidth);
    if (text.length > maxChars) {
      return text.substring(0, maxChars - 3) + "...";
    }
    return text;
  }

  ctx.font = font;

  const ellipsis = "...";
  const textWidth = ctx.measureText(text).width;

  if (textWidth <= maxWidth) {
    return text;
  }

  // Binary search for optimal truncation point
  let left = 0;
  let right = text.length;
  let truncated = text;

  while (left < right) {
    const mid = Math.floor((left + right + 1) / 2);
    truncated = text.substring(0, mid);
    const truncatedWidth = ctx.measureText(truncated + ellipsis).width;

    if (truncatedWidth <= maxWidth) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }

  return text.substring(0, left) + ellipsis;
};

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
    columnMeta?: TableColumnMeta[];
  };
}

export type DataGridColumn = GridColumn & {
  id: string;
  name: string;
  type?: string;
  // Original database metadata for this column (db_type, enum_values, is_fk, is_json, nullable, etc.)
  meta?: unknown;
};

export interface DataGridState {
  columns: DataGridColumn[];
  rows: unknown[];
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

// Helper to check if column should have full width by default
export const shouldUseFullWidth = (type?: string): boolean => {
  if (!type) return false;

  const lowerType = type.toLowerCase();

  // Use full width for numbers, dates, times, and timestamps
  return (
    lowerType.includes("int") ||
    lowerType.includes("numeric") ||
    lowerType.includes("decimal") ||
    lowerType.includes("float") ||
    lowerType.includes("double") ||
    lowerType.includes("real") ||
    lowerType.includes("date") ||
    lowerType.includes("time") ||
    lowerType.includes("timestamp") ||
    lowerType.includes("timestamptz")
  );
};

// Determine custom renderer type string from column metadata
export const getCellRendererFromColumnMeta = (
  meta: TableColumnMeta,
): string | undefined => {
  const dbType: string | undefined = meta.db_type;

  if (Array.isArray(meta.enum_values) && meta.enum_values.length > 0) {
    return "enum-cell";
  }
  if (meta.is_fk) return "lookup-cell";
  if (meta.is_json) return "json-cell";

  const t = (dbType || "").toLowerCase();
  if (t.includes("bool")) return "boolean-cell";
  if (t.includes("money")) return "money-cell";
  if (t.includes("uuid")) return "uuid-cell";
  if (t.includes("array") || t.endsWith("[]")) return "array-cell";
  if (t.includes("bytea") || t.includes("blob") || t.includes("binary"))
    return "binary-cell";
  if (t.includes("timestamptz") || t.includes("timestamp"))
    return "datetime-cell";
  if (t.includes("time") && !t.includes("date")) return "time-cell";
  if (t.includes("date")) return "date-cell";
  if (
    t.includes("int") ||
    t.includes("numeric") ||
    t.includes("decimal") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("real")
  )
    return "number-cell";

  return undefined;
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
      themeOverride: {
        textDark: "rgba(127,127,127,0.7)",
        baseFontStyle: "italic 12px",
      },
    };
  }

  // Debug log the value structure
  // if (typeof value === "object" && "display_value" in value) {
  //   logger.info("CellValue structure:", value);
  // }

  // Handle CellValue structure from types/cellValue.ts
  let displayText = "";

  if (typeof value === "object") {
    // Check for frontend CellValue structure (has 'value' property)
    if ("value" in value) {
      const inner = (value as { value: unknown }).value;
      if (inner == null) {
        return {
          kind: GridCellKind.Text,
          data: "NULL",
          displayData: "NULL",
          allowOverlay: false,
          readonly: true,
          contentAlign: "left",
          themeOverride: {
            textDark: "rgba(127,127,127,0.7)",
            baseFontStyle: "italic 12px",
          },
        };
      }
      if (typeof inner === "object") {
        try {
          displayText = JSON.stringify(inner as Record<string, unknown>);
        } catch {
          displayText = "[object]";
        }
      } else {
        if (typeof inner === "object") {
          displayText = JSON.stringify(inner);
        } else if (
          typeof inner === "string" ||
          typeof inner === "number" ||
          typeof inner === "boolean"
        ) {
          displayText = String(inner);
        } else {
          displayText = "[Unknown]";
        }
      }
    } else {
      // If it's an object without expected properties, convert to string
      try {
        displayText = JSON.stringify(value as Record<string, unknown>);
      } catch {
        displayText = "[object]";
      }
    }
  } else {
    // For primitive values or other types
    displayText = String(value);
  }

  switch (kind) {
    case GridCellKind.Number: {
      // Try to extract numeric value from various formats
      let numericValue = 0;
      if (typeof value === "number") {
        numericValue = value;
      } else if (typeof value === "bigint") {
        numericValue = Number(value);
        displayText = (value as bigint).toString();
      } else if (typeof value === "object" && "value" in value) {
        numericValue = Number(value.value);
        if (typeof value.value === "bigint") {
          displayText = value.value.toString();
          numericValue = Number(value.value);
        }
      } else if (displayText) {
        const parsed = parseFloat(displayText);
        numericValue = isNaN(parsed) ? 0 : parsed;
      }

      return {
        kind: GridCellKind.Number,
        data: numericValue,
        displayData: displayText, // Full width for numbers - no truncation
        allowOverlay: false,
        readonly: true,
        contentAlign: "right", // Align numbers to the right
      };
    }

    case GridCellKind.Boolean: {
      // Handle boolean values
      let boolValue = false;
      if (typeof value === "boolean") {
        boolValue = value;
      } else if (typeof value === "object" && "value" in value) {
        boolValue = Boolean(value.value);
      } else if (displayText) {
        boolValue = displayText.toLowerCase() === "true" || displayText === "1";
      }

      return {
        kind: GridCellKind.Boolean,
        data: boolValue,
        allowOverlay: false,
        readonly: true,
      };
    }

    default: {
      // Dynamic truncation based on column width (always apply)
      let truncatedText = displayText;

      if (columnWidth && columnWidth > 0) {
        // Account for minimal padding (8px total for left and right)
        const availableWidth = columnWidth - 8;
        truncatedText = truncateTextToWidth(displayText, availableWidth);
      }

      return {
        kind: GridCellKind.Text,
        data: displayText, // Full text for copy/overlay
        displayData: truncatedText, // Truncated text for display
        allowOverlay: true, // Allow overlay for full text view
        readonly: true,
        contentAlign: "left",
        allowWrapping: false,
      };
    }
  }
};
