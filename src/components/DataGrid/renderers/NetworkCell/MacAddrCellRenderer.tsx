import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { MacAddrCellEditorWithProps } from "./MacAddrCellEditor";
import { truncateTextMiddleToWidth } from "../../utils/textUtils";
import { type MacAddrCustomCell } from "./types";
import {
  getCachedThemeValues,
  MONOSPACE_FONT_FAMILY,
} from "../../utils/renderCache";
import { isValidMacAddr } from "./utils";

// Pre-cached monospace font for MAC addresses
const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;

// Color for invalid addresses
const INVALID_COLOR = "#ef4444";

const MacAddrCellRenderer: CustomCellRenderer<MacAddrCustomCell> = {
  isMatch: (cell: CustomCell): cell is MacAddrCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "macaddr-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
    } else {
      // Display in uppercase with colons
      text = value.toUpperCase();
      const isValid = isValidMacAddr(value);

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
      editor: MacAddrCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default MacAddrCellRenderer;

