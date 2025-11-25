import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { type DateTimeKind, type Bounds } from "./types";

// Enable UTC plugin
dayjs.extend(utc);

export const parseDateTime = (
  value: string | number | null | undefined,
  kind: DateTimeKind,
) => {
  if (!value) return { date: null, time: null, timezone: null };

  const strValue = typeof value === "number" ? String(value) : value;

  // Extract timezone if present (e.g., +05:30, +00:00, -07:00, Z)
  const tzMatch = strValue.match(/([+-]\d{2}:\d{2}|Z)$/);
  const timezone = tzMatch ? tzMatch[1] : null;

  // For time-cell, just extract time components directly
  if (kind === "time-cell") {
    const timeMatch = strValue.match(
      /(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?/,
    );
    if (timeMatch && timeMatch[1] && timeMatch[2]) {
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

  // Parse date/datetime using regex to avoid timezone conversion
  // Format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD HH:mm:ss
  const dateTimeMatch = strValue.match(
    /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?)?/,
  );

  if (!dateTimeMatch) {
    // Fallback to dayjs for unusual formats
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
  }

  const [, year, month, day, hour, minute, second, millisecond] = dateTimeMatch;

  // Create date without timezone conversion by using UTC and then treating as local display
  const dateObj = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
  );

  return {
    date: dateObj,
    time:
      kind !== "date-cell" && hour
        ? {
            hour: hour,
            minute: minute || "00",
            second: second || "00",
            millisecond: millisecond || "",
          }
        : null,
    timezone,
  };
};

export const parseRange = (
  input: string | null | undefined,
): { lower: string | null; upper: string | null; bounds: Bounds } => {
  if (!input) return { lower: null, upper: null, bounds: "[)" };
  const trimmed = input.trim();
  const lb = trimmed[0] === "(" ? "(" : "[";
  const ub = trimmed[trimmed.length - 1] === ")" ? ")" : "]";
  const inner = trimmed.substring(1, trimmed.length - 1);
  // naive split – timestamps won't contain top-level commas here
  const parts = inner.split(",");
  const lower = parts[0]?.trim() || null;
  const upper = parts[1]?.trim() || null;
  return { lower, upper, bounds: (lb + ub) as Bounds };
};

export const buildText = (value: string | null): string => {
  const { lower, upper, bounds } = parseRange(value);
  if (!lower && !upper) return "";
  const lowerText = lower ?? "";
  const upperText = upper ?? "";
  const joiner = upperText.length > 0 ? ", " : ",";
  return `${bounds[0]}${lowerText}${joiner}${upperText}${bounds[1]}`;
};
