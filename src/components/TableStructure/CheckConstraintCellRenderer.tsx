import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { CheckConstraintCellEditorWithProps } from "./CheckConstraintCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import { type CheckConstraintCustomCell } from "./types";
import {
  MONOSPACE_FONT_FAMILY,
  getCachedThemeValues,
} from "@/components/DataGrid/utils/renderCache";

const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;
const MONO_FONT_ITALIC = `italic 400 11px ${MONOSPACE_FONT_FAMILY}`;

const CheckConstraintCellRenderer: CustomCellRenderer<CheckConstraintCustomCell> = {
  isMatch: (cell: CustomCell): cell is CheckConstraintCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data &&
        typeof data === "object" &&
        data.kind === "check-constraint-cell",
    );
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
      text = "";
      color = cachedTheme.nullTextColor;
      ctx.font = MONO_FONT_ITALIC;
    } else {
      const lines = text.split("\n");
      lineCount = lines.length;
      showBadge = lineCount > 1;
      if (showBadge) {
        text = `${lines[0] ?? ""}...`;
      }
      ctx.font = MONO_FONT;
    }

    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

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
      editor: CheckConstraintCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default CheckConstraintCellRenderer;
