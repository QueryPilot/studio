import type { GridColumnV2 } from "../types";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export type Validator = (
  value: unknown,
  column: GridColumnV2
) => ValidationResult;

const VALID: ValidationResult = { valid: true };

// UUID: 8-4-4-4-12 hex format
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// IPv4 with optional CIDR
const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:3[0-2]|[12]?\d))?$/;

// IPv6 (simplified)
const IPV6_REGEX = /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;

// MAC address
const MAC_REGEX = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

// Numeric bounds
const INT2_MIN = -32768;
const INT2_MAX = 32767;
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;
const INT8_MIN = BigInt("-9223372036854775808");
const INT8_MAX = BigInt("9223372036854775807");

// ============================================================================
// Core Validators
// ============================================================================

function validateUuid(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  return UUID_REGEX.test(String(v))
    ? VALID
    : { valid: false, error: "Invalid UUID format (expected: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)" };
}

function validateInet(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const str = String(v);
  if (IPV4_REGEX.test(str) || IPV6_REGEX.test(str)) return VALID;
  return { valid: false, error: "Invalid IP address" };
}

function validateCidr(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const str = String(v);
  if (!str.includes("/")) {
    return { valid: false, error: "CIDR requires network prefix (e.g., 192.168.1.0/24)" };
  }
  if (IPV4_REGEX.test(str) || IPV6_REGEX.test(str)) return VALID;
  return { valid: false, error: "Invalid CIDR notation" };
}

function validateMacaddr(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  return MAC_REGEX.test(String(v))
    ? VALID
    : { valid: false, error: "Invalid MAC address (expected: xx:xx:xx:xx:xx:xx)" };
}

function validateJson(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  try {
    JSON.parse(String(v));
    return VALID;
  } catch {
    return { valid: false, error: "Invalid JSON syntax" };
  }
}

function validateInt2(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const num = Number(v);
  if (isNaN(num)) return { valid: false, error: "Must be a number" };
  if (!Number.isInteger(num)) return { valid: false, error: "Must be an integer" };
  if (num < INT2_MIN || num > INT2_MAX) {
    return { valid: false, error: `Must be between ${INT2_MIN} and ${INT2_MAX}` };
  }
  return VALID;
}

function validateInt4(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const num = Number(v);
  if (isNaN(num)) return { valid: false, error: "Must be a number" };
  if (!Number.isInteger(num)) return { valid: false, error: "Must be an integer" };
  if (num < INT4_MIN || num > INT4_MAX) {
    return { valid: false, error: `Must be between ${INT4_MIN} and ${INT4_MAX}` };
  }
  return VALID;
}

function validateInt8(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  try {
    const str = String(v).split(".")[0] ?? "0";
    const big = BigInt(str);
    if (big < INT8_MIN || big > INT8_MAX) {
      return { valid: false, error: "Value out of bigint range" };
    }
    return VALID;
  } catch {
    return { valid: false, error: "Must be a valid integer" };
  }
}

function validateNumeric(v: unknown, col: GridColumnV2): ValidationResult {
  if (v == null || v === "") return VALID;
  const num = Number(v);
  if (isNaN(num)) return { valid: false, error: "Must be a valid number" };

  const precision = col.meta?.precision;
  const scale = col.meta?.scale;

  if (precision != null && scale != null) {
    const str = String(v);
    const parts = str.replace("-", "").split(".");
    const intDigits = parts[0]?.replace(/^0+/, "").length ?? 0;
    const decDigits = parts[1]?.length ?? 0;

    if (intDigits > precision - scale) {
      return {
        valid: false,
        error: `Too many integer digits (max ${precision - scale})`,
      };
    }
    if (decDigits > scale) {
      return {
        valid: false,
        error: `Too many decimal places (max ${scale})`,
      };
    }
  }
  return VALID;
}

function validateFloat(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const num = Number(v);
  if (isNaN(num)) return { valid: false, error: "Must be a valid number" };
  return VALID;
}

function validateBoolean(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const str = String(v).toLowerCase();
  const valid = ["true", "false", "t", "f", "yes", "no", "y", "n", "1", "0"].includes(str);
  return valid ? VALID : { valid: false, error: "Must be true/false" };
}

// Regex-based validation avoids new Date() which misparses timezone offsets on WebKit
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)(:([0-5]\d))?(\.\d+)?$/;

function validateDate(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  return DATE_REGEX.test(String(v))
    ? VALID
    : { valid: false, error: "Invalid date format (expected: YYYY-MM-DD)" };
}

function validateTimestamp(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  return TIMESTAMP_REGEX.test(String(v))
    ? VALID
    : {
        valid: false,
        error: "Invalid timestamp format (expected: YYYY-MM-DD HH:mm:ss)",
      };
}

function validateTime(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  return TIME_REGEX.test(String(v))
    ? VALID
    : { valid: false, error: "Invalid time format (expected: HH:MM:SS)" };
}

function validateInterval(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const str = String(v).toLowerCase();
  const hasValidPart = /\d+\s*(year|month|day|hour|minute|second|week)/i.test(str) ||
    /^(\d+:)?\d{2}:\d{2}(:\d{2})?$/.test(str);
  return hasValidPart
    ? VALID
    : { valid: false, error: "Invalid interval format" };
}

function validateBytea(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const str = String(v);
  if (str.startsWith("\\x") || str.startsWith("\\\\x")) {
    const hex = str.replace(/^\\\\?x/, "");
    return /^[0-9a-f]*$/i.test(hex)
      ? VALID
      : { valid: false, error: "Invalid hex in bytea" };
  }
  return VALID;
}

function validatePoint(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const pointRegex = /^\(?\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*\)?$/;
  return pointRegex.test(String(v))
    ? VALID
    : { valid: false, error: "Invalid point format (expected: (x,y))" };
}

function validateBox(v: unknown): ValidationResult {
  if (v == null || v === "") return VALID;
  const str = String(v);
  const boxRegex = /^\(?\s*\(?\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*\)?\s*,\s*\(?\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*\)?\s*\)?$/;
  return boxRegex.test(str)
    ? VALID
    : { valid: false, error: "Invalid box format (expected: ((x1,y1),(x2,y2)))" };
}

// ============================================================================
// Validator Registry
// ============================================================================

const validators: Record<string, Validator> = {
  // UUID
  uuid: validateUuid,

  // Network types
  inet: validateInet,
  cidr: validateCidr,
  macaddr: validateMacaddr,

  // JSON
  json: validateJson,
  jsonb: validateJson,

  // Integer types
  int2: validateInt2,
  smallint: validateInt2,
  int4: validateInt4,
  integer: validateInt4,
  int: validateInt4,
  int8: validateInt8,
  bigint: validateInt8,

  // Numeric types
  numeric: validateNumeric,
  decimal: validateNumeric,

  // Float types
  float4: validateFloat,
  real: validateFloat,
  float8: validateFloat,
  "double precision": validateFloat,

  // Boolean
  boolean: validateBoolean,
  bool: validateBoolean,

  // Date/time types
  date: validateDate,
  timestamp: validateTimestamp,
  timestamptz: validateTimestamp,
  "timestamp with time zone": validateTimestamp,
  "timestamp without time zone": validateTimestamp,
  time: validateTime,
  timetz: validateTime,
  interval: validateInterval,

  // Binary
  bytea: validateBytea,

  // Geometry
  point: validatePoint,
  box: validateBox,
};

/**
 * Get appropriate validator for a database type
 */
export function getValidator(dbType: string): Validator | undefined {
  const normalized = dbType.toLowerCase().trim();

  // Direct match
  if (validators[normalized]) {
    return validators[normalized];
  }

  // Handle array types (e.g., "integer[]", "_int4")
  if (normalized.endsWith("[]") || normalized.startsWith("_")) {
    return undefined; // Arrays have complex validation, skip for now
  }

  // Handle varchar(n), char(n), etc.
  if (normalized.startsWith("varchar") || normalized.startsWith("character varying")) {
    return undefined; // Text validation handled elsewhere
  }

  if (normalized.startsWith("char") || normalized.startsWith("character")) {
    return undefined;
  }

  // Handle numeric(p,s)
  if (normalized.startsWith("numeric") || normalized.startsWith("decimal")) {
    return validators.numeric;
  }

  // Handle timestamp variants
  if (normalized.includes("timestamp")) {
    return validators.timestamp;
  }

  // Handle time variants
  if (normalized.includes("time") && !normalized.includes("stamp")) {
    return validators.time;
  }

  return undefined;
}

/**
 * Validate a cell value against its column type
 */
export function validateCell(
  value: unknown,
  column: GridColumnV2
): ValidationResult {
  const dbType = column.meta?.db_type;
  if (!dbType) return VALID;

  // Check nullable constraint
  if ((value == null || value === "") && !column.meta?.nullable) {
    return { valid: false, error: "This field cannot be null" };
  }

  // Get type-specific validator
  const validator = getValidator(dbType);
  if (!validator) return VALID;

  return validator(value, column);
}

/**
 * Validate multiple cells (for paste operations)
 */
export function validateCells(
  values: Array<{ value: unknown; column: GridColumnV2 }>
): ValidationResult[] {
  return values.map(({ value, column }) => validateCell(value, column));
}
