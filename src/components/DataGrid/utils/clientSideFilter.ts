/**
 * Client-side filtering for query results
 */

import type { FilterConfig, FilterCondition, FilterGroup } from "@/types";

// Define GridRowModel type locally to avoid circular dependency
type GridRowModel = Record<string, unknown>;

/**
 * Apply a FilterConfig to rows client-side
 */
export function applyClientSideFilter(
  rows: GridRowModel[],
  filter: FilterConfig | undefined,
  columns: string[],
): GridRowModel[] {
  if (!filter) {
    return rows;
  }

  // Handle raw WHERE clause - convert to simple search
  if (filter.rawWhereClause) {
    return applySimpleSearch(rows, filter.rawWhereClause, columns);
  }

  // Handle structured filter
  return rows.filter((row) => evaluateGroup(row, filter.root, columns));
}

/**
 * Simple search - match any column containing the search term
 */
function applySimpleSearch(
  rows: GridRowModel[],
  searchTerm: string,
  columns: string[],
): GridRowModel[] {
  const term = searchTerm.toLowerCase().trim();
  if (!term) {
    return rows;
  }

  return rows.filter((row) => {
    for (const col of columns) {
      const value = row[col];
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
function evaluateGroup(row: GridRowModel, group: FilterGroup, columns: string[]): boolean {
  if (group.conditions.length === 0) {
    return true;
  }

  const results = group.conditions.map((item) => {
    if ("type" in item && item.type === "group") {
      return evaluateGroup(row, item, columns);
    }
    return evaluateCondition(row, item as FilterCondition);
  });

  if (group.logical === "AND") {
    return results.every(Boolean);
  }
  return results.some(Boolean);
}

/**
 * Evaluate a single filter condition
 */
function evaluateCondition(row: GridRowModel, condition: FilterCondition): boolean {
  const value = row[condition.column];
  const filterValue = condition.value;

  // Handle NULL checks first
  if (condition.operator === "IS NULL") {
    return value === null || value === undefined;
  }
  if (condition.operator === "IS NOT NULL") {
    return value !== null && value !== undefined;
  }

  // For other operators, null values don't match
  if (value === null || value === undefined) {
    return false;
  }

  const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
  const lowerValue = strValue.toLowerCase();
  const lowerFilter = String(filterValue ?? "").toLowerCase();

  switch (condition.operator) {
    case "=":
      return strValue === String(filterValue);
    case "!=":
      return strValue !== String(filterValue);
    case "CONTAINS":
      return lowerValue.includes(lowerFilter);
    case "NOT CONTAINS":
      return !lowerValue.includes(lowerFilter);
    case "STARTS WITH":
      return lowerValue.startsWith(lowerFilter);
    case "ENDS WITH":
      return lowerValue.endsWith(lowerFilter);
    case "LIKE":
      return matchLike(strValue, String(filterValue ?? ""));
    case "NOT LIKE":
      return !matchLike(strValue, String(filterValue ?? ""));
    case ">":
    case "<":
    case ">=":
    case "<=":
      return compareValues(value, filterValue, condition.operator);
    case "IN":
      if (Array.isArray(filterValue)) {
        return filterValue.some((v) => String(v) === strValue);
      }
      return false;
    case "NOT IN":
      if (Array.isArray(filterValue)) {
        return !filterValue.some((v) => String(v) === strValue);
      }
      return true;
    case "BETWEEN":
      if (Array.isArray(filterValue) && filterValue.length === 2) {
        const numValue = Number(value);
        const minVal = Number(filterValue[0]);
        const maxVal = Number(filterValue[1]);
        return numValue >= minVal && numValue <= maxVal;
      }
      return false;
    default:
      return true;
  }
}

/**
 * SQL LIKE pattern matching
 */
function matchLike(value: string, pattern: string): boolean {
  // Convert SQL LIKE pattern to regex
  const regexPattern = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
    .replace(/%/g, ".*") // % = any characters
    .replace(/_/g, "."); // _ = single character

  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(value);
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
