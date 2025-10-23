import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../types";
import { UuidCellEditorWithProps } from "./UuidCellEditor";
import { truncateTextMiddleToWidth } from "../utils/textUtils";

interface UuidCellData {
  kind: "uuid-cell";
  value: string | null;
  nullable?: boolean;
  isValid?: boolean;
}

export interface UuidCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: UuidCellData;
  copyData: string;
  readonly?: boolean;
}

// UUID validation regex (supports v1-v5)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUuid = (value: string): boolean => {
  return UUID_REGEX.test(value);
};

const UuidCellRenderer: CustomCellRenderer<UuidCustomCell> = {
  isMatch: (cell: CustomCell): cell is UuidCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "uuid-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isValid } = cell.data;
    const baseFont = `400 11px monospace`;

    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = "rgba(127,127,127,0.7)";
      const fontFamily =
        "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
      ctx.font = `italic ${theme.baseFontStyle} ${fontFamily}`;
    } else {
      text = value;

      // Color code based on validity
      if (isValid === false) {
        color = "#ef4444"; // red for invalid UUID
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

    const availableWidth = rect.width - padding * 2;
    const displayText =
      availableWidth > 0
        ? truncateTextMiddleToWidth(text, availableWidth, { ctx })
        : text;

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: () => {
    return {
      editor: UuidCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default UuidCellRenderer;
