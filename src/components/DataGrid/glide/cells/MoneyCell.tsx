import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../types";

type MoneyCellData = {
  kind: "money-cell";
  value: string | number | null;
  metadata?: {
    currency_code?: string;
    currency_symbol?: string;
    scale?: number | null;
  } & Record<string, unknown>;
};

export type MoneyCustomCell = CustomCell<MoneyCellData>;

const formatMoney = (
  value: string | number,
  currency_code?: string,
  scale?: number | null,
  currency_symbol?: string,
): string => {
  const n = typeof value === "number" ? value : Number(value);
  if (!isFinite(n)) return String(value);
  if (currency_code) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency_code,
      minimumFractionDigits:
        typeof scale === "number" && scale >= 0 ? scale : undefined,
      maximumFractionDigits:
        typeof scale === "number" && scale >= 0 ? scale : undefined,
    }).format(n);
  }
  const basic = n.toLocaleString(undefined, {
    minimumFractionDigits:
      typeof scale === "number" && scale >= 0 ? scale : undefined,
    maximumFractionDigits:
      typeof scale === "number" && scale >= 0 ? scale : undefined,
  });
  return currency_symbol ? `${currency_symbol}${basic}` : basic;
};

export const MoneyCell: CustomRenderer<MoneyCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is MoneyCustomCell => {
    return (cell as any)?.data?.kind === "money-cell";
  },
  draw: (args: DrawArgs<MoneyCustomCell>, cell: MoneyCustomCell) => {
    const ctx = args.ctx as CanvasRenderingContext2D;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value, metadata } = cell.data;

    let text = "NULL";
    if (value !== null && value !== undefined) {
      text = formatMoney(
        value,
        metadata?.currency_code,
        metadata?.scale ?? null,
        metadata?.currency_symbol,
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
        <div className="p-2 text-xs min-w-[160px]">{text || "No value"}</div>
      );
    },
    disablePadding: true,
  }),
};
