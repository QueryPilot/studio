import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../types";

type BinaryCellData = {
  kind: "binary-cell";
  value: Uint8Array | string | null;
  metadata?: { byte_size?: number } & Record<string, unknown>;
};

export type BinaryCustomCell = CustomCell<BinaryCellData>;

const toHexPreview = (v: Uint8Array | string): string => {
  if (typeof v === "string") return v.length > 64 ? v.slice(0, 61) + "..." : v;
  const len = Math.min(24, v.length);
  let out = "0x";
  for (let i = 0; i < len; i++) out += v[i].toString(16).padStart(2, "0");
  if (v.length > len) out += "...";
  return out;
};

export const BinaryCell: CustomRenderer<BinaryCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is BinaryCustomCell => {
    return (cell as any)?.data?.kind === "binary-cell";
  },
  draw: (args: DrawArgs<BinaryCustomCell>, cell: BinaryCustomCell) => {
    const ctx = args.ctx as CanvasRenderingContext2D;
    const rect = args.rect;
    const theme = args.theme as Theme;

    const { value, metadata } = cell.data;
    let text = "NULL";
    if (value !== null && value !== undefined) {
      text = toHexPreview(value);
      if (metadata?.byte_size) text += ` (${metadata.byte_size}B)`;
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
    const display = truncateTextToWidth(
      isNull ? text.toUpperCase() : text,
      maxTextWidth,
      baseFont,
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
    editor: (props) => {
      const v = props.value.data.value;
      const text = v == null ? "" : toHexPreview(v);
      return (
        <div className="p-2 text-xs min-w-[220px]">{text || "No data"}</div>
      );
    },
    disablePadding: true,
  }),
};
