import {
  type CustomCell,
  type DrawArgs,
  GridCellKind,
} from "@glideapps/glide-data-grid";

// Custom text cell renderer with ellipsis
export const TextCellRenderer = {
  isMatch: (cell: CustomCell): boolean => {
    return cell.kind === GridCellKind.Custom;
  },

  draw: (args: DrawArgs<any>, cell: any) => {
    const { ctx, rect, theme } = args;
    const { x, y, width, height } = rect;

    // Get text to render
    const text = cell.displayData || cell.data || "";

    // Set up text styles
    ctx.fillStyle = theme.textDark;
    ctx.font = theme.baseFontStyle;

    // Calculate text metrics
    const padding = 8;
    const maxWidth = width - padding * 2;

    // Measure text width
    const metrics = ctx.measureText(text);

    // Clear the cell area
    ctx.fillStyle = theme.bgCell;
    ctx.fillRect(x, y, width, height);

    // Draw text with ellipsis if needed
    ctx.fillStyle = theme.textDark;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    if (metrics.width > maxWidth) {
      // Text overflow - add ellipsis
      let truncated = text;
      const ellipsis = "...";
      let truncatedWidth = ctx.measureText(truncated + ellipsis).width;

      // Binary search for optimal truncation point
      let left = 0;
      let right = text.length;

      while (left < right) {
        const mid = Math.floor((left + right + 1) / 2);
        truncated = text.substring(0, mid);
        truncatedWidth = ctx.measureText(truncated + ellipsis).width;

        if (truncatedWidth <= maxWidth) {
          left = mid;
        } else {
          right = mid - 1;
        }
      }

      truncated = text.substring(0, left) + ellipsis;
      console.log(">>>", "truncated", truncated);
      ctx.fillText(truncated, x + padding, y + height / 2);
    } else {
      console.log(">>>", "textonly", text);
      // No overflow - render normally
      ctx.fillText(text, x + padding, y + height / 2);
    }

    return true;
  },

  provideEditor: () => undefined,
};
