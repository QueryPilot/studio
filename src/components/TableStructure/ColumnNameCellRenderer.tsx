import {
  type CustomCell,
  type CustomRenderer,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import { type ColumnNameCustomCell } from "./types";
import { getCachedThemeValues } from "@/components/DataGrid/utils/renderCache";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import { ColumnNameCellEditor } from "./ColumnNameCellEditor";

// Icon size for PK/FK indicators
const ICON_SIZE = 12;
const ICON_PADDING = 4;

// Detect dark mode based on theme (bgCell brightness)
function isDarkMode(bgCell: string): boolean {
  // Quick heuristic: if bgCell starts with #1 or #2 or contains 'dark', it's dark mode
  // Or check if it's a dark color by parsing
  if (bgCell.startsWith('#')) {
    const hex = bgCell.slice(1);
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      // Calculate luminance - if less than 128, it's dark
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
      return luminance < 128;
    }
  }
  return false;
}

// Icon path definitions (from Tabler Icons, 24x24 viewBox)
const ICON_PATHS = {
  // IconKey - Primary Key
  pk: [
    'M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z',
    'M15 9h.01',
  ],
  // IconLink - Foreign Key
  fk: [
    'M9 15l6 -6',
    'M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464',
    'M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463',
  ],
};

// Colors for icons (light/dark mode)
const ICON_COLORS = {
  pk: { light: '#d97706', dark: '#fbbf24' }, // amber-600 / amber-400
  fk: { light: '#2563eb', dark: '#60a5fa' }, // blue-600 / blue-400
};

/**
 * Draw an icon on the canvas using Path2D
 */
function drawIcon(
  ctx: CanvasRenderingContext2D,
  iconType: 'pk' | 'fk',
  x: number,
  y: number,
  size: number,
  isDark: boolean
): void {
  const paths = ICON_PATHS[iconType];
  const colors = ICON_COLORS[iconType];
  const color = isDark ? colors.dark : colors.light;

  ctx.save();

  // Translate and scale from 24x24 viewBox to target size
  ctx.translate(x, y - size / 2);
  const scale = size / 24;
  ctx.scale(scale, scale);

  // Set up stroke style
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw all paths
  for (const pathData of paths) {
    const path = new Path2D(pathData);
    ctx.stroke(path);
  }

  ctx.restore();
}

const ColumnNameCellRenderer: CustomRenderer<ColumnNameCustomCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is ColumnNameCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data &&
      typeof data === "object" &&
      data.kind === "column-name-cell"
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { name, isPrimaryKey, isForeignKey } = cell.data;

    // Use cached theme values for consistent styling
    const cachedTheme = getCachedThemeValues(theme);
    const isDark = isDarkMode(theme.bgCell);

    const padding = cachedTheme.cellHorizontalPadding;
    const centerY = rect.y + rect.height / 2;

    // Calculate space needed for icons on the right
    let iconSpace = 0;
    if (isPrimaryKey && isForeignKey) {
      iconSpace = ICON_SIZE * 2 + ICON_PADDING * 2;
    } else if (isPrimaryKey || isForeignKey) {
      iconSpace = ICON_SIZE + ICON_PADDING;
    }

    // Calculate max width for text (leave room for icons)
    const maxTextWidth = Math.max(0, rect.width - padding * 2 - iconSpace);

    // Draw column name (left-aligned) with ellipsis if needed
    ctx.fillStyle = cachedTheme.textDark;
    ctx.font = cachedTheme.baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const displayText = name
      ? truncateTextToWidth(name, maxTextWidth, cachedTheme.baseFont)
      : "";
    ctx.fillText(displayText, rect.x + padding, centerY);

    // Draw icons on the right side
    if (isPrimaryKey || isForeignKey) {
      let iconX = rect.x + rect.width - padding;

      // Draw FK icon first (rightmost) if present
      if (isForeignKey) {
        iconX -= ICON_SIZE;
        drawIcon(ctx, 'fk', iconX, centerY, ICON_SIZE, isDark);
        iconX -= ICON_PADDING;
      }

      // Draw PK icon if present
      if (isPrimaryKey) {
        iconX -= ICON_SIZE;
        drawIcon(ctx, 'pk', iconX, centerY, ICON_SIZE, isDark);
      }
    }

    return true;
  },

  provideEditor: () => ({
    editor: ColumnNameCellEditor,
    disablePadding: true,
    disableStyling: false,
  }),
};

export default ColumnNameCellRenderer;
