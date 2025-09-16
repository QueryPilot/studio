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

type BooleanCellData = {
  kind: "boolean-cell";
  value: unknown;
  metadata?: Record<string, unknown>;
};

export type BooleanCustomCell = CustomCell<BooleanCellData>;

export const BooleanCell: CustomRenderer<BooleanCustomCell> = {
  kind: GridCellKind.Custom,
  needsHover: true,
  needsHoverPosition: true,
  isMatch: (cell: CustomCell): cell is BooleanCustomCell => {
    return (
      (cell as CustomCell<{ kind?: unknown }>).data.kind === "boolean-cell"
    );
  },
  draw: (args: DrawArgs<BooleanCustomCell>, cell: BooleanCustomCell) => {
    const ctx = args.ctx;
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
      parsed === null
        ? theme.textLight
        : parsed
        ? theme.accentColor || "#FCA311"
        : theme.textDark;
    const baseFont = theme.baseFontStyle || `12px ${theme.fontFamily}`;

    // text only, no background fill to keep selection visible
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.font = parsed === null ? `italic ${baseFont}` : baseFont;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const horizontalPadding = (theme.cellHorizontalPadding || 6) + 2;
    const extraRight = 0; // HTML overlay handles its own layout; no canvas reserve
    const maxTextWidth = Math.max(
      0,
      rect.width - horizontalPadding * 2 - extraRight,
    );
    const display = truncateTextToWidth(text, maxTextWidth, baseFont);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    ctx.fillText(display, cx, cy);

    ctx.restore();
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
