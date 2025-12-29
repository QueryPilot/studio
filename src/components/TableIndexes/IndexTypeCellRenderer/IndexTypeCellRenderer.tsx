import type { CustomCell } from "@glideapps/glide-data-grid";
import type { IndexTypeCell } from "./types";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { IndexTypeCellEditorWithProps } from "./IndexTypeCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";

export const IndexTypeCellRenderer: CustomCellRenderer<IndexTypeCell> = {
  isMatch: (cell: CustomCell): cell is IndexTypeCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "index-type-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isLocked } = cell.data;

    const text = value.toUpperCase();
    const padding = 8;
    const availableWidth = rect.width - padding * 2;

    ctx.save();

    // Use grayed text for locked cells
    ctx.fillStyle = isLocked ? theme.textLight : theme.textDark;

    // Use monospace font for index types
    const baseFontSize = theme.baseFontStyle.split(" ").slice(1).join(" ");
    ctx.font = `500 ${baseFontSize}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // Truncate text if it's too wide
    const displayText = truncateTextToWidth(text, availableWidth, ctx.font);

    ctx.fillText(displayText, rect.x + padding, rect.y + rect.height / 2);
    ctx.restore();

    return true;
  },

  provideEditor: (cell) => {
    // Don't provide editor for locked cells
    if (cell.data.isLocked) {
      return undefined;
    }

    // Don't provide editor if there's only one option (e.g., SQLite only has btree)
    if (cell.data.options.length <= 1) {
      return undefined;
    }

    return {
      editor: IndexTypeCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default IndexTypeCellRenderer;
