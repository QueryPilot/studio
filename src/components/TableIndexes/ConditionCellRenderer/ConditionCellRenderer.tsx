import type { CustomCell } from "@glideapps/glide-data-grid";
import type { IndexConditionCell } from "./types";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { ConditionCellEditorWithProps } from "./ConditionCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import {
  MONOSPACE_FONT_FAMILY,
  getCachedThemeValues,
} from "@/components/DataGrid/utils/renderCache";

const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;
const MONO_FONT_ITALIC = `italic 400 11px ${MONOSPACE_FONT_FAMILY}`;
const SQL_TEXT_COLOR = "#3b82f6"; // Blue for SQL condition
const SQL_TEXT_COLOR_LOCKED = "rgba(127, 127, 127, 0.7)";

export const ConditionCellRenderer: CustomCellRenderer<IndexConditionCell> = {
  isMatch: (cell: CustomCell): cell is IndexConditionCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "index-condition-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isLocked } = cell.data;

    const cachedTheme = getCachedThemeValues(theme);

    ctx.save();

    // Determine text and styling based on value
    let text: string;
    let color: string;

    if (!value || value.trim() === "") {
      // Empty condition - show placeholder
      text = "\u2014"; // em-dash
      color = cachedTheme.nullTextColor;
      ctx.font = MONO_FONT_ITALIC;
    } else {
      // Has condition - show truncated SQL in blue monospace
      text = value;
      color = isLocked ? SQL_TEXT_COLOR_LOCKED : SQL_TEXT_COLOR;
      ctx.font = MONO_FONT;
    }

    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding = cachedTheme.cellHorizontalPadding;
    const maxWidth = Math.max(0, rect.width - padding * 2);
    const displayText = truncateTextToWidth(text, maxWidth, ctx.font);

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    ctx.restore();

    return true;
  },

  provideEditor: (cell) => {
    // Don't provide editor for locked cells
    if (cell.data.isLocked) {
      return undefined;
    }

    return {
      editor: ConditionCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default ConditionCellRenderer;
