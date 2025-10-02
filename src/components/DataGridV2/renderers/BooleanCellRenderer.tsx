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

    // Draw the text with proper alignment
    ctx.fillStyle = color;
    ctx.textAlign = cell.contentAlign || "center";
    ctx.textBaseline = "middle";

    let x: number;
    switch (cell.contentAlign) {
      case "left":
        x = rect.x + 8; // Add some padding
        break;
      case "right":
        x = rect.x + rect.width - 8; // Add some padding
        break;
      case "center":
      default:
        x = rect.x + rect.width / 2;
        break;
    }

    const centerY = rect.y + rect.height / 2;
    ctx.fillText(text, x, centerY);

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
