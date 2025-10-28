import { type CustomCell } from "@glideapps/glide-data-grid";

import { BooleanCellEditorWithProps } from "./BooleanCellEditor";
import { type BooleanCustomCell } from "./types";
import { type CustomCellRenderer } from "../../types";

// Renderer for the boolean cell
const BooleanCellRenderer: CustomCellRenderer<BooleanCustomCell> = {
  isMatch: (cell: CustomCell): cell is BooleanCustomCell => {
    return (
      typeof cell.data === "object" &&
      "kind" in cell.data &&
      cell.data.kind === "boolean-cell"
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;
    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `${theme.baseFontStyle} ${fontFamily}`;

    // Don't fill the background - let the grid handle it
    // This ensures proper borders and hover states

    // Determine text and color based on value
    let text: string;
    let color: string = theme.textDark;

    if (value == null) {
      text = "NULL";
      color = "rgba(127,127,127,0.7)";
      ctx.font = `italic ${baseFont}`;
    } else if (value) {
      text = "TRUE";
      ctx.font = baseFont; // non-italic
    } else {
      text = "FALSE";
      ctx.font = baseFont; // non-italic
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

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: BooleanCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default BooleanCellRenderer;
