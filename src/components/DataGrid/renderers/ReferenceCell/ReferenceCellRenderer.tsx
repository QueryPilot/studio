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
    const arrowWidth = 20; // Reserve space for hover arrow on the right
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
      // Value with embedded reference: "42 → john@email.com"
      const fkText = displayValue || String(value);
      const arrowText = " → ";

      // Measure text widths
      ctx.font = cachedTheme.baseFont;
      const fkWidth = ctx.measureText(fkText).width;
      const arrowTextWidth = ctx.measureText(arrowText).width;

      // Calculate available space for embedded value
      const embeddedAvailable = availableWidth - fkWidth - arrowTextWidth;

      // Draw FK value (normal color)
      ctx.fillStyle = cachedTheme.textDark;
      let x = rect.x + padding;
      ctx.fillText(fkText, x, centerY);
      x += fkWidth;

      // Draw arrow separator (muted color)
      ctx.fillStyle = cachedTheme.textMedium || "rgba(127,127,127,0.7)";
      ctx.fillText(arrowText, x, centerY);
      x += arrowTextWidth;

      // Draw embedded value (muted color, truncated if needed)
      if (embeddedAvailable > 20) {
        const truncatedEmbed = truncateTextToWidth(
          String(embeddedValue),
          embeddedAvailable,
          ctx.font,
        );
        ctx.fillText(truncatedEmbed, x, centerY);
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
