import type { Theme, Rectangle } from "@glideapps/glide-data-grid";
import type { ColumnMeta } from "@/types";
import { drawColumnIcon, getIconTypeFromMeta } from "./columnTypeIcons";

// Helper to detect if a color is dark (for theme detection)
function isColorDark(color: string): boolean {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    // Using relative luminance formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }
  // Handle rgb/rgba
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match && match[1] && match[2] && match[3]) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }
  return false;
}

interface DrawSortIndicatorArgs {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  rect: Rectangle;
  direction: 'asc' | 'desc' | null;
  sortIndex?: number;
}

interface DrawColumnTypeIconArgs {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  meta: ColumnMeta | null | undefined;
  isDark: boolean;
}

const ICON_SIZE = 15;
const ICON_SIZE_SMALL = 14;
const ICON_PADDING = 6;

// Icons that need smaller size
const SMALL_ICONS = new Set(['pk', 'uuid', 'computed']);

// Draw column type icon based on data type
function drawColumnTypeIcon({
  ctx,
  x,
  y,
  meta,
  isDark,
}: DrawColumnTypeIconArgs): number {
  if (!meta) return 0;

  const iconType = getIconTypeFromMeta(meta);
  const size = SMALL_ICONS.has(iconType) ? ICON_SIZE_SMALL : ICON_SIZE;
  drawColumnIcon(ctx, iconType, x, y, size, isDark);
  return ICON_SIZE + ICON_PADDING;
}

// Draw sort ascending icon (Tabler sort-ascending-small-big)
function drawSortAscIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Arrow pointing down
  ctx.beginPath();
  ctx.moveTo(4, 15);
  ctx.lineTo(7, 18);
  ctx.lineTo(10, 15);
  ctx.stroke();

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(7, 6);
  ctx.lineTo(7, 18);
  ctx.stroke();

  // Small box (top)
  ctx.beginPath();
  ctx.roundRect(14, 5, 4, 4, 0.667);
  ctx.stroke();

  // Large box (bottom)
  ctx.beginPath();
  ctx.roundRect(14, 12, 7, 7, 1.167);
  ctx.stroke();

  ctx.restore();
}

// Draw sort descending icon (Tabler sort-descending-small-big)
function drawSortDescIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Arrow pointing down
  ctx.beginPath();
  ctx.moveTo(4, 15);
  ctx.lineTo(7, 18);
  ctx.lineTo(10, 15);
  ctx.stroke();

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(7, 6);
  ctx.lineTo(7, 18);
  ctx.stroke();

  // Small box (bottom)
  ctx.beginPath();
  ctx.roundRect(14, 15, 4, 4, 0.667);
  ctx.stroke();

  // Large box (top)
  ctx.beginPath();
  ctx.roundRect(14, 5, 7, 7, 1.167);
  ctx.stroke();

  ctx.restore();
}

export function drawSortIndicator({
  ctx,
  theme,
  rect,
  direction,
  sortIndex,
}: DrawSortIndicatorArgs): void {
  if (!direction) return;

  const iconSize = 16;
  const padding = 4;
  const x = rect.x + rect.width - padding - iconSize;
  const centerY = rect.y + (rect.height - iconSize) / 2;

  ctx.save();

  // Draw sort icon
  const iconColor = theme.textHeader;
  if (direction === 'asc') {
    drawSortAscIcon(ctx, x, centerY, iconSize, iconColor);
  } else {
    drawSortDescIcon(ctx, x, centerY, iconSize, iconColor);
  }

  // Draw sort index for multi-column sort
  if (sortIndex !== undefined && sortIndex > 0) {
    ctx.font = '9px sans-serif';
    ctx.fillStyle = theme.textMedium ?? theme.textHeader;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      String(sortIndex),
      x - 2,
      rect.y + rect.height / 2
    );
  }

  ctx.restore();
}

interface CreateDrawHeaderArgs {
  getSortDirection: (columnId: string) => 'asc' | 'desc' | null;
  getSortIndex: (columnId: string) => number;
  columns: Array<{ id: string; meta?: ColumnMeta | null }>;
  /** Number of columns currently sorted (for showing multi-sort index) */
  sortedColumnCount?: number;
}

export function createDrawHeader({
  getSortDirection,
  getSortIndex,
  columns,
  sortedColumnCount = 0,
}: CreateDrawHeaderArgs) {
  // Create a map for quick lookup of column metadata
  const columnMetaMap = new Map(columns.map(c => [c.id, c.meta]));

  return (args: {
    ctx: CanvasRenderingContext2D;
    column: { id?: string; title?: string };
    theme: Theme;
    rect: Rectangle;
    hoverAmount: number;
    isSelected: boolean;
    isHovered: boolean;
    hasSelectedCell: boolean;
    spriteManager: unknown;
    menuBounds: Rectangle;
  }): boolean => {
    const { ctx, column, theme, rect, isSelected } = args;

    // Detect dark mode from theme (check if bgCell is dark)
    const isDark = isColorDark(theme.bgCell);

    // When selected, the bg is accent color (orange) - need dark text for contrast
    const isSelectedHeader = isSelected;
    const textColor = isSelectedHeader
      ? (theme.textHeaderSelected ?? '#111827')
      : theme.textHeader;

    // Find the column ID and metadata
    const colId = column.id ?? '';
    const direction = getSortDirection(colId);
    const sortIndex = getSortIndex(colId);
    const meta = columnMetaMap.get(colId);

    // Draw header text
    const padding = 8;
    const title = column.title ?? colId;
    const centerY = rect.y + rect.height / 2;

    // Draw column type icon first (use dark icons on selected orange bg)
    const iconWidth = drawColumnTypeIcon({
      ctx,
      x: rect.x + padding,
      y: centerY,
      meta,
      isDark: isSelectedHeader ? false : isDark, // Force light mode icons on selected (dark text on orange)
    });

    ctx.save();
    ctx.fillStyle = textColor;
    ctx.font = `${theme.headerFontStyle ?? ''} 13px ${theme.fontFamily}`.trim();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Calculate available width for text (leave room for icon and sort indicator)
    const sortIndicatorWidth = direction ? 20 : 0;
    const textStartX = rect.x + padding + iconWidth;
    const maxTextWidth = rect.width - padding * 2 - iconWidth - sortIndicatorWidth;

    // Truncate text if needed
    let displayText = title;
    let textWidth = ctx.measureText(displayText).width;
    if (textWidth > maxTextWidth) {
      while (textWidth > maxTextWidth && displayText.length > 0) {
        displayText = displayText.slice(0, -1);
        textWidth = ctx.measureText(displayText + '…').width;
      }
      displayText += '…';
    }

    ctx.fillText(
      displayText,
      textStartX,
      centerY
    );
    ctx.restore();

    // Draw sort indicator if sorted
    if (direction) {
      drawSortIndicator({
        ctx,
        theme: isSelectedHeader
          ? { ...theme, textHeader: textColor }
          : theme,
        rect,
        direction,
        sortIndex: sortedColumnCount > 1 ? sortIndex : undefined,
      });
    }

    return true; // We handled the drawing for all columns
  };
}
