import { type CustomCell } from "@glideapps/glide-data-grid";
import {
  type IndexNameCustomCell,
  type EditableIndexNameCell,
} from "./types";
import { IndexNameCellEditorWithProps } from "./IndexNameCellEditor";
import { type CustomCellRenderer } from "@/components/DataGrid/types";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import { 
  drawVectorIcon, 
  isDarkMode, 
  ICON_SIZE, 
  ICON_PADDING 
} from "@/components/DataGrid/utils/vectorIcons";
import { getCachedThemeValues } from "@/components/DataGrid/utils/renderCache";

type IndexNameCell = IndexNameCustomCell | EditableIndexNameCell;

const IndexNameCellRenderer: CustomCellRenderer<IndexNameCell> = {
  isMatch: (cell: CustomCell): cell is IndexNameCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data &&
        typeof data === "object" &&
        (data.kind === "index-name-cell" ||
          data.kind === "editable-index-name-cell"),
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { name, isPrimary } = cell.data;
    const isLocked =
      "isLocked" in cell.data
        ? (cell.data as { isLocked: boolean }).isLocked
        : false;
    
    // Use cached theme values for consistent styling
    const cachedTheme = getCachedThemeValues(theme);
    const isDark = isDarkMode(theme.bgCell);

    const padding = 8;
    const centerY = rect.y + rect.height / 2;

    // Calculate space needed for icons on the right
    let iconSpace = 0;
    if (isPrimary) {
      iconSpace = ICON_SIZE + ICON_PADDING;
    }

    // Calculate max width for text (leave room for icons)
    const maxTextWidth = Math.max(0, rect.width - padding * 2 - iconSpace);

    // Draw index name (left-aligned) with ellipsis
    ctx.fillStyle = cachedTheme.textDark;
    ctx.font = cachedTheme.baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    
    const displayText = name
      ? truncateTextToWidth(name, maxTextWidth, cachedTheme.baseFont)
      : "";
    ctx.fillText(displayText, rect.x + padding, centerY);

    // Draw key icon for primary key (right-aligned)
    if (isPrimary) {
      const iconX = rect.x + rect.width - padding - ICON_SIZE;
      drawVectorIcon(ctx, 'pk', iconX, centerY, ICON_SIZE, isDark);
    }

    // Draw lock icon for locked rows (right-aligned)
    if (isLocked) {
      // Position lock to the left of key if key is present
      const lockOffset = isPrimary ? ICON_SIZE + 4 : 0;
      const iconX = rect.x + rect.width - padding - ICON_SIZE - lockOffset;
      drawVectorIcon(ctx, 'lock', iconX, centerY, ICON_SIZE, isDark);
    }

    return true;
  },

  provideEditor: (cell) => {
    // Only provide editor for editable cells that are not locked
    if (cell.data.kind !== "editable-index-name-cell") {
      return undefined;
    }

    if ((cell as EditableIndexNameCell).data.isLocked) {
      return undefined;
    }

    return {
      editor: IndexNameCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default IndexNameCellRenderer;
