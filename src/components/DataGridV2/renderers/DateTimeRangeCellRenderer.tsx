import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, X as ClearIcon } from "lucide-react";
import { ToggleButton } from "@/components/ui/toggle-button";
import { truncateTextToWidth } from "../utils/textUtils";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Bounds = "[]" | "[)" | "(]" | "()";

export interface TstzRangeCellData {
  kind: "tstzrange-cell";
  // Canonical text representation, e.g. "[2025-01-01T00:00:00Z,2025-01-02T00:00:00Z)"
  value: string | null;
}

export interface TstzRangeCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: TstzRangeCellData;
  copyData: string;
  readonly?: boolean;
}

const parseRange = (
  input: string | null | undefined,
): { lower: string | null; upper: string | null; bounds: Bounds } => {
  if (!input) return { lower: null, upper: null, bounds: "[)" };
  const trimmed = input.trim();
  const lb = trimmed[0] === "(" ? "(" : "[";
  const ub = trimmed[trimmed.length - 1] === ")" ? ")" : "]";
  const inner = trimmed.substring(1, trimmed.length - 1);
  // naive split – timestamps won't contain top-level commas here
  const parts = inner.split(",");
  const lower = (parts[0]?.trim() || null);
  const upper = (parts[1]?.trim() || null);
  return { lower, upper, bounds: (lb + ub) as Bounds };
};

const buildText = (value: string | null): string => {
  const { lower, upper } = parseRange(value);
  const l = lower ?? "";
  const u = upper ?? "";
  if (!l && !u) return "";
  return `${l} — ${u}`.trim();
};

// Editor
interface RangeEditorProps {
  value: TstzRangeCustomCell;
  onFinishedEditing: (
    newValue?: TstzRangeCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const DateTimeRangeCellEditor: React.FC<RangeEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const { value: raw } = value.data;
  const parsed = useMemo(() => parseRange(raw), [raw]);
  const [lowerText, setLowerText] = useState<string>(parsed.lower ?? "");
  const [upperText, setUpperText] = useState<string>(parsed.upper ?? "");
  const [bounds, setBounds] = useState<Bounds>(parsed.bounds);
  const [openRange, setOpenRange] = useState(false);
  const finishedRef = useRef(false);

  // No auto-open; keep UI steady

  const commit = useCallback(
    (lower: string | null, upper: string | null, b: Bounds = bounds) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const text = `${b[0]}${lower ?? ""},${upper ?? ""}${b[1]}`;
      const next: TstzRangeCustomCell = {
        kind: value.kind,
        data: { ...value.data, value: text },
        copyData: text,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };
      setOpenRange(false);
      Promise.resolve().then(() => { onFinishedEditing(next); });
    },
    [bounds, onFinishedEditing, value],
  );

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (finishedRef.current) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      setOpenRange(false);
      onFinishedEditing(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit(lowerText.trim() || null, upperText.trim() || null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;
      setOpenRange(false);
      onFinishedEditing(value, movement);
    }
  };

  const [tz, setTz] = useState<string>(() => {
    try {
      const g = (dayjs as any).tz?.guess?.() as string | undefined;
      // Validate IANA
      if (g) {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: g }).format(new Date());
          return g;
        } catch {
          return "UTC";
        }
      }
      return "UTC";
    } catch {
      return "UTC";
    }
  });

  const toDate = (text: string): Date | undefined => {
    if (!text) return undefined;
    const hasOffset = /([+-]\d{2}:?\d{2}|Z)$/.test(text);
    const d = hasOffset
      ? dayjs(text)
      : (dayjs as any).tz?.(text, tz) ?? dayjs(text);
    return d.isValid() ? d.toDate() : undefined;
  };

  // cycle helpers
  const cycleLower = () =>
    { setBounds((prev) =>
      prev[0] === "["
        ? (("(" + prev[1]) as Bounds)
        : (("[" + prev[1]) as Bounds),
    ); };
  const cycleUpper = () =>
    { setBounds((prev) =>
      prev[1] === "]"
        ? ((prev[0] + ")") as Bounds)
        : ((prev[0] + "]") as Bounds),
    ); };

  return (
    <div className="w-full h-full flex items-center gap-2 px-2 click-outside-ignore">
      {/* Left bound toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-xs"
        title="Toggle lower bound"
        onClick={cycleLower}
      >
        {bounds[0]}
      </Button>

      {/* Lower input */}
      <input
        className="h-[31px] w-[200px] bg-transparent text-xs leading-6 outline-none"
        placeholder="lower ISO"
        autoFocus
        value={lowerText}
        onChange={(e) => { setLowerText(e.target.value); }}
        onKeyDown={handleKeyDown}
      />

      <span className="text-xs text-muted-foreground">to</span>

      {/* Upper input */}
      <input
        className="h-[31px] w-[200px] bg-transparent text-xs leading-6 outline-none"
        placeholder="upper ISO"
        value={upperText}
        onChange={(e) => { setUpperText(e.target.value); }}
        onKeyDown={handleKeyDown}
      />

      {/* Right bound toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-xs"
        title="Toggle upper bound"
        onClick={cycleUpper}
      >
        {bounds[1]}
      </Button>

      {/* Clear + unified dual-calendar trigger aligned to the far right */}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          className="h-6 w-6 p-0 z-[9999]"
          title="Clear"
          onClick={() => { commit(null, null, bounds); }}
        >
          <ClearIcon className="h-3 w-3" />
        </Button>

        <Popover open={openRange} onOpenChange={setOpenRange}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="h-6 w-6 p-0 z-[9999]"
              title="Pick range"
            >
              <CalendarIcon className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="p-2 rounded-xl click-outside-ignore z-[9999]"
          >
            <div className="flex items-start gap-3">
              <Calendar
                mode="single"
                month={toDate(lowerText) ?? new Date()}
                selected={toDate(lowerText)}
                defaultMonth={toDate(lowerText) ?? new Date()}
                onSelect={(d) => {
                  if (!d) return;
                  dayjs.extend(utc);
                  dayjs.extend(timezone);
                  const from = dayjs(toDate(lowerText) ?? d);
                  const next = dayjs(d)
                    .hour(from.hour())
                    .minute(from.minute())
                    .second(from.second())
                    .millisecond(from.millisecond());
                  setLowerText(next.tz(tz).format("YYYY-MM-DDTHH:mm:ss.SSSZ"));
                }}
                captionLayout="dropdown"
              />
              <Calendar
                mode="single"
                month={toDate(upperText) ?? new Date()}
                selected={toDate(upperText)}
                defaultMonth={toDate(upperText) ?? new Date()}
                onSelect={(d) => {
                  if (!d) return;
                  dayjs.extend(utc);
                  dayjs.extend(timezone);
                  const to = dayjs(toDate(upperText) ?? d);
                  const next = dayjs(d)
                    .hour(to.hour())
                    .minute(to.minute())
                    .second(to.second())
                    .millisecond(to.millisecond());
                  setUpperText(next.tz(tz).format("YYYY-MM-DDTHH:mm:ss.SSSZ"));
                }}
                captionLayout="dropdown"
              />
              <div className="flex flex-col gap-2 pl-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs w-10 text-muted-foreground">
                    From
                  </span>
                  <input
                    className="h-7 w-28 bg-transparent text-xs leading-6 outline-none border-b border-border"
                    value={dayjs(toDate(lowerText) ?? new Date()).format(
                      "HH:mm:ss",
                    )}
                    onChange={(e) => {
                      dayjs.extend(utc);
                      dayjs.extend(timezone);
                      const base = dayjs(
                        toDate(lowerText) ?? new Date(),
                      ).format("YYYY-MM-DD");
                      const parsed = dayjs.tz(`${base}T${e.target.value}`, tz);
                      if (parsed.isValid())
                        setLowerText(parsed.format("YYYY-MM-DDTHH:mm:ss.SSSZ"));
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs w-10 text-muted-foreground">To</span>
                  <input
                    className="h-7 w-28 bg-transparent text-xs leading-6 outline-none border-b border-border"
                    value={dayjs(toDate(upperText) ?? new Date()).format(
                      "HH:mm:ss",
                    )}
                    onChange={(e) => {
                      dayjs.extend(utc);
                      dayjs.extend(timezone);
                      const base = dayjs(
                        toDate(upperText) ?? new Date(),
                      ).format("YYYY-MM-DD");
                      const parsed = dayjs.tz(`${base}T${e.target.value}`, tz);
                      if (parsed.isValid())
                        setUpperText(parsed.format("YYYY-MM-DDTHH:mm:ss.SSSZ"));
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs w-10 text-muted-foreground">TZ</span>
                  <Select value={tz} onValueChange={setTz}>
                    <SelectTrigger className="h-7 px-2 text-xs w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 text-xs">
                      {Array.from(
                        new Set([
                          tz,
                          "UTC",
                          "America/Los_Angeles",
                          "America/New_York",
                          "Europe/London",
                          "Europe/Berlin",
                          "Asia/Singapore",
                          "Asia/Ho_Chi_Minh",
                          "Asia/Tokyo",
                          "Asia/Shanghai",
                          "Australia/Sydney",
                        ]),
                      ).map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};

export const DateTimeRangeCellEditorWithProps = Object.assign(
  DateTimeRangeCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);

const DateTimeRangeCellRenderer: CustomCellRenderer<TstzRangeCustomCell> = {
  isMatch: (cell: CustomCell): cell is TstzRangeCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "tstzrange-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const text = buildText(cell.data.value);
    const isEmpty = text.length === 0;

    // Match NULL styling used by default text cells and ensure full font family is set
    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `${theme.baseFontStyle} ${fontFamily}`;
    ctx.fillStyle = isEmpty ? "rgba(127,127,127,0.7)" : theme.textDark;
    ctx.font = isEmpty ? `italic ${baseFont}` : baseFont; // only NULL italic
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padding =
      typeof theme.cellHorizontalPadding === "number"
        ? theme.cellHorizontalPadding
        : 8;
    const maxWidth = Math.max(0, rect.width - padding * 2);
    const displayText = isEmpty
      ? "NULL"
      : truncateTextToWidth(text, maxWidth, ctx.font);
    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);
    return true;
  },

  provideEditor: () => {
    return {
      editor: DateTimeRangeCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default DateTimeRangeCellRenderer;
