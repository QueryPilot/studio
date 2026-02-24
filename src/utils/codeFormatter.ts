import { logger } from "@/lib/logger";
import { format as sqlFormat } from "sql-formatter";
import type { SqlDialect } from "@/components/CodeEditor/types";
import { splitStatements } from "@/components/CodeEditor/languages/sql/statement-splitter";

type SqlFormatterLanguage =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "plsql"
  | "tsql"
  | "sql";

const SQL_FORMAT_OPTIONS = {
  tabWidth: 2,
  keywordCase: "upper",
  indentStyle: "standard",
  linesBetweenQueries: 2,
  denseOperators: false,
  newlineBeforeSemicolon: false,
} as const;

const SQL_LANGUAGE_MAP: Record<SqlDialect, SqlFormatterLanguage> = {
  postgresql: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  plsql: "plsql",
  mssql: "tsql",
};

function uniqueLanguages(
  languages: readonly SqlFormatterLanguage[],
): SqlFormatterLanguage[] {
  return [...new Set(languages)];
}

function tryFormatWithLanguage(
  code: string,
  language: SqlFormatterLanguage,
): string | null {
  try {
    return sqlFormat(code, {
      language,
      ...SQL_FORMAT_OPTIONS,
    });
  } catch {
    return null;
  }
}

function formatWithFallbackLanguages(
  code: string,
  preferredLanguage: SqlFormatterLanguage,
): string | null {
  for (const language of uniqueLanguages([preferredLanguage, "sql"])) {
    const formatted = tryFormatWithLanguage(code, language);
    if (formatted !== null) {
      return formatted;
    }
  }
  return null;
}

function normalizeWhitespaceFallback(code: string): string {
  return code
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

function formatStatementByStatement(
  code: string,
  preferredLanguage: SqlFormatterLanguage,
): string | null {
  const statements = splitStatements(code);
  if (statements.length === 0) {
    return null;
  }

  let output = code;
  let changed = false;

  // Apply replacements in reverse so offsets remain valid.
  for (let i = statements.length - 1; i >= 0; i--) {
    const statement = statements[i];
    if (!statement) continue;

    const formatted = formatWithFallbackLanguages(
      statement.text,
      preferredLanguage,
    );
    if (formatted && formatted !== statement.text) {
      output = `${output.slice(0, statement.from)}${formatted}${output.slice(statement.to)}`;
      changed = true;
    }
  }

  return changed ? output : null;
}

/**
 * Format SQL code using sql-formatter
 */
export function formatSql(
  code: string,
  dialect: SqlDialect = "postgresql",
): string {
  if (!code.trim()) {
    return code;
  }

  const preferredLanguage = SQL_LANGUAGE_MAP[dialect];

  // Fast path: format whole document as-is.
  const fullDocumentFormatted = formatWithFallbackLanguages(
    code,
    preferredLanguage,
  );
  if (fullDocumentFormatted !== null) {
    return fullDocumentFormatted;
  }

  // Tolerant path: when document has parse errors, still format valid statements.
  const statementFormatted = formatStatementByStatement(code, preferredLanguage);
  if (statementFormatted !== null) {
    return statementFormatted;
  }

  // Last-resort lightweight cleanup so "Format" still does something useful.
  const normalized = normalizeWhitespaceFallback(code);
  if (normalized !== code) {
    return normalized;
  }

  logger.warn("SQL formatting skipped: unable to parse SQL in current state");
  return code;
}

/**
 * Format JSON code
 */
export function formatJson(code: string): string {
  if (!code.trim()) {
    return code;
  }

  try {
    const parsed = JSON.parse(code);
    return JSON.stringify(parsed, null, 2);
  } catch (error) {
    logger.error("JSON formatting error:", error);
    return code;
  }
}

/**
 * Format code based on language type
 */
export function formatCode(
  code: string,
  language: "sql" | "json" | "text" = "sql",
  dialect?: SqlDialect,
): string {
  switch (language) {
    case "sql":
      return formatSql(code, dialect);
    case "json":
      return formatJson(code);
    case "text":
    default:
      return code;
  }
}
