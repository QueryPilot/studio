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

// Cache for minified JSON to avoid parsing/stringifying on every render
const minifiedJsonCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

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
      // Show minified/compact JSON (cached to avoid parsing on every render)
      let minified = minifiedJsonCache.get(value);
      if (minified === undefined) {
        try {
          const parsed = JSON.parse(value);
          minified = JSON.stringify(parsed);
        } catch {
          minified = value;
        }
        // Simple LRU: clear if too large
        if (minifiedJsonCache.size > MAX_CACHE_SIZE) {
          minifiedJsonCache.clear();
        }
        minifiedJsonCache.set(value, minified);
      }
      text = minified;

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
