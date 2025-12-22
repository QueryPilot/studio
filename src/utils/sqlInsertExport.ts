import { logger } from "@/lib/logger";
import type { DatabaseType } from "@/types";

export interface InsertExportOptions {
  tableName?: string;
  schema?: string;
  databaseType?: DatabaseType;
  batchMode?: boolean;
}

export interface InsertExportResult {
  success: boolean;
  rowCount: number;
  error?: string;
}

function getDialectQuoting(dbType: DatabaseType) {
  switch (dbType) {
    case "postgresql":
    case "sqlite":
      return {
        quoteIdentifier: (id: string) => `"${id.replace(/"/g, '""')}"`,
        formatTableName: (schema: string, table: string) => `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`,
      };
    case "mysql":
    case "mariadb":
      return {
        quoteIdentifier: (id: string) => `\`${id.replace(/`/g, '``')}\``,
        formatTableName: (schema: string, table: string) => `\`${schema.replace(/`/g, '``')}\`.\`${table.replace(/`/g, '``')}\``,
      };
    case "mssql":
      return {
        quoteIdentifier: (id: string) => `[${id.replace(/]/g, "]]")}]`,
        formatTableName: (schema: string, table: string) => `[${schema.replace(/]/g, "]]")}].[${table.replace(/]/g, "]]")}]`,
      };
    default:
      return {
        quoteIdentifier: (id: string) => `"${id.replace(/"/g, '""')}"`,
        formatTableName: (schema: string, table: string) => `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`,
      };
  }
}

function formatSQLValue(value: unknown, dbType: DatabaseType): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "string") {
    let escaped = value;
    if (dbType === "mysql" || dbType === "mariadb") {
      escaped = escaped.replace(/\\/g, '\\\\');
    }
    escaped = escaped.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    switch (dbType) {
      case "postgresql":
        return value ? "TRUE" : "FALSE";
      case "mysql":
      case "mariadb":
      case "sqlite":
      case "mssql":
        return value ? "1" : "0";
      default:
        return value ? "TRUE" : "FALSE";
    }
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

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

export function generateInsertStatements(
  rows: unknown[][],
  columns: string[],
  options: InsertExportOptions = {},
): string {
  const tableName = (options.tableName ?? "table_name").trim();
  if (!tableName) {
    throw new Error("Table name cannot be empty");
  }
  if (columns.length === 0) {
    throw new Error("No columns provided");
  }

  const schema = options.schema;
  const dbType = options.databaseType ?? "postgresql";
  const batchMode = options.batchMode ?? false;

  if (rows.length === 0) return "";

  const { quoteIdentifier, formatTableName } = getDialectQuoting(dbType);
  const fullTableName = schema
    ? formatTableName(schema, tableName)
    : quoteIdentifier(tableName);

  const columnNames = columns.map(quoteIdentifier).join(", ");

  if (batchMode) {
    const valueSets = rows.map((row) => {
      const values = row.map((val) => formatSQLValue(val, dbType));
      return `  (${values.join(", ")})`;
    });

    return `INSERT INTO ${fullTableName} (${columnNames})\nVALUES\n${valueSets.join(",\n")};`;
  }

  const statements = rows.map((row) => {
    const values = row.map((val) => formatSQLValue(val, dbType));
    return `INSERT INTO ${fullTableName} (${columnNames}) VALUES (${values.join(", ")});`;
  });

  return statements.join("\n");
}

export function copyInsertToClipboard(
  rows: unknown[][],
  columns: string[],
  options: InsertExportOptions = {},
): Promise<InsertExportResult> {
  return new Promise((resolve) => {
    try {
      const sql = generateInsertStatements(rows, columns, options);

      navigator.clipboard
        .writeText(sql)
        .then(() => {
          logger.info(
            `[SQL Insert Export] Copied ${rows.length} rows as ${options.batchMode ? "batch" : "individual"} INSERT`,
          );
          resolve({ success: true, rowCount: rows.length });
        })
        .catch((err) => {
          logger.error("[SQL Insert Export] Failed to copy to clipboard", err);
          resolve({
            success: false,
            rowCount: 0,
            error: err instanceof Error ? err.message : "Failed to copy to clipboard",
          });
        });
    } catch (err) {
      logger.error("[SQL Insert Export] Failed to generate SQL", err);
      resolve({
        success: false,
        rowCount: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });
}
