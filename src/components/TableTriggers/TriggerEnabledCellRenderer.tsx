import type { CustomCell } from "@glideapps/glide-data-grid";
import type { TriggerEnabledCustomCell } from "./types";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { TriggerEnabledCellEditorWithProps } from "./TriggerEnabledCellEditor";

export const TriggerEnabledCellRenderer: CustomCellRenderer<TriggerEnabledCustomCell> = {
  isMatch: (cell: CustomCell): cell is TriggerEnabledCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "trigger-enabled-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isLocked } = cell.data;

    const text = value;
    const isYes = value === "YES";

    ctx.save();

    if (isLocked) {
      ctx.fillStyle = theme.textLight;
    } else {
      ctx.fillStyle = isYes ? "#22c55e" : "#ef4444";
    }

    ctx.font = `600 ${theme.baseFontStyle.split(" ").slice(1).join(" ")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();

    return true;
  },

  provideEditor: (cell) => {
    if (cell.data.isLocked) {
      return undefined;
    }

    return {
      editor: TriggerEnabledCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default TriggerEnabledCellRenderer;
