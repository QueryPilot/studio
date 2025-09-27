// Canvas context for measuring text
let measurementCtx: CanvasRenderingContext2D | null = null;

const getMeasurementContext = () => {
  if (measurementCtx) return measurementCtx;

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      measurementCtx = ctx;
      return ctx;
    }
  }
  return null;
};

// Measure text width and truncate with ellipsis if needed
export const truncateTextToWidth = (
  text: string,
  maxWidth: number,
  font: string = "400 12px Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif",
): string => {
  if (!text) return text;

  const ctx = getMeasurementContext();
  if (!ctx) {
    // Fallback to character-based truncation if canvas not available
    const avgCharWidth = 7;
    const maxChars = Math.floor(maxWidth / avgCharWidth);
    if (text.length > maxChars) {
      return text.substring(0, maxChars - 3) + "...";
    }
    return text;
  }

  ctx.font = font;

  const ellipsis = "...";
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  const textWidth = ctx.measureText(text).width;

  if (textWidth <= maxWidth) {
    return text;
  }

  // Binary search for the right length
  let left = 0;
  let right = text.length;
  let bestLength = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const truncated = text.substring(0, mid);
    const width = ctx.measureText(truncated).width + ellipsisWidth;

    if (width <= maxWidth) {
      bestLength = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return bestLength > 0 ? text.substring(0, bestLength) + ellipsis : ellipsis;
};