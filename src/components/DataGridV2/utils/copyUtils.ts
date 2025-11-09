import type { GridColumnV2, GridRowModel } from "../types";
import type { DatabaseType } from "@/types/database";

/**
 * Format rows as JSON array
 */
export function copyAsJSON(
  rows: GridRowModel[],
  columns: GridColumnV2[],
): string {
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col) => {
      const cellValue = row[col.field];
      obj[col.field] =
        cellValue && typeof cellValue === "object" && "value" in cellValue
          ? cellValue.value
          : null;
    });
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

/**
 * Format rows as CSV with headers
 */
export function copyAsCSV(
  rows: GridRowModel[],
  columns: GridColumnV2[],
): string {
  const headers = columns.map((col) => escapeCSV(col.name));
  const headerRow = headers.join(",");

  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const cellValue = row[col.field];
        const value =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? cellValue.value
            : null;
        return escapeCSV(formatValue(value));
      })
      .join(","),
  );

  return [headerRow, ...dataRows].join("\n");
}

/**
 * Format rows as TSV (tab-separated values)
 */
export function copyAsTSV(
  rows: GridRowModel[],
  columns: GridColumnV2[],
): string {
  const headers = columns.map((col) => col.name);
  const headerRow = headers.join("\t");

  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const cellValue = row[col.field];
        const value =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? cellValue.value
            : null;
        return formatValue(value);
      })
      .join("\t"),
  );

  return [headerRow, ...dataRows].join("\n");
}

/**
 * Generate SQL INSERT statement based on database type
 * Uses single INSERT with multiple VALUES clauses: INSERT INTO ... VALUES (...), (...), (...)
 */
export function copyAsInsert(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  tableName: string,
  dbType: DatabaseType,
  schema?: string,
): string {
  if (rows.length === 0) return "";

  const { quoteIdentifier, formatTableName } = getDialectQuoting(dbType);
  const fullTableName = schema
    ? formatTableName(schema, tableName)
    : quoteIdentifier(tableName);

  const columnNames = columns
    .map((col) => quoteIdentifier(col.field))
    .join(", ");

  // Generate all value sets
  const valueSets = rows.map((row) => {
    const values = columns.map((col) => {
      const cellValue = row[col.field];
      const value =
        cellValue && typeof cellValue === "object" && "value" in cellValue
          ? cellValue.value
          : null;
      return formatSQLValue(value, dbType);
    });

    return `  (${values.join(", ")})`;
  });

  // Single INSERT statement with multiple VALUES
  return `INSERT INTO ${fullTableName} (${columnNames})\nVALUES\n${valueSets.join(",\n")};`;
}

/**
 * Get quoting rules for different database types
 */
function getDialectQuoting(dbType: DatabaseType) {
  switch (dbType) {
    case "postgresql":
    case "sqlite":
      return {
        quoteIdentifier: (id: string) => `"${id}"`,
        formatTableName: (schema: string, table: string) =>
          `"${schema}"."${table}"`,
      };
    case "mysql":
    case "mariadb":
      return {
        quoteIdentifier: (id: string) => `\`${id}\``,
        formatTableName: (schema: string, table: string) =>
          `\`${schema}\`.\`${table}\``,
      };
    case "mssql":
      return {
        quoteIdentifier: (id: string) => `[${id}]`,
        formatTableName: (schema: string, table: string) =>
          `[${schema}].[${table}]`,
      };
    case "mongodb":
      // MongoDB doesn't use SQL INSERT
      return {
        quoteIdentifier: (id: string) => id,
        formatTableName: (schema: string, table: string) =>
          `${schema}.${table}`,
      };
    default:
      return {
        quoteIdentifier: (id: string) => `"${id}"`,
        formatTableName: (schema: string, table: string) =>
          `"${schema}"."${table}"`,
      };
  }
}

/**
 * Format value for SQL INSERT
 */
function formatSQLValue(value: unknown, dbType: DatabaseType): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "string") {
    // Escape single quotes
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    // Different databases handle booleans differently
    switch (dbType) {
      case "postgresql":
        return value ? "TRUE" : "FALSE";
      case "mysql":
      case "mariadb":
      case "sqlite":
        return value ? "1" : "0";
      case "mssql":
        return value ? "1" : "0";
      default:
        return value ? "TRUE" : "FALSE";
    }
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  // For objects/arrays, serialize as JSON
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      const escaped = json.replace(/'/g, "''");
      return `'${escaped}'`;
    } catch {
      return "NULL";
    }
  }

  return "NULL";
}

/**
 * Escape CSV field
 */
function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Format value as string
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return typeof value === "object" ? "[Object]" : String(value);
    }
  }

  if (typeof value === "object") return JSON.stringify(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return "[Unknown]";
}
