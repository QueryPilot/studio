import { truncateTextToWidth } from "../utils/textUtils";

export type DateTimeKind = "date-cell" | "time-cell" | "datetime-cell";

interface DateTimeCellData {
  kind: DateTimeKind;
  value: string | null;
  nullable?: boolean;
  format?: string; // display/parse hint
}
import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../types";
import { DateTimeCellEditorWithProps } from "./DateTimeCellEditor";
export interface DateTimeCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: DateTimeCellData;
  copyData: string;
  readonly?: boolean;
}

const formatForDisplay = (
  kind: DateTimeKind,
  value: string | number | null,
): string => {
  if (value == null) return "NULL";

  // Convert to string if it's a number (raw CellValue from fast path)
  const strValue = typeof value === "number" ? String(value) : value;

  // Keep as-is for now; do not localize to avoid surprises
  if (kind === "date-cell") {
    // If a full ISO string is present, slice the date part
    const match = strValue.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? strValue;
  }
  if (kind === "time-cell") {
    // Extract time portion if included
    const timeMatch = strValue.match(
      /(\d{2}:\d{2}(:\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
    );
    return timeMatch?.[1] ?? strValue;
  }
  return strValue;
};

const DateTimeCellRenderer: CustomCellRenderer<DateTimeCustomCell> = {
  isMatch: (cell: CustomCell): cell is DateTimeCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return false;
    return (
      data.kind === "date-cell" ||
      data.kind === "time-cell" ||
      data.kind === "datetime-cell"
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, kind } = cell.data;

    const text = formatForDisplay(kind, value);
    const isNull = value == null;

    // Match NULL styling used by default text cells and ensure full font family is set
    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `${theme.baseFontStyle} ${fontFamily}`;
    ctx.fillStyle = isNull ? "rgba(127,127,127,0.7)" : theme.textDark;
    ctx.font = isNull ? `italic ${baseFont}` : baseFont; // only NULL italic
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padding =
      typeof theme.cellHorizontalPadding === "number"
        ? theme.cellHorizontalPadding
        : 8;
    const maxWidth = Math.max(0, rect.width - padding * 2);
    const displayText = isNull
      ? "NULL"
      : truncateTextToWidth(text, maxWidth, ctx.font);
    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: () => {
    return {
      editor: DateTimeCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default DateTimeCellRenderer;
