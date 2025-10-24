import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { ReferenceCellEditorWithProps } from "./ReferenceCellEditor";
import { truncateTextToWidth } from "../../utils/textUtils";
import { type ReferenceCustomCell } from "./types";

const ReferenceCellRenderer: CustomCellRenderer<ReferenceCustomCell> = {
  isMatch: (cell: CustomCell): cell is ReferenceCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "reference-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, displayValue } = cell.data;
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
      text = displayValue || String(value);
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

    // Reserve space for arrow icon
    const arrowWidth = 20;
    const maxWidth = Math.max(0, rect.width - padding * 2 - arrowWidth);
    const displayText =
      value == null ? "NULL" : truncateTextToWidth(text, maxWidth, ctx.font);

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    // Draw arrow icon (→) on hover
    if (value != null && args.hoverAmount > 0) {
      const arrowX = rect.x + rect.width - padding - 12;
      ctx.fillStyle = theme.accentColor;
      ctx.font = `14px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("→", arrowX, centerY);
    }

    return true;
  },

  provideEditor: () => {
    return {
      editor: ReferenceCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default ReferenceCellRenderer;
