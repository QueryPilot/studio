export const MAX_CORRECTION_ATTEMPTS = 3;

const READ_ONLY_PREFIXES = [
  "SELECT",
  "SHOW",
  "DESCRIBE",
  "DESC",
  "PRAGMA",
  "VALUES",
];

const MUTATING_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "UPSERT",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "MERGE",
  "GRANT",
  "REVOKE",
];

/** Strip SQL comments (single-line and block) and leading whitespace */
function stripCommentsAndWhitespace(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/--[^\n]*/g, "")          // single-line comments
    .replace(/^\s+/, "")               // leading whitespace
    .toUpperCase();
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === undefined) continue;
    const prev = i > 0 ? sql[i - 1] : "";
    const escaped = prev === "\\";

    if (!escaped && !inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
    } else if (!escaped && !inSingle && !inBacktick && ch === "\"") {
      inDouble = !inDouble;
    } else if (!escaped && !inSingle && !inDouble && ch === "`") {
      inBacktick = !inBacktick;
    }

    if (ch === ";" && !inSingle && !inDouble && !inBacktick) {
      const statement = current.trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const finalStatement = current.trim();
  if (finalStatement.length > 0) {
    statements.push(finalStatement);
  }

  return statements;
}

function stripQuotedLiterals(sql: string): string {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === undefined) continue;

    const prev = i > 0 ? sql[i - 1] : "";
    const escaped = prev === "\\";

    if (!escaped && !inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
      out += " ";
      continue;
    }
    if (!escaped && !inSingle && !inBacktick && ch === "\"") {
      inDouble = !inDouble;
      out += " ";
      continue;
    }
    if (!escaped && !inSingle && !inDouble && ch === "`") {
      inBacktick = !inBacktick;
      out += " ";
      continue;
    }

    if (inSingle || inDouble || inBacktick) {
      out += " ";
    } else {
      out += ch;
    }
  }

  return out;
}

function hasMutatingKeyword(sql: string): boolean {
  const sanitized = stripQuotedLiterals(sql);
  return MUTATING_KEYWORDS.some((kw) =>
    new RegExp(`(?<![A-Z0-9_])${kw}(?![A-Z0-9_])`).test(sanitized),
  );
}

function isReadOnlySingleStatement(statement: string): boolean {
  if (!statement) return false;

  // EXPLAIN is read-only unless ANALYZE would execute mutating SQL.
  if (statement.startsWith("EXPLAIN")) {
    if (/\bANALYZE\b/.test(statement) && hasMutatingKeyword(statement)) {
      return false;
    }
    return true;
  }

  // WITH ... SELECT is read-only; WITH ... DML is not.
  if (statement.startsWith("WITH")) {
    return !hasMutatingKeyword(statement);
  }

  if (hasMutatingKeyword(statement)) {
    return false;
  }

  if (READ_ONLY_PREFIXES.some((prefix) => statement.startsWith(prefix))) {
    return true;
  }

  // Transaction control keywords are treated as non-mutating in this guard.
  if (
    statement.startsWith("BEGIN") ||
    statement.startsWith("COMMIT") ||
    statement.startsWith("ROLLBACK") ||
    statement.startsWith("SAVEPOINT") ||
    statement.startsWith("RELEASE")
  ) {
    return true;
  }

  return false;
}

/**
 * Check if a SQL statement is read-only (safe for auto-retry).
 * Strips comments/whitespace and evaluates each statement in a SQL batch.
 */
export function isReadOnlyStatement(sql: string): boolean {
  const stripped = stripCommentsAndWhitespace(sql);

  if (stripped.length === 0) return false;

  const statements = splitSqlStatements(stripped);
  if (statements.length === 0) return false;
  return statements.every(isReadOnlySingleStatement);
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
