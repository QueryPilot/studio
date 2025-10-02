/**
 * TableDataService - Service for loading table data using new streaming backend
 * Provides type-safe streaming interface for table data operations
 */
import { isTauri, safeInvoke } from "@/utils/tauri";
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

      // Get backend connection ID
      const { databaseService } = await import("./databaseService");
      const backendConnectionId =
        databaseService.getBackendConnectionId?.(params.connectionId) ||
        params.connectionId;

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
              backendConnectionId,
              params.schema || "public",
              params.table,
              params.limit || 1000,
              params.offset || 0,
              params.filters || undefined,
              params.sorts || undefined,
            )
          : await BackendAPI.getTableData(
              backendConnectionId,
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
            backendConnectionId,
            params.schema || "public",
            params.table,
          );
          console.log("[TableDataService] Table total count:", estimatedTotal);
        } catch (err) {
          console.warn("[TableDataService] Failed to get table count:", err);
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
          const cellValue = row[index];
          rowObj[col.name] = {
            value: cellValue?.display_value || null,
            db_type: col.db_type || "text",
            value_type: cellValue?.value_type || "Text",
            is_truncated: false,
          };
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
    } catch (error) {
      console.error("[TableDataService] Error fetching table data:", error);
      callbacks.onError({
        type: "error",
        code: "FETCH_ERROR",
        message:
          error instanceof Error ? error.message : "Failed to fetch table data",
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
  ): Promise<{ columns: string[]; rows: any[][]; error?: string }> {
    try {
      if (!isTauri()) {
        throw new Error("Query execution requires Tauri runtime");
      }
      if (options.signal?.aborted) {
        const abortError = new Error("Query execution cancelled");
        abortError.name = "AbortError";
        throw abortError;
      }
      const { databaseService } = await import("./databaseService");
      const backendConnectionId =
        databaseService.getBackendConnectionId?.(connectionId) || connectionId;

      const handle: QueryHandle = await BackendAPI.executeQuery(
        backendConnectionId,
        query,
      );

      if (!handle) {
        throw new Error("Failed to execute query: No handle returned");
      }

      const result = await BackendAPI.fetchResults(
        backendConnectionId,
        handle,
        options.limit || 1000,
      );

      if (options.signal?.aborted) {
        const abortError = new Error("Query execution cancelled");
        abortError.name = "AbortError";
        throw abortError;
      }

      if (!result) {
        throw new Error("Failed to fetch query results");
      }

      const columns = (handle.columns || []).map(
        (col: BackendColumnMeta) => col.name,
      );

      const transformedRows = (result.rows || []).map(
        (row: BackendCellValue[]) =>
          row.map((cell, columnIndex) =>
            this.normalizeQueryCellValue(
              cell,
              handle.columns?.[columnIndex] as BackendColumnMeta | undefined,
            ),
          ),
      );

      return {
        columns,
        rows: transformedRows,
      };
    } catch (error) {
      console.error("[TableDataService] Query execution error:", error);

      let errorMessage = "Failed to execute query";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      } else if (error && typeof error === "object" && "message" in error) {
        errorMessage = String(error.message);
      }

      throw new Error(errorMessage);
    }
  }

  /**
   * Normalize backend CellValue objects into primitive values suitable for display/export
   */
  private normalizeQueryCellValue(
    cell: BackendCellValue | null | undefined,
    column?: BackendColumnMeta,
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
      try {
        return JSON.parse(cell.display_value);
      } catch (err) {
        console.warn("[TableDataService] Failed to parse JSON cell", {
          column: column?.name,
          error: err,
          value: cell.display_value,
        });
        return cell.display_value;
      }
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
