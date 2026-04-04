import type { VariableType } from "./types";

const LIST_SUFFIXES = ["_list", "_ids", "_values", "_items", "_set", "_types", "_names", "_codes", "_tags", "_categories"];
const LIST_NAMES = ["list", "ids", "values", "items", "types", "names", "codes", "tags", "categories", "statuses", "roles"];
const DATE_SUFFIXES = ["_date", "_at", "_on", "_time", "_timestamp"];
const DATE_NAMES = ["date", "start", "end", "from", "to", "since", "until", "before", "after", "created", "updated", "deleted", "expires"];
const DATETIME_SUFFIXES = ["_datetime", "_timestamp"];
const DATETIME_NAMES = ["datetime", "timestamp"];
const NUMBER_SUFFIXES = ["_id", "_count", "_num", "_amount", "_total", "_qty", "_quantity", "_price", "_limit", "_offset", "_page", "_size"];
const NUMBER_NAMES = ["id", "count", "limit", "offset", "page", "size", "amount", "total", "qty", "price", "age", "year", "month", "day"];
const BOOLEAN_SUFFIXES = ["_flag", "_enabled", "_disabled", "_active", "_deleted"];
const BOOLEAN_NAMES = ["active", "enabled", "disabled", "deleted", "archived", "published", "verified", "is_active", "is_enabled", "is_deleted", "flag"];

/**
 * Infer the variable type from its name using heuristics.
 * Positional variables (starting with $ or #) default to "text".
 */
export function inferVariableType(name: string): VariableType {
  // Positional parameters: default to text
  if (name.startsWith("$") || name.startsWith("#")) {
    return "text";
  }

  const lower = name.toLowerCase();

  // Check list first (plural names, _ids suffixes)
  if (LIST_NAMES.includes(lower) || LIST_SUFFIXES.some((s) => lower.endsWith(s))) {
    return "list";
  }

  // Check datetime first (more specific than date)
  if (DATETIME_NAMES.includes(lower) || DATETIME_SUFFIXES.some((s) => lower.endsWith(s))) {
    return "datetime";
  }

  if (DATE_NAMES.includes(lower) || DATE_SUFFIXES.some((s) => lower.endsWith(s))) {
    return "date";
  }

  if (NUMBER_NAMES.includes(lower) || NUMBER_SUFFIXES.some((s) => lower.endsWith(s))) {
    return "number";
  }

  if (BOOLEAN_NAMES.includes(lower) || BOOLEAN_SUFFIXES.some((s) => lower.endsWith(s))) {
    return "boolean";
  }

  return "text";
}
