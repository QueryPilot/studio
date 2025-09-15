import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../types";

type DateTimeCellData = {
  kind: "datetime-cell";
  value: Date | string | null;
  metadata?: Record<string, unknown> & { timezone?: string };
};

export type DateTimeCustomCell = CustomCell<DateTimeCellData>;

export const DateTimeCell: CustomRenderer<DateTimeCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is DateTimeCustomCell => {
    return (cell as any)?.data?.kind === "datetime-cell";
  },
  draw: (args: DrawArgs<DateTimeCustomCell>, cell: DateTimeCustomCell) => {
    const ctx = args.ctx;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value } = cell.data;

    let text = "NULL";
    if (value != null) {
      if (typeof value === "string") {
        text = value; // keep original
      } else if (value instanceof Date && !isNaN(value.getTime())) {
        text = value.toISOString();
      }
    }

    const isNull = value == null;
    ctx.fillStyle = isNull ? theme.textLight : theme.textDark;
    const baseFont = theme.baseFontStyle || "12px sans-serif";
    ctx.font = isNull ? `italic ${baseFont}` : baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padding = theme.cellHorizontalPadding ?? 6;
    const maxTextWidth = Math.max(0, rect.width - padding * 2);
    const display = truncateTextToWidth(
      text,
      maxTextWidth,
      theme.baseFontStyle || "12px sans-serif",
    );

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    // keep full opacity for red NULL
    ctx.fillText(display, rect.x + padding, rect.y + rect.height / 2);
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: (props) => {
      // For now reuse Date calendar (date portion). Time editing later.

      return (
        <div className="p-2 text-xs text-muted-foreground">
          Inline editor TBD
        </div>
      );
    },
    disablePadding: true,
  }),
};
