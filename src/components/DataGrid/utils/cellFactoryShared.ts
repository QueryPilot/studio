import type { GridCell } from "@glideapps/glide-data-grid";
import type { CellValue } from "@/types";

// ============================================================================
// Shared Cache Infrastructure
// ============================================================================

/**
 * Cache for memoizing cell creation (keyed by CellValue object identity)
 * Shared across all paradigm-specific cell factories
 */
export const cellCache = new WeakMap<CellValue, Map<string, GridCell>>();

// Development-mode cache statistics
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Helper to cache cell results and apply read-only flags
 * Used by all paradigm-specific cell factories (SQL, Document, KeyValue)
 */
export function cacheAndReturn(
  value: CellValue | null | undefined,
  cacheKey: string,
  readOnly: boolean,
  result: GridCell,
): GridCell {
  const finalized =
    readOnly && (result.allowOverlay || (result as any).readonly !== true)
      ? ({ ...result, allowOverlay: false, readonly: true } as GridCell)
      : result;

  if (value && typeof value === "object") {
    let cache = cellCache.get(value);
    if (!cache) {
      cache = new Map<string, GridCell>();
      cellCache.set(value, cache);
    }
    cache.set(cacheKey, finalized);
  }

  if (process.env.NODE_ENV === "development") {
    cacheMisses++;
  }

  return finalized;
}

/**
 * Try to get cached cell (fast path for all paradigms)
 */
export function tryGetCachedCell(
  value: CellValue | null | undefined,
  cacheKey: string,
): GridCell | undefined {
  if (value && typeof value === "object") {
    const columnCache = cellCache.get(value);
    const cached = columnCache?.get(cacheKey);
    if (cached) {
      if (process.env.NODE_ENV === "development") {
        cacheHits++;
      }
      return cached;
    }
  }
  return undefined;
}

// ============================================================================
// Cache Statistics (Development)
// ============================================================================

/**
 * Get cache statistics (development only)
 */
export function getCellFactoryStats(): {
  hits: number;
  misses: number;
  hitRate: string;
} {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? ((cacheHits / total) * 100).toFixed(1) : "0";
  return { hits: cacheHits, misses: cacheMisses, hitRate: `${hitRate}%` };
}

/**
 * Reset cache statistics (development only)
 */
export function resetCellFactoryStats(): void {
  cacheHits = 0;
  cacheMisses = 0;
}

// Development helper
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).__cellFactoryStats = getCellFactoryStats;
  (window as any).__resetCellFactoryStats = resetCellFactoryStats;
}

// ============================================================================
// Common Type Guards & Utilities
// ============================================================================

/**
 * Check if value is a plain object (used by document paradigm for drill-down)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  );
}

/**
 * Check if value should be treated as drillable (objects/arrays in document paradigm)
 */
export function isDrillableValue(value: unknown): boolean {
  return isPlainObject(value) || Array.isArray(value);
}

export { validate as isValidUuidString } from "uuid";
