import type { CustomCell } from '@glideapps/glide-data-grid';
import type { CustomCellRenderer } from '../../types';
import { getCachedThemeValues, MONOSPACE_FONT_FAMILY } from '../../utils/renderCache';
import { truncateTextToWidth } from '../../utils/textUtils';
import { DRILLABLE_CELL_KIND, type DrillableCell } from './types';

// Monospace font for preview text
const MONO_FONT = `400 12px ${MONOSPACE_FONT_FAMILY}`;

// Colors
const OBJECT_COLOR = '#8b5cf6'; // Purple for objects
const ARRAY_COLOR = '#0ea5e9';  // Cyan for arrays
const CHEVRON_COLOR = 'rgba(127, 127, 127, 0.85)';

// Chevron icon path (right arrow)
const CHEVRON_PATH = new Path2D('M 0 0 L 4 4 L 0 8');
const CHEVRON_AREA_WIDTH = 16; // chevron (8px) + gap

const DrillableCellRenderer: CustomCellRenderer<DrillableCell> = {
  isMatch: (cell: CustomCell): cell is DrillableCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === 'object' && data.kind === DRILLABLE_CELL_KIND
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme, hoverAmount } = args;
    const { type, preview, canDrillDown } = cell.data;

    // Get cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    // Background highlight on hover (if drillable)
    if (canDrillDown && hoverAmount > 0) {
      ctx.fillStyle = `rgba(127, 127, 127, ${0.08 * hoverAmount})`;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }

    // Set font
    ctx.font = MONO_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Color based on type
    const color = type === 'object' ? OBJECT_COLOR : ARRAY_COLOR;
    ctx.fillStyle = color;

    // Draw preview text (truncated to fit available width)
    const padding = cachedTheme.cellHorizontalPadding;
    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    const maxTextWidth = rect.width - padding * 2 - (canDrillDown ? CHEVRON_AREA_WIDTH : 0);
    const truncated = truncateTextToWidth(preview, maxTextWidth, MONO_FONT);

    ctx.fillText(truncated, x, centerY);

    // Draw chevron if drillable
    if (canDrillDown) {
      const chevronSize = 8;
      const chevronX = rect.x + rect.width - padding - chevronSize;
      const chevronY = centerY - chevronSize / 2;

      ctx.save();
      ctx.translate(chevronX, chevronY);
      ctx.strokeStyle = CHEVRON_COLOR;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(CHEVRON_PATH);
      ctx.restore();
    }

    return true;
  },

  // No editor - drillable cells are read-only, user must drill down to edit
  provideEditor: () => undefined,
};

export default DrillableCellRenderer;
