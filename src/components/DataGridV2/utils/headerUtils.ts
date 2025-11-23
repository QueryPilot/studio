import type { Theme, Rectangle } from "@glideapps/glide-data-grid";
import type { ColumnMeta } from "@/types/database";

interface DrawSortIndicatorArgs {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  rect: Rectangle;
  direction: 'asc' | 'desc' | null;
  sortIndex?: number;
}

interface DrawColumnTypeIconArgs {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  x: number;
  y: number;
  meta: ColumnMeta | null | undefined;
}

// Draw column type icon (PK key, FK link, etc.)
function drawColumnTypeIcon({
  ctx,
  theme,
  x,
  y,
  meta,
}: DrawColumnTypeIconArgs): number {
  if (!meta) return 0;

  const iconSize = 10;
  const iconPadding = 4;
  let iconWidth = 0;

  ctx.save();

  // Primary Key - draw key icon
  if (meta.is_pk) {
    ctx.fillStyle = '#f59e0b'; // amber-500
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.2;

    // Draw key icon
    const kx = x;
    const ky = y - iconSize / 2;

    // Key head (circle)
    ctx.beginPath();
    ctx.arc(kx + 3, ky + 3, 2.5, 0, Math.PI * 2);
    ctx.stroke();

    // Key shaft
    ctx.beginPath();
    ctx.moveTo(kx + 5.5, ky + 3);
    ctx.lineTo(kx + 9, ky + 3);
    ctx.stroke();

    // Key teeth
    ctx.beginPath();
    ctx.moveTo(kx + 7, ky + 3);
    ctx.lineTo(kx + 7, ky + 5);
    ctx.moveTo(kx + 8.5, ky + 3);
    ctx.lineTo(kx + 8.5, ky + 4.5);
    ctx.stroke();

    iconWidth = iconSize + iconPadding;
  }
  // Foreign Key - draw link icon
  else if (meta.is_fk) {
    ctx.strokeStyle = '#3b82f6'; // blue-500
    ctx.lineWidth = 1.2;

    const lx = x;
    const ly = y - iconSize / 2;

    // Draw two interlocking chain links
    ctx.beginPath();
    // First link
    ctx.arc(lx + 3, ly + 5, 2.5, Math.PI * 0.5, Math.PI * 1.5);
    ctx.moveTo(lx + 3, ly + 2.5);
    ctx.lineTo(lx + 5, ly + 2.5);
    ctx.moveTo(lx + 3, ly + 7.5);
    ctx.lineTo(lx + 5, ly + 7.5);
    ctx.stroke();

    // Second link
    ctx.beginPath();
    ctx.arc(lx + 7, ly + 5, 2.5, Math.PI * 1.5, Math.PI * 0.5);
    ctx.moveTo(lx + 5, ly + 2.5);
    ctx.lineTo(lx + 7, ly + 2.5);
    ctx.moveTo(lx + 5, ly + 7.5);
    ctx.lineTo(lx + 7, ly + 7.5);
    ctx.stroke();

    iconWidth = iconSize + iconPadding;
  }
  // Nullable indicator - draw small circle with question mark
  else if (meta.nullable) {
    ctx.fillStyle = theme.textMedium ?? theme.textHeader;
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + iconSize / 2, y);
    iconWidth = 8 + iconPadding;
  }

  ctx.restore();
  return iconWidth;
}

export function drawSortIndicator({
  ctx,
  theme,
  rect,
  direction,
  sortIndex,
}: DrawSortIndicatorArgs): void {
  if (!direction) return;

  const padding = 6;
  const arrowSize = 6;
  const x = rect.x + rect.width - padding - arrowSize;
  const centerY = rect.y + rect.height / 2;

  ctx.save();
  ctx.fillStyle = theme.textHeader;

  // Draw arrow
  ctx.beginPath();
  if (direction === 'asc') {
    // Up arrow
    ctx.moveTo(x + arrowSize / 2, centerY - arrowSize / 2);
    ctx.lineTo(x + arrowSize, centerY + arrowSize / 2);
    ctx.lineTo(x, centerY + arrowSize / 2);
  } else {
    // Down arrow
    ctx.moveTo(x, centerY - arrowSize / 2);
    ctx.lineTo(x + arrowSize, centerY - arrowSize / 2);
    ctx.lineTo(x + arrowSize / 2, centerY + arrowSize / 2);
  }
  ctx.closePath();
  ctx.fill();

  // Draw sort index for multi-column sort
  if (sortIndex !== undefined && sortIndex > 0) {
    ctx.font = `${9}px sans-serif`;
    ctx.fillStyle = theme.textMedium ?? theme.textHeader;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      String(sortIndex),
      x - 2,
      centerY
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
    const { ctx, column, theme, rect } = args;

    // Find the column ID and metadata
    const colId = column.id ?? '';
    const direction = getSortDirection(colId);
    const sortIndex = getSortIndex(colId);
    const meta = columnMetaMap.get(colId);

    // Draw header text
    const padding = 8;
    const title = column.title ?? colId;
    const centerY = rect.y + rect.height / 2;

    // Draw column type icon first
    const iconWidth = drawColumnTypeIcon({
      ctx,
      theme,
      x: rect.x + padding,
      y: centerY,
      meta,
    });

    ctx.save();
    ctx.fillStyle = theme.textHeader;
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
        theme,
        rect,
        direction,
        sortIndex: sortedColumnCount > 1 ? sortIndex : undefined,
      });
    }

    return true; // We handled the drawing for all columns
  };
}
