import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { LazyJsonCellEditorWithProps } from "../hooks/lazyEditors";
import { truncateTextToWidth } from "../../utils/textUtils";
import { type JsonCustomCell } from "./types";
import { 
  getCachedThemeValues, 
  MONOSPACE_FONT_FAMILY,
} from "../../utils/renderCache";

// Pre-cached monospace font for JSON
const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;

// Color for invalid JSON
const INVALID_JSON_COLOR = "#ef4444";

const JSONCellRenderer: CustomCellRenderer<JsonCustomCell> = {
  isMatch: (cell: CustomCell): cell is JsonCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "json-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isValid } = cell.data;
    
    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
    } else {
      // Show minified/compact JSON
      try {
        const parsed = JSON.parse(value);
        const minified = JSON.stringify(parsed);
        text = minified;
      } catch {
        // If parsing fails, show raw value
        text = value;
      }

      // Color code based on validity
      if (isValid === false) {
        color = INVALID_JSON_COLOR;
      } else {
        color = cachedTheme.textDark;
      }
      ctx.font = MONO_FONT;
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
      editor: LazyJsonCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default JSONCellRenderer;
