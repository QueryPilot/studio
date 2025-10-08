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
  | { [key: string]: unknown }; // Json

/**
 * Cell formatter function signature
 * Takes a raw CellValue and column metadata, returns formatted display string
 */
export type CellFormatter = (value: CellValue, column: ColumnMeta) => string;

/**
 * Format UUID bytes as hyphenated string
 */
function formatUUID(bytes: number[]): string {
  if (bytes.length !== 16) return `<Invalid UUID: ${bytes.length} bytes>`;

  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Format timestamp (microseconds since epoch) as localized datetime
 */
function formatTimestamp(micros: number): string {
  try {
    // Convert microseconds to milliseconds
    const date = new Date(micros / 1000);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(date);
  } catch {
    return String(micros);
  }
}

/**
 * Format date (days since epoch) as localized date
 */
function formatDate(days: number): string {
  try {
    // Days since Unix epoch (1970-01-01)
    const ms = days * 24 * 60 * 60 * 1000;
    const date = new Date(ms);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
    }).format(date);
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
 * Registry of type-specific formatters
 * Maps database type names to formatting functions
 */
const formatters: Record<string, CellFormatter> = {
  // Integers - use number formatting
  int2: (v) => (v === null ? "" : new Intl.NumberFormat().format(v as number)),
  int4: (v) => (v === null ? "" : new Intl.NumberFormat().format(v as number)),
  int8: (v) => (v === null ? "" : String(v)), // BigInt handling
  smallint: (v) => (v === null ? "" : new Intl.NumberFormat().format(v as number)),
  integer: (v) => (v === null ? "" : new Intl.NumberFormat().format(v as number)),
  bigint: (v) => (v === null ? "" : String(v)),

  // Floats - use fixed precision
  float4: (v) => (v === null ? "" : (v as number).toFixed(2)),
  float8: (v) => (v === null ? "" : (v as number).toFixed(4)),
  real: (v) => (v === null ? "" : (v as number).toFixed(2)),
  "double precision": (v) => (v === null ? "" : (v as number).toFixed(4)),
  numeric: (v) => (v === null ? "" : (v as number).toFixed(4)),
  decimal: (v) => (v === null ? "" : (v as number).toFixed(4)),

  // Boolean
  bool: (v) => (v === null ? "" : v ? "true" : "false"),
  boolean: (v) => (v === null ? "" : v ? "true" : "false"),

  // Text types
  text: (v) => (v === null ? "" : String(v)),
  varchar: (v) => (v === null ? "" : String(v)),
  char: (v) => (v === null ? "" : String(v)),
  bpchar: (v) => (v === null ? "" : String(v)),
  name: (v) => (v === null ? "" : String(v)),

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

  // Arrays - format as JSON
  _int4: (v) => (v === null ? "" : formatJson(v)),
  _int8: (v) => (v === null ? "" : formatJson(v)),
  _text: (v) => (v === null ? "" : formatJson(v)),
  _varchar: (v) => (v === null ? "" : formatJson(v)),

  // Default fallback
  default: (v) => (v === null ? "" : String(v)),
};

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
  if (value === null || value === undefined) {
    return "";
  }

  // Select formatter based on database type
  const dbType = column.db_type.toLowerCase();
  const formatter = formatters[dbType] || formatters.default;

  try {
    return formatter(value, column);
  } catch (error) {
    console.warn(`Formatter error for type ${dbType}:`, error);
    return String(value);
  }
}

/**
 * Format a cell value with explicit type hint (for testing/debugging)
 */
export function formatCellWithType(
  value: CellValue,
  dbType: string
): string {
  if (value === null || value === undefined) {
    return "";
  }

  const formatter = formatters[dbType.toLowerCase()] || formatters.default;

  try {
    // Create minimal column meta for formatter
    return formatter(value, { db_type: dbType } as ColumnMeta);
  } catch (error) {
    console.warn(`Formatter error for type ${dbType}:`, error);
    return String(value);
  }
}

/**
 * Register a custom formatter for a specific database type
 */
export function registerFormatter(dbType: string, formatter: CellFormatter): void {
  formatters[dbType.toLowerCase()] = formatter;
}

/**
 * Get available formatter types
 */
export function getAvailableFormatters(): string[] {
  return Object.keys(formatters).filter((k) => k !== "default");
}
