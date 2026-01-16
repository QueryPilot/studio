import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { truncateTextToWidth } from "../../utils/textUtils";
import { type ExpandableCustomCell } from "./types";
import {
  getCachedThemeValues,
  MONOSPACE_FONT_FAMILY,
} from "../../utils/renderCache";

// Pre-cached monospace font for structured data
const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;

// Icons for expand/collapse (using Unicode)
const EXPAND_ICON = "▶";
const COLLAPSE_ICON = "▼";

function formatValue(value: unknown, isExpanded: boolean): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "object") {
    if (Array.isArray(value)) {
      if (isExpanded) {
        return JSON.stringify(value, null, 2);
      }
      return `Array[${value.length}]`;
    }

    if (isExpanded) {
      return JSON.stringify(value, null, 2);
    }

    const keys = Object.keys(value);
    return `Object{${keys.length} keys}`;
  }

  return String(value);
}

function isExpandable(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return Object.keys(value).length > 0;
  }

  return false;
}

const ExpandableCellRenderer: CustomCellRenderer<ExpandableCustomCell> = {
  isMatch: (cell: CustomCell): cell is ExpandableCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "expandable-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isExpanded = false } = cell.data;

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    const expandable = isExpandable(value);
    const formattedValue = formatValue(value, isExpanded);

    let color: string;
    let font: string;

    if (value == null) {
      color = cachedTheme.nullTextColor;
      font = cachedTheme.italicFont;
    } else {
      color = cachedTheme.textDark;
      font = MONO_FONT;
    }

    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding = cachedTheme.cellHorizontalPadding;
    let x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;

    // Draw expand/collapse icon if expandable
    if (expandable) {
      const icon = isExpanded ? COLLAPSE_ICON : EXPAND_ICON;
      ctx.fillText(icon, x, centerY);
      x += ctx.measureText(icon).width + 4; // Add spacing after icon
    }

    // Draw the value
    const maxWidth = Math.max(0, rect.width - (x - rect.x) - padding);

    let displayText: string;
    if (isExpanded && typeof value === "object") {
      // For expanded view, show first line only in the grid
      const lines = formattedValue.split('\n');
      displayText = truncateTextToWidth(lines[0] || "", maxWidth, font);
    } else {
      displayText = truncateTextToWidth(formattedValue, maxWidth, font);
    }

    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: () => {
    // No editor for now - can be added later if needed
    return undefined;
  },
};

export default ExpandableCellRenderer;
