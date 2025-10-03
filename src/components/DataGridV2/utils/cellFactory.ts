import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { CellValue } from "@/types/cellValue";
import type { GridColumnV2 } from "../types";

// Cache for memoizing cell creation
const cellCache = new WeakMap<CellValue, Map<string, GridCell>>();

/**
 * Helper to cache cell results
 */
const cacheAndReturn = (
  value: CellValue | null | undefined,
  column: GridColumnV2,
  result: GridCell,
): GridCell => {
  if (value && typeof value === "object") {
    if (!cellCache.has(value)) {
      cellCache.set(value, new Map());
    }
    const cache = cellCache.get(value);
    if (cache) {
      cache.set(column.id, result);
    }
  }
  return result;
};

/**
 * Build a clean GridCell for V2 without custom cell baggage
 */
export function buildGridCellV2(opts: {
  value: CellValue | null | undefined;
  column: GridColumnV2;
}): GridCell {
  const { value, column } = opts;

  // Try to get from cache first
  if (value && typeof value === "object") {
    const columnCache = cellCache.get(value);
    if (columnCache?.has(column.id)) {
      const cached = columnCache.get(column.id);
      if (cached) return cached;
    }
  }

  const rawValue = value?.value;
  const dbType = column.meta?.db_type.toLowerCase() || "";

  // Enum cells - use custom cell to support enum values
  if (column.meta?.enum_values && column.meta.enum_values.length > 0) {
    const enumValue =
      rawValue === null || rawValue === undefined ? null : String(rawValue);

    return cacheAndReturn(value, column, {
      kind: GridCellKind.Custom,
      data: {
        kind: "enum-cell",
        value: enumValue,
        allowedValues: column.meta.enum_values,
        nullable: Boolean(
          (column.meta as { nullable?: boolean } | null)?.nullable,
        ),
      },
      copyData: enumValue ?? "NULL",
      allowOverlay: true,
      readonly: false,
      contentAlign: "left",
    });
  }

  // Boolean cells - use custom cell to support null values (including NULL)
  if (dbType.includes("bool") || typeof rawValue === "boolean") {
    let boolValue: boolean | null = null;

    if (rawValue === null || rawValue === undefined) {
      boolValue = null;
    } else if (typeof rawValue === "boolean") {
      boolValue = rawValue;
    } else if (typeof rawValue === "string") {
      // Handle string representations of booleans
      const lowerValue = rawValue.toLowerCase();
      if (lowerValue === "true" || lowerValue === "t" || lowerValue === "1") {
        boolValue = true;
      } else if (
        lowerValue === "false" ||
        lowerValue === "f" ||
        lowerValue === "0"
      ) {
        boolValue = false;
      } else {
        boolValue = null;
      }
    } else if (typeof rawValue === "number") {
      boolValue = rawValue !== 0;
    }

    return cacheAndReturn(value, column, {
      kind: GridCellKind.Custom,
      data: {
        kind: "boolean-cell",
        value: boolValue,
      },
      copyData: boolValue === null ? "NULL" : String(boolValue),
      allowOverlay: true,
      readonly: false,
      contentAlign: "center",
    });
  }

  // Money cells - format with currency symbol
  if (dbType.includes("money")) {
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    return cacheAndReturn(value, column, {
      kind: GridCellKind.Text,
      data: String(rawValue),
      displayData: isNaN(num) ? String(rawValue) : num.toFixed(2),
      allowOverlay: false,
      readonly: false,
      contentAlign: "right",
    });
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
    return cacheAndReturn(value, column, {
      kind: GridCellKind.Number,
      data: isNaN(num) ? 0 : num,
      displayData: String(rawValue),
      allowOverlay: false,
      readonly: false,
      contentAlign: "right",
    });
  }

  // JSON/Array cells - render as formatted text
  if (
    dbType.includes("json") ||
    dbType.includes("array") ||
    Array.isArray(rawValue)
  ) {
    let text = "";
    try {
      text =
        typeof rawValue === "string"
          ? rawValue
          : JSON.stringify(rawValue, null, 2);
    } catch {
      text = String(rawValue);
    }
    return cacheAndReturn(value, column, {
      kind: GridCellKind.Text,
      data: text,
      displayData: text.length > 50 ? text.substring(0, 47) + "..." : text,
      allowOverlay: true,
      readonly: false,
      themeOverride: {
        baseFontStyle: "400 11px monospace",
      },
    });
  }

  // Date/Time cells - provide custom editor with calendar popover
  if (dbType.includes("timestamptz") || dbType.includes("timestamp")) {
    const v = rawValue == null ? null : String(rawValue);
    return cacheAndReturn(value, column, {
      kind: GridCellKind.Custom,
      data: {
        kind: "datetime-cell",
        value: v,
        nullable: Boolean(column.meta?.nullable),
      },
      copyData: v ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  if (dbType.includes("date")) {
    const v = rawValue == null ? null : String(rawValue);
    return cacheAndReturn(value, column, {
      kind: GridCellKind.Custom,
      data: {
        kind: "date-cell",
        value: v,
        nullable: Boolean(column.meta?.nullable),
      },
      copyData: v ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  if (dbType.includes("time")) {
    const v = rawValue == null ? null : String(rawValue);
    return cacheAndReturn(value, column, {
      kind: GridCellKind.Custom,
      data: {
        kind: "time-cell",
        value: v,
        nullable: Boolean(column.meta?.nullable),
      },
      copyData: v ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  // UUID cells - render as monospace text
  if (dbType.includes("uuid")) {
    const text = String(rawValue);
    return cacheAndReturn(value, column, {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: false,
      readonly: false,
      themeOverride: {
        baseFontStyle: "400 11px monospace",
      },
    });
  }

  // Handle NULL values for non-boolean columns
  if (rawValue === null || rawValue === undefined) {
    const isNumericColumn =
      dbType.includes("int") ||
      dbType.includes("numeric") ||
      dbType.includes("decimal") ||
      dbType.includes("float") ||
      dbType.includes("double") ||
      dbType.includes("real") ||
      dbType.includes("money");

    return cacheAndReturn(value, column, {
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
    });
  }

  // Default: Text cell
  const text = String(rawValue);
  return cacheAndReturn(value, column, {
    kind: GridCellKind.Text,
    data: text,
    displayData: text, // Will be truncated by the adapter
    allowOverlay: true,
    readonly: false,
  });
}
