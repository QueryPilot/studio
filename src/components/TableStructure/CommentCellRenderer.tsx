import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { CommentCellEditorWithProps } from "./CommentCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import { type CommentCustomCell } from "./types";
import { getCachedThemeValues } from "@/components/DataGrid/utils/renderCache";

const CommentCellRenderer: CustomCellRenderer<CommentCustomCell> = {
  isMatch: (cell: CustomCell): cell is CommentCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(data && typeof data === "object" && data.kind === "comment-cell");
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    const cachedTheme = getCachedThemeValues(theme);

    let text = value ?? "";
    let color = cachedTheme.textDark;
    let showBadge = false;
    let lineCount = 0;

    if (!text) {
      color = cachedTheme.nullTextColor;
      text = "";
    } else {
      const lines = text.split("\n");
      lineCount = lines.length;
      showBadge = lineCount > 1;
      if (showBadge) {
        text = `${lines[0] ?? ""}...`;
      }
    }

    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = cachedTheme.baseFont;

    const padding = cachedTheme.cellHorizontalPadding;
    const badgeWidth = showBadge ? 50 : 0;
    const maxWidth = Math.max(0, rect.width - padding * 2 - badgeWidth);
    const displayText = truncateTextToWidth(text, maxWidth, ctx.font);

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    if (showBadge) {
      const badgeText = `${lineCount} lines`;
      const badgeX = rect.x + rect.width - padding - 45;
      ctx.font = cachedTheme.baseFont;
      ctx.fillStyle = "rgba(100,100,100,0.5)";
      ctx.textAlign = "right";
      ctx.fillText(badgeText, badgeX + 45, centerY);
    }

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: CommentCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default CommentCellRenderer;
