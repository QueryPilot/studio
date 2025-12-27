import type { CustomCell, CustomRenderer } from "@glideapps/glide-data-grid";
import type { DataTypeCell } from "./types";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { DataTypeCellEditorWithProps } from "./DataTypeCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";

const CELL_PADDING = 8;

export const DataTypeCellRenderer: CustomRenderer<DataTypeCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is DataTypeCell => {
    return (cell.data as Record<string, unknown>).kind === "datatype-cell";
  },
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    ctx.save();
    ctx.fillStyle = theme.textDark;
    ctx.font = `400 12px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const maxWidth = Math.max(0, rect.width - CELL_PADDING * 2);
    const displayText = truncateTextToWidth(value, maxWidth, ctx.font);

    const x = rect.x + CELL_PADDING;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);
    ctx.restore();

    return true;
  },
  provideEditor: () => ({
    editor: DataTypeCellEditorWithProps,
    disablePadding: true,
    disableStyling: false,
  }),
};
