import { safeInvoke, isTauri } from "@/utils/tauri";
import type { ColumnMeta } from "@/types/database";

export interface CellEditRequest {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  column: string;
  primaryKeys: Record<string, any>;
  newValue: any;
}

export interface CellEditResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export class CellEditService {
  /**
   * Update a single cell value in the database
   */
  static async updateCell({
    connectionId,
    database,
    table,
    schema,
    column,
    primaryKeys,
    newValue,
  }: CellEditRequest): Promise<CellEditResponse> {
    try {
      // Build WHERE clause from primary keys
      const whereConditions = Object.entries(primaryKeys)
        .map(([key, value]) => {
          if (value === null || value === undefined) {
            return `${key} IS NULL`;
          }
          if (typeof value === "string") {
            return `${key} = '${value.replace(/'/g, "''")}'`;
          }
          if (typeof value === "number") {
            return `${key} = ${value}`;
          }
          if (typeof value === "boolean") {
            return `${key} = ${value ? 1 : 0}`;
          }
          return `${key} = '${String(value).replace(/'/g, "''")}'`;
        })
        .join(" AND ");

      // Build UPDATE query
      let updateValue: string;
      if (newValue === null || newValue === undefined) {
        updateValue = "NULL";
      } else if (typeof newValue === "string") {
        updateValue = `'${newValue.replace(/'/g, "''")}'`;
      } else if (typeof newValue === "number") {
        updateValue = String(newValue);
      } else if (typeof newValue === "boolean") {
        updateValue = newValue ? "1" : "0";
      } else if (typeof newValue === "object") {
        updateValue = `'${JSON.stringify(newValue).replace(/'/g, "''")}'`;
      } else {
        updateValue = `'${String(newValue).replace(/'/g, "''")}'`;
      }

      const fullTableName = schema ? `${schema}.${table}` : table;
      const query = `UPDATE ${fullTableName} SET ${column} = ${updateValue} WHERE ${whereConditions}`;

      // Execute the update query
      if (!isTauri()) {
        console.warn("Cell edit operations require Tauri runtime");
        return {
          success: false,
          error: "Cell editing is not available in browser mode",
        };
      }

      // Map to backend connection ID used by tauri commands
      const { databaseService } = await import("./databaseService");
      const backendConnId =
        databaseService.getBackendConnectionId?.(connectionId) || connectionId;

      const handle = await safeInvoke<any>("execute_query", {
        connId: backendConnId,
        sql: query,
      });

      // Fetch the result
      const result = await safeInvoke<any>("fetch_results", {
        connId: backendConnId,
        queryHandle: handle,
        maxRows: 1,
      });

      // Check for errors in the result
      if (result.error) {
        return {
          success: false,
          error: result.error,
        };
      }

      return {
        success: true,
        message: `Successfully updated ${column}`,
      };
    } catch (error) {
      console.error("Failed to update cell:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update cell",
      };
    }
  }

  /**
   * Get primary key values from a row
   */
  static extractPrimaryKeys(
    row: Record<string, any>,
    columns: ColumnMeta[],
  ): Record<string, any> {
    const primaryKeys: Record<string, any> = {};

    columns.forEach((column) => {
      if (column.is_pk) {
        const value = row[column.name];
        // Handle both direct values and CellValue objects
        const raw = value?.value !== undefined ? value.value : value;
        primaryKeys[column.name] =
          typeof raw === "bigint" ? raw.toString() : raw;
      }
    });

    return primaryKeys;
  }

  /**
   * Validate if a value is valid for a column type
   */
  static validateValue(value: any, column: ColumnMeta): boolean {
    // Allow NULL for nullable columns
    if (value === null || value === undefined) {
      return column.nullable;
    }

    // Type-specific validation
    const dataType = column.db_type.toLowerCase();

    if (
      dataType.includes("int") ||
      dataType.includes("numeric") ||
      dataType.includes("decimal")
    ) {
      return !isNaN(Number(value));
    }

    if (dataType.includes("bool")) {
      return (
        typeof value === "boolean" ||
        value === 0 ||
        value === 1 ||
        value === "true" ||
        value === "false"
      );
    }

    if (dataType.includes("json")) {
      try {
        if (typeof value === "string") {
          JSON.parse(value);
        }
        return true;
      } catch {
        return false;
      }
    }

    // String types accept anything
    return true;
  }
}
