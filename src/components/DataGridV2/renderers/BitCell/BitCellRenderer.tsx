import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { BitCellEditorWithProps } from "./BitCellEditor";
import { truncateTextMiddleToWidth } from "../../utils/textUtils";
import { type BitCustomCell } from "./types";
import {
  getCachedThemeValues,
  MONOSPACE_FONT_FAMILY,
} from "../../utils/renderCache";
import { isValidBinary, isValidBitLength } from "./utils";

// Pre-cached monospace font for bit strings
const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;

// Color for invalid bit strings
const INVALID_COLOR = "#ef4444";

const BitCellRenderer: CustomCellRenderer<BitCustomCell> = {
  isMatch: (cell: CustomCell): cell is BitCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return false;

    const kind = data.kind as string;
    return kind === "bit-cell" || kind === "varbit-cell";
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, length } = cell.data;

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
    } else {
      // Display as B'bits'
      text = `B'${value}'`;

      // Check validity
      const isValid = isValidBinary(value) && isValidBitLength(value, length);

      if (!isValid) {
        color = INVALID_COLOR;
      } else {
        color = cachedTheme.textDark;
      }
      ctx.font = MONO_FONT;
    }

    // Draw the text with left alignment
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding = cachedTheme.cellHorizontalPadding;

    const rightPadding = padding;
    const availableWidth = rect.width - padding - rightPadding;
    const displayText =
      availableWidth > 0
        ? truncateTextMiddleToWidth(text, availableWidth, {
            ctx,
            font: ctx.font,
          })
        : text;

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: BitCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default BitCellRenderer;

