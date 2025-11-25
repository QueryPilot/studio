import {
  DEFAULT_FONT_FAMILY,
  getCachedTextWidth,
  setCachedTextWidth,
  getCachedTruncation,
  setCachedTruncation,
} from "./renderCache";

// Canvas context for measuring text (singleton)
let measurementCtx: CanvasRenderingContext2D | null = null;

const getMeasurementContext = (): CanvasRenderingContext2D | null => {
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

// Default font string (using shared constant)
const DEFAULT_FONT = `400 12px ${DEFAULT_FONT_FAMILY}`;

// Pre-computed average character widths for common fonts (fallback)
const AVG_CHAR_WIDTH = 7;

// Ellipsis string and cached width per font
const ELLIPSIS = "...";
const ellipsisWidthCache = new Map<string, number>();

/**
 * Get cached ellipsis width for a font
 */
function getEllipsisWidth(ctx: CanvasRenderingContext2D, font: string): number {
  let cached = ellipsisWidthCache.get(font);
  if (cached === undefined) {
    ctx.font = font;
    cached = ctx.measureText(ELLIPSIS).width;
    ellipsisWidthCache.set(font, cached);
    
    // Limit cache size
    if (ellipsisWidthCache.size > 50) {
      const firstKey = ellipsisWidthCache.keys().next().value;
      if (firstKey) ellipsisWidthCache.delete(firstKey);
    }
  }
  return cached;
}

/**
 * Measure text width with caching
 */
function measureTextWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  // Check cache first
  const cached = getCachedTextWidth(text, font);
  if (cached !== undefined) {
    return cached;
  }

  // Measure and cache
  ctx.font = font;
  const width = ctx.measureText(text).width;
  setCachedTextWidth(text, font, width);
  return width;
}

/**
 * Measure text width and truncate with ellipsis if needed.
 * Uses LRU cache for both measurements and truncation results.
 */
export const truncateTextToWidth = (
  text: string,
  maxWidth: number,
  font: string = DEFAULT_FONT,
): string => {
  // Early exit for empty text
  if (!text) return text;
  
  // Early exit for very small widths
  if (maxWidth <= 0) return "";

  // Check truncation cache first (includes the full computation result)
  const cachedResult = getCachedTruncation(text, maxWidth, font);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  const ctx = getMeasurementContext();
  if (!ctx) {
    // Fallback to character-based truncation if canvas not available
    const maxChars = Math.floor(maxWidth / AVG_CHAR_WIDTH);
    if (text.length > maxChars) {
      const result = text.substring(0, Math.max(0, maxChars - 3)) + ELLIPSIS;
      setCachedTruncation(text, maxWidth, font, result);
      return result;
    }
    setCachedTruncation(text, maxWidth, font, text);
    return text;
  }

  // Measure full text width (cached)
  const textWidth = measureTextWidth(ctx, text, font);
  
  // If text fits, return as-is
  if (textWidth <= maxWidth) {
    setCachedTruncation(text, maxWidth, font, text);
    return text;
  }

  // Get ellipsis width (cached per font)
  const ellipsisWidth = getEllipsisWidth(ctx, font);
  
  // If ellipsis alone is too wide, just return ellipsis
  if (ellipsisWidth >= maxWidth) {
    setCachedTruncation(text, maxWidth, font, ELLIPSIS);
    return ELLIPSIS;
  }

  // Available width for text content
  const availableWidth = maxWidth - ellipsisWidth;

  // Fast path: estimate based on average character width
  // This gives us a good starting point for binary search
  const avgCharWidth = textWidth / text.length;
  const estimatedChars = Math.floor(availableWidth / avgCharWidth);
  
  // If estimate is reasonable, start binary search from there
  let left = 0;
  let right = Math.min(text.length, estimatedChars + 5);
  let bestLength = 0;

  // Binary search for the right truncation point
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const truncated = text.substring(0, mid);
    const width = measureTextWidth(ctx, truncated, font);

    if (width <= availableWidth) {
      bestLength = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  const result = bestLength > 0 ? text.substring(0, bestLength) + ELLIPSIS : ELLIPSIS;
  setCachedTruncation(text, maxWidth, font, result);
  return result;
};

interface TruncateTextMiddleOptions {
  ctx?: CanvasRenderingContext2D;
  font?: string;
}

/**
 * Truncate text in the middle (preserving start and end).
 * Useful for file paths and UUIDs.
 */
export const truncateTextMiddleToWidth = (
  text: string,
  maxWidth: number,
  options?: TruncateTextMiddleOptions,
): string => {
  if (!text) return text;
  if (maxWidth <= 0) return "";

  // Check cache first
  const font = options?.font ?? DEFAULT_FONT;
  const cacheKey = `mid|${font}`;
  const cachedResult = getCachedTruncation(text, maxWidth, cacheKey);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  const measuringCtx = options?.ctx ?? getMeasurementContext();

  if (!measuringCtx) {
    // Fallback to character-based truncation
    const maxChars = Math.floor(maxWidth / AVG_CHAR_WIDTH);
    if (text.length <= maxChars) {
      setCachedTruncation(text, maxWidth, cacheKey, text);
      return text;
    }
    if (maxChars <= ELLIPSIS.length) {
      setCachedTruncation(text, maxWidth, cacheKey, ELLIPSIS);
      return ELLIPSIS;
    }

    const keep = maxChars - ELLIPSIS.length;
    const leftKeep = Math.ceil(keep / 2);
    const rightKeep = Math.floor(keep / 2);
    const result = text.substring(0, leftKeep) + ELLIPSIS + text.substring(text.length - rightKeep);
    setCachedTruncation(text, maxWidth, cacheKey, result);
    return result;
  }

  const originalFont = measuringCtx.font;
  if (options?.font) {
    measuringCtx.font = options.font;
  }

  const restoreFont = () => {
    if (options?.font) {
      measuringCtx.font = originalFont;
    }
  };

  try {
    const ellipsisWidth = getEllipsisWidth(measuringCtx, font);
    if (ellipsisWidth >= maxWidth) {
      setCachedTruncation(text, maxWidth, cacheKey, ELLIPSIS);
      return ELLIPSIS;
    }

    const textWidth = measureTextWidth(measuringCtx, text, font);
    if (textWidth <= maxWidth) {
      setCachedTruncation(text, maxWidth, cacheKey, text);
      return text;
    }

    // Binary search for optimal split
    let left = 0;
    let right = text.length;
    let best = 0;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const leftCount = Math.ceil(mid / 2);
      const rightCount = Math.floor(mid / 2);

      const leftText = text.substring(0, leftCount);
      const rightText = rightCount > 0 ? text.substring(text.length - rightCount) : "";

      const width =
        measureTextWidth(measuringCtx, leftText, font) +
        ellipsisWidth +
        measureTextWidth(measuringCtx, rightText, font);

      if (width <= maxWidth) {
        best = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    let result: string;
    if (best === 0) {
      result = ELLIPSIS;
    } else {
      const leftCount = Math.ceil(best / 2);
      const rightCount = Math.floor(best / 2);
      const leftText = text.substring(0, leftCount);
      const rightText = rightCount > 0 ? text.substring(text.length - rightCount) : "";
      result = leftText + ELLIPSIS + rightText;
    }

    setCachedTruncation(text, maxWidth, cacheKey, result);
    return result;
  } finally {
    restoreFont();
  }
};

/**
 * Pre-warm truncation cache for visible cells (call during idle time)
 */
export function preWarmTruncationCache(
  texts: string[],
  maxWidth: number,
  font: string = DEFAULT_FONT,
): void {
  if (typeof requestIdleCallback === "undefined") {
    // Fallback: just compute them synchronously in small batches
    texts.slice(0, 20).forEach((text) => truncateTextToWidth(text, maxWidth, font));
    return;
  }

  let index = 0;
  const batchSize = 10;

  const processNextBatch = (deadline: IdleDeadline) => {
    while (index < texts.length && deadline.timeRemaining() > 0) {
      const batchEnd = Math.min(index + batchSize, texts.length);
      for (let i = index; i < batchEnd; i++) {
        const text = texts[i];
        if (text !== undefined) {
          truncateTextToWidth(text, maxWidth, font);
        }
      }
      index = batchEnd;
    }

    if (index < texts.length) {
      requestIdleCallback(processNextBatch);
    }
  };

  requestIdleCallback(processNextBatch);
}
