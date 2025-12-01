import type { FilterCondition, FilterConfig } from "@/types/filter";

export type FilterMode = "search" | "where" | "ai";

export interface ColumnMeta {
  name: string;
  dataType: string;
  nullable?: boolean;
  enumValues?: string[];
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  foreignTable?: string;
  foreignColumn?: string;
}

export interface ParseResult {
  success: boolean;
  filter?: FilterConfig;
  error?: string;
}

let conditionIdCounter = 0;
function generateId(): string {
  return `cond_${++conditionIdCounter}`;
}

function isTextType(dataType: string): boolean {
  const textTypes = [
    "text",
    "varchar",
    "char",
    "character",
    "string",
    "nvarchar",
    "nchar",
    "ntext",
    "citext",
  ];
  return textTypes.some((t) => dataType.toLowerCase().includes(t));
}

// For simple search, we want to search across most column types
// Exclude only binary/blob types that can't be meaningfully searched
function isSearchableType(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  const unsearchable = [
    "bytea",
    "blob",
    "binary",
    "varbinary",
    "image",
    "geometry",
    "geography",
  ];
  return !unsearchable.some((t) => lower.includes(t));
}

export function parseSimpleSearch(
  text: string,
  columns: ColumnMeta[]
): FilterConfig {
  let searchValue = text.trim();
  if (!searchValue) {
    return createEmptyFilter();
  }

  // Check for case-sensitive prefix (!)
  const caseSensitive = searchValue.startsWith("!");
  if (caseSensitive) {
    searchValue = searchValue.slice(1).trim();
    if (!searchValue) {
      return createEmptyFilter();
    }
  }

  // Search across all searchable columns (exclude binary/blob types)
  const searchableColumns = columns.filter((c) => isSearchableType(c.dataType));

  if (searchableColumns.length === 0) {
    return createEmptyFilter();
  }

  const conditions: FilterCondition[] = searchableColumns.map((col) => {
    // For text types, use ILIKE/LIKE directly
    // For non-text types, we need to cast to text first
    const needsCast = !isTextType(col.dataType);

    return {
      id: generateId(),
      column: col.name,
      operator: caseSensitive ? "LIKE" : "ILIKE",
      value: `%${searchValue}%`,
      // Mark that this column needs casting for non-text types
      castToText: needsCast,
    };
  });

  return {
    root: {
      id: "root",
      type: "group",
      logical: "OR",
      conditions,
    },
  };
}

export function parseWhereClause(
  whereExpr: string,
  _columns: ColumnMeta[]
): ParseResult {
  let expr = whereExpr.trim();

  // Safety: always strip mode prefixes if present
  if (expr.startsWith("?") || expr.startsWith("#") || expr.startsWith("!")) {
    expr = expr.slice(1).trim();
  }

  if (!expr) {
    return { success: true, filter: undefined };
  }

  // Basic syntax validation only - let database handle complex validation
  const syntaxError = validateBasicSyntax(expr);
  if (syntaxError) {
    return { success: false, error: syntaxError };
  }

  // Return raw clause - database will validate column names and SQL syntax
  return {
    success: true,
    filter: {
      root: {
        id: "root",
        type: "group",
        logical: "AND",
        conditions: [],
      },
      rawWhereClause: expr,
    },
  };
}

// Basic syntax validation - just catch obvious errors
function validateBasicSyntax(clause: string): string | null {
  // Check balanced parentheses
  let depth = 0;
  for (const char of clause) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth < 0) return "Unbalanced parentheses";
  }
  if (depth !== 0) return "Unbalanced parentheses";

  // Check balanced quotes
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < clause.length; i++) {
    const char = clause[i];
    const prevChar = i > 0 ? clause[i - 1] : "";

    if (char === "'" && prevChar !== "\\" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && prevChar !== "\\" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    }
  }
  if (inSingleQuote) return "Unclosed single quote";
  if (inDoubleQuote) return "Unclosed double quote";

  // Check has comparison operator
  const hasOperator = /[=<>!]|(?:LIKE|ILIKE|IN|IS|BETWEEN)\b/i.test(clause);
  if (!hasOperator) {
    return "Missing comparison operator";
  }

  return null;
}


export function sanitizeInput(input: string, mode: FilterMode): string {
  let sanitized = input.trim();

  // Handle escape sequences first: \? \# \! become literal characters
  if (sanitized.startsWith("\\")) {
    // Remove the backslash, keep the escaped character
    sanitized = sanitized.slice(1);
    return sanitized;
  }

  // Always strip mode prefixes based on current mode
  switch (mode) {
    case "where":
      if (sanitized.startsWith("?")) {
        sanitized = sanitized.slice(1).trim();
      }
      break;
    case "ai":
      if (sanitized.startsWith("#")) {
        sanitized = sanitized.slice(1).trim();
      }
      break;
    case "search":
      if (sanitized.startsWith("!")) {
        sanitized = sanitized.slice(1).trim();
      }
      break;
  }

  // Safety: strip any remaining mode prefixes
  if (sanitized.startsWith("?") || sanitized.startsWith("#") || sanitized.startsWith("!")) {
    sanitized = sanitized.slice(1).trim();
  }

  return sanitized;
}

function createEmptyFilter(): FilterConfig {
  return {
    root: {
      id: "root",
      type: "group",
      logical: "AND",
      conditions: [],
    },
  };
}

export function detectFilterMode(input: string): FilterMode {
  const trimmed = input.trim();
  // Support escape sequences: \? \# \! to search literal characters
  if (trimmed.startsWith("\\")) return "search";
  if (trimmed.startsWith("#")) return "ai";
  if (trimmed.startsWith("?")) return "where";
  return "search";
}
