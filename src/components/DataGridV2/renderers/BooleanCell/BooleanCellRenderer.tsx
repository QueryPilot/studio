import { type CustomCell } from "@glideapps/glide-data-grid";

import { BooleanCellEditorWithProps } from "./BooleanCellEditor";
import { type BooleanCustomCell } from "./types";
import { type CustomCellRenderer } from "../../types";
import { getCachedThemeValues } from "../../utils/renderCache";

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
    
    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    // Don't fill the background - let the grid handle it
    // This ensures proper borders and hover states

    // Determine text and color based on value
    let text: string;
    let color: string = cachedTheme.textDark;

    if (value == null) {
      text = "NULL";
      color = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
    } else if (value) {
      text = "TRUE";
      ctx.font = cachedTheme.baseFont;
    } else {
      text = "FALSE";
      ctx.font = cachedTheme.baseFont;
    }

    // Draw the text with proper alignment
    ctx.fillStyle = color;
    ctx.textAlign = cell.contentAlign || "center";
    ctx.textBaseline = "middle";

    let x: number;
    switch (cell.contentAlign) {
      case "left":
        x = rect.x + cachedTheme.cellHorizontalPadding;
        break;
      case "right":
        x = rect.x + rect.width - cachedTheme.cellHorizontalPadding;
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
