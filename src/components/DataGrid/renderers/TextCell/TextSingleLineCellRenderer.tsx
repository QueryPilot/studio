import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { TextMultiLineCellEditorWithProps } from "./TextMultiLineCellEditor";
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
      const { value, dbType } = cell.data;
      
      // Use cached theme values
      const cachedTheme = getCachedThemeValues(theme);

      let text: string;
      let color: string;

      if (value == null) {
        if (dbType === "document_null") {
          text = "null";
          color = cachedTheme.textMedium;
          ctx.font = cachedTheme.italicFont;
        } else {
          text = "NULL";
          color = cachedTheme.nullTextColor;
          ctx.font = cachedTheme.italicFont;
        }
      } else {
        text = value;
        color = cachedTheme.textDark;
        ctx.font = cachedTheme.baseFont;
      }

      // Draw text honoring cell alignment (used by document nulls in numeric/boolean columns)
      ctx.fillStyle = color;
      ctx.textAlign = cell.contentAlign ?? "left";
      ctx.textBaseline = "middle";

      const padding = cachedTheme.cellHorizontalPadding;
      const maxWidth = Math.max(0, rect.width - padding * 2);
      const displayText =
        value == null ? text : truncateTextToWidth(text, maxWidth, ctx.font);

      let x: number;
      switch (cell.contentAlign) {
        case "center":
          x = rect.x + rect.width / 2;
          break;
        case "right":
          x = rect.x + rect.width - padding;
          break;
        case "left":
        default:
          x = rect.x + padding;
          break;
      }
      const centerY = rect.y + rect.height / 2;
      ctx.fillText(displayText, x, centerY);

      return true;
    },

    provideEditor: (cell) => {
      console.log('[TextSingleLineCellRenderer] provideEditor called:', {
        readonly: cell.readonly,
        dataKind: cell.data.kind,
        dataValue: cell.data.value,
      });
      if (cell.readonly) {
        console.log('[TextSingleLineCellRenderer] Cell is readonly, no editor');
        return undefined;
      }
      console.log('[TextSingleLineCellRenderer] Providing editor');
      return {
        editor: TextMultiLineCellEditorWithProps,
        disablePadding: true,
        disableStyling: false,
      };
    },
  };

export default TextSingleLineCellRenderer;
