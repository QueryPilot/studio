import type { CustomCell } from "@glideapps/glide-data-grid";
import type { TriggerNameCustomCell } from "./types";
import { getCachedThemeValues } from "@/components/DataGrid/utils/renderCache";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";
import { TriggerNameCellEditorWithProps } from "./TriggerNameCellEditor";
import type { CustomCellRenderer } from "@/components/DataGrid/types";

const TriggerNameCellRenderer: CustomCellRenderer<TriggerNameCustomCell> = {
  isMatch: (cell: CustomCell): cell is TriggerNameCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data &&
      typeof data === "object" &&
      data.kind === "trigger-name-cell"
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { name } = cell.data;

    const cachedTheme = getCachedThemeValues(theme);
    const padding = cachedTheme.cellHorizontalPadding;
    const centerY = rect.y + rect.height / 2;
    const maxTextWidth = Math.max(0, rect.width - padding * 2);

    ctx.fillStyle = cachedTheme.textDark;
    ctx.font = cachedTheme.baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const displayText = name
      ? truncateTextToWidth(name, maxTextWidth, cachedTheme.baseFont)
      : "";
    ctx.fillText(displayText, rect.x + padding, centerY);

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly || cell.data.isLocked) {
      return undefined;
    }

    return {
      editor: TriggerNameCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default TriggerNameCellRenderer;
