import type { CustomCell, CustomRenderer } from "@glideapps/glide-data-grid";
import type { NullableCell } from "./types";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { NullableCellEditor } from "./NullableCellEditor";

export const NullableCellRenderer: CustomRenderer<NullableCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is NullableCell => {
    return (cell.data as Record<string, unknown>).kind === "nullable-cell";
  },
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    const text = value;
    const isYes = value === "YES";

    ctx.save();
    ctx.fillStyle = isYes ? "#22c55e" : "#ef4444";
    ctx.font = `600 ${theme.baseFontStyle.split(" ").slice(1).join(" ")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();

    return true;
  },
  provideEditor: () => ({
    editor: NullableCellEditor,
    disablePadding: true,
    disableStyling: false,
  }),
};
