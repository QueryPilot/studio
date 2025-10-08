/**
 * TableDataService - Service for loading table data using new streaming backend
 * Provides type-safe streaming interface for table data operations
 */
import { isTauri } from "@/utils/tauri";
import type {
  TableDataParams,
  TableDataCallbacks,
  TableDataRow,
} from "./tableDataTypes";
import { BackendAPI } from "./backend";
import type {
  ColumnMeta as BackendColumnMeta,
  CellValue as BackendCellValue,
  LegacyCellValue,
} from "./backend";
import type { ColumnMeta } from "@/types/database";
import type { CellValue as FrontCellValue } from "@/types/cellValue";

export class TableDataService {
  /**
   * Load table data with the provided parameters
   * Calls callbacks directly with results
   */
  async loadTableData(
    params: TableDataParams,
    callbacks: TableDataCallbacks,
  ): Promise<void> {
    console.log("[TableDataService] Loading data with params:", params);

    try {
      // Validate parameters
      this.validateParams(params);
      console.log("[TableDataService] Parameters validated");

      if (!isTauri()) {
        console.warn(
          "[TableDataService] Not in Tauri context, simulating completion",
        );
        // Simulate immediate completion for browser mode
        setTimeout(() => {
          callbacks.onDone();
        }, 100);
        return;
      }

      // Use proper offset-based pagination API
      console.log("[TableDataService] Starting table data fetch");
      console.log("  - Table:", params.table);
      console.log("  - Schema:", params.schema || "public");
      console.log("  - Limit:", params.limit || 1000);
      console.log("  - Offset:", params.offset || 0);

      // Use filtered API if filters or sorts are present
      const hasFilters =
        params.filters &&
        params.filters.root &&
        params.filters.root.conditions &&
        params.filters.root.conditions.length > 0;
      const hasSorts = params.sorts && params.sorts.length > 0;
      console.log("[TableDataService] Filter/sort status:", {
        hasFilters,
        hasSorts,
        filters: params.filters,
        sorts: params.sorts,
      });

      const result =
        hasFilters || hasSorts
          ? await BackendAPI.getTableDataFiltered(
              params.connectionId,
              params.schema || "public",
              params.table,
              params.limit || 1000,
              params.offset || 0,
              params.filters || undefined,
              params.sorts || undefined,
            )
          : await BackendAPI.getTableData(
              params.connectionId,
              params.schema || "public",
              params.table,
              params.limit || 1000,
              params.offset || 0,
            );

      // Get total count if it's the first page
      let estimatedTotal: number | undefined;
      if (!params.offset || params.offset === 0) {
        try {
          estimatedTotal = await BackendAPI.getTableCount(
            params.connectionId,
            params.schema || "public",
            params.table,
          );
          console.log("[TableDataService] Table total count:", estimatedTotal);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[TableDataService] Failed to get table count:", msg);
        }
      }

      // Send meta information first
      console.log(
        `[tableDataService] Received ${result.columns.length} columns for table ${params.table}`,
      );
      console.log(
        "[tableDataService] Column names:",
        result.columns.map((c) => c.name),
      );

      // Map backend columns to frontend ColumnMeta format
      const mappedColumns = result.columns.map(
        (col, index) =>
          ({
            name: col.name,
            db_type: col.db_type,
            nullable: col.nullable,
            default:
              (col as unknown as { default_value?: string | null })
                .default_value || null,
            is_pk: col.primary_key,
            is_fk: false,
            ordinal: index,
            precision: null,
            scale: null,
            comment:
              (col as unknown as { comment?: string | null }).comment || null,
            enum_values: (col as unknown as { enum_values?: string[] })
              .enum_values,
            type_category: (col as unknown as { type_category?: string })
              .type_category,
          } as ColumnMeta),
      );

      callbacks.onMeta({
        type: "meta",
        table: params.table,
        schema: params.schema,
        columns: mappedColumns,
        selected: result.columns.map((col) => col.name),
        page_size: params.limit || 1000,
        cursor_key_columns: [],
        execution_time: result.execution_time_ms,
      });

      // NEW FAST PATH: No normalization - pass through raw CellValue primitives
      // Formatting is done lazily in the UI using formatters.ts
      const transformedRows: TableDataRow[] = result.rows.map((row) => {
        const rowObj: TableDataRow = {};
        result.columns.forEach((col, index) => {
          const rawValue = row[index]; // Already a primitive (null | bool | number | string | array | object)
          const dbType = col.db_type || "text";

          // Infer value_type from the primitive type
          let valueType: FrontCellValue["value_type"] = "Text";
          if (rawValue === null) {
            valueType = "Text"; // Null is handled as empty text
          } else if (typeof rawValue === "boolean") {
            valueType = "Boolean";
          } else if (typeof rawValue === "number") {
            // Could be Integer, Decimal, Timestamp, or Date - infer from db_type
            if (dbType.includes("int") || dbType.includes("serial")) {
              valueType = "Integer";
            } else if (dbType.includes("timestamp") || dbType.includes("time")) {
              valueType = "DateTime";
            } else if (dbType.includes("date")) {
              valueType = "Date";
            } else {
              valueType = "Decimal";
            }
          } else if (typeof rawValue === "object" && !Array.isArray(rawValue)) {
            valueType = "Json";
          }

          const cellValue: FrontCellValue = {
            value: rawValue,
            db_type: dbType,
            value_type: valueType,
            is_truncated: false,
          };
          rowObj[col.name] = cellValue;
        });
        return rowObj;
      });

      // Send rows with proper next page indication from backend
      callbacks.onRows({
        type: "rows",
        rows: transformedRows,
        next_cursor: result.has_more ? "has_more" : undefined,
        estimated_total: estimatedTotal,
      });

      // Mark as completed
      callbacks.onDone();
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[TableDataService] Error fetching table data:", errMsg);
      callbacks.onError({
        type: "error",
        code: "FETCH_ERROR",
        message: errMsg,
      });
    }
  }

  /**
   * Validate table data parameters
   */
  private validateParams(params: TableDataParams): void {
    if (!params.connectionId || typeof params.connectionId !== "string") {
      throw new Error("Connection ID is required and must be a string");
    }

    if (!params.database || typeof params.database !== "string") {
      throw new Error("Database name is required and must be a string");
    }

    if (!params.table || typeof params.table !== "string") {
      throw new Error("Table name is required and must be a string");
    }

    if (
      params.limit !== undefined &&
      (params.limit < 1 || params.limit > 1000)
    ) {
      throw new Error("Limit must be between 1 and 1000");
    }

    if (params.offset !== undefined && params.offset < 0) {
      throw new Error("Offset must be non-negative");
    }

    // Validate sort specifications
    if (params.sorts) {
      for (const sort of params.sorts) {
        if (!sort.column || typeof sort.column !== "string") {
          throw new Error("Sort column name is required and must be a string");
        }
        if (!["asc", "desc"].includes(sort.direction)) {
          throw new Error('Sort direction must be "asc" or "desc"');
        }
      }
    }

    // Validate filter specifications
    if (params.filters) {
      if (!params.filters.root) {
        throw new Error("Filter must have a root node");
      }
      // Additional validation could be done recursively on the filter tree
    }

    // Validate column selection
    if (params.select) {
      if (!Array.isArray(params.select) || params.select.length === 0) {
        throw new Error("Select must be a non-empty array of column names");
      }
      for (const column of params.select) {
        if (!column || typeof column !== "string") {
          throw new Error("Selected column names must be non-empty strings");
        }
      }
    }
  }
}

// Export singleton instance
export const tableDataService = new TableDataService();
