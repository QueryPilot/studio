import type { IntervalParts } from "./types";

/**
 * Default empty interval parts
 */
export const EMPTY_INTERVAL: IntervalParts = {
  years: 0,
  months: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  negative: false,
};

/**
 * Parse PostgreSQL interval string into components
 * Formats:
 * - "1 year 2 mons 3 days 04:05:06"
 * - "1 year 2 months 3 days 04:05:06.123"
 * - "@ 1 year 2 mons"
 * - "1 day"
 * - "04:05:06"
 * - "-1 days"
 * - "P1Y2M3DT4H5M6S" (ISO 8601)
 */
export function parseInterval(input: string | null | undefined): IntervalParts {
  if (!input || input.trim() === "") {
    return { ...EMPTY_INTERVAL };
  }

  const trimmed = input.trim();

  // Check for ISO 8601 format
  if (trimmed.startsWith("P")) {
    return parseIso8601Duration(trimmed);
  }

  const parts: IntervalParts = { ...EMPTY_INTERVAL };

  // Check for leading negative
  let str = trimmed;
  if (str.startsWith("-")) {
    parts.negative = true;
    str = str.substring(1).trim();
  } else if (str.startsWith("@")) {
    str = str.substring(1).trim();
    if (str.startsWith("-")) {
      parts.negative = true;
      str = str.substring(1).trim();
    }
  }

  // Parse year/month/day components
  const yearMatch = str.match(/(-?\d+)\s*(?:year|yr)s?/i);
  if (yearMatch) {
    parts.years = Math.abs(parseInt(yearMatch[1], 10));
    if (parseInt(yearMatch[1], 10) < 0) parts.negative = true;
  }

  const monthMatch = str.match(/(-?\d+)\s*(?:mon(?:th)?s?)/i);
  if (monthMatch) {
    parts.months = Math.abs(parseInt(monthMatch[1], 10));
    if (parseInt(monthMatch[1], 10) < 0) parts.negative = true;
  }

  const dayMatch = str.match(/(-?\d+)\s*(?:day)s?/i);
  if (dayMatch) {
    parts.days = Math.abs(parseInt(dayMatch[1], 10));
    if (parseInt(dayMatch[1], 10) < 0) parts.negative = true;
  }

  // Parse time component HH:MM:SS or HH:MM:SS.mmm
  const timeMatch = str.match(/(-?)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/);
  if (timeMatch) {
    if (timeMatch[1] === "-") parts.negative = true;
    parts.hours = parseInt(timeMatch[2], 10);
    parts.minutes = parseInt(timeMatch[3], 10);
    if (timeMatch[4]) {
      let seconds = parseInt(timeMatch[4], 10);
      if (timeMatch[5]) {
        // Handle fractional seconds
        const fraction = parseFloat(`0.${timeMatch[5]}`);
        seconds += fraction;
      }
      parts.seconds = seconds;
    }
  }

  return parts;
}

/**
 * Parse ISO 8601 duration format
 * Format: P[n]Y[n]M[n]DT[n]H[n]M[n]S
 */
function parseIso8601Duration(input: string): IntervalParts {
  const parts: IntervalParts = { ...EMPTY_INTERVAL };

  // Check for negative
  let str = input;
  if (str.startsWith("-P")) {
    parts.negative = true;
    str = str.substring(1);
  }

  // Remove leading P
  str = str.substring(1);

  // Split by T for date/time parts
  const [datePart, timePart] = str.split("T");

  // Parse date part
  if (datePart) {
    const yearMatch = datePart.match(/(\d+)Y/);
    if (yearMatch) parts.years = parseInt(yearMatch[1], 10);

    const monthMatch = datePart.match(/(\d+)M/);
    if (monthMatch) parts.months = parseInt(monthMatch[1], 10);

    const dayMatch = datePart.match(/(\d+)D/);
    if (dayMatch) parts.days = parseInt(dayMatch[1], 10);
  }

  // Parse time part
  if (timePart) {
    const hourMatch = timePart.match(/(\d+)H/);
    if (hourMatch) parts.hours = parseInt(hourMatch[1], 10);

    const minMatch = timePart.match(/(\d+)M/);
    if (minMatch) parts.minutes = parseInt(minMatch[1], 10);

    const secMatch = timePart.match(/([\d.]+)S/);
    if (secMatch) parts.seconds = parseFloat(secMatch[1]);
  }

  return parts;
}

/**
 * Format interval parts to PostgreSQL string format
 */
export function formatInterval(parts: IntervalParts): string {
  const components: string[] = [];

  if (parts.years !== 0) {
    components.push(`${parts.years} ${parts.years === 1 ? "year" : "years"}`);
  }
  if (parts.months !== 0) {
    components.push(`${parts.months} ${parts.months === 1 ? "mon" : "mons"}`);
  }
  if (parts.days !== 0) {
    components.push(`${parts.days} ${parts.days === 1 ? "day" : "days"}`);
  }

  // Format time component
  if (parts.hours !== 0 || parts.minutes !== 0 || parts.seconds !== 0) {
    const hours = parts.hours.toString().padStart(2, "0");
    const minutes = parts.minutes.toString().padStart(2, "0");
    const seconds = Number.isInteger(parts.seconds)
      ? parts.seconds.toString().padStart(2, "0")
      : parts.seconds.toFixed(6).replace(/\.?0+$/, "").padStart(2, "0");
    components.push(`${hours}:${minutes}:${seconds}`);
  }

  if (components.length === 0) {
    return "00:00:00";
  }

  const result = components.join(" ");
  return parts.negative ? `-${result}` : result;
}

/**
 * Format interval parts to ISO 8601 duration format
 */
export function formatIso8601Duration(parts: IntervalParts): string {
  const dateComponents: string[] = [];
  const timeComponents: string[] = [];

  if (parts.years !== 0) dateComponents.push(`${parts.years}Y`);
  if (parts.months !== 0) dateComponents.push(`${parts.months}M`);
  if (parts.days !== 0) dateComponents.push(`${parts.days}D`);

  if (parts.hours !== 0) timeComponents.push(`${parts.hours}H`);
  if (parts.minutes !== 0) timeComponents.push(`${parts.minutes}M`);
  if (parts.seconds !== 0) timeComponents.push(`${parts.seconds}S`);

  let result = "P";
  result += dateComponents.join("");
  if (timeComponents.length > 0) {
    result += "T" + timeComponents.join("");
  }

  if (result === "P") {
    result = "PT0S";
  }

  return parts.negative ? `-${result}` : result;
}

/**
 * Get human-readable display text for interval
 */
export function getIntervalDisplayText(value: string | null): string {
  if (!value) return "NULL";

  const parts = parseInterval(value);
  const components: string[] = [];

  if (parts.years !== 0) components.push(`${parts.years}y`);
  if (parts.months !== 0) components.push(`${parts.months}mo`);
  if (parts.days !== 0) components.push(`${parts.days}d`);
  if (parts.hours !== 0) components.push(`${parts.hours}h`);
  if (parts.minutes !== 0) components.push(`${parts.minutes}m`);
  if (parts.seconds !== 0) {
    components.push(
      `${Number.isInteger(parts.seconds) ? parts.seconds : parts.seconds.toFixed(3)}s`,
    );
  }

  if (components.length === 0) {
    return "0s";
  }

  const result = components.join(" ");
  return parts.negative ? `-${result}` : result;
}

/**
 * Check if interval parts represent zero duration
 */
export function isZeroInterval(parts: IntervalParts): boolean {
  return (
    parts.years === 0 &&
    parts.months === 0 &&
    parts.days === 0 &&
    parts.hours === 0 &&
    parts.minutes === 0 &&
    parts.seconds === 0
  );
}

/**
 * Common interval presets
 */
export const INTERVAL_PRESETS = [
  { label: "1 second", value: "00:00:01" },
  { label: "1 minute", value: "00:01:00" },
  { label: "1 hour", value: "01:00:00" },
  { label: "1 day", value: "1 day" },
  { label: "1 week", value: "7 days" },
  { label: "1 month", value: "1 mon" },
  { label: "1 year", value: "1 year" },
] as const;

