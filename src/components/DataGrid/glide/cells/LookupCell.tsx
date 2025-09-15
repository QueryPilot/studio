import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { truncateTextToWidth } from "../types";

type LookupCellData = {
  kind: "lookup-cell";
  value: unknown;
  metadata?: { label?: string } & Record<string, unknown>;
};

export type LookupCustomCell = CustomCell<LookupCellData>;

export const LookupCell: CustomRenderer<LookupCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is LookupCustomCell => {
    return (cell as any)?.data?.kind === "lookup-cell";
  },
  draw: (
    args: DrawArgs<LookupCustomCell>,
    cell: LookupCellData & CustomCell["data"],
  ) => {
    const ctx = args.ctx as CanvasRenderingContext2D;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value, metadata } = cell as any;

    let text = "NULL";
    if (value !== null && value !== undefined) {
      if (typeof value === "string" || typeof value === "number") {
        text = String(value);
      } else if (
        (metadata as any)?.label &&
        typeof (metadata as any).label === "string"
      ) {
        text = (metadata as any).label;
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
    ctx.fillStyle = isNull ? theme.textLight : theme.textDark;
    ctx.font = isNull ? `italic ${baseFont}` : baseFont;
    // if (isNull) ctx.globalAlpha = 0.55;
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
      const text = String(props.value.data.value ?? "");
      return (
        <div className="p-2 text-xs min-w-[220px] max-w-[420px] overflow-hidden">
          <div className="truncate" title={text}>
            {text || "No value"}
          </div>
        </div>
      );
    },
    disablePadding: true,
  }),
};
