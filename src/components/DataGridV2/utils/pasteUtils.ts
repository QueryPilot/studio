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
