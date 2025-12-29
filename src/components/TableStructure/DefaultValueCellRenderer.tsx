import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { DefaultValueCellEditorWithProps } from "./DefaultValueCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import { type DefaultValueCustomCell } from "./types";
import {
  MONOSPACE_FONT_FAMILY,
  getCachedThemeValues,
} from "@/components/DataGrid/utils/renderCache";

const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;
const MONO_FONT_ITALIC = `italic 400 11px ${MONOSPACE_FONT_FAMILY}`;

const DefaultValueCellRenderer: CustomCellRenderer<DefaultValueCustomCell> = {
  isMatch: (cell: CustomCell): cell is DefaultValueCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "default-value-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    const cachedTheme = getCachedThemeValues(theme);

    let text = value ?? "";
    let color = cachedTheme.textDark;

    if (!text) {
      text = "NULL";
      color = cachedTheme.nullTextColor;
      ctx.font = MONO_FONT_ITALIC;
    } else {
      ctx.font = MONO_FONT;
    }

    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding = cachedTheme.cellHorizontalPadding;
    const maxWidth = Math.max(0, rect.width - padding * 2);
    const displayText = truncateTextToWidth(text, maxWidth, ctx.font);

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: DefaultValueCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default DefaultValueCellRenderer;
