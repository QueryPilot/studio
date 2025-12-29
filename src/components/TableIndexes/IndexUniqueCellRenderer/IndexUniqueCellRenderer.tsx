import type { CustomCell } from "@glideapps/glide-data-grid";
import type { IndexUniqueCell } from "./types";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { IndexUniqueCellEditorWithProps } from "./IndexUniqueCellEditor";

export const IndexUniqueCellRenderer: CustomCellRenderer<IndexUniqueCell> = {
  isMatch: (cell: CustomCell): cell is IndexUniqueCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "index-unique-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isLocked } = cell.data;

    const text = value;
    const isYes = value === "YES";

    ctx.save();

    // Use grayed text for locked cells, otherwise green/red based on value
    if (isLocked) {
      ctx.fillStyle = theme.textLight;
    } else {
      ctx.fillStyle = isYes ? "#22c55e" : "#ef4444";
    }

    ctx.font = `600 ${theme.baseFontStyle.split(" ").slice(1).join(" ")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();

    return true;
  },

  provideEditor: (cell) => {
    // Don't provide editor for locked cells
    if (cell.data.isLocked) {
      return undefined;
    }

    return {
      editor: IndexUniqueCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default IndexUniqueCellRenderer;
