import dayjs from "dayjs";
import { type DateTimeKind, type Bounds } from "./types";

export const parseDateTime = (
  value: string | number | null | undefined,
  kind: DateTimeKind,
) => {
  if (!value) return { date: null, time: null, timezone: null };

  const strValue = typeof value === "number" ? String(value) : value;

  // Extract timezone if present (e.g., +05:30, +00:00, -07:00, Z)
  const tzMatch = strValue.match(/([+-]\d{2}:\d{2}|Z)$/);
  const timezone = tzMatch ? tzMatch[1] : null;

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
