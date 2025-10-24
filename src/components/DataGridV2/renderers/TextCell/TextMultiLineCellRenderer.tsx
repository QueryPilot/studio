import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { TextMultiLineCellEditorWithProps } from "./TextMultiLineCellEditor";
import { truncateTextToWidth } from "../../utils/textUtils";
import { type TextMultiLineCustomCell } from "./types";

const TextMultiLineCellRenderer: CustomCellRenderer<TextMultiLineCustomCell> = {
  isMatch: (cell: CustomCell): cell is TextMultiLineCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "text-multi-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, displayValue, showLineBadge } = cell.data;
    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `400 11px monospace`;

    let text: string;
    let color: string;
    let showBadge = false;
    let lineCount = 0;

    if (value == null) {
      text = "NULL";
      color = "rgba(127,127,127,0.7)";
      ctx.font = `italic ${baseFont}`;
    } else {
      const lines = value.split("\n");
      lineCount = lines.length;
      showBadge = showLineBadge !== false && lineCount > 1;

      if (displayValue != null) {
        text = displayValue;
      } else if (showBadge) {
        const firstLine = lines[0] || "";
        text = `${firstLine}...`;
      } else {
        text = value;
      }

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

    // Reserve space for line count badge if needed
    const badgeWidth = showBadge ? 50 : 0;
    const maxWidth = Math.max(0, rect.width - padding * 2 - badgeWidth);
    const displayText =
      value == null ? "NULL" : truncateTextToWidth(text, maxWidth, ctx.font);

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    // Draw line count badge if multiline
    if (showBadge) {
      const badgeText = `${lineCount} lines`;
      const badgeX = rect.x + rect.width - padding - 45;
      const badgeY = centerY;

      ctx.font = `${theme.baseFontStyle} ${fontFamily}`;
      ctx.fillStyle = "rgba(100,100,100,0.5)";
      ctx.textAlign = "right";
      ctx.fillText(badgeText, badgeX + 45, badgeY);
    }

    return true;
  },

  provideEditor: () => {
    return {
      editor: TextMultiLineCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default TextMultiLineCellRenderer;
