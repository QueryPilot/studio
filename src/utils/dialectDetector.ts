import type { SqlDialect } from "@/components/CodeEditor";
import { DbType } from "@/types/connection";

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
  const normalizedDbType = typeof dbType === "string"
    ? dbType.toLowerCase()
    : dbType;

  // For PostgreSQL, detect if this is procedural code (PL/pgSQL)
  if (
    normalizedDbType === DbType.PostgreSQL.toLowerCase() ||
    normalizedDbType.includes("postgres")
  ) {
    // If SQL provided, check if it's procedural code
    if (sql) {
      const sqlUpper = sql.trim().toUpperCase();
      const isProceduralCode =
        sqlUpper.startsWith("DO ") ||
        sqlUpper.startsWith("DO$$") ||
        sqlUpper.startsWith("CREATE FUNCTION") ||
        sqlUpper.startsWith("CREATE OR REPLACE FUNCTION") ||
        sqlUpper.startsWith("CREATE PROCEDURE") ||
        sqlUpper.startsWith("CREATE OR REPLACE PROCEDURE") ||
        sqlUpper.includes("DECLARE") ||
        sqlUpper.includes("BEGIN") && sqlUpper.includes("END") ||
        sqlUpper.includes("RAISE ") ||
        sqlUpper.includes("$$"); // Dollar-quoted strings common in PL/pgSQL

      // Use plsql dialect for PL/pgSQL code (better highlighting)
      if (isProceduralCode) {
        return "plsql";
      }
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
  objectType: "table" | "view" | "materialized_view" | "function" | "procedure",
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
