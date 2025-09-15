import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import { Calendar } from "@/components/ui/calendar";
import { truncateTextToWidth } from "../types";

type DateCellData = {
  kind: "date-cell";
  value: Date | string | null;
  metadata?: Record<string, unknown> & { format?: string };
};

export type DateCustomCell = CustomCell<DateCellData>;

export const DateCell: CustomRenderer<DateCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is DateCustomCell => {
    const c = cell as unknown as { data: { kind?: unknown } };
    return c.data.kind === "date-cell";
  },
  draw: (args: DrawArgs<DateCustomCell>, cell: DateCustomCell) => {
    const ctx = args.ctx;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value } = cell.data;
    const meta = cell.data.metadata as Record<string, unknown> | undefined;
    const dbTypeRaw = (meta?.db_type as string | undefined) ?? "";
    const dbType = dbTypeRaw.toLowerCase();

    const isTimeOnly = dbType.includes("time") && !dbType.includes("date");

    let text = "NULL";
    if (value != null) {
      if (typeof value === "string") {
        // Preserve original incoming string verbatim (including T, fractional seconds, timezone)
        text = value;
      } else if (isTimeOnly) {
        if (value instanceof Date && !isNaN(value.getTime())) {
          text = value.toTimeString().slice(0, 8);
        } else {
          text = String(value);
        }
      } else if (value instanceof Date && !isNaN(value.getTime())) {
        // Fallback when backend provides Date object: keep ISO string
        text = value.toISOString();
      }
    }

    const baseFont = theme.baseFontStyle || "12px sans-serif";
    const isNull = value == null;
    ctx.fillStyle = isNull ? theme.textLight : theme.textDark;
    ctx.font = isNull ? `italic ${baseFont}` : baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padding = (theme.cellHorizontalPadding as number | undefined) ?? 6;
    const maxTextWidth = Math.max(0, rect.width - padding * 2);
    const display = truncateTextToWidth(
      text,
      maxTextWidth,
      theme.baseFontStyle || "12px sans-serif",
    );

    // Clip to cell rect to preserve selection visuals drawn by grid
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
      const raw = props.value.data.value;
      const selected =
        typeof raw === "string" ? new Date(raw) : raw ?? undefined;
      return (
        <div className="p-2">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              props.onChange({
                ...props.value,
                data: { ...props.value.data, value: d ?? null },
              });
            }}
          />
        </div>
      );
    },
    disablePadding: true,
  }),
};
