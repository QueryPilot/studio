import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../types";

type UuidCellData = {
  kind: "uuid-cell";
  value: string | null;
  metadata?: Record<string, unknown>;
};

export type UuidCustomCell = CustomCell<UuidCellData>;

export const UuidCell: CustomRenderer<UuidCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is UuidCustomCell => {
    return (cell as any)?.data?.kind === "uuid-cell";
  },
  draw: (args: DrawArgs<UuidCustomCell>, cell: UuidCustomCell) => {
    const ctx = args.ctx as CanvasRenderingContext2D;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value } = cell.data;

    const text = value ?? "NULL";
    const baseFont = theme.baseFontStyle || "12px sans-serif";
    const isNull = value == null;
    ctx.fillStyle = theme.textDark;
    ctx.font = isNull ? `italic ${baseFont}` : baseFont;
    if (isNull) ctx.globalAlpha = 0.55;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padding = theme.cellHorizontalPadding ?? 6;
    const maxTextWidth = Math.max(0, rect.width - padding * 2);
    const display = truncateTextToWidth(text, maxTextWidth, baseFont);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.fillText(display, rect.x + padding, rect.y + rect.height / 2);
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: (props) => {
      const v = props.value.data.value ?? "";
      return (
        <div className="p-2 text-xs min-w-[260px]">
          <div className="truncate" title={v}>
            {v || "No value"}
          </div>
        </div>
      );
    },
    disablePadding: true,
  }),
};
