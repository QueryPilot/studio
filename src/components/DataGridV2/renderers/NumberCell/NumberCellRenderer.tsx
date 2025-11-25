import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { truncateTextToWidth } from "../../utils/textUtils";
import { NumberCellEditorWithProps } from "./NumberCellEditor";
import { type NumberCustomCell } from "./types";
import { getCachedThemeValues } from "../../utils/renderCache";

const NumberCellRenderer: CustomCellRenderer<NumberCustomCell> = {
  isMatch: (cell: CustomCell): cell is NumberCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "number-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;
    const isNull = value == null;

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    ctx.fillStyle = isNull ? cachedTheme.nullTextColor : cachedTheme.textDark;
    ctx.font = isNull ? cachedTheme.italicFont : cachedTheme.baseFont;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const padding = cachedTheme.cellHorizontalPadding;
    const maxWidth = Math.max(0, rect.width - padding * 2);

    const displayText = isNull
      ? "NULL"
      : truncateTextToWidth(value, maxWidth, ctx.font);

    const x = rect.x + rect.width - padding;
    const centerY = rect.y + rect.height / 2;

    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: NumberCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default NumberCellRenderer;
