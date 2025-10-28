import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { TextSingleLineCellEditorWithProps } from "./TextSingleLineCellEditor";
import { truncateTextToWidth } from "../../utils/textUtils";
import { type TextSingleLineCustomCell } from "./types";

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
      const fontFamily =
        "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
      const baseFont = `${theme.baseFontStyle} ${fontFamily}`;

      let text: string;
      let color: string;

      if (value == null) {
        text = "NULL";
        color = "rgba(127,127,127,0.7)";
        ctx.font = `italic ${baseFont}`;
      } else {
        text = value;
        color = theme.textDark;
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
