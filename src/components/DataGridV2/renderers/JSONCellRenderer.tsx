import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../types";
import { JsonCellEditorWithProps } from "./JSONCellEditor";
import { truncateTextToWidth } from "../utils/textUtils";

interface JsonCellData {
  kind: "json-cell";
  value: string | null;
  nullable?: boolean;
  isValid?: boolean;
}

export interface JsonCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: JsonCellData;
  copyData: string;
  readonly?: boolean;
}

const JSONCellRenderer: CustomCellRenderer<JsonCustomCell> = {
  isMatch: (cell: CustomCell): cell is JsonCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "json-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isValid } = cell.data;
    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `400 11px monospace`;

    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = "rgba(127,127,127,0.7)";
      ctx.font = `italic ${theme.baseFontStyle} ${fontFamily}`;
    } else {
      // Show minified/compact JSON
      try {
        const parsed = JSON.parse(value);
        const minified = JSON.stringify(parsed);
        text = minified;
      } catch {
        // If parsing fails, show raw value
        text = value;
      }

      // Color code based on validity
      if (isValid === false) {
        color = "#ef4444"; // red for invalid JSON
      } else {
        color = theme.textDark;
      }
      ctx.font = baseFont;
    }

    // Draw the text with left alignment
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding =
      typeof theme.cellHorizontalPadding === "number"
        ? theme.cellHorizontalPadding
        : 8;
    const maxWidth = Math.max(0, rect.width - padding * 2);
    const displayText =
      value == null ? "NULL" : truncateTextToWidth(text, maxWidth, ctx.font);

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: () => {
    return {
      editor: JsonCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default JSONCellRenderer;
