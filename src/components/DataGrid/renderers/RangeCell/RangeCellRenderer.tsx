import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { RangeCellEditorWithProps } from "./RangeCellEditor";
import { truncateTextMiddleToWidth } from "../../utils/textUtils";
import { type RangeCustomCell } from "./types";
import {
  getCachedThemeValues,
  MONOSPACE_FONT_FAMILY,
} from "../../utils/renderCache";
import { getRangeDisplayText } from "./utils";

// Pre-cached monospace font for ranges
const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;

const RangeCellRenderer: CustomCellRenderer<RangeCustomCell> = {
  isMatch: (cell: CustomCell): cell is RangeCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return false;

    const kind = data.kind as string;
    return (
      kind === "int4range-cell" ||
      kind === "int8range-cell" ||
      kind === "numrange-cell" ||
      kind === "daterange-cell" ||
      kind === "tsrange-cell"
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
      text = getRangeDisplayText(value);
      color = cachedTheme.textDark;
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
      editor: RangeCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default RangeCellRenderer;

