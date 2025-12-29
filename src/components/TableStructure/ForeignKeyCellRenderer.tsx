import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { ForeignKeyCellEditorWithProps } from "./ForeignKeyCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import { type ForeignKeyCustomCell } from "./types";
import { getCachedThemeValues } from "@/components/DataGrid/utils/renderCache";

const ForeignKeyCellRenderer: CustomCellRenderer<ForeignKeyCustomCell> = {
  isMatch: (cell: CustomCell): cell is ForeignKeyCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "foreign-key-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    const cachedTheme = getCachedThemeValues(theme);

    const text = value ?? "";
    const color = text ? cachedTheme.textDark : cachedTheme.nullTextColor;

    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = cachedTheme.baseFont;

    const padding = cachedTheme.cellHorizontalPadding;
    const maxWidth = Math.max(0, rect.width - padding * 2);
    const displayText = truncateTextToWidth(text, maxWidth, ctx.font);

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
      editor: ForeignKeyCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default ForeignKeyCellRenderer;
