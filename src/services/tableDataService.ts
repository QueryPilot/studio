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
  QueryHandle,
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
      });

      // Transform data to expected format
      const transformedRows: TableDataRow[] = result.rows.map((row) => {
        const rowObj: TableDataRow = {};
        result.columns.forEach((col, index) => {
          const cell = row[index] as BackendCellValue | undefined;
          const dbType = col.db_type || "text";

          // Default: treat only explicit Null as null
          const vt =
            typeof cell?.value_type === "string" ? cell.value_type : "Text";
          const isNull = cell == null || vt === "Null";

          let value: unknown = null;
          let valueType: FrontCellValue["value_type"] = "Text";
          if (vt === "Json") valueType = "Json";
          else if (vt === "Integer") valueType = "Integer";
          else if (vt === "Decimal") valueType = "Decimal";
          else if (vt === "Boolean") valueType = "Boolean";
          else if (vt === "Text") valueType = "Text";

          if (!isNull) {
            const display = cell.display_value;
            if (vt === "Json") {
              try {
                value = JSON.parse(display);
              } catch {
                value = display; // fallback to raw string
              }
            } else if (vt === "Integer" || vt === "Decimal") {
              const n = Number(display);
              value = Number.isFinite(n) ? n : display;
              if (!Number.isFinite(n)) valueType = "Text";
            } else if (vt === "Boolean") {
              const s = display.toLowerCase();
              if (["true", "t", "1", "yes"].includes(s)) value = true;
              else if (["false", "f", "0", "no"].includes(s)) value = false;
              else {
                value = display;
                valueType = "Text";
              }
            } else {
              value = display;
            }
          }

          const cellValue: FrontCellValue = {
            value,
            db_type: dbType,
            value_type: valueType as FrontCellValue["value_type"],
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
   * Execute a SQL query and return results
   */
  async executeQuery(
    connectionId: string,
    _database: string,
    query: string,
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<{ columns: string[]; rows: unknown[][]; error?: string }> {
    try {
      if (!isTauri()) {
        throw new Error("Query execution requires Tauri runtime");
      }
      if (options.signal?.aborted) {
        const abortError = new Error("Query execution cancelled");
        abortError.name = "AbortError";
        throw abortError;
      }
      // Fast path: single-call execute that returns columns + first page
      // Falls back to legacy two-step path if unavailable
      type SimpleResult = {
        columns: BackendColumnMeta[];
        rows: BackendCellValue[][];
      };
      let result: SimpleResult;
      try {
        const simple = await BackendAPI.executeQuerySimple(
          connectionId,
          query,
          options.limit || 1000,
        );
        result = { columns: simple.columns, rows: simple.rows };
      } catch {
        // Fallback to legacy two-step API
        const handle: QueryHandle = await BackendAPI.executeQuery(
          connectionId,
          query,
        );
        const page = await BackendAPI.fetchResults(
          connectionId,
          handle,
          options.limit || 1000,
        );
        result = {
          columns: handle.columns,
          rows: page.rows,
        };
      }

      if (options.signal?.aborted) {
        const abortError = new Error("Query execution cancelled");
        abortError.name = "AbortError";
        throw abortError;
      }

      const columns = result.columns.map((col: BackendColumnMeta) => col.name);

      // Light-touch transform: prefer display_value directly; only parse JSON if obviously JSON
      const transformedRows = result.rows.map((row) =>
        row.map((cell, columnIndex) =>
          this.normalizeQueryCellValue(
            cell,
            result.columns[columnIndex] as BackendColumnMeta | undefined,
          ),
        ),
      );

      return {
        columns,
        rows: transformedRows,
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[TableDataService] Query execution error:", errMsg);

      throw new Error(errMsg || "Failed to execute query");
    }
  }

  /**
   * Normalize backend CellValue objects into primitive values suitable for display/export
   */
  private normalizeQueryCellValue(
    cell: BackendCellValue | null | undefined,
    _column?: BackendColumnMeta,
  ): unknown {
    if (!cell) {
      return null;
    }

    const valueType =
      typeof cell.value_type === "string" ? cell.value_type : undefined;

    if (valueType === "Null") {
      return null;
    }

    if (valueType === "Boolean") {
      const normalized = cell.display_value.toLowerCase();
      if (["true", "t", "1", "yes"].includes(normalized)) return true;
      if (["false", "f", "0", "no"].includes(normalized)) return false;
    }

    if (valueType === "Json") {
      return cell.display_value;
    }

    // For array/multi-valued types, fallback to display string
    if (typeof cell.value_type === "object") {
      return cell.display_value;
    }

    // Default to the backend-provided display string
    return cell.display_value;
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
