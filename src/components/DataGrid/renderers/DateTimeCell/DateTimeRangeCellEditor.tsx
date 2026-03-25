/* eslint-disable @typescript-eslint/restrict-plus-operands */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  IconCalendar as CalendarIcon,
  IconX as ClearIcon,
  IconKey,
} from "@tabler/icons-react";

import dayjs from "dayjs";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseRange } from "./utils";
import type { Bounds, TstzRangeCustomCell } from "./types";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

const TZ_OFFSET_REGEX = /([+-]\d{2}:?\d{2}|Z)$/;

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
  const { value: raw, columnName, isPrimaryKey, dbType } = value.data;
  const parsed = useMemo(() => parseRange(raw), [raw]);
  const [lowerText, setLowerText] = useState<string>(parsed.lower ?? "");
  const [upperText, setUpperText] = useState<string>(parsed.upper ?? "");
  const [bounds, setBounds] = useState<Bounds>(parsed.bounds);
  const [openRange, setOpenRange] = useState(false);
  const finishedRef = useRef(false);
  const originalValueRef = useRef(raw); // Store original value for change detection

  // No auto-open; keep UI steady

  const commit = useCallback(
    (lower: string | null, upper: string | null, b: Bounds) => {
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
      void Promise.resolve().then(() => {
        onFinishedEditing(next);
      });
    },
    [bounds, onFinishedEditing, value],
  );

  const commitCurrentValues = useCallback(() => {
    const nextLower = lowerText.trim() || null;
    const nextUpper = upperText.trim() || null;
    const currentValue = `${bounds[0]}${nextLower ?? ""},${nextUpper ?? ""}${
      bounds[1]
    }`;

    // Normalize whitespace around comma for comparison
    const normalize = (s: string | null) => s?.replace(/,\s*/g, ",") ?? "";
    const hasChanged = normalize(currentValue) !== normalize(originalValueRef.current);

    // If no changes were made, cancel the edit
    if (!hasChanged) {
      finishedRef.current = true;
      setOpenRange(false);
      onFinishedEditing(undefined);
      return;
    }

    // Commit the changed value
    commit(nextLower, nextUpper, bounds);
  }, [bounds, commit, lowerText, upperText, onFinishedEditing]);

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
      commitCurrentValues();
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;
      setOpenRange(false);

      const nextLower = lowerText.trim() || null;
      const nextUpper = upperText.trim() || null;
      const text = `${bounds[0]}${nextLower ?? ""},${nextUpper ?? ""}${
        bounds[1]
      }`;
      const normalizeRange = (s: string | null) => s?.replace(/,\s*/g, ",") ?? "";
      const hasChanged = normalizeRange(text) !== normalizeRange(originalValueRef.current);

      // If no changes, cancel and move
      if (!hasChanged) {
        onFinishedEditing(undefined, movement);
        return;
      }

      // Commit the current range values before moving
      const newCell: TstzRangeCustomCell = {
        kind: value.kind,
        data: { ...value.data, value: text },
        copyData: text,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell, movement);
    }
  };

  const [tz, setTz] = useState<string>(() => {
    try {
      const g = dayjs.tz.guess();
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

  // cycle helpers
  const cycleLower = () => {
    setBounds((prev) =>
      prev[0] === "["
        ? (("(" + prev[1]) as Bounds)
        : (("[" + prev[1]) as Bounds),
    );
  };
  const cycleUpper = () => {
    setBounds((prev) =>
      prev[1] === "]"
        ? ((prev[0] + ")") as Bounds)
        : ((prev[0] + "]") as Bounds),
    );
  };

  // Memoize date parsing so dayjs objects are only created when text/tz change
  const { lowerDateValue, upperDateValue, lowerTimeValue, upperTimeValue } =
    useMemo(() => {
      const toDate = (text: string): Date | undefined => {
        if (!text) return undefined;
        const hasOffset = TZ_OFFSET_REGEX.test(text);
        // Use dayjs.utc() for offset-aware strings to avoid WebKit's new Date()
        // misinterpreting timezone offsets (e.g. parsing +00:00 as local time).
        const d = hasOffset ? dayjs.utc(text) : dayjs.tz(text, tz);
        return d.isValid() ? d.toDate() : undefined;
      };
      const lower = toDate(lowerText);
      const upper = toDate(upperText);
      // Extract time directly from the text to avoid UTC conversion shifting the display
      const extractTime = (text: string): string => {
        const m = text.match(/[T ](\d{2}:\d{2}:\d{2})/);
        return m?.[1] ?? "00:00:00";
      };
      return {
        lowerDateValue: lower,
        upperDateValue: upper,
        lowerTimeValue: lowerText ? extractTime(lowerText) : "00:00:00",
        upperTimeValue: upperText ? extractTime(upperText) : "00:00:00",
      };
    }, [lowerText, upperText, tz]);
  const displayLowerDate = lowerDateValue ?? new Date();
  const displayUpperDate = upperDateValue ?? new Date();

  useCommitOnUnmount(finishedRef, commitCurrentValues);

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50 gdg-editor-shell">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
        )}
        <span className="text-[10px] font-medium text-foreground/80">
          {columnName}
        </span>
        {dbType && (
          <span className="text-[9px] text-muted-foreground ml-auto">
            {dbType}
          </span>
        )}
      </div>

      {/* Range inputs */}
      <div className="flex-1 flex items-center gap-2 px-2">
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
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-[31px] w-[200px] bg-transparent text-xs leading-6 outline-none"
          placeholder="lower ISO"
          autoFocus
          value={lowerText}
          onChange={(e) => {
            setLowerText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
        />

        <span className="text-xs text-muted-foreground">to</span>

        {/* Upper input */}
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-[31px] w-[200px] bg-transparent text-xs leading-6 outline-none"
          placeholder="upper ISO"
          value={upperText}
          onChange={(e) => {
            setUpperText(e.target.value);
          }}
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
            className="h-6 w-6 p-0 z-50"
            title="Clear"
            onClick={() => {
              commit(null, null, bounds);
            }}
          >
            <ClearIcon className="h-3 w-3" />
          </Button>

          <Popover open={openRange} onOpenChange={setOpenRange}>
            <PopoverTrigger
              className="h-6 w-6 p-0 z-50 inline-flex items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground"
              title="Pick range"
            >
              <CalendarIcon className="h-3 w-3" />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={12}
              className="w-[640px] max-w-[90vw] rounded-xl click-outside-ignore p-0 z-100"
            >
              <div className="flex flex-col gap-3 p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border bg-card p-3">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      Start
                    </span>
                    <CalendarPicker
                      mode="single"
                      month={displayLowerDate}
                      selected={lowerDateValue}
                      defaultMonth={displayLowerDate}
                      onSelect={(d) => {
                        if (!d) return;
                        // Replace only the date portion, preserving time + sub-seconds + offset
                        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                        const timeAndRest = lowerText.match(/[T ](.+)/)?.[1] ?? "00:00:00";
                        setLowerText(`${dateStr}T${timeAndRest}`);
                      }}
                      captionLayout="dropdown"
                      className="mt-2 border-0 bg-transparent p-0 shadow-none"
                    />
                    <div className="flex items-center gap-2 pt-3">
                      <span className="w-12 text-xs text-muted-foreground">
                        Time
                      </span>
                      <Input
                        type="time"
                        step="1"
                        value={lowerTimeValue}
                        onChange={(e) => {
                          // Replace only the time portion, preserving date + sub-seconds + offset
                          const dateMatch = lowerText.match(/^(\d{4}-\d{2}-\d{2})/);
                          const dateStr = dateMatch?.[1] ?? dayjs(displayLowerDate).format("YYYY-MM-DD");
                          const subsecAndOffset = lowerText.match(/\d{2}:\d{2}:\d{2}(\.[\d]+)?([+-]\d{2}:\d{2}|Z)?$/);
                          const subsec = subsecAndOffset?.[1] ?? "";
                          const offset = subsecAndOffset?.[2] ?? "";
                          setLowerText(`${dateStr}T${e.target.value}${subsec}${offset}`);
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card p-3">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      End
                    </span>
                    <CalendarPicker
                      mode="single"
                      month={displayUpperDate}
                      selected={upperDateValue}
                      defaultMonth={displayUpperDate}
                      onSelect={(d) => {
                        if (!d) return;
                        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                        const timeAndRest = upperText.match(/[T ](.+)/)?.[1] ?? "00:00:00";
                        setUpperText(`${dateStr}T${timeAndRest}`);
                      }}
                      captionLayout="dropdown"
                      className="mt-2 border-0 bg-transparent p-0 shadow-none"
                    />
                    <div className="flex items-center gap-2 pt-3">
                      <span className="w-12 text-xs text-muted-foreground">
                        Time
                      </span>
                      <Input
                        type="time"
                        step="1"
                        value={upperTimeValue}
                        onChange={(e) => {
                          const dateMatch = upperText.match(/^(\d{4}-\d{2}-\d{2})/);
                          const dateStr = dateMatch?.[1] ?? dayjs(displayUpperDate).format("YYYY-MM-DD");
                          const subsecAndOffset = upperText.match(/\d{2}:\d{2}:\d{2}(\.[\d]+)?([+-]\d{2}:\d{2}|Z)?$/);
                          const subsec = subsecAndOffset?.[1] ?? "";
                          const offset = subsecAndOffset?.[2] ?? "";
                          setUpperText(`${dateStr}T${e.target.value}${subsec}${offset}`);
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 border-t pt-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Timezone
                  </span>
                  <Select
                    value={tz}
                    onValueChange={(value) => {
                      if (value) {
                        setTz(value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 text-xs click-outside-ignore">
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
            </PopoverContent>
          </Popover>
        </div>
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
