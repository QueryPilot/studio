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
import { PopoverAnchor } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarIcon, Trash2, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import { type DateTimeCustomCell } from "./DateTimeCellRenderer";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

// Common timezones for quick access
const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Australia/Sydney",
];

const parseDateTime = (
  value: string | number | null | undefined,
  kind: "date-cell" | "time-cell" | "datetime-cell",
) => {
  if (!value) return { date: null, time: null, timezone: null };

  const strValue = typeof value === "number" ? String(value) : value;

  // Extract timezone if present (e.g., +05:30, -07:00, Z)
  const tzMatch = strValue.match(/([+-]\d{2}:?\d{2}|Z)$/);
  const timezone = tzMatch ? tzMatch[1] : null;

  if (kind === "time-cell") {
    const timeMatch = strValue.match(
      /(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?/,
    );
    if (timeMatch) {
      return {
        date: null,
        time: {
          hour: timeMatch[1],
          minute: timeMatch[2],
          second: timeMatch[3] || "00",
          millisecond: timeMatch[4] || "",
        },
        timezone,
      };
    }
  }

  // Parse with dayjs, preserving timezone
  const parsed = dayjs(strValue);
  if (!parsed.isValid()) return { date: null, time: null, timezone: null };

  return {
    date: parsed.toDate(),
    time:
      kind !== "date-cell"
        ? {
            hour: parsed.format("HH"),
            minute: parsed.format("mm"),
            second: parsed.format("ss"),
            millisecond: parsed.format("SSS"),
          }
        : null,
    timezone,
  };
};

// Custom Calendar with Shadcn Select for month/year
interface CustomCalendarProps {
  selected?: Date;
  onSelect: (date: Date) => void;
  className?: string;
}

const CustomCalendar: React.FC<CustomCalendarProps> = ({
  selected,
  onSelect,
  className,
}) => {
  const [month, setMonth] = useState(
    selected?.getMonth() ?? new Date().getMonth(),
  );
  const [year, setYear] = useState(
    selected?.getFullYear() ?? new Date().getFullYear(),
  );

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const handleDayClick = (day: number) => {
    const date = new Date(year, month, day);
    onSelect(date);
  };

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Generate year options (current year ± 100 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from(
    { length: 201 },
    (_, i) => currentYear - 100 + i,
  );

  return (
    <div className={cn("p-3", className)}>
      <div className="flex items-center justify-center gap-2 mb-4">
        <Select
          value={month.toString()}
          onValueChange={(v) => {
            setMonth(Number(v));
          }}
        >
          <SelectTrigger size="sm" className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthNames.map((name, idx) => (
              <SelectItem key={idx} value={idx.toString()}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={year.toString()}
          onValueChange={(v) => {
            setYear(Number(v));
          }}
        >
          <SelectTrigger size="sm" className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={y.toString()}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground p-2"
          >
            {day}
          </div>
        ))}
        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const isSelected =
            selected &&
            selected.getDate() === day &&
            selected.getMonth() === month &&
            selected.getFullYear() === year;
          return (
            <Button
              key={day}
              variant={isSelected ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8 p-0 text-xs"
              onClick={() => {
                handleDayClick(day);
              }}
            >
              {day}
            </Button>
          );
        })}
      </div>
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
  const { kind, value: raw, nullable } = value.data;
  const finishedRef = useRef(false);

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
    initialParsed.timezone ?? "",
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setOpen(true);
    }, 0);
    return () => {
      clearTimeout(t);
    };
  }, []);

  const buildDateTimeString = useCallback(() => {
    if (kind === "time-cell") {
      let result = `${hour}:${minute}:${second}`;
      if (millisecond) result += `.${millisecond}`;
      if (selectedTimezone)
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

    // datetime-cell
    let result = `${y}-${m}-${d} ${hour}:${minute}:${second}`;
    if (millisecond) result += `.${millisecond}`;
    if (selectedTimezone)
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

  const handleSave = useCallback(() => {
    const result = buildDateTimeString();
    commit(result);
  }, [buildDateTimeString, commit]);

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setOpen(false);
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (finishedRef.current) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSave();
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;
      setOpen(false);
      onFinishedEditing(value, movement);
    }
  };

  return (
    <div
      className="w-full h-full flex items-center gap-1 px-2 click-outside-ignore relative"
      onKeyDown={handleKeyDown}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="flex items-center gap-1 flex-1">
            <span className="text-xs text-muted-foreground">
              {buildDateTimeString() ?? "NULL"}
            </span>
          </div>
        </PopoverAnchor>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="h-6 w-6 p-0 z-50"
            title={kind === "time-cell" ? "Pick time" : "Pick date/time"}
          >
            {kind === "time-cell" ? (
              <Clock className="h-3 w-3" />
            ) : (
              <CalendarIcon className="h-3 w-3" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={12}
          className="w-auto rounded-xl click-outside-ignore z-50 p-4"
        >
          <div className="flex flex-col gap-4">
            {/* Calendar for date/datetime */}
            {kind !== "time-cell" && (
              <CustomCalendar
                selected={selectedDate ?? undefined}
                onSelect={setSelectedDate}
              />
            )}

            {/* Time picker for time/datetime */}
            {kind !== "date-cell" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    placeholder="HH"
                    value={hour}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                      if (val === "") {
                        setHour("00");
                      } else if (Number(val) >= 0 && Number(val) <= 23) {
                        setHour(val);
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      if (val && Number(val) >= 0 && Number(val) <= 23) {
                        setHour(val.padStart(2, "0"));
                      }
                    }}
                    className="w-14 text-center"
                  />
                  <span>:</span>
                  <Input
                    type="text"
                    placeholder="MM"
                    value={minute}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                      if (val === "") {
                        setMinute("00");
                      } else if (Number(val) >= 0 && Number(val) <= 59) {
                        setMinute(val);
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      if (val && Number(val) >= 0 && Number(val) <= 59) {
                        setMinute(val.padStart(2, "0"));
                      }
                    }}
                    className="w-14 text-center"
                  />
                  <span>:</span>
                  <Input
                    type="text"
                    placeholder="SS"
                    value={second}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                      if (val === "") {
                        setSecond("00");
                      } else if (Number(val) >= 0 && Number(val) <= 59) {
                        setSecond(val);
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      if (val && Number(val) >= 0 && Number(val) <= 59) {
                        setSecond(val.padStart(2, "0"));
                      }
                    }}
                    className="w-14 text-center"
                  />
                  <span className="text-muted-foreground">.</span>
                  <Input
                    type="text"
                    placeholder="000"
                    value={millisecond}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 3);
                      setMillisecond(val);
                    }}
                    className="w-16 text-center"
                  />
                </div>

                {/* Timezone selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Timezone:
                  </span>
                  <Select
                    value={selectedTimezone}
                    onValueChange={setSelectedTimezone}
                  >
                    <SelectTrigger size="sm" className="w-[180px]">
                      <SelectValue placeholder="No timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      <SelectItem value="Z">UTC (Z)</SelectItem>
                      {COMMON_TIMEZONES.filter((tz) => tz !== "UTC").map(
                        (tz) => {
                          const offset = dayjs().tz(tz).format("Z");
                          return (
                            <SelectItem key={tz} value={offset}>
                              {tz} ({offset})
                            </SelectItem>
                          );
                        },
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t">
              {nullable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    commit(null);
                  }}
                  className="gap-1"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export const DateTimeCellEditorWithProps = Object.assign(DateTimeCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
