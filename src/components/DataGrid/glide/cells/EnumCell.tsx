import {
  GridCellKind,
  type CustomCell,
  type DrawArgs,
  type CustomRenderer,
  type Theme,
} from "@glideapps/glide-data-grid";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { truncateTextToWidth } from "../types";

type EnumCellData = {
  kind: "enum-cell";
  value: string | null;
  metadata?: { enum_values?: string[] } & Record<string, unknown>;
};

export type EnumCustomCell = CustomCell<EnumCellData>;

export const EnumCell: CustomRenderer<EnumCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is EnumCustomCell => {
    return (cell as any)?.data?.kind === "enum-cell";
  },
  draw: (args: DrawArgs<EnumCustomCell>, cell: EnumCustomCell) => {
    const ctx = args.ctx as CanvasRenderingContext2D;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value } = cell.data;
    const text = value ?? "Select…";

    const baseFont = theme.baseFontStyle || "12px sans-serif";
    const isNull = value == null;
    ctx.fillStyle = isNull ? theme.textLight : theme.textDark;
    ctx.font = isNull ? `italic ${baseFont}` : baseFont;
    // if (isNull) ctx.globalAlpha = 0.55;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padding = theme.cellHorizontalPadding ?? 6;
    const maxTextWidth = Math.max(0, rect.width - padding * 2 - 16);
    const display = truncateTextToWidth(
      text,
      maxTextWidth,
      theme.baseFontStyle || "12px sans-serif",
    );
    // Clip to cell rect to preserve selection visuals
    (ctx as CanvasRenderingContext2D).save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.fillText(display, rect.x + padding, rect.y + rect.height / 2);
    (ctx as CanvasRenderingContext2D).restore();

    // dropdown glyph
    ctx.fillStyle = theme.textLight as string;
    const gx = rect.x + rect.width - 14;
    const gy = rect.y + rect.height / 2;
    ctx.beginPath();
    ctx.moveTo(gx - 4, gy - 2);
    ctx.lineTo(gx + 4, gy - 2);
    ctx.lineTo(gx, gy + 2);
    ctx.closePath();
    ctx.fill();
    return true;
  },
  provideEditor: () => ({
    editor: (props) => {
      const options = props.value.data.metadata?.enum_values ?? [];
      const current = props.value.data.value ?? "";
      return (
        <div className="p-2 min-w-[200px]">
          <Select
            value={current}
            onValueChange={(v) => {
              props.onChange({
                ...props.value,
                data: { ...props.value.data, value: v },
              });
            }}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
              {options.length === 0 && (
                <SelectItem value="" disabled>
                  No options
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      );
    },
    disablePadding: true,
  }),
};
