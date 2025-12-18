import type { Bounds, ParsedRange, RangeCellKind, RangeValueType } from "./types";

/**
 * Parse a PostgreSQL range string into its components
 */
export function parseRange(input: string | null | undefined): ParsedRange {
  if (!input) {
    return {
      lower: null,
      upper: null,
      bounds: "[)",
      lowerInclusive: true,
      upperInclusive: false,
    };
  }

  const trimmed = input.trim();

  // Handle empty range
  if (trimmed === "empty") {
    return {
      lower: null,
      upper: null,
      bounds: "()",
      lowerInclusive: false,
      upperInclusive: false,
    };
  }

  // Extract bounds
  const lowerBound = trimmed[0] === "(" ? "(" : "[";
  const upperBound = trimmed[trimmed.length - 1] === ")" ? ")" : "]";
  const bounds = (lowerBound + upperBound) as Bounds;

  // Extract inner content
  const inner = trimmed.substring(1, trimmed.length - 1);

  // Split on comma, handling potential nested commas in timestamps
  // For timestamps with commas, the format is typically ISO so we can split on the first unquoted comma
  let lower: string | null = null;
  let upper: string | null = null;

  const commaIndex = findSplitComma(inner);
  if (commaIndex !== -1) {
    lower = inner.substring(0, commaIndex).trim() || null;
    upper = inner.substring(commaIndex + 1).trim() || null;
  } else {
    lower = inner.trim() || null;
  }

  return {
    lower,
    upper,
    bounds,
    lowerInclusive: lowerBound === "[",
    upperInclusive: upperBound === "]",
  };
}

/**
 * Find the comma that splits lower and upper bounds
 * Handles quoted strings and nested parentheses
 */
function findSplitComma(str: string): number {
  let depth = 0;
  let inQuote = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (char === '"' && (i === 0 || str[i - 1] !== "\\")) {
      inQuote = !inQuote;
    } else if (!inQuote) {
      if (char === "(" || char === "[") {
        depth++;
      } else if (char === ")" || char === "]") {
        depth--;
      } else if (char === "," && depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Format a range into PostgreSQL syntax
 */
export function formatRange(
  lower: string | null,
  upper: string | null,
  bounds: Bounds,
): string {
  if (lower === null && upper === null) {
    return "empty";
  }

  const lowerStr = lower ?? "";
  const upperStr = upper ?? "";

  return `${bounds[0]}${lowerStr},${upperStr}${bounds[1]}`;
}

/**
 * Get display text for a range
 */
export function getRangeDisplayText(value: string | null): string {
  if (!value) return "NULL";

  const parsed = parseRange(value);
  if (parsed.lower === null && parsed.upper === null) {
    return "empty";
  }

  const lowerStr = parsed.lower ?? "∞";
  const upperStr = parsed.upper ?? "∞";
  const lowerBracket = parsed.lowerInclusive ? "[" : "(";
  const upperBracket = parsed.upperInclusive ? "]" : ")";

  return `${lowerBracket}${lowerStr}, ${upperStr}${upperBracket}`;
}

/**
 * Determine the element type from the range kind
 */
export function getElementType(kind: RangeCellKind): RangeValueType {
  switch (kind) {
    case "int4range-cell":
    case "int8range-cell":
      return "integer";
    case "numrange-cell":
      return "numeric";
    case "daterange-cell":
      return "date";
    case "tsrange-cell":
      return "timestamp";
  }
}

/**
 * Validate a range value based on its type
 */
export function isValidRangeValue(
  value: string | null,
  elementType: RangeValueType,
): boolean {
  if (value === null || value.trim() === "") return true;

  const trimmed = value.trim();

  switch (elementType) {
    case "integer":
      return /^-?\d+$/.test(trimmed);
    case "numeric":
      return /^-?\d+(\.\d+)?$/.test(trimmed);
    case "date":
      // Basic date validation: YYYY-MM-DD
      return /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    case "timestamp":
      // Basic timestamp validation: YYYY-MM-DD or YYYY-MM-DD HH:mm:ss
      return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(trimmed);
  }
}

/**
 * Compare two range values
 */
export function compareRangeValues(
  a: string | null,
  b: string | null,
  elementType: RangeValueType,
): number {
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;

  switch (elementType) {
    case "integer":
    case "numeric":
      return parseFloat(a) - parseFloat(b);
    case "date":
    case "timestamp":
      return new Date(a).getTime() - new Date(b).getTime();
  }
}

/**
 * Check if a range is valid (lower <= upper considering bounds)
 */
export function isValidRange(
  lower: string | null,
  upper: string | null,
  _bounds: Bounds,
  elementType: RangeValueType,
): boolean {
  // Empty range is valid
  if (lower === null && upper === null) return true;

  // Unbounded on one side is valid
  if (lower === null || upper === null) return true;

  // Both bounds present - check order
  const comparison = compareRangeValues(lower, upper, elementType);
  return comparison <= 0;
}

/**
 * Get placeholder text for range input
 */
export function getPlaceholder(elementType: RangeValueType): {
  lower: string;
  upper: string;
} {
  switch (elementType) {
    case "integer":
      return { lower: "0", upper: "100" };
    case "numeric":
      return { lower: "0.00", upper: "100.00" };
    case "date":
      return { lower: "2024-01-01", upper: "2024-12-31" };
    case "timestamp":
      return { lower: "2024-01-01 00:00:00", upper: "2024-12-31 23:59:59" };
  }
}

