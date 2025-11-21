import type { Theme, Rectangle } from "@glideapps/glide-data-grid";

interface DrawSortIndicatorArgs {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  rect: Rectangle;
  direction: 'asc' | 'desc' | null;
  sortIndex?: number;
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
  columns: Array<{ id: string }>;
  /** Number of columns currently sorted (for showing multi-sort index) */
  sortedColumnCount?: number;
}

export function createDrawHeader({
  getSortDirection,
  getSortIndex,
  sortedColumnCount = 0,
}: CreateDrawHeaderArgs) {
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

    // Find the column ID
    const colId = column.id ?? '';
    const direction = getSortDirection(colId);
    const sortIndex = getSortIndex(colId);

    // Draw header text
    const padding = 8;
    const title = column.title ?? colId;

    ctx.save();
    ctx.fillStyle = theme.textHeader;
    ctx.font = `${theme.headerFontStyle ?? ''} 13px ${theme.fontFamily}`.trim();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Calculate available width for text (leave room for sort indicator if sorted)
    const sortIndicatorWidth = direction ? 20 : 0;
    const maxTextWidth = rect.width - padding * 2 - sortIndicatorWidth;

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
      rect.x + padding,
      rect.y + rect.height / 2
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
