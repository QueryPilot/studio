/**
 * Detected paste format
 */
export type PasteFormat = "tsv" | "csv" | "json" | "unknown";

/**
 * Parsed paste result
 */
export interface ParsedPasteData {
  format: PasteFormat;
  rows: (string | number | boolean | null)[][];
  error?: string;
}

/**
 * Auto-detect paste format from clipboard text
 */
export function detectPasteFormat(text: string): PasteFormat {
  const trimmed = text.trim();

  // Try JSON first
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not valid JSON, continue detection
    }
  }

  // Check for tabs (TSV)
  const hasTab = trimmed.includes("\t");
  const hasComma = trimmed.includes(",");

  if (hasTab && !hasComma) {
    return "tsv";
  }

  if (hasComma && !hasTab) {
    return "csv";
  }

  // If both tabs and commas, count which is more frequent in first line
  if (hasTab && hasComma) {
    const firstLine = trimmed.split("\n")[0] || "";
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    return tabCount > commaCount ? "tsv" : "csv";
  }

  // Default to TSV for simple whitespace-separated values
  return "tsv";
}

/**
 * Parse clipboard text into rows and columns
 */
export function parsePasteData(text: string): ParsedPasteData {
  const format = detectPasteFormat(text);

  try {
    switch (format) {
      case "json":
        return parseJSON(text);
      case "csv":
        return parseCSV(text);
      case "tsv":
        return parseTSV(text);
      default:
        // Try TSV as fallback
        return parseTSV(text);
    }
  } catch (error) {
    return {
      format: "unknown",
      rows: [],
      error:
        error instanceof Error ? error.message : "Failed to parse paste data",
    };
  }
}

/**
 * Parse JSON array of objects
 */
export function parseJSON(text: string): ParsedPasteData {
  try {
    const parsed = JSON.parse(text.trim());

    // Handle single object
    if (!Array.isArray(parsed)) {
      if (typeof parsed === "object" && parsed !== null) {
        const values = Object.values(parsed as Record<string, unknown>).map(
          coerceValue,
        );
        return {
          format: "json",
          rows: [values],
        };
      }
      throw new Error("Invalid JSON format - expected array or object");
    }

    // Handle array of objects
    const rows = parsed.map((item) => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        return Object.values(item as Record<string, unknown>).map(coerceValue);
      }
      if (Array.isArray(item)) {
        return item.map(coerceValue);
      }
      return [coerceValue(item)];
    });

    return {
      format: "json",
      rows,
    };
  } catch (error) {
    throw new Error(
      `JSON parse error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

/**
 * Parse TSV (tab-separated values)
 */
export function parseTSV(text: string): ParsedPasteData {
  const lines = text.trim().split("\n");
  const rows = lines.map((line) => {
    return line.split("\t").map((cell) => coerceValue(cell.trim()));
  });

  return {
    format: "tsv",
    rows,
  };
}

/**
 * Parse CSV (comma-separated values)
 * Handles quoted fields with commas
 */
export function parseCSV(text: string): ParsedPasteData {
  const lines = text.trim().split("\n");
  const rows = lines.map((line) => parseCSVLine(line));

  return {
    format: "csv",
    rows,
  };
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string): (string | number | boolean | null)[] {
  const result: (string | number | boolean | null)[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const char = line[i]!;
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      // Field separator
      result.push(coerceValue(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }

  // Add last field
  result.push(coerceValue(current.trim()));

  return result;
}

/**
 * Coerce string value to appropriate type
 */
function coerceValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "object") return JSON.stringify(value);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return String(value);
    return "[Unknown]";
  }

  const str = value.trim();

  // Empty string -> null
  if (str === "") {
    return null;
  }

  // Null literals
  if (str.toLowerCase() === "null" || str === "\\N") {
    return null;
  }

  // Boolean
  if (str.toLowerCase() === "true") {
    return true;
  }
  if (str.toLowerCase() === "false") {
    return false;
  }

  // Number
  const num = Number(str);
  if (!Number.isNaN(num) && str !== "") {
    return num;
  }

  // Return as string
  return str;
}

// ============================================================================
// Smart Paste - Type-Aware Value Coercion
// ============================================================================

/**
 * Column type hint for smart paste
 */
export interface ColumnTypeHint {
  /** Database type (e.g., "integer", "uuid", "timestamp") */
  dbType: string;
  /** Whether column is nullable */
  nullable?: boolean;
}

const numericPattern = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

/**
 * Coerce value based on target column type
 */
export function coerceToColumnType(
  value: unknown,
  hint: ColumnTypeHint
): string | number | boolean | null {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return hint.nullable !== false ? null : "";
  }

  const str = typeof value === "string" ? value.trim() : String(value);
  const dbType = hint.dbType.toLowerCase();

  // Empty string handling
  if (str === "" || str.toLowerCase() === "null" || str === "\\N") {
    return hint.nullable !== false ? null : "";
  }

  // Integer types
  if (
    dbType.includes("int") ||
    dbType === "serial" ||
    dbType === "bigserial" ||
    dbType === "smallserial"
  ) {
    const cleaned = str.replace(/,/g, "");
    return /^[-+]?\d+$/.test(cleaned) ? cleaned : str;
  }

  // Float/decimal types
  if (
    dbType.includes("numeric") ||
    dbType.includes("decimal") ||
    dbType.includes("float") ||
    dbType.includes("double") ||
    dbType.includes("real") ||
    dbType === "money"
  ) {
    // Remove currency symbols and commas
    const cleaned = str.replace(/[$€£¥,]/g, "");
    return numericPattern.test(cleaned) ? cleaned : str;
  }

  // Boolean types
  if (dbType === "boolean" || dbType === "bool") {
    const lower = str.toLowerCase();
    if (["true", "t", "yes", "y", "1", "on"].includes(lower)) return true;
    if (["false", "f", "no", "n", "0", "off"].includes(lower)) return false;
    return str;
  }

  // UUID - validate format
  if (dbType === "uuid") {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(str)) return str.toLowerCase();
    // Try to format as UUID if it's 32 hex chars
    const hex = str.replace(/[^0-9a-f]/gi, "");
    if (hex.length === 32) {
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
    }
    return str;
  }

  // JSON types
  if (dbType === "json" || dbType === "jsonb") {
    // Already valid JSON string
    if (str.startsWith("{") || str.startsWith("[")) {
      try {
        JSON.parse(str);
        return str;
      } catch {
        // Not valid JSON, wrap as string
        return JSON.stringify(str);
      }
    }
    return str;
  }

  // Date types - try to parse and format
  if (dbType === "date") {
    const date = new Date(str);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().split("T")[0] ?? str;
    }
    return str;
  }

  // Timestamp types
  if (dbType.includes("timestamp")) {
    const date = new Date(str);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
    return str;
  }

  // Array types - try to parse
  if (dbType.endsWith("[]") || dbType.startsWith("_")) {
    // If it looks like a PostgreSQL array literal, return as-is
    if (str.startsWith("{") && str.endsWith("}")) {
      return str;
    }
    // If it's JSON array, convert to PostgreSQL format
    if (str.startsWith("[")) {
      try {
        const arr = JSON.parse(str);
        if (Array.isArray(arr)) {
          return `{${arr.map((v) => JSON.stringify(v)).join(",")}}`;
        }
      } catch {
        // Not valid JSON array
      }
    }
    return str;
  }

  // Default: return as string
  return str;
}

/**
 * Smart paste - coerce all values based on target column types
 */
export function smartPasteCoerce(
  rows: (string | number | boolean | null)[][],
  columnHints: ColumnTypeHint[]
): (string | number | boolean | null)[][] {
  return rows.map((row) =>
    row.map((value, colIndex) => {
      const hint = columnHints[colIndex];
      if (!hint) return value;
      return coerceToColumnType(value, hint);
    })
  );
}

/**
 * Validate paste data against column types
 * Returns validation errors if any
 */
export interface PasteValidationError {
  row: number;
  column: number;
  value: unknown;
  error: string;
}

export function validatePasteData(
  rows: (string | number | boolean | null)[][],
  columnHints: ColumnTypeHint[]
): PasteValidationError[] {
  const errors: PasteValidationError[] = [];

  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      const hint = columnHints[colIndex];
      if (!hint) return;

      // Check nullable constraint
      if (value === null && hint.nullable === false) {
        errors.push({
          row: rowIndex,
          column: colIndex,
          value,
          error: "Value cannot be null",
        });
        return;
      }

      // Type-specific validation
      const dbType = hint.dbType.toLowerCase();

      if (value !== null) {
        // UUID validation
        if (dbType === "uuid") {
          const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const str = String(value);
          if (!uuidRegex.test(str)) {
            errors.push({
              row: rowIndex,
              column: colIndex,
              value,
              error: "Invalid UUID format",
            });
          }
        }

        // Integer validation
        if (dbType.includes("int") && typeof value === "string") {
          const num = parseInt(value, 10);
          if (Number.isNaN(num)) {
            errors.push({
              row: rowIndex,
              column: colIndex,
              value,
              error: "Invalid integer",
            });
          }
        }

        // JSON validation
        if ((dbType === "json" || dbType === "jsonb") && typeof value === "string") {
          try {
            JSON.parse(value);
          } catch {
            errors.push({
              row: rowIndex,
              column: colIndex,
              value,
              error: "Invalid JSON",
            });
          }
        }
      }
    });
  });

  return errors;
}
