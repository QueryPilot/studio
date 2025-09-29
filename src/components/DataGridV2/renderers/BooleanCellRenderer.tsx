import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../types";
import { BooleanCellEditorWithProps } from "./BooleanCellEditor";

interface BooleanCellData {
  kind: "boolean-cell";
  value: boolean | null;
}

// Define our custom boolean cell type
export interface BooleanCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: BooleanCellData;
  copyData: string;
  readonly?: boolean;
}

// Renderer for the boolean cell
const BooleanCellRenderer: CustomCellRenderer<BooleanCustomCell> = {
  isMatch: (cell: CustomCell): cell is BooleanCustomCell => {
    return (
      typeof cell.data === "object" &&
      cell.data !== null &&
      "kind" in cell.data &&
      cell.data.kind === "boolean-cell"
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    // Don't fill the background - let the grid handle it
    // This ensures proper borders and hover states

    // Determine text and color based on value
    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = theme.textLight;
      ctx.font = `italic ${theme.baseFontStyle}`;
    } else if (value) {
      text = "TRUE";
      color = "#10b981"; // green-500
      ctx.font = `500 ${theme.baseFontStyle}`;
    } else {
      text = "FALSE";
      color = "#ef4444"; // red-500
      ctx.font = `500 ${theme.baseFontStyle}`;
    }

    // Draw the text centered
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(text, centerX, centerY);

    return true;
  },

  provideEditor: () => {
    return {
      editor: BooleanCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default BooleanCellRenderer;
