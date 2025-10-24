import { type CustomCell } from "@glideapps/glide-data-grid";
import { EnumCellEditorWithProps } from "./EnumCellEditor";

import type { CustomCellRenderer } from "../../types";
import { type EnumCustomCell } from "./types";

// Renderer for the enum cell
const EnumCellRenderer: CustomCellRenderer<EnumCustomCell> = {
  isMatch: (cell: CustomCell): cell is EnumCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "enum-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;
    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `${theme.baseFontStyle} ${fontFamily}`;

    // Determine text and color based on value
    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      // Match NULL styling used by default text cells
      color = "rgba(127,127,127,0.7)";
      ctx.font = `italic ${baseFont}`;
    } else {
      text = value;
      color = theme.textDark;
      ctx.font = baseFont; // non-italic
    }

    // Draw the text with left alignment
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const x = rect.x + 8; // Add some padding
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(text, x, centerY);

    return true;
  },

  provideEditor: () => {
    return {
      editor: EnumCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default EnumCellRenderer;
