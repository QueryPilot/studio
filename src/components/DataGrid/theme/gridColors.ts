/**
 * Grid Color Utilities
 *
 * Provides access to CSS variable-based colors for Glide Data Grid.
 * Glide requires actual color values, so we read CSS vars at runtime.
 */

// Cache computed styles to avoid repeated getComputedStyle calls
let cachedStyles: CSSStyleDeclaration | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 1000; // 1 second cache

function getComputedStyles(): CSSStyleDeclaration {
  const now = Date.now();
  if (!cachedStyles || now - cacheTimestamp > CACHE_TTL) {
    cachedStyles = getComputedStyle(document.documentElement);
    cacheTimestamp = now;
  }
  return cachedStyles;
}

/**
 * Get a CSS variable value
 */
export function getCssVar(name: string, fallback?: string): string {
  if (typeof window === "undefined") return fallback ?? "";
  const value = getComputedStyles().getPropertyValue(name).trim();
  return value || fallback || "";
}

/**
 * Clear the style cache (call when theme changes)
 */
export function clearColorCache(): void {
  cachedStyles = null;
  cacheTimestamp = 0;
}

// ============================================================================
// Row State Colors
// ============================================================================

export interface RowStateColors {
  bgCell: string;
  bgCellMedium: string;
  accentColor?: string;
  accentLight?: string;
}

export function getDeletedRowColors(): RowStateColors {
  return {
    bgCell: getCssVar("--grid-row-deleted-bg", "rgba(239, 68, 68, 0.06)"),
    bgCellMedium: getCssVar("--grid-row-deleted-bg-medium", "rgba(239, 68, 68, 0.08)"),
    accentColor: getCssVar("--grid-row-deleted-accent", "rgba(239, 68, 68, 0.4)"),
    accentLight: getCssVar("--grid-row-deleted-accent-light", "rgba(239, 68, 68, 0.15)"),
  };
}

export function getInsertedRowColors(): RowStateColors {
  return {
    bgCell: getCssVar("--grid-row-inserted-bg", "rgba(34, 197, 94, 0.06)"),
    bgCellMedium: getCssVar("--grid-row-inserted-bg-medium", "rgba(34, 197, 94, 0.08)"),
    accentColor: getCssVar("--grid-row-inserted-accent", "rgba(34, 197, 94, 0.4)"),
    accentLight: getCssVar("--grid-row-inserted-accent-light", "rgba(34, 197, 94, 0.15)"),
  };
}

export function getUpdatedRowColors(): RowStateColors {
  return {
    bgCell: getCssVar("--grid-row-updated-bg", "rgba(59, 130, 246, 0.08)"),
    bgCellMedium: getCssVar("--grid-row-updated-bg-medium", "rgba(59, 130, 246, 0.10)"),
  };
}

export function getPinnedRowColors(): RowStateColors {
  return {
    bgCell: getCssVar("--grid-row-pinned-bg", "rgba(212, 165, 43, 0.04)"),
    bgCellMedium: getCssVar("--grid-row-pinned-bg-medium", "rgba(212, 165, 43, 0.06)"),
    accentLight: getCssVar("--grid-row-pinned-accent-light", "rgba(212, 165, 43, 0.12)"),
  };
}

export function getPinnedStagedRowColors(): RowStateColors {
  return {
    bgCell: getCssVar("--grid-row-pinned-staged-bg", "rgba(212, 165, 43, 0.10)"),
    bgCellMedium: getCssVar("--grid-row-pinned-staged-bg-medium", "rgba(212, 165, 43, 0.12)"),
  };
}

// ============================================================================
// Cell State Colors
// ============================================================================

export function getCellModifiedBg(): string {
  return getCssVar("--grid-cell-modified-bg", "rgba(59, 130, 246, 0.15)");
}

export function getCellErrorBg(): string {
  return getCssVar("--grid-cell-error-bg", "rgba(239, 68, 68, 0.15)");
}

export function getCellFkHighlight(): { bgCell: string; accentLight: string } {
  return {
    bgCell: getCssVar("--grid-cell-fk-highlight", "rgba(251, 146, 60, 0.15)"),
    accentLight: getCssVar("--grid-cell-fk-accent-light", "rgba(251, 146, 60, 0.2)"),
  };
}

// ============================================================================
// Text Colors
// ============================================================================

export function getNullTextColor(): string {
  return getCssVar("--grid-null-text", "rgba(127, 127, 127, 0.7)");
}

export function getTextMediumColor(): string {
  return getCssVar("--grid-text-medium", "rgba(0, 0, 0, 0.7)");
}

export function getTextLightColor(): string {
  return getCssVar("--grid-text-light", "rgba(0, 0, 0, 0.5)");
}

// ============================================================================
// Border & Accent Colors
// ============================================================================

export function getBorderColor(): string {
  return getCssVar("--grid-border", "rgba(0, 0, 0, 0.1)");
}

export function getBorderLightColor(): string {
  return getCssVar("--grid-border-light", "rgba(0, 0, 0, 0.05)");
}

export function getAccentColor(): string {
  return getCssVar("--grid-accent", "#D4A52B");
}

export function getAccentLightColor(): string {
  return getCssVar("--grid-accent-light", "rgba(212, 165, 43, 0.1)");
}

export function getSearchResultBg(): string {
  return getCssVar("--grid-search-result-bg", "rgba(212, 165, 43, 0.2)");
}

// ============================================================================
// Hover & Selection
// ============================================================================

export function getHoverIconBg(): string {
  return getCssVar("--grid-hover-icon-bg", "rgba(0, 0, 0, 0.1)");
}

export function getRowStripeBg(): string {
  return getCssVar("--grid-row-stripe", "rgba(0, 0, 0, 0.03)");
}

// ============================================================================
// Convenience: All Row State Colors
// ============================================================================

export type RowState = "deleted" | "inserted" | "updated" | "pinned" | "pinned-staged";

export function getRowStateColors(state: RowState): RowStateColors {
  switch (state) {
    case "deleted":
      return getDeletedRowColors();
    case "inserted":
      return getInsertedRowColors();
    case "updated":
      return getUpdatedRowColors();
    case "pinned":
      return getPinnedRowColors();
    case "pinned-staged":
      return getPinnedStagedRowColors();
  }
}
