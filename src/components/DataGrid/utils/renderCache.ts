/**
 * Render Cache - Performance optimization utilities for DataGrid rendering
 * 
 * Provides:
 * - Cached font strings to avoid recreation on every draw call
 * - Theme value caching to pre-compute colors and padding
 * - LRU cache for text measurements
 */

// ============================================================================
// Font String Cache
// ============================================================================

/**
 * Default font family used across all renderers
 * Extracted to module scope to avoid string allocation on every draw
 */
export const DEFAULT_FONT_FAMILY = 
  "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";

export const MONOSPACE_FONT_FAMILY = 
  "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace";

// Cache for computed font strings
const fontStringCache = new Map<string, string>();

/**
 * Get a cached font string combining style and family
 * Avoids string concatenation on every draw call
 */
export function getCachedFont(baseFontStyle: string, family: string = DEFAULT_FONT_FAMILY): string {
  const key = `${baseFontStyle}|${family}`;
  let cached = fontStringCache.get(key);
  if (!cached) {
    cached = `${baseFontStyle} ${family}`;
    fontStringCache.set(key, cached);
  }
  return cached;
}

/**
 * Get italic version of a font string
 */
export function getCachedItalicFont(baseFontStyle: string, family: string = DEFAULT_FONT_FAMILY): string {
  const key = `italic|${baseFontStyle}|${family}`;
  let cached = fontStringCache.get(key);
  if (!cached) {
    cached = `italic ${baseFontStyle} ${family}`;
    fontStringCache.set(key, cached);
  }
  return cached;
}

// ============================================================================
// Theme Value Cache
// ============================================================================

export interface CachedThemeValues {
  // Common colors
  textDark: string;
  textMedium: string;
  nullTextColor: string;
  bgCell: string;
  bgCellMedium: string;
  borderColor: string;
  
  // Common fonts
  baseFont: string;
  italicFont: string;
  monoFont: string;
  
  // Common padding
  cellHorizontalPadding: number;
}

// WeakMap to cache computed theme values per theme object
const themeCache = new WeakMap<object, CachedThemeValues>();

// Fallback for primitive theme identifiers
const themeIdCache = new Map<string, CachedThemeValues>();

/**
 * Get cached theme values, computing them once per theme
 */
export function getCachedThemeValues(theme: {
  textDark: string;
  textMedium?: string;
  bgCell: string;
  bgCellMedium?: string;
  borderColor?: string;
  baseFontStyle: string;
  cellHorizontalPadding?: number;
}): CachedThemeValues {
  // Try WeakMap first (works for object themes)
  let cached = themeCache.get(theme);
  if (cached) {
    return cached;
  }

  // Create cache key for fallback
  const cacheKey = `${theme.textDark}|${theme.bgCell}|${theme.baseFontStyle}`;
  cached = themeIdCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute cached values
  const baseFontStyle = theme.baseFontStyle;
  cached = {
    textDark: theme.textDark,
    textMedium: theme.textMedium ?? theme.textDark,
    nullTextColor: "rgba(127,127,127,0.7)",
    bgCell: theme.bgCell,
    bgCellMedium: theme.bgCellMedium ?? theme.bgCell,
    borderColor: theme.borderColor ?? theme.bgCellMedium ?? theme.bgCell,
    baseFont: getCachedFont(baseFontStyle),
    italicFont: getCachedItalicFont(baseFontStyle),
    monoFont: getCachedFont(baseFontStyle, MONOSPACE_FONT_FAMILY),
    cellHorizontalPadding: typeof theme.cellHorizontalPadding === "number" 
      ? theme.cellHorizontalPadding 
      : 8,
  };

  // Store in both caches
  themeCache.set(theme, cached);
  themeIdCache.set(cacheKey, cached);

  // Limit fallback cache size
  if (themeIdCache.size > 20) {
    const firstKey = themeIdCache.keys().next().value;
    if (firstKey) {
      themeIdCache.delete(firstKey);
    }
  }

  return cached;
}

// ============================================================================
// Text Measurement LRU Cache
// ============================================================================

interface MeasurementCacheEntry {
  width: number;
  timestamp: number;
}

const MAX_MEASUREMENT_CACHE_SIZE = 2000;
const measurementCache = new Map<string, MeasurementCacheEntry>();

/**
 * Get cached text width measurement
 * Returns undefined if not cached
 */
export function getCachedTextWidth(text: string, font: string): number | undefined {
  const key = `${font}|${text}`;
  const entry = measurementCache.get(key);
  if (entry) {
    // Update timestamp for LRU
    entry.timestamp = Date.now();
    return entry.width;
  }
  return undefined;
}

/**
 * Cache a text width measurement
 */
export function setCachedTextWidth(text: string, font: string, width: number): void {
  const key = `${font}|${text}`;
  measurementCache.set(key, { width, timestamp: Date.now() });

  // Evict oldest entries if cache is too large
  if (measurementCache.size > MAX_MEASUREMENT_CACHE_SIZE) {
    evictOldestMeasurements(Math.floor(MAX_MEASUREMENT_CACHE_SIZE * 0.2));
  }
}

/**
 * Evict the oldest N entries from the measurement cache
 */
function evictOldestMeasurements(count: number): void {
  const entries = Array.from(measurementCache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
    .slice(0, count);

  for (const [key] of entries) {
    measurementCache.delete(key);
  }
}

// ============================================================================
// Truncation Result Cache
// ============================================================================

interface TruncationCacheEntry {
  result: string;
  timestamp: number;
}

const MAX_TRUNCATION_CACHE_SIZE = 1000;
const truncationCache = new Map<string, TruncationCacheEntry>();

/**
 * Get cached truncation result
 */
export function getCachedTruncation(text: string, maxWidth: number, font: string): string | undefined {
  // Round maxWidth to avoid cache misses from floating point differences
  const roundedWidth = Math.round(maxWidth);
  const key = `${font}|${roundedWidth}|${text}`;
  const entry = truncationCache.get(key);
  if (entry) {
    entry.timestamp = Date.now();
    return entry.result;
  }
  return undefined;
}

/**
 * Cache a truncation result
 */
export function setCachedTruncation(text: string, maxWidth: number, font: string, result: string): void {
  const roundedWidth = Math.round(maxWidth);
  const key = `${font}|${roundedWidth}|${text}`;
  truncationCache.set(key, { result, timestamp: Date.now() });

  // Evict if too large
  if (truncationCache.size > MAX_TRUNCATION_CACHE_SIZE) {
    evictOldestTruncations(Math.floor(MAX_TRUNCATION_CACHE_SIZE * 0.2));
  }
}

function evictOldestTruncations(count: number): void {
  const entries = Array.from(truncationCache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
    .slice(0, count);

  for (const [key] of entries) {
    truncationCache.delete(key);
  }
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear all render caches (useful when theme changes significantly)
 */
export function clearAllRenderCaches(): void {
  fontStringCache.clear();
  themeIdCache.clear();
  measurementCache.clear();
  truncationCache.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getRenderCacheStats(): {
  fontStrings: number;
  themes: number;
  measurements: number;
  truncations: number;
} {
  return {
    fontStrings: fontStringCache.size,
    themes: themeIdCache.size,
    measurements: measurementCache.size,
    truncations: truncationCache.size,
  };
}

// Development helper
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).__renderCacheStats = getRenderCacheStats;
}

