import { logger } from "@/lib/logger";
import {
  getDialectQuoting,
  quoteIdentifier,
  formatTableName,
  formatValue,
} from "@/adapters/formatting";
import type { DbType } from "@/types/connection";
import { writeClipboardText } from "@/lib/clipboard";

// Support both DbType enum and legacy string type
type DatabaseTypeInput = DbType | string;

export interface InsertExportOptions {
  tableName?: string;
  schema?: string;
  databaseType?: DatabaseTypeInput;
  batchMode?: boolean;
}

export interface InsertExportResult {
  success: boolean;
  rowCount: number;
  error?: string;
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

  const fullTableName = formatTableName(schema, tableName, dbType);
  const columnNames = columns.map((col) => quoteIdentifier(col, dbType)).join(", ");

  if (batchMode) {
    const valueSets = rows.map((row) => {
      const values = row.map((val) => formatValue(val, dbType));
      return `  (${values.join(", ")})`;
    });

    return `INSERT INTO ${fullTableName} (${columnNames})\nVALUES\n${valueSets.join(",\n")};`;
  }

  const statements = rows.map((row) => {
    const values = row.map((val) => formatValue(val, dbType));
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

      writeClipboardText(sql)
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

// Re-export getDialectQuoting for any code that might still need it
export { getDialectQuoting };
