import { useMemo } from "react";
import type { GridColumnV2, GridRowModel } from "../types";
import type { CellValue as FrontCellValue, JsonValue } from "@/types";
import type { CrudCommand } from "@/types/crud";

export interface UseOptimisticRowsOptions {
  /** Original rows from query */
  displayRows: GridRowModel[];
  /** Staged CRUD commands for this table */
  stagedCommands: CrudCommand[];
  /** Primary key column names */
  primaryKeyColumns: string[];
  /** Map from column name to field identifier (e.g., "title" -> "col_0") */
  columnNameToFieldMap: Map<string, string>;
  /** Map from field identifier to column definition */
  columnByFieldMap: Map<string, GridColumnV2>;
  /** All columns for building inserted rows */
  columns: GridColumnV2[];
  /** Function to get unique key for a row */
  getRowKey: (row: GridRowModel | undefined, index: number) => string;
}

/**
 * Hook to apply optimistic updates from staged commands to display rows.
 *
 * Optimized: O(N+M) instead of O(N×M) using index-based lookup.
 * Further optimized: Only creates new row objects for rows that actually changed.
 */
export function useOptimisticRows({
  displayRows,
  stagedCommands,
  primaryKeyColumns,
  columnNameToFieldMap,
  columnByFieldMap,
  columns,
  getRowKey,
}: UseOptimisticRowsOptions): GridRowModel[] {
  return useMemo(() => {
    if (stagedCommands.length === 0) {
      return displayRows;
    }

    // Build index: PK signature → array of UPDATE commands (O(M) where M = commands)
    const updateCommandsByPK = new Map<
      string,
      Array<{ column: string; newValue: unknown }>
    >();

    for (const cmd of stagedCommands) {
      if (cmd.type !== "data.update") continue;
      const payload = cmd.payload as {
        primaryKeys?: Record<string, unknown>;
        column?: string;
        newValue?: unknown;
      };
      if (!payload.primaryKeys || !payload.column) continue;

      // Create stable PK signature from sorted keys
      const pkEntries = Object.entries(payload.primaryKeys).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      const pkSig = pkEntries
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("|");

      if (!updateCommandsByPK.has(pkSig)) {
        updateCommandsByPK.set(pkSig, []);
      }
      updateCommandsByPK.get(pkSig)!.push({
        column: payload.column,
        newValue: payload.newValue,
      });
    }

    // Apply UPDATE commands - only create new objects for modified rows
    let updatedRows: GridRowModel[];
    if (updateCommandsByPK.size === 0) {
      updatedRows = displayRows;
    } else {
      // Pre-compute PK signatures for ALL rows once (avoids repeated computation)
      const rowPkSignatures = displayRows.map((row) => {
        const pkEntries = primaryKeyColumns
          .map((colName) => {
            // Map column name to field identifier to access row data
            const field = columnNameToFieldMap.get(colName);
            const cell = field ? row[field] : undefined;
            const value =
              cell && typeof cell === "object" && "value" in cell
                ? cell.value
                : undefined;
            return [colName, value] as [string, unknown];
          })
          .sort(([a], [b]) => a.localeCompare(b));
        return pkEntries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("|");
      });

      // Check if ANY rows need updates before mapping
      const hasUpdates = rowPkSignatures.some((sig) =>
        updateCommandsByPK.has(sig)
      );

      if (!hasUpdates) {
        updatedRows = displayRows;
      } else {
        updatedRows = displayRows.map((row, idx) => {
          const pkSig = rowPkSignatures[idx] ?? "";
          const updates = updateCommandsByPK.get(pkSig);
          if (!updates || updates.length === 0) {
            return row; // Return original reference - no copy needed
          }

          // Only create new object for rows that actually changed
          const updatedRow = { ...row };
          for (const { column, newValue } of updates) {
            // Map column name to field identifier (e.g., "title" -> "col_0")
            const field = columnNameToFieldMap.get(column);
            if (field && field in updatedRow) {
              const existingCell = updatedRow[field];
              if (
                existingCell &&
                typeof existingCell === "object" &&
                "value" in existingCell
              ) {
                updatedRow[field] = {
                  ...existingCell,
                  value: newValue,
                };
              }
            }
          }
          return updatedRow;
        });
      }
    }

    // Collect INSERT commands
    const insertCommands = stagedCommands.filter(
      (cmd) => cmd.type === "data.insert"
    );
    if (insertCommands.length === 0) {
      return updatedRows;
    }

    // Build result array with inserts at correct positions
    const result = [...updatedRows];

    // Pre-build row key index for O(1) lookup during insert positioning
    const rowKeyToIndex = new Map<string, number>();
    for (let i = 0; i < result.length; i++) {
      rowKeyToIndex.set(getRowKey(result[i], i), i);
    }

    // Track offset as we insert (positions shift)
    let insertOffset = 0;

    for (const cmd of insertCommands) {
      const payload = cmd.payload as {
        values?: Record<string, JsonValue>;
        tempId?: string;
      };

      // Build a complete row with ALL columns from schema
      const row: GridRowModel = {};

      // Populate ALL columns with NULL defaults
      for (const col of columns) {
        const dbType = col.meta?.db_type ?? col.type ?? "text";
        row[col.field] = {
          value: null,
          value_type: "Null",
          db_type: dbType,
          is_truncated: false,
        };
      }

      // Track the INSERT command's tempId for linking UPDATE commands
      const insertTempId = payload.tempId || cmd.id;
      row["__insert_temp_id__"] = {
        value: insertTempId,
        value_type: "Text",
        db_type: "text",
        is_truncated: false,
      } as FrontCellValue;

      // Overlay the actual values from the INSERT command
      if (payload.values) {
        for (const [key, value] of Object.entries(payload.values)) {
          // O(1) lookup instead of .find()
          const column = columnByFieldMap.get(key);
          const dbType = column?.meta?.db_type ?? column?.type ?? "text";

          let valueType: FrontCellValue["value_type"] = "Text";
          if (value === null) {
            valueType = "Null";
          } else if (typeof value === "number") {
            valueType = Number.isInteger(value) ? "Integer" : "Decimal";
          } else if (typeof value === "boolean") {
            valueType = "Boolean";
          }

          row[key] = {
            value,
            value_type: valueType,
            db_type: dbType,
            is_truncated: false,
          };
        }
      }

      // Insert at specified position or top
      const insertAfterRowKey = cmd.metadata.insertAfterRowKey;
      if (insertAfterRowKey) {
        const targetIndex = rowKeyToIndex.get(insertAfterRowKey);
        if (targetIndex !== undefined) {
          result.splice(targetIndex + 1 + insertOffset, 0, row);
          insertOffset++;
        } else {
          result.unshift(row);
          insertOffset++;
        }
      } else {
        result.unshift(row);
        insertOffset++;
      }
    }

    return result;
  }, [
    displayRows,
    stagedCommands,
    primaryKeyColumns,
    columnNameToFieldMap,
    columnByFieldMap,
    columns,
    getRowKey,
  ]);
}
