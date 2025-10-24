import {
  type CustomCell,
  type CustomRenderer,
  type DrawArgs,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../../utils/textUtils";

export interface TextCellData extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "text-cell";
    value: string | null;
    displayValue?: string;
  };
}

export const TextCellRenderer: CustomRenderer<TextCellData> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is TextCellData => {
    return (cell.data as any)?.kind === "text-cell";
  },

  draw: (args: DrawArgs<TextCellData>, cell: TextCellData) => {
    const { ctx, rect, theme } = args;
    const { x, y, width, height } = rect;

    // Get text to render
    const text = cell.data.displayValue ?? cell.data.value ?? "";
    const isNull = cell.data.value === null;

    // Set up text styles
    if (isNull) {
      ctx.fillStyle = theme.textLight;
      ctx.font = `italic ${theme.baseFontStyle}`;
    } else {
      ctx.fillStyle = theme.textDark;
      ctx.font = theme.baseFontStyle;
    }

    // Calculate text metrics
    const padding = theme.cellHorizontalPadding;
    const maxWidth = width - padding * 2;

    // Apply text truncation
    const displayText = isNull
      ? "NULL"
      : truncateTextToWidth(text, maxWidth, ctx.font);

    // Draw text
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(displayText, x + padding, y + height / 2);

    return true;
  },

  provideEditor: () => undefined, // Read-only for now
};
