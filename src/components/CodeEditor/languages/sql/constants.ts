/**
 * Shared SQL constants used across linter, completion, and hover modules.
 */

export const SQL_KEYWORDS = [
  // DML
  "SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "ON",
  "INSERT", "UPDATE", "DELETE", "TRUNCATE",
  "VALUES", "RETURNING", "INTO", "SET",
  // DDL
  "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW", "SCHEMA", "DATABASE",
  "COLUMN", "CONSTRAINT", "PRIMARY", "FOREIGN", "KEY", "REFERENCES",
  "UNIQUE", "CHECK", "DEFAULT",
  // Clauses
  "WITH", "DISTINCT", "UNION", "EXCEPT", "INTERSECT", "ALL", "ANY", "SOME",
  // EXPLAIN / ANALYZE
  "EXPLAIN", "ANALYZE", "BUFFERS", "COSTS", "FORMAT", "VERBOSE",
  "SETTINGS", "WAL", "TIMING", "SUMMARY",
  // Operators & Logic
  "AND", "OR", "NOT", "IN", "IS", "LIKE", "ILIKE", "BETWEEN", "EXISTS",
  "CASE", "WHEN", "THEN", "ELSE", "END",
  // Functions & Casts
  "CAST", "COALESCE", "NULLIF", "AS", "BY",
  // Ordering
  "ASC", "DESC", "NULLS", "FIRST", "LAST",
  // Literals
  "TRUE", "FALSE", "NULL",
  // Types (common)
  "TEXT", "JSON", "XML", "YAML",
] as const;

export type SqlKeyword = typeof SQL_KEYWORDS[number];

// Pre-computed Set for O(1) lookup
export const SQL_KEYWORDS_SET = new Set(SQL_KEYWORDS);

// Lowercase version for case-insensitive checks
export const SQL_KEYWORDS_LOWER = SQL_KEYWORDS.map(k => k.toLowerCase());
export const SQL_KEYWORDS_LOWER_SET = new Set(SQL_KEYWORDS_LOWER);

/**
 * Check if a string is a SQL keyword (case-insensitive)
 */
export function isSqlKeyword(text: string): boolean {
  return SQL_KEYWORDS_LOWER_SET.has(text.toLowerCase());
}

// Table-introducing keywords (used for table context detection)
export const TABLE_KEYWORDS = ["from", "join", "update", "into", "table"] as const;
export const TABLE_KEYWORDS_SET: Set<string> = new Set(TABLE_KEYWORDS);

/**
 * Check if a string is a table-introducing keyword
 */
export function isTableKeyword(text: string): boolean {
  return TABLE_KEYWORDS_SET.has(text.toLowerCase());
}
