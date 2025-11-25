import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { TextSingleLineCellEditorWithProps } from "./TextSingleLineCellEditor";
import { truncateTextToWidth } from "../../utils/textUtils";
import { type TextSingleLineCustomCell } from "./types";
import { getCachedThemeValues } from "../../utils/renderCache";

const TextSingleLineCellRenderer: CustomCellRenderer<TextSingleLineCustomCell> =
  {
    isMatch: (cell: CustomCell): cell is TextSingleLineCustomCell => {
      const data = cell.data as Record<string, unknown> | null;
      return Boolean(
        data && typeof data === "object" && data.kind === "text-single-cell",
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
        text = value;
        color = cachedTheme.textDark;
        ctx.font = cachedTheme.baseFont;
      }

      // Draw the text with left alignment
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const padding = cachedTheme.cellHorizontalPadding;
      const maxWidth = Math.max(0, rect.width - padding * 2);
      const displayText =
        value == null ? "NULL" : truncateTextToWidth(text, maxWidth, ctx.font);

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
        editor: TextSingleLineCellEditorWithProps,
        disablePadding: true,
        disableStyling: false,
      };
    },
  };

export default TextSingleLineCellRenderer;
