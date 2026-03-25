import type { JsonValue } from "@/types";

/**
 * Extracts and converts a cell edit value based on the column type.
 */
export function convertEditValue(
  extractedValue: string,
  columnDbType: string
): JsonValue {
  const normalizedType = columnDbType.toLowerCase();
  const isNumericColumn =
    normalizedType.includes("int") ||
    normalizedType.includes("serial") ||
    normalizedType.includes("numeric") ||
    normalizedType.includes("decimal") ||
    normalizedType.includes("float") ||
    normalizedType.includes("double") ||
    normalizedType.includes("real") ||
    normalizedType.includes("money");

  if (
    isNumericColumn &&
    typeof extractedValue === "string" &&
    extractedValue !== ""
  ) {
    const trimmed = extractedValue.trim();
    const num = Number(trimmed);
    return isNaN(num) ? trimmed : num;
  }

  return extractedValue as JsonValue;
}
