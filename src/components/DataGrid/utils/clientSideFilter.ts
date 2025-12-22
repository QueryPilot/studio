/**
 * Client-side filtering for query results
 */

import type { FilterConfig, FilterCondition, FilterGroup } from "@/types";

// Define GridRowModel type locally to avoid circular dependency
type GridRowModel = Record<string, unknown>;

// Cell value wrapper used in query mode
interface CellValueWrapper {
  value: unknown;
  db_type?: string;
}

export interface FilterOptions {
  /** Map column names to row keys (for query mode with col_N keys) */
  columnKeyMap?: Map<string, string>;
  /** Whether row values are wrapped in {value: ...} objects */
  wrappedValues?: boolean;
}

/**
 * Get value from row, handling both direct access and wrapped values
 */
function getRowValue(
  row: GridRowModel,
  column: string,
  options: FilterOptions,
): unknown {
  const key = options.columnKeyMap?.get(column) ?? column;
  const cellData = row[key];

  if (options.wrappedValues && cellData && typeof cellData === "object") {
    return (cellData as CellValueWrapper).value;
  }

  return cellData;
}

/**
 * Apply a FilterConfig to rows client-side
 */
export function applyClientSideFilter(
  rows: GridRowModel[],
  filter: FilterConfig | undefined,
  columns: string[],
  options: FilterOptions = {},
): GridRowModel[] {
  if (!filter) {
    return rows;
  }

  // Handle raw WHERE clause - convert to simple search
  if (filter.rawWhereClause) {
    return applySimpleSearch(rows, filter.rawWhereClause, columns, options);
  }

  // Handle structured filter
  return rows.filter((row) => evaluateGroup(row, filter.root, columns, options));
}

/**
 * Simple search - match any column containing the search term
 */
function applySimpleSearch(
  rows: GridRowModel[],
  searchTerm: string,
  columns: string[],
  options: FilterOptions,
): GridRowModel[] {
  const term = searchTerm.toLowerCase().trim();
  if (!term) {
    return rows;
  }

  return rows.filter((row) => {
    for (const col of columns) {
      const value = getRowValue(row, col, options);
      if (value === null || value === undefined) {
        continue;
      }
      const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
      if (strValue.toLowerCase().includes(term)) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Evaluate a filter group (AND/OR logic)
 */
function evaluateGroup(row: GridRowModel, group: FilterGroup, columns: string[], options: FilterOptions): boolean {
  if (group.conditions.length === 0) {
    return true;
  }

  const results = group.conditions.map((item) => {
    if ("type" in item && item.type === "group") {
      return evaluateGroup(row, item, columns, options);
    }
    return evaluateCondition(row, item as FilterCondition, options);
  });

  if (group.logical === "AND") {
    return results.every(Boolean);
  }
  return results.some(Boolean);
}

/**
 * Evaluate a single filter condition
 */
function evaluateCondition(row: GridRowModel, condition: FilterCondition, options: FilterOptions): boolean {
  const value = getRowValue(row, condition.column, options);
  const filterValue = condition.value;

  // Handle NULL checks first
  if (condition.operator === "IS NULL") {
    const result = value === null || value === undefined;
    return condition.negated ? !result : result;
  }
  if (condition.operator === "IS NOT NULL") {
    const result = value !== null && value !== undefined;
    return condition.negated ? !result : result;
  }

  // For other operators, null values don't match
  if (value === null || value === undefined) {
    return condition.negated ? true : false;
  }

  const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
  const lowerValue = strValue.toLowerCase();
  const lowerFilter = String(filterValue ?? "").toLowerCase();

  let result: boolean;

  switch (condition.operator) {
    case "=":
      result = strValue === String(filterValue);
      break;
    case "!=":
      result = strValue !== String(filterValue);
      break;
    case "CONTAINS":
      result = lowerValue.includes(lowerFilter);
      break;
    case "NOT CONTAINS":
      result = !lowerValue.includes(lowerFilter);
      break;
    case "STARTS WITH":
      result = lowerValue.startsWith(lowerFilter);
      break;
    case "ENDS WITH":
      result = lowerValue.endsWith(lowerFilter);
      break;
    case "LIKE":
      result = matchLike(strValue, String(filterValue ?? ""), true);
      break;
    case "ILIKE":
      result = matchLike(strValue, String(filterValue ?? ""), false);
      break;
    case "NOT LIKE":
      result = !matchLike(strValue, String(filterValue ?? ""), true);
      break;
    case "REGEX":
      result = matchRegex(strValue, String(filterValue ?? ""), true);
      break;
    case "REGEX_I":
      result = matchRegex(strValue, String(filterValue ?? ""), false);
      break;
    case ">":
    case "<":
    case ">=":
    case "<=":
      result = compareValues(value, filterValue, condition.operator);
      break;
    case "IN":
      if (Array.isArray(filterValue)) {
        result = filterValue.some((v) => String(v) === strValue);
      } else {
        result = false;
      }
      break;
    case "NOT IN":
      if (Array.isArray(filterValue)) {
        result = !filterValue.some((v) => String(v) === strValue);
      } else {
        result = true;
      }
      break;
    case "BETWEEN":
      if (Array.isArray(filterValue) && filterValue.length === 2) {
        const numValue = Number(value);
        const minVal = Number(filterValue[0]);
        const maxVal = Number(filterValue[1]);
        result = numValue >= minVal && numValue <= maxVal;
      } else {
        result = false;
      }
      break;
    default:
      result = true;
  }

  return condition.negated ? !result : result;
}

/**
 * SQL LIKE pattern matching
 */
function matchLike(value: string, pattern: string, caseSensitive: boolean): boolean {
  // Convert SQL LIKE pattern to regex
  const regexPattern = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
    .replace(/%/g, ".*") // % = any characters
    .replace(/_/g, "."); // _ = single character

  const flags = caseSensitive ? "" : "i";
  const regex = new RegExp(`^${regexPattern}$`, flags);
  return regex.test(value);
}

/**
 * Regex pattern matching
 */
function matchRegex(value: string, pattern: string, caseSensitive: boolean): boolean {
  try {
    const flags = caseSensitive ? "" : "i";
    const regex = new RegExp(pattern, flags);
    return regex.test(value);
  } catch {
    // Invalid regex pattern - return false
    return false;
  }
}

/**
 * Compare numeric or string values
 */
function compareValues(
  value: unknown,
  filterValue: unknown,
  operator: ">" | "<" | ">=" | "<=",
): boolean {
  const numValue = Number(value);
  const numFilter = Number(filterValue);

  // If both are valid numbers, compare numerically
  if (!isNaN(numValue) && !isNaN(numFilter)) {
    switch (operator) {
      case ">":
        return numValue > numFilter;
      case "<":
        return numValue < numFilter;
      case ">=":
        return numValue >= numFilter;
      case "<=":
        return numValue <= numFilter;
    }
  }

  // Otherwise compare as strings
  const strValue = String(value);
  const strFilter = String(filterValue);

  switch (operator) {
    case ">":
      return strValue > strFilter;
    case "<":
      return strValue < strFilter;
    case ">=":
      return strValue >= strFilter;
    case "<=":
      return strValue <= strFilter;
  }
}
