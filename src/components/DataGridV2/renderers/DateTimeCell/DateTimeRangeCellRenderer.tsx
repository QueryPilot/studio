import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { truncateTextToWidth } from "../../utils/textUtils";

import { DateTimeRangeCellEditorWithProps } from "./DateTimeRangeCellEditor";
import { buildText } from "./utils";
import { type TstzRangeCustomCell } from "./types";

const DateTimeRangeCellRenderer: CustomCellRenderer<TstzRangeCustomCell> = {
  isMatch: (cell: CustomCell): cell is TstzRangeCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "tstzrange-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const text = buildText(cell.data.value);
    const isEmpty = text.length === 0;

    // Match NULL styling used by default text cells and ensure full font family is set
    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `${theme.baseFontStyle} ${fontFamily}`;
    ctx.fillStyle = isEmpty ? "rgba(127,127,127,0.7)" : theme.textDark;
    ctx.font = isEmpty ? `italic ${baseFont}` : baseFont; // only NULL italic
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padding =
      typeof theme.cellHorizontalPadding === "number"
        ? theme.cellHorizontalPadding
        : 8;
    const maxWidth = Math.max(0, rect.width - padding * 2);
    const displayText = isEmpty
      ? "NULL"
      : truncateTextToWidth(text, maxWidth, ctx.font);
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
      editor: DateTimeRangeCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default DateTimeRangeCellRenderer;
