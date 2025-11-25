import { type CustomCell } from "@glideapps/glide-data-grid";
import { EnumCellEditorWithProps } from "./EnumCellEditor";

import type { CustomCellRenderer } from "../../types";
import { type EnumCustomCell } from "./types";
import { getCachedThemeValues } from "../../utils/renderCache";

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
    
    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    // Determine text and color based on value
    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
    } else {
      text = value;
      color = cachedTheme.textDark;
      ctx.font = cachedTheme.baseFont;
    }

    // Draw the text with left alignment
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const x = rect.x + cachedTheme.cellHorizontalPadding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(text, x, centerY);

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: EnumCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default EnumCellRenderer;
