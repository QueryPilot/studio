/**
 * Shared renderer utilities for DataGrid cell renderers
 *
 * Provides common drawing functions to reduce duplication across 18+ renderers
 * while maintaining Glide Data Grid's plain object pattern.
 */

import type { CustomCell, Rectangle, Theme } from "@glideapps/glide-data-grid";
import { getCachedThemeValues, type CachedThemeValues } from "./renderCache";
import { truncateTextToWidth } from "./textUtils";

// Re-export for convenience
export type { CachedThemeValues } from "./renderCache";

// ============================================================================
// Type Matchers
// ============================================================================

/**
 * Create a type-safe isMatch function for a custom cell kind
 *
 * @example
 * const NumberCellRenderer = {
 *   isMatch: createMatcher<NumberCustomCell>('number-cell'),
 *   draw: ...,
 *   provideEditor: ...
 * };
 */
export function createMatcher<T extends CustomCell>(kind: string) {
  return (cell: CustomCell): cell is T => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(data && typeof data === "object" && data.kind === kind);
  };
}

// ============================================================================
// NULL Value Drawing
// ============================================================================

/**
 * Draw NULL text in a cell
 * Shared implementation for consistent NULL rendering across all cell types
 */
export function drawNull(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  theme: CachedThemeValues,
  align: "left" | "right" | "center" = "left"
): void {
  ctx.fillStyle = theme.nullTextColor;
  ctx.font = theme.italicFont;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";

  const padding = theme.cellHorizontalPadding;
  const centerY = rect.y + rect.height / 2;

  let x: number;
  switch (align) {
    case "right":
      x = rect.x + rect.width - padding;
      break;
    case "center":
      x = rect.x + rect.width / 2;
      break;
    default:
      x = rect.x + padding;
  }

  ctx.fillText("NULL", x, centerY);
}

/**
 * Draw NULL text using raw theme (when you haven't cached yet)
 */
export function drawNullWithTheme(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  theme: Theme,
  align: "left" | "right" | "center" = "left"
): void {
  const cached = getCachedThemeValues(theme);
  drawNull(ctx, rect, cached, align);
}

// ============================================================================
// Text Drawing
// ============================================================================

interface DrawTextOptions {
  align?: "left" | "right" | "center";
  color?: string;
  font?: string;
  truncate?: boolean;
}

/**
 * Draw text in a cell with standard formatting
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: Rectangle,
  theme: CachedThemeValues,
  options: DrawTextOptions = {}
): void {
  const { align = "left", color, font, truncate = true } = options;

  ctx.fillStyle = color ?? theme.textDark;
  ctx.font = font ?? theme.baseFont;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";

  const padding = theme.cellHorizontalPadding;
  const maxWidth = Math.max(0, rect.width - padding * 2);
  const centerY = rect.y + rect.height / 2;

  const displayText = truncate
    ? truncateTextToWidth(text, maxWidth, ctx.font)
    : text;

  let x: number;
  switch (align) {
    case "right":
      x = rect.x + rect.width - padding;
      break;
    case "center":
      x = rect.x + rect.width / 2;
      break;
    default:
      x = rect.x + padding;
  }

  ctx.fillText(displayText, x, centerY);
}

/**
 * Draw text or NULL depending on value
 */
export function drawTextOrNull(
  ctx: CanvasRenderingContext2D,
  value: string | null | undefined,
  rect: Rectangle,
  theme: CachedThemeValues,
  options: DrawTextOptions = {}
): void {
  if (value == null) {
    drawNull(ctx, rect, theme, options.align);
  } else {
    drawText(ctx, value, rect, theme, options);
  }
}

// ============================================================================
// Number Drawing
// ============================================================================

interface DrawNumberOptions {
  format?: (n: number) => string;
  align?: "left" | "right";
  color?: string;
}

/**
 * Draw a number with right alignment (default for numbers)
 */
export function drawNumber(
  ctx: CanvasRenderingContext2D,
  value: number | string | null | undefined,
  rect: Rectangle,
  theme: CachedThemeValues,
  options: DrawNumberOptions = {}
): void {
  const { format, align = "right", color } = options;

  if (value == null) {
    drawNull(ctx, rect, theme, align);
    return;
  }

  const text =
    format && typeof value === "number" ? format(value) : String(value);

  drawText(ctx, text, rect, theme, { align, color });
}

// ============================================================================
// Monospace Drawing (for UUIDs, IPs, etc.)
// ============================================================================

/**
 * Draw monospace text (for UUIDs, IPs, MAC addresses, etc.)
 */
export function drawMonospace(
  ctx: CanvasRenderingContext2D,
  value: string | null | undefined,
  rect: Rectangle,
  theme: CachedThemeValues,
  options: { color?: string; align?: "left" | "right" } = {}
): void {
  const { color, align = "left" } = options;

  if (value == null) {
    drawNull(ctx, rect, theme, align);
    return;
  }

  drawText(ctx, value, rect, theme, {
    align,
    color,
    font: theme.monoFont,
  });
}

// ============================================================================
// Badge/Tag Drawing
// ============================================================================

interface DrawBadgeOptions {
  bgColor: string;
  textColor: string;
  maxWidth?: number;
}

/**
 * Draw a badge/tag style element (for booleans, enums, etc.)
 */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: Rectangle,
  theme: CachedThemeValues,
  options: DrawBadgeOptions
): void {
  const { bgColor, textColor, maxWidth } = options;
  const padding = theme.cellHorizontalPadding;

  ctx.font = theme.baseFont;
  const textWidth = ctx.measureText(text).width;
  const badgeWidth = Math.min(
    textWidth + 12,
    maxWidth ?? rect.width - padding * 2
  );
  const badgeHeight = 20;

  const x = rect.x + padding;
  const y = rect.y + (rect.height - badgeHeight) / 2;

  // Draw background
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, y, badgeWidth, badgeHeight, 4);
  ctx.fill();

  // Draw text
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + badgeWidth / 2, y + badgeHeight / 2);
}

// ============================================================================
// Icon Drawing
// ============================================================================

/**
 * Draw an icon indicator in the cell
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  rect: Rectangle,
  theme: CachedThemeValues,
  position: "left" | "right" = "left"
): number {
  const padding = theme.cellHorizontalPadding;
  const size = 14;

  ctx.font = `${size}px sans-serif`;
  ctx.textBaseline = "middle";

  const x =
    position === "right" ? rect.x + rect.width - padding - size : rect.x + padding;

  ctx.fillText(emoji, x, rect.y + rect.height / 2);

  // Return width consumed
  return size + 4;
}

// ============================================================================
// Editor Helpers
// ============================================================================

/**
 * Create a standard provideEditor implementation
 */
export function createEditorProvider<T extends CustomCell>(
  Editor: React.ComponentType<any>,
  options: { disablePadding?: boolean; disableStyling?: boolean } = {}
) {
  const { disablePadding = true, disableStyling = false } = options;

  return (cell: T) => {
    if ((cell as any).readonly) {
      return undefined;
    }
    return {
      editor: Editor,
      disablePadding,
      disableStyling,
    };
  };
}
