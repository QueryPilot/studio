import type { CustomCell, CustomRenderer } from "@glideapps/glide-data-grid";
import type { DataTypeCell } from "./types";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { DataTypeCellEditorWithProps } from "./DataTypeCellEditor";

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

    const x = rect.x + 8;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(value, x, centerY);
    ctx.restore();

    return true;
  },
  provideEditor: () => ({
    editor: DataTypeCellEditorWithProps,
    disablePadding: true,
    disableStyling: false,
  }),
};
