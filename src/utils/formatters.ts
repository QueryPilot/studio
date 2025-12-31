import { logger } from "@/lib/logger";
import type { ColumnMeta } from "../services/backend";

/**
 * Cell value types from backend (lightweight enum variants)
 * These match the Rust CellValue enum
 */
export type CellValue =
  | null
  | boolean
  | number // i16, i32, i64, f32, f64
  | string // Text
  | number[] // Bytes (represented as array in JSON)
  | unknown[] // Arrays
  | { [key: string]: unknown }; // Json

/**
 * Cell formatter function signature
 * Takes a raw CellValue and column metadata, returns formatted display string
 */
export type CellFormatter = (value: CellValue, column: ColumnMeta) => string;

// ============================================================================
// CACHED FORMATTERS - Avoid recreating Intl objects per-call (perf critical)
// ============================================================================
const cachedNumberFormatter = new Intl.NumberFormat();
const cachedDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeStyle: "medium",
});
const cachedDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
});

/**
 * Format UUID bytes as hyphenated string
 */
function formatUUID(bytes: number[]): string {
  if (bytes.length !== 16) return `<Invalid UUID: ${bytes.length} bytes>`;

  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Format timestamp (microseconds since epoch) as localized datetime
 */
function formatTimestamp(micros: number): string {
  try {
    const date = new Date(micros / 1000);
    return cachedDateTimeFormatter.format(date);
  } catch {
    return String(micros);
  }
}

/**
 * Format date (days since epoch) as localized date
 */
function formatDate(days: number): string {
  try {
    const ms = days * 24 * 60 * 60 * 1000;
    const date = new Date(ms);
    return cachedDateFormatter.format(date);
  } catch {
    return String(days);
  }
}

/**
 * Format JSON value with pretty printing
 */
function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Format binary data (bytea, blob)
 */
function formatBinary(bytes: number[]): string {
  return `<Binary ${bytes.length} bytes>`;
}

/**
 * Format array in PostgreSQL native format: {1,2,3}
 * Matches TablePlus and native PostgreSQL array display
 */
function formatPgArray(value: unknown): string {
  // If already a string (already formatted), return as-is
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return String(value);
  }

  const formatElement = (v: unknown): string => {
    if (Array.isArray(v)) {
      return formatPgArray(v);
    }
    if (v === null || v === undefined) {
      return "NULL";
    }
    if (typeof v === "string") {
      // Escape backslashes and quotes for PostgreSQL
      const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    if (typeof v === "number" || typeof v === "bigint") {
      return String(v);
    }
    if (typeof v === "boolean") {
      return v ? "TRUE" : "FALSE";
    }
    return JSON.stringify(v);
  };

  return `{${value.map(formatElement).join(",")}}`;
}

/**
 * Registry of type-specific formatters
 * Maps database type names to formatting functions
 */
const formatters: Record<string, CellFormatter> = {
  // Integers - use cached number formatter
  int2: (v) => (v === null ? "" : cachedNumberFormatter.format(v as number)),
  int4: (v) => (v === null ? "" : cachedNumberFormatter.format(v as number)),
  int8: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v), // BigInt handling
  smallint: (v) =>
    v === null ? "" : cachedNumberFormatter.format(v as number),
  integer: (v) =>
    v === null ? "" : cachedNumberFormatter.format(v as number),
  bigint: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),

  // Floats - preserve exact values, no rounding
  float4: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),
  float8: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),
  real: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),
  "double precision": (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),
  numeric: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v), // NUMERIC/DECIMAL must preserve exact precision
  decimal: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),

  // Boolean
  bool: (v) => (v === null ? "" : v ? "true" : "false"),
  boolean: (v) => (v === null ? "" : v ? "true" : "false"),

  // Text types
  text: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),
  varchar: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),
  char: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),
  bpchar: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),
  name: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : JSON.stringify(v),

  // Date/Time types
  timestamp: (v) => (v === null ? "" : formatTimestamp(v as number)),
  timestamptz: (v) => (v === null ? "" : formatTimestamp(v as number)),
  date: (v) => (v === null ? "" : formatDate(v as number)),
  time: (v) => (v === null ? "" : formatTimestamp(v as number)), // Time stored as micros
  timetz: (v) => (v === null ? "" : formatTimestamp(v as number)),

  // UUID
  uuid: (v) => (v === null ? "" : formatUUID(v as number[])),

  // JSON types
  json: (v) => (v === null ? "" : formatJson(v)),
  jsonb: (v) => (v === null ? "" : formatJson(v)),

  // Binary types
  bytea: (v) => (v === null ? "" : formatBinary(v as number[])),
  blob: (v) => (v === null ? "" : formatBinary(v as number[])),

  // Arrays - format in PostgreSQL native format: {1,2,3}
  // PostgreSQL uses underscore prefix for array types (_int4 = int4[])
  _int2: (v) => (v === null ? "" : formatPgArray(v)),
  _int4: (v) => (v === null ? "" : formatPgArray(v)),
  _int8: (v) => (v === null ? "" : formatPgArray(v)),
  _text: (v) => (v === null ? "" : formatPgArray(v)),
  _varchar: (v) => (v === null ? "" : formatPgArray(v)),
  _bool: (v) => (v === null ? "" : formatPgArray(v)),
  _float4: (v) => (v === null ? "" : formatPgArray(v)),
  _float8: (v) => (v === null ? "" : formatPgArray(v)),
  _numeric: (v) => (v === null ? "" : formatPgArray(v)),
  _char: (v) => (v === null ? "" : formatPgArray(v)),
  _bpchar: (v) => (v === null ? "" : formatPgArray(v)),
  _uuid: (v) => (v === null ? "" : formatPgArray(v)),
  _json: (v) => (v === null ? "" : formatPgArray(v)),
  _jsonb: (v) => (v === null ? "" : formatPgArray(v)),
  _timestamp: (v) => (v === null ? "" : formatPgArray(v)),
  _timestamptz: (v) => (v === null ? "" : formatPgArray(v)),
  _date: (v) => (v === null ? "" : formatPgArray(v)),
  _time: (v) => (v === null ? "" : formatPgArray(v)),
  _bytea: (v) => (v === null ? "" : formatPgArray(v)),

  // Default fallback
  default: (v) =>
    v === null
      ? ""
      : typeof v === "string"
      ? v
      : typeof v === "number"
      ? v.toString()
      : typeof v === "boolean"
      ? v.toString()
      : JSON.stringify(v),
};

/**
 * Get formatter for database type (always returns a formatter, falls back to default)
 */
function getFormatter(dbType: string): CellFormatter {
  const lowerType = dbType.toLowerCase();

  // Check for explicit formatter
  let formatter = formatters[lowerType];

  // If not found and starts with underscore (array type), use array formatter
  if (!formatter && lowerType.startsWith("_")) {
    formatter = formatters["_int4"]; // Any array formatter works since they all use formatPgArray
  }

  // Fall back to default
  return (formatter || formatters["default"]) as CellFormatter;
}

/**
 * Format a cell value for display (LAZY - only call when visible in viewport)
 *
 * This function implements the lazy formatting optimization:
 * - Call ONLY when cell scrolls into viewport
 * - Cache result using useMemo keyed by (rowId, columnId)
 * - Eliminates 300-400ms eager formatting overhead
 *
 * @param value - Raw CellValue from backend (null | boolean | number | string | array | object)
 * @param column - Column metadata with db_type for formatter selection
 * @returns Formatted display string
 *
 * @example
 * // In DataGrid render function:
 * const displayValue = useMemo(
 *   () => formatCell(row[colIdx], column),
 *   [row, colIdx, column]
 * );
 */
export function formatCell(value: CellValue, column: ColumnMeta): string {
  if (value === null) {
    return "";
  }

  // Select formatter based on database type
  const formatter = getFormatter(column.db_type);

  try {
    return formatter(value, column);
  } catch (error) {
    logger.warn(`Formatter error for type ${column.db_type}:`, error);
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value.toString();
    return JSON.stringify(value);
  }
}

/**
 * Format a cell value with explicit type hint (for testing/debugging)
 */
export function formatCellWithType(value: CellValue, dbType: string): string {
  if (value === null) {
    return "";
  }

  const formatter = getFormatter(dbType);

  try {
    // Create minimal column meta for formatter
    return formatter(value, { db_type: dbType } as ColumnMeta);
  } catch (error) {
    logger.warn(`Formatter error for type ${dbType}:`, error);
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value.toString();
    return JSON.stringify(value);
  }
}

export function formatNumber(value: number): string {
  return cachedNumberFormatter.format(value);
}
