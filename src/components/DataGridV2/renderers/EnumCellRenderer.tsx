import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../types";
import { EnumCellEditorWithProps } from "./EnumCellEditor";

interface EnumCellData {
  kind: "enum-cell";
  value: string | null;
  allowedValues: string[];
  nullable?: boolean;
}

// Define our custom enum cell type
export interface EnumCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: EnumCellData;
  copyData: string;
  readonly?: boolean;
}

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

    // Determine text and color based on value
    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = theme.textLight;
      ctx.font = `italic ${theme.baseFontStyle}`;
    } else {
      text = value;
      color = theme.textDark;
      ctx.font = theme.baseFontStyle;
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
