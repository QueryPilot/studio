export const MAX_CORRECTION_ATTEMPTS = 3;

const READ_ONLY_PREFIXES = [
  "SELECT",
  "EXPLAIN",
  "SHOW",
  "DESCRIBE",
  "DESC",
];

const MUTATING_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "MERGE",
];

/** Strip SQL comments (single-line and block) and leading whitespace */
function stripCommentsAndWhitespace(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/--[^\n]*/g, "")          // single-line comments
    .replace(/^\s+/, "")               // leading whitespace
    .toUpperCase();
}

/**
 * Check if a SQL statement is read-only (safe for auto-retry).
 * Strips comments and whitespace before checking.
 * CTEs (WITH ... SELECT) are read-only, but WITH ... INSERT/UPDATE/DELETE are not.
 */
export function isReadOnlyStatement(sql: string): boolean {
  const stripped = stripCommentsAndWhitespace(sql);

  if (stripped.length === 0) return false;

  // Handle CTEs: WITH ... must end with a read-only main statement.
  // Use word boundary matching to avoid false positives from table names
  // like "user_updates" matching "UPDATE".
  if (stripped.startsWith("WITH")) {
    const wordBoundary = (kw: string) =>
      new RegExp(`(?<![A-Z_])${kw}(?![A-Z_])`);
    return !MUTATING_KEYWORDS.some((kw) => wordBoundary(kw).test(stripped));
  }

  return READ_ONLY_PREFIXES.some((prefix) =>
    stripped.startsWith(prefix),
  );
}

/**
 * Build a correction prompt to send back to the AI after a query error.
 */
export function buildCorrectionPrompt(
  originalQuery: string,
  errorMessage: string,
  attemptNumber: number,
): string {
  return [
    `The query I ran failed (attempt ${attemptNumber} of ${MAX_CORRECTION_ATTEMPTS}). Please fix it.`,
    "",
    "**Query that failed:**",
    "```sql",
    originalQuery,
    "```",
    "",
    "**Error:**",
    "```",
    errorMessage,
    "```",
    "",
    "Please provide a corrected query. Only output the SQL in a code block, no explanation needed.",
  ].join("\n");
}
