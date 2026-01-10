import { type CustomCell } from "@glideapps/glide-data-grid";
import { logger } from "@/lib/logger";
import { type ColumnNameCustomCell } from "./types";
import { getCachedThemeValues } from "@/components/DataGrid/utils/renderCache";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import { ColumnNameCellEditorWithProps } from "./ColumnNameCellEditor";
import { type CustomCellRenderer } from "@/components/DataGrid/types";
import { 
  drawVectorIcon, 
  isDarkMode, 
  ICON_SIZE, 
  ICON_PADDING 
} from "@/components/DataGrid/utils/vectorIcons";

const ColumnNameCellRenderer: CustomCellRenderer<ColumnNameCustomCell> = {
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
        drawVectorIcon(ctx, 'fk', iconX, centerY, ICON_SIZE, isDark);
        iconX -= ICON_PADDING;
      }

      // Draw PK icon if present
      if (isPrimaryKey) {
        iconX -= ICON_SIZE;
        drawVectorIcon(ctx, 'pk', iconX, centerY, ICON_SIZE, isDark);
      }
    }

    return true;
  },

  provideEditor: (cell) => {
    logger.info("[ColumnNameCellRenderer] provideEditor called:", {
      readonly: cell.readonly,
      allowOverlay: cell.allowOverlay,
      data: cell.data,
    });

    if (cell.readonly) {
      logger.info("[ColumnNameCellRenderer] Cell is readonly, not providing editor");
      return undefined;
    }

    logger.info("[ColumnNameCellRenderer] Returning editor:", ColumnNameCellEditorWithProps);
    return {
      editor: ColumnNameCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default ColumnNameCellRenderer;
