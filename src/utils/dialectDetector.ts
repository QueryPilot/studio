import type { SqlDialect } from "@/components/CodeEditor";
import { DbType } from "@/types/connection";

/**
 * Strip SQL comments to allow pattern matching on actual code
 * Handles both line comments (--) and block comments
 */
function stripSqlComments(sql: string): string {
  // Remove block comments first (/* ... */)
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove line comments (-- to end of line)
  result = result.replace(/--[^\n]*/g, " ");
  // Collapse whitespace and trim
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Check if SQL content contains PL/pgSQL procedural code patterns
 */
function containsProceduralCode(sql: string): boolean {
  // Strip comments first so we can detect patterns properly
  const stripped = stripSqlComments(sql);
  const sqlUpper = stripped.toUpperCase();

  // Check for start patterns (after stripping comments)
  const startsWithProcedural =
    sqlUpper.startsWith("DO ") ||
    sqlUpper.startsWith("DO$$") ||
    sqlUpper.startsWith("CREATE FUNCTION") ||
    sqlUpper.startsWith("CREATE OR REPLACE FUNCTION") ||
    sqlUpper.startsWith("CREATE PROCEDURE") ||
    sqlUpper.startsWith("CREATE OR REPLACE PROCEDURE") ||
    sqlUpper.startsWith("CREATE TRIGGER") ||
    sqlUpper.startsWith("CREATE OR REPLACE TRIGGER");

  if (startsWithProcedural) {
    return true;
  }

  // Check for patterns anywhere in the SQL
  const containsProceduralPatterns =
    // Dollar-quoted strings (most reliable PL/pgSQL indicator)
    sqlUpper.includes("$$") ||
    // Language declaration
    sqlUpper.includes("LANGUAGE PLPGSQL") ||
    sqlUpper.includes("LANGUAGE 'PLPGSQL'") ||
    // Trigger-specific patterns
    sqlUpper.includes("EXECUTE FUNCTION") ||
    sqlUpper.includes("EXECUTE PROCEDURE") ||
    sqlUpper.includes("FOR EACH ROW") ||
    sqlUpper.includes("FOR EACH STATEMENT") ||
    // PL/pgSQL control structures
    sqlUpper.includes("RAISE ") ||
    sqlUpper.includes("RAISE;") ||
    // DECLARE/BEGIN/END block detection (common in PL/pgSQL)
    (sqlUpper.includes("DECLARE") &&
      sqlUpper.includes("BEGIN") &&
      sqlUpper.includes("END")) ||
    // BEGIN/END without TRANSACTION (PL/pgSQL block, not transaction)
    (sqlUpper.includes("BEGIN") &&
      sqlUpper.includes("END;") &&
      !sqlUpper.includes("BEGIN TRANSACTION") &&
      !sqlUpper.includes("BEGIN WORK") &&
      !sqlUpper.includes("COMMIT") &&
      !sqlUpper.includes("ROLLBACK")) ||
    // Exception handling
    sqlUpper.includes("EXCEPTION WHEN") ||
    // PL/pgSQL specific keywords
    sqlUpper.includes("RETURN NEW") ||
    sqlUpper.includes("RETURN OLD") ||
    sqlUpper.includes("RETURN NEXT") ||
    sqlUpper.includes("RETURN QUERY") ||
    // Variable assignment (PL/pgSQL uses :=)
    stripped.includes(":=") ||
    // FOUND variable (PL/pgSQL specific)
    sqlUpper.includes("IF FOUND") ||
    sqlUpper.includes("IF NOT FOUND");

  return containsProceduralPatterns;
}

/**
 * Detect the appropriate SQL dialect for syntax highlighting
 * @param dbType - Database type from connection profile
 * @param sql - Optional SQL query to analyze for procedural code
 * @returns The appropriate CodeMirror SQL dialect
 */
export function detectSqlDialect(
  dbType: DbType | string,
  sql?: string,
): SqlDialect {
  // Normalize dbType to handle various formats
  const normalizedDbType =
    typeof dbType === "string" ? dbType.toLowerCase() : dbType;

  // For PostgreSQL, detect if this is procedural code (PL/pgSQL)
  if (
    normalizedDbType === DbType.PostgreSQL.toLowerCase() ||
    normalizedDbType === "postgres" ||
    normalizedDbType.includes("postgres")
  ) {
    // If SQL provided, check if it's procedural code
    if (sql && containsProceduralCode(sql)) {
      // Use plsql dialect for PL/pgSQL code (better highlighting)
      return "plsql";
    }
    // Regular PostgreSQL SQL
    return "postgresql";
  }

  // MySQL
  if (
    normalizedDbType === DbType.MySQL.toLowerCase() ||
    normalizedDbType === "mysql"
  ) {
    return "mysql";
  }

  // SQLite
  if (
    normalizedDbType === DbType.SQLite.toLowerCase() ||
    normalizedDbType === "sqlite"
  ) {
    return "sqlite";
  }

  // SQL Server / MSSQL
  if (
    normalizedDbType === DbType.SQLServer.toLowerCase() ||
    normalizedDbType === "mssql" ||
    normalizedDbType === "sqlserver"
  ) {
    return "mssql";
  }

  // Default to PostgreSQL
  return "postgresql";
}

/**
 * Detect dialect for object definitions (functions, procedures, views, etc.)
 * @param dbType - Database type from connection profile
 * @param objectType - Type of database object
 * @returns The appropriate CodeMirror SQL dialect
 */
export function detectDialectForObject(
  dbType: DbType | string,
  objectType: import("@/adapters/types").ObjectDefinitionType,
): SqlDialect {
  const normalizedDbType = typeof dbType === "string"
    ? dbType.toLowerCase()
    : dbType;

  // For PostgreSQL functions/procedures, use plsql for better PL/pgSQL highlighting
  if (
    (normalizedDbType === DbType.PostgreSQL.toLowerCase() ||
      normalizedDbType.includes("postgres")) &&
    (objectType === "function" || objectType === "procedure")
  ) {
    return "plsql";
  }

  // For all other cases, use standard dialect detection
  return detectSqlDialect(dbType);
}
