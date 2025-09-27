import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { CellValue } from "@/types/cellValue";
import type { GridColumnV2 } from "../types";

/**
 * Build a clean GridCell for V2 without custom cell baggage
 */
export function buildGridCellV2(opts: {
  value: CellValue | null | undefined;
  column: GridColumnV2;
}): GridCell {
  const { value, column } = opts;

  // Handle null/undefined
  if (!value || value.value == null) {
    // Check if this should be a number column based on type
    const dbType = column.meta?.db_type?.toLowerCase() || "";
    const isNumericColumn = dbType.includes("int") ||
      dbType.includes("numeric") ||
      dbType.includes("decimal") ||
      dbType.includes("float") ||
      dbType.includes("double") ||
      dbType.includes("real") ||
      dbType.includes("money");

    return {
      kind: GridCellKind.Text,
      data: "NULL",
      displayData: "NULL",
      allowOverlay: false,
      readonly: false,
      contentAlign: isNumericColumn ? "right" : "left",
      themeOverride: {
        textDark: "rgba(127,127,127,0.7)",
        baseFontStyle: "italic 12px",
      },
    };
  }

  const rawValue = value.value;
  const dbType = column.meta?.db_type?.toLowerCase() || "";

  // Boolean cells
  if (dbType.includes("bool") || typeof rawValue === "boolean") {
    return {
      kind: GridCellKind.Boolean,
      data: Boolean(rawValue),
      allowOverlay: false,
      readonly: false,
    };
  }

  // Money cells - format with currency symbol
  if (dbType.includes("money")) {
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    return {
      kind: GridCellKind.Text,
      data: String(rawValue),
      displayData: isNaN(num) ? String(rawValue) : num.toFixed(2),
      allowOverlay: false,
      readonly: false,
      contentAlign: "right",
    };
  }

  // Number cells
  if (
    dbType.includes("int") ||
    dbType.includes("numeric") ||
    dbType.includes("decimal") ||
    dbType.includes("float") ||
    dbType.includes("double") ||
    dbType.includes("real") ||
    typeof rawValue === "number"
  ) {
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    return {
      kind: GridCellKind.Number,
      data: isNaN(num) ? 0 : num,
      displayData: String(rawValue),
      allowOverlay: false,
      readonly: false,
      contentAlign: "right",
    };
  }

  // JSON/Array cells - render as formatted text
  if (dbType.includes("json") || dbType.includes("array") || Array.isArray(rawValue)) {
    let text = "";
    try {
      text = typeof rawValue === "string"
        ? rawValue
        : JSON.stringify(rawValue, null, 2);
    } catch {
      text = String(rawValue);
    }
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text.length > 50 ? text.substring(0, 47) + "..." : text,
      allowOverlay: true,
      readonly: false,
      themeOverride: {
        baseFontStyle: "400 11px monospace",
      },
    };
  }

  // Date/Time cells - render as text with special formatting
  if (dbType.includes("date") || dbType.includes("time")) {
    const text = String(rawValue);
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: false,
      readonly: false,
      contentAlign: "left",
    };
  }

  // UUID cells - render as monospace text
  if (dbType.includes("uuid")) {
    const text = String(rawValue);
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: false,
      readonly: false,
      themeOverride: {
        baseFontStyle: "400 11px monospace",
      },
    };
  }

  // Default: Text cell
  const text = String(rawValue);
  return {
    kind: GridCellKind.Text,
    data: text,
    displayData: text, // Will be truncated by the adapter
    allowOverlay: true,
    readonly: false,
  };
}