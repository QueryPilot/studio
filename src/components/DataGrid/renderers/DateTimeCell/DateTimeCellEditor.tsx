import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  IconCalendar as CalendarIcon,
  IconTrash,
  IconClock,
  IconChevronDown,
  IconDeviceFloppy,
  IconKey,
} from "@tabler/icons-react";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { cn } from "@/lib/cn";

import { type DateTimeCustomCell } from "./types";
import { parseDateTime } from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import dayjs from "dayjs";

// Normalize datetime strings for comparison (handles timezone differences)
const normalizeDateTimeForComparison = (
  value: string | null,
): number | null => {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.valueOf() : null;
};

// Time Picker Component (following shadcn pattern)
interface TimePickerProps {
  hour: string;
  minute: string;
  second: string;
  onHourChange: (hour: string) => void;
  onMinuteChange: (minute: string) => void;
  onSecondChange: (second: string) => void;
  className?: string;
}

const TimePicker: React.FC<TimePickerProps> = ({
  hour,
  minute,
  second,
  onHourChange,
  onMinuteChange,
  onSecondChange,
  className,
}) => {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Input
        type="time"
        step="1"
        value={`${hour}:${minute}:${second}`}
        onChange={(e) => {
          const [h, m, s] = e.target.value.split(":");
          if (h) onHourChange(h);
          if (m) onMinuteChange(m);
          if (s) onSecondChange(s);
        }}
        className="bg-background w-full"
      />
    </div>
  );
};

// Editor
interface DateTimeCellEditorProps {
  value: DateTimeCustomCell;
  onFinishedEditing: (
    newValue?: DateTimeCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const DateTimeCellEditor: React.FC<DateTimeCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const {
    kind,
    value: raw,
    nullable,
    columnName,
    isPrimaryKey,
    dbType,
  } = value.data;
  const finishedRef = useRef(false);
  const originalValueRef = useRef(raw); // Store original value for change detection

  // Parse initial value
  const initialParsed = useMemo(() => parseDateTime(raw, kind), [raw, kind]);

  const [selectedDate, setSelectedDate] = useState<Date | null>(
    initialParsed.date,
  );
  const [hour, setHour] = useState(initialParsed.time?.hour ?? "00");
  const [minute, setMinute] = useState(initialParsed.time?.minute ?? "00");
  const [second, setSecond] = useState(initialParsed.time?.second ?? "00");
  const [millisecond, setMillisecond] = useState(
    initialParsed.time?.millisecond ?? "",
  );
  const [selectedTimezone, setSelectedTimezone] = useState<string>(
    initialParsed.timezone ?? "none",
  );
  const [open, setOpen] = useState(false);
  const [timeCollapsed, setTimeCollapsed] = useState(false);
  const [manualText, setManualText] = useState<string>(raw ?? "");
  const [manualDirty, setManualDirty] = useState(false);
  // Skip the initial effect run to preserve original value format
  const hasInitialized = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const buildDateTimeString = useCallback(() => {
    if (kind === "time-cell") {
      let result = `${hour}:${minute}:${second}`;
      if (millisecond) result += `.${millisecond}`;
      if (selectedTimezone && selectedTimezone !== "none")
        result += selectedTimezone === "Z" ? "Z" : selectedTimezone;
      return result;
    }

    if (!selectedDate) return null;

    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const d = String(selectedDate.getDate()).padStart(2, "0");

    if (kind === "date-cell") {
      return `${y}-${m}-${d}`;
    }

    // datetime-cell - use T separator for ISO format consistency
    let result = `${y}-${m}-${d}T${hour}:${minute}:${second}`;
    if (millisecond) result += `.${millisecond}`;
    if (selectedTimezone && selectedTimezone !== "none")
      result += selectedTimezone === "Z" ? "Z" : selectedTimezone;
    return result;
  }, [kind, selectedDate, hour, minute, second, millisecond, selectedTimezone]);

  const commit = useCallback(
    (nextRaw: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const newCell: DateTimeCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextRaw,
        },
        copyData: nextRaw ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };
      setOpen(false);
      void Promise.resolve().then(() => {
        onFinishedEditing(newCell);
      });
    },
    [onFinishedEditing, value],
  );

  const commitCurrentValue = useCallback(() => {
    const trimmed = manualText.trim();
    const currentValue = !trimmed && nullable ? null : trimmed;

    // Check if value actually changed (normalize to handle timezone differences)
    const originalNorm = normalizeDateTimeForComparison(
      originalValueRef.current,
    );
    const currentNorm = normalizeDateTimeForComparison(currentValue);
    const hasChanged = originalNorm !== currentNorm;

    // If no changes were made, cancel the edit
    if (!hasChanged) {
      finishedRef.current = true;
      setOpen(false);
      onFinishedEditing(undefined);
      return;
    }

    // Commit the changed value
    if (!trimmed && nullable) {
      commit(null);
    } else {
      commit(trimmed);
    }
  }, [commit, manualText, nullable, onFinishedEditing]);

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setOpen(false);
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const handleSetNow = useCallback(() => {
    const now = new Date();
    if (kind !== "time-cell") {
      setSelectedDate(now);
    }
    setHour(String(now.getHours()).padStart(2, "0"));
    setMinute(String(now.getMinutes()).padStart(2, "0"));
    setSecond(String(now.getSeconds()).padStart(2, "0"));
    setMillisecond(String(now.getMilliseconds()).padStart(3, "0"));
    setTimeCollapsed(true);
    setManualDirty(false);
  }, [kind]);

  const handleSetToday = useCallback(() => {
    const today = new Date();
    setSelectedDate(today);
    setManualDirty(false);
  }, []);

  const handleSave = useCallback(() => {
    const result = buildDateTimeString();
    commit(result);
  }, [buildDateTimeString, commit]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (finishedRef.current) return;

    // Update the ref with current manual text value before processing keyboard events
    // (manualText state is already being updated via onChange, but ensure we have latest)

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commitCurrentValue();
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;
      setOpen(false);

      // Check if value actually changed (normalize to handle timezone differences)
      const trimmed = manualText.trim();
      const committedValue: string | null =
        !trimmed && nullable ? null : trimmed;
      const originalNorm = normalizeDateTimeForComparison(
        originalValueRef.current,
      );
      const currentNorm = normalizeDateTimeForComparison(committedValue);
      const hasChanged = originalNorm !== currentNorm;

      // If no changes, cancel and move
      if (!hasChanged) {
        onFinishedEditing(undefined, movement);
        return;
      }

      // Commit the current text value before moving
      const newCell: DateTimeCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: committedValue,
        },
        copyData: committedValue ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell, movement);
    }
  };

  const handleDateSelect = useCallback((date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
    }
    setManualDirty(false); // Let sync effect update the text
  }, []);

  const handleHourChange = useCallback((next: string) => {
    setHour(next);
    setManualDirty(false);
  }, []);

  const handleMinuteChange = useCallback((next: string) => {
    setMinute(next);
    setManualDirty(false);
  }, []);

  const handleSecondChange = useCallback((next: string) => {
    setSecond(next);
    setManualDirty(false);
  }, []);

  const handleMillisecondChange = useCallback((value: string) => {
    setMillisecond(value);
    setManualDirty(false);
  }, []);

  const handleTimezoneChange = useCallback((tz: string) => {
    setSelectedTimezone(tz);
    setManualDirty(false);
  }, []);

  // Sync manual text with picker selections (unless user is typing)
  // Skip initial mount to preserve original value format
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      return;
    }
    if (manualDirty) return;
    const built = buildDateTimeString();
    const nextText = built ?? "";
    setManualText((current) => (current === nextText ? current : nextText));
  }, [
    kind,
    selectedDate,
    hour,
    minute,
    second,
    millisecond,
    selectedTimezone,
    manualDirty,
    buildDateTimeString,
  ]);

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  return (
    <div className="w-full h-full flex flex-col relative z-50 gdg-editor-shell">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50 click-outside-ignore">
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

      {/* DateTime input and picker */}
      <div className="flex-1 flex items-center gap-1 px-2 justify-between click-outside-ignore">
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          ref={inputRef}
          className={cn(
            "h-full w-[200px] bg-transparent z-50 text-xs leading-6 outline-none flex-1 min-w-0",
            !manualText ? "italic text-muted-foreground" : "",
          )}
          placeholder={
            kind === "date-cell"
              ? "YYYY-MM-DD"
              : kind === "time-cell"
              ? "HH:mm[:ss]"
              : "YYYY-MM-DD HH:mm[:ss]"
          }
          autoFocus
          value={manualText}
          onChange={(e) => {
            const nextValue = e.target.value;
            setManualText(nextValue);
            setManualDirty(true);
            // Try to parse and update picker state when the text is a valid value
            const parsed = parseDateTime(nextValue, kind);
            const hasParsedValue = Boolean(parsed.date) || Boolean(parsed.time);
            if (!hasParsedValue) {
              return;
            }
            if (parsed.date) {
              setSelectedDate(parsed.date);
            }
            if (parsed.time) {
              if (parsed.time.hour) setHour(parsed.time.hour);
              if (parsed.time.minute) setMinute(parsed.time.minute);
              if (parsed.time.second) setSecond(parsed.time.second);
              if (parsed.time.millisecond)
                setMillisecond(parsed.time.millisecond);
            }
            const timezoneValue = parsed.timezone ?? "none";
            setSelectedTimezone(timezoneValue);
          }}
          onKeyDown={handleInputKeyDown}
        />
        <div className="flex items-center gap-0">
          {nullable && (
            <Button
              variant="ghost"
              className="h-6 w-6 p-0 z-50"
              title="Clear"
              onClick={() => {
                commit(null);
              }}
            >
              <IconTrash className="h-3 w-3" />
            </Button>
          )}
          {/* Hide picker button for time-cell - user can type directly */}
          {kind !== "time-cell" && (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger
                className="h-6 w-6 p-0 z-50 inline-flex items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground"
                title="Pick date/time"
              >
                <CalendarIcon className="h-3 w-3" />
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={12}
                className="w-auto rounded-xl click-outside-ignore p-0 z-[100]"
              >
                <div className="flex flex-col gap-2 p-3">
                  {/* Quick action buttons */}
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={handleSetToday}
                    >
                      Today
                    </Button>
                    {kind !== "date-cell" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs flex-1"
                        onClick={handleSetNow}
                      >
                        <IconClock className="h-3 w-3 mr-1" />
                        Now
                      </Button>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <Button
                        title="Save"
                        variant="outline"
                        size="sm"
                        onClick={handleSave}
                        className="h-7 py-0 text-xs"
                      >
                        <IconDeviceFloppy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Calendar for date/datetime - always shown since we're in the non-time-cell branch */}
                  <CalendarPicker
                    mode="single"
                    selected={selectedDate ?? undefined}
                    onSelect={handleDateSelect}
                    captionLayout="dropdown"
                    className="border-0 p-0"
                    startMonth={new Date(1900, 0)}
                    endMonth={new Date(2100, 0)}
                    defaultMonth={selectedDate ?? new Date()}
                  />

                  {/* Time picker for time/datetime - Collapsible */}
                  {kind !== "date-cell" && (
                    <Collapsible
                      open={timeCollapsed}
                      onOpenChange={setTimeCollapsed}
                      className="border-t pt-2"
                    >
                      <CollapsibleTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-between h-8 px-2"
                          >
                            <div className="flex items-center gap-2">
                              <IconClock className="h-3.5 w-3.5" />
                              <span className="text-xs font-medium">
                                Time & Timezone
                              </span>
                            </div>
                            <IconChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform",
                                !timeCollapsed && "rotate-0",
                                timeCollapsed && "rotate-180",
                              )}
                            />
                          </Button>
                        }
                      />
                      <CollapsibleContent className="space-y-3 pt-3">
                        {/* Time and Milliseconds on same row */}
                        <div className="space-y-2">
                          <span className="text-xs font-medium">Time</span>
                          <div className="flex items-center gap-1 w-full">
                            <div className="flex-1 w-full flex items-center gap-1 overflow-hidden">
                              <TimePicker
                                className="w-full"
                                hour={hour}
                                minute={minute}
                                second={second}
                                onHourChange={handleHourChange}
                                onMinuteChange={handleMinuteChange}
                                onSecondChange={handleSecondChange}
                              />
                              <span className="text-muted-foreground">.</span>
                            </div>

                            <Input
                              type="text"
                              placeholder="000"
                              value={millisecond}
                              onChange={(e) => {
                                const val = e.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, 3);
                                handleMillisecondChange(val);
                              }}
                              className="bg-background w-20"
                            />
                          </div>
                        </div>

                        {/* Timezone selector */}
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-medium">Timezone</span>
                          <Select
                            value={selectedTimezone}
                            onValueChange={(value) => {
                              handleTimezoneChange(value as string);
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent
                              className="click-outside-ignore z-[110] max-h-64"
                              sideOffset={4}
                            >
                              <SelectItem value="none">No timezone</SelectItem>
                              <SelectItem value="Z">UTC (Z)</SelectItem>
                              <SelectItem value="+00:00">+00:00</SelectItem>
                              <SelectItem value="+01:00">+01:00</SelectItem>
                              <SelectItem value="+02:00">+02:00</SelectItem>
                              <SelectItem value="+03:00">+03:00</SelectItem>
                              <SelectItem value="+03:30">+03:30</SelectItem>
                              <SelectItem value="+04:00">+04:00</SelectItem>
                              <SelectItem value="+04:30">+04:30</SelectItem>
                              <SelectItem value="+05:00">+05:00</SelectItem>
                              <SelectItem value="+05:30">+05:30</SelectItem>
                              <SelectItem value="+05:45">+05:45</SelectItem>
                              <SelectItem value="+06:00">+06:00</SelectItem>
                              <SelectItem value="+06:30">+06:30</SelectItem>
                              <SelectItem value="+07:00">+07:00</SelectItem>
                              <SelectItem value="+08:00">+08:00</SelectItem>
                              <SelectItem value="+08:30">+08:30</SelectItem>
                              <SelectItem value="+08:45">+08:45</SelectItem>
                              <SelectItem value="+09:00">+09:00</SelectItem>
                              <SelectItem value="+09:30">+09:30</SelectItem>
                              <SelectItem value="+10:00">+10:00</SelectItem>
                              <SelectItem value="+10:30">+10:30</SelectItem>
                              <SelectItem value="+11:00">+11:00</SelectItem>
                              <SelectItem value="+12:00">+12:00</SelectItem>
                              <SelectItem value="+12:45">+12:45</SelectItem>
                              <SelectItem value="+13:00">+13:00</SelectItem>
                              <SelectItem value="+14:00">+14:00</SelectItem>
                              <SelectItem value="-01:00">-01:00</SelectItem>
                              <SelectItem value="-02:00">-02:00</SelectItem>
                              <SelectItem value="-03:00">-03:00</SelectItem>
                              <SelectItem value="-03:30">-03:30</SelectItem>
                              <SelectItem value="-04:00">-04:00</SelectItem>
                              <SelectItem value="-05:00">-05:00</SelectItem>
                              <SelectItem value="-06:00">-06:00</SelectItem>
                              <SelectItem value="-07:00">-07:00</SelectItem>
                              <SelectItem value="-08:00">-08:00</SelectItem>
                              <SelectItem value="-09:00">-09:00</SelectItem>
                              <SelectItem value="-09:30">-09:30</SelectItem>
                              <SelectItem value="-10:00">-10:00</SelectItem>
                              <SelectItem value="-11:00">-11:00</SelectItem>
                              <SelectItem value="-12:00">-12:00</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
};

export const DateTimeCellEditorWithProps = Object.assign(DateTimeCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
