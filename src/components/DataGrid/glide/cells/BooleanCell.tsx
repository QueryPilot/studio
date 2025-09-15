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

type BooleanCellData = {
  kind: "boolean-cell";
  value: unknown;
  metadata?: Record<string, unknown>;
};

export type BooleanCustomCell = CustomCell<BooleanCellData>;

export const BooleanCell: CustomRenderer<BooleanCustomCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is BooleanCustomCell => {
    return (
      (cell as CustomCell<{ kind?: unknown }>).data.kind === "boolean-cell"
    );
  },
  draw: (args: DrawArgs<BooleanCustomCell>, cell: BooleanCustomCell) => {
    const ctx: CanvasRenderingContext2D = args.ctx;
    const rect = args.rect;
    const theme = args.theme as Theme;
    const { value } = cell.data;

    const parseBoolean = (v: unknown): boolean | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y")
          return true;
        if (s === "false" || s === "f" || s === "0" || s === "no" || s === "n")
          return false;
        return Boolean(s);
      }
      return Boolean(v);
    };

    const parsed = parseBoolean(value);

    const text = parsed === null ? "NULL" : parsed ? "TRUE" : "FALSE";
    const color =
      parsed === null ? theme.textLight : parsed ? "#10b981" : "#ef4444";
    const baseFont = theme.baseFontStyle || `11px ${theme.fontFamily}`;

    // badge
    ctx.font = parsed === null ? `italic ${baseFont}` : baseFont;
    if (parsed === null) ctx.globalAlpha = 0.55;
    const w = ctx.measureText(text).width + 12;
    const h = 18;
    const x = rect.x + 8;
    const y = rect.y + (rect.height - h) / 2;

    ctx.fillStyle = `${color}20`;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rctx = ctx as CanvasRenderingContext2D & {
      roundRect?: (
        x: number,
        y: number,
        w: number,
        h: number,
        r: number,
      ) => void;
    };
    if (typeof rctx.roundRect === "function") {
      rctx.roundRect(x, y, w, h, 4);
    } else {
      // fallback rounded rect
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + w - 4, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + 4);
      ctx.lineTo(x + w, y + h - 4);
      ctx.quadraticCurveTo(x + w, y + h, x + w - 4, y + h);
      ctx.lineTo(x + 4, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - 4);
      ctx.lineTo(x, y + 4);
      ctx.quadraticCurveTo(x, y, x + 4, y);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2);

    return true;
  },
  provideEditor: () => ({
    editor: (props) => {
      const parseBoolean = (v: unknown): boolean | null => {
        if (v === null || v === undefined) return null;
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        if (typeof v === "string") {
          const s = v.trim().toLowerCase();
          if (
            s === "true" ||
            s === "t" ||
            s === "1" ||
            s === "yes" ||
            s === "y"
          )
            return true;
          if (
            s === "false" ||
            s === "f" ||
            s === "0" ||
            s === "no" ||
            s === "n"
          )
            return false;
          return Boolean(s);
        }
        return Boolean(v);
      };
      const current = parseBoolean(props.value.data.value);
      const str = current === null ? "null" : current ? "true" : "false";
      return (
        <div className="p-2 min-w-[160px]">
          <Select
            value={str}
            onValueChange={(v) => {
              const newValue = v === "null" ? null : v === "true";
              props.onChange({
                ...props.value,
                data: { ...props.value.data, value: newValue },
              });
            }}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">TRUE</SelectItem>
              <SelectItem value="false">FALSE</SelectItem>
              <SelectItem value="null">NULL</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    },
    disablePadding: true,
  }),
};
