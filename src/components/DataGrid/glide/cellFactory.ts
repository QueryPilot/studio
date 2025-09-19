import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { DataGridColumn } from "./types";
import { cellValueToGridCell, getCellRendererFromColumnMeta } from "./types";
import type { ColumnMeta as TableColumnMeta } from "@/types/database";
import type { CellValue } from "@/types/cellValue";

/**
 * Build a GridCell for the table data grid using metadata to select custom cells.
 */
export function buildTableCell(opts: {
  value:
    | CellValue
    | null
    | undefined
    | string
    | number
    | boolean
    | Date
    | Record<string, unknown>
    | unknown[];
  column: DataGridColumn;
  meta?: TableColumnMeta;
}): GridCell {
  const { value, column, meta } = opts;

  if (meta) {
    const kind = getCellRendererFromColumnMeta(meta);
    if (kind) {
      let raw: unknown;
      if (value && typeof value === "object" && "value" in (value as object)) {
        raw = (value as CellValue).value;
      } else {
        raw = value;
      }
      const copy =
        typeof raw === "object" && raw !== null
          ? JSON.stringify(raw)
          : String(raw);
      return {
        kind: GridCellKind.Custom,
        allowOverlay: false,
        copyData: copy,
        data: {
          kind,
          value: raw,
          metadata: meta,
        },
        readonly: true,
      } as unknown as GridCell;
    }
  }

  // Fallback to default conversion
  return cellValueToGridCell(
    value as CellValue | null | undefined,
    column.type,
    "width" in column ? column.width : undefined,
  );
}

/**
 * Build a GridCell for ad-hoc query results without metadata.
 */
export function buildQueryCell(value: unknown): GridCell {
  if (value === null) {
    return {
      kind: GridCellKind.Text,
      data: "NULL",
      displayData: "NULL",
      allowOverlay: false,
      readonly: true,
      themeOverride: {
        textDark: "rgba(127,127,127,0.7)",
        baseFontStyle: "italic 12px",
      },
      contentAlign: "left",
    };
  }
  if (value === undefined) {
    return {
      kind: GridCellKind.Text,
      data: "",
      displayData: "",
      allowOverlay: false,
      readonly: true,
      contentAlign: "left",
    };
  }

  if (typeof value === "boolean") {
    return {
      kind: GridCellKind.Boolean,
      data: value,
      allowOverlay: false,
      readonly: true,
    };
  }

  if (typeof value === "number" && !isNaN(value)) {
    return {
      kind: GridCellKind.Number,
      data: value,
      displayData: String(value),
      allowOverlay: false,
      readonly: true,
      contentAlign: "right",
    };
  }

  // Dates -> ISO
  if (value instanceof Date) {
    const text = value.toISOString();
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: false,
      readonly: true,
    };
  }

  // Objects -> detect CellValue wrapper with null inner value first
  if (typeof value === "object") {
    const maybeCellValue = value as
      | Partial<CellValue>
      | Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(maybeCellValue, "value") &&
      (maybeCellValue as Partial<CellValue>).value === null
    ) {
      return {
        kind: GridCellKind.Text,
        data: "NULL",
        displayData: "NULL",
        allowOverlay: false,
        readonly: true,
        themeOverride: {
          textDark: "rgba(127,127,127,0.7)",
          baseFontStyle: "italic 12px",
        },
        contentAlign: "left",
      };
    }
    let text = "[object]";
    try {
      text = JSON.stringify(value as Record<string, unknown>);
    } catch {
      text = "[object]";
    }
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: false,
      readonly: true,
    };
  }

  // Default text
  let text: string;
  try {
    text =
      typeof value === "string"
        ? value
        : JSON.stringify(value as Record<string, unknown>);
  } catch {
    text = "[object]";
  }
  return {
    kind: GridCellKind.Text,
    data: text,
    displayData: text,
    allowOverlay: false,
    readonly: true,
  };
}
