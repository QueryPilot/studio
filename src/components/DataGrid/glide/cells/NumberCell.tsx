import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../types";

type NumberCellData = {
  kind: "number-cell";
  value: string | number | null;
  metadata?: { precision?: number | null; scale?: number | null } & Record<
    string,
    unknown
  >;
};

export type NumberCustomCell = CustomCell<NumberCellData>;

const formatNumber = (
  value: string | number,
  precision?: number | null,
  scale?: number | null,
): string => {
  const n = typeof value === "number" ? value : Number(value);
  if (!isFinite(n)) return String(value);
  const minFrac = typeof scale === "number" && scale >= 0 ? scale : undefined;
  const maxFrac = typeof scale === "number" && scale >= 0 ? scale : undefined;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
    useGrouping: true,
  }).format(n);
};

export const NumberCell: CustomRenderer<NumberCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is NumberCustomCell => {
    return (cell as any)?.data?.kind === "number-cell";
  },
  draw: (args: DrawArgs<NumberCustomCell>, cell: NumberCustomCell) => {
    const ctx = args.ctx as CanvasRenderingContext2D;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value, metadata } = cell.data;

    let text = "NULL";
    if (value !== null && value !== undefined) {
      text = formatNumber(
        value,
        metadata?.precision ?? null,
        metadata?.scale ?? null,
      );
    }

    const baseFont = theme.baseFontStyle || "12px sans-serif";
    const isNull = value == null;
    ctx.fillStyle = theme.textDark;
    ctx.font = isNull ? `italic ${baseFont}` : baseFont;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const padding = theme.cellHorizontalPadding ?? 6;
    const maxTextWidth = Math.max(0, rect.width - padding * 2);
    const display = truncateTextToWidth(text, maxTextWidth, baseFont);
    if (isNull) ctx.globalAlpha = 0.55;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.fillText(
      display,
      rect.x + rect.width - padding,
      rect.y + rect.height / 2,
    );
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: (props) => {
      const v = props.value.data.value;
      const text = v == null ? "" : String(v);
      return (
        <div className="p-2 text-xs min-w-[140px]">{text || "No value"}</div>
      );
    },
    disablePadding: true,
  }),
};
