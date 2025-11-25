import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { truncateTextToWidth } from "../../utils/textUtils";

import { LazyDateTimeRangeCellEditorWithProps } from "../hooks/lazyEditors";
import { buildText } from "./utils";
import { type TstzRangeCustomCell } from "./types";
import { getCachedThemeValues } from "../../utils/renderCache";

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

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);
    
    ctx.fillStyle = isEmpty ? cachedTheme.nullTextColor : cachedTheme.textDark;
    ctx.font = isEmpty ? cachedTheme.italicFont : cachedTheme.baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding = cachedTheme.cellHorizontalPadding;
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
      editor: LazyDateTimeRangeCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default DateTimeRangeCellRenderer;
