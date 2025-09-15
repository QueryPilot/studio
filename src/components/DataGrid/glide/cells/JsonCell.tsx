import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../types";

type JsonCellData = {
  kind: "json-cell";
  value: unknown;
  metadata?: Record<string, unknown>;
};

export type JsonCustomCell = CustomCell<JsonCellData>;

export const JsonCell: CustomRenderer<JsonCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is JsonCustomCell => {
    return (cell as any)?.data?.kind === "json-cell";
  },
  draw: (args: DrawArgs<JsonCustomCell>, cell: JsonCustomCell) => {
    const ctx = args.ctx as CanvasRenderingContext2D;
    const rect = args.rect;
    const theme = args.theme as Theme;

    const { value } = cell.data;
    let text = "NULL";
    if (value !== null && value !== undefined) {
      if (typeof value === "string") {
        text = value;
      } else {
        try {
          text = JSON.stringify(value);
        } catch {
          text = "[object]";
        }
      }
    }

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
      const v = props.value.data.value;
      let pretty = "";
      if (v !== null && v !== undefined) {
        try {
          pretty = typeof v === "string" ? v : JSON.stringify(v, null, 2);
        } catch {
          pretty = String(v);
        }
      }
      return (
        <div className="p-2 min-w-[320px] max-w-[520px] max-h-[360px] overflow-auto text-xs">
          <pre className="whitespace-pre-wrap break-words">{pretty}</pre>
        </div>
      );
    },
    disablePadding: true,
  }),
};
