import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../types";

type TimeCellData = {
  kind: "time-cell";
  value: Date | string | null;
  metadata?: Record<string, unknown>;
};

export type TimeCustomCell = CustomCell<TimeCellData>;

export const TimeCell: CustomRenderer<TimeCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is TimeCustomCell => {
    return (cell as any)?.data?.kind === "time-cell";
  },
  draw: (args: DrawArgs<TimeCustomCell>, cell: TimeCustomCell) => {
    const ctx = args.ctx as CanvasRenderingContext2D;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value } = cell.data;

    let text = "NULL";
    if (value != null) {
      if (typeof value === "string") {
        text = value;
      } else if (value instanceof Date && !isNaN(value.getTime())) {
        text = value.toTimeString().slice(0, 8);
      } else {
        text = String(value);
      }
    }

    ctx.fillStyle = theme.textDark;
    const baseFont = theme.baseFontStyle || "12px sans-serif";
    const isNull = value == null;
    ctx.font = isNull ? `italic ${baseFont}` : baseFont;
    if (isNull) ctx.globalAlpha = 0.55;
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
    ctx.fillText(display, rect.x + padding, rect.y + rect.height / 2);
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: () => {
      return (
        <div className="p-2 text-xs text-muted-foreground">
          Inline editor TBD
        </div>
      );
    },
    disablePadding: true,
  }),
};
