import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { ReferenceCellEditorWithProps } from "./ReferenceCellEditor";
import { truncateTextToWidth } from "../../utils/textUtils";
import { type ReferenceCustomCell } from "./types";
import { 
  getCachedThemeValues, 
  getCachedFont,
  DEFAULT_FONT_FAMILY,
} from "../../utils/renderCache";

const ReferenceCellRenderer: CustomCellRenderer<ReferenceCustomCell> = {
  isMatch: (cell: CustomCell): cell is ReferenceCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "reference-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, displayValue, embeddedValue } = cell.data;

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    const padding = cachedTheme.cellHorizontalPadding;
    // Only reserve arrow space when hovering to maximize text display
    const arrowWidth = args.hoverAmount > 0 ? 20 : 0;
    const availableWidth = Math.max(0, rect.width - padding * 2 - arrowWidth);
    const centerY = rect.y + rect.height / 2;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    if (value == null) {
      // NULL value
      ctx.fillStyle = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
      ctx.fillText("NULL", rect.x + padding, centerY);
    } else if (embeddedValue != null) {
      // Value with embedded reference as: "1 → [user@example.com]"
      const fkText = displayValue || String(value);
      const arrowText = " → ";
      const badgePaddingH = 6; // Horizontal padding inside badge
      const badgeRadius = 4; // Border radius for pill

      // Measure FK value and arrow width
      ctx.font = cachedTheme.baseFont;
      const fkWidth = ctx.measureText(fkText).width;
      const arrowWidth = ctx.measureText(arrowText).width;

      // Calculate badge dimensions
      const badgeFont = getCachedFont("11px", DEFAULT_FONT_FAMILY);
      ctx.font = badgeFont;
      const maxBadgeTextWidth = Math.max(0, availableWidth - fkWidth - arrowWidth - badgePaddingH * 2 - 4);
      const truncatedEmbed = truncateTextToWidth(embeddedValue, maxBadgeTextWidth, badgeFont);
      const badgeTextWidth = ctx.measureText(truncatedEmbed).width;
      const badgeWidth = badgeTextWidth + badgePaddingH * 2;
      const badgeHeight = 16;

      // Draw FK value (normal color)
      ctx.font = cachedTheme.baseFont;
      ctx.fillStyle = cachedTheme.textDark;
      let x = rect.x + padding;
      ctx.fillText(fkText, x, centerY);
      x += fkWidth;

      // Draw arrow separator (muted color)
      ctx.fillStyle = cachedTheme.textMedium || "rgba(127,127,127,0.7)";
      ctx.fillText(arrowText, x, centerY);
      x += arrowWidth;

      // Draw badge background (only if there's space)
      if (maxBadgeTextWidth > 10) {
        const badgeY = centerY - badgeHeight / 2;

        // Badge background - subtle muted color
        const isDark = (theme.bgCell || "").startsWith("#") &&
          parseInt((theme.bgCell || "#ffffff").slice(1, 3), 16) < 128;
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)";
        ctx.beginPath();
        ctx.roundRect(x, badgeY, badgeWidth, badgeHeight, badgeRadius);
        ctx.fill();

        // Badge text (muted color)
        ctx.font = badgeFont;
        ctx.fillStyle = cachedTheme.textMedium || "rgba(127,127,127,0.8)";
        ctx.fillText(truncatedEmbed, x + badgePaddingH, centerY);
      }
    } else {
      // Value without embedded reference
      const text = displayValue || String(value);
      ctx.fillStyle = cachedTheme.textDark;
      ctx.font = cachedTheme.baseFont;
      const displayText = truncateTextToWidth(text, availableWidth, ctx.font);
      ctx.fillText(displayText, rect.x + padding, centerY);
    }

    // Draw hover arrow icon (→) - existing behavior
    if (value != null && args.hoverAmount > 0) {
      const arrowX = rect.x + rect.width - padding - 12;
      ctx.fillStyle = theme.accentColor;
      ctx.font = getCachedFont("14px", DEFAULT_FONT_FAMILY);
      ctx.textAlign = "center";
      ctx.fillText("→", arrowX, centerY);
    }

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: ReferenceCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default ReferenceCellRenderer;
