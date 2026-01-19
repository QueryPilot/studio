import { useMemo } from "react";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand } from "@/types";
import type { GridRowModel, GridColumnV2 } from "../types";

export interface StagedChangesMap {
  /** Map of row index → set of changed column fields */
  rowChanges: Map<number, Set<string>>;
  /** Set of row indexes that are pending INSERT */
  insertedRows: Set<number>;
  /** Set of row indexes that are pending DELETE */
  deletedRows: Set<number>;
}

// Empty/default result to avoid allocations when disabled
const EMPTY_RESULT: StagedChangesMap = {
  rowChanges: new Map(),
  insertedRows: new Set(),
  deletedRows: new Set(),
};

interface UseStagedChangesIndicatorOptions {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  rows: GridRowModel[];
  columns: GridColumnV2[];
}

/**
 * Hook to track which cells/rows have staged CRUD changes
 *
 * Returns a map of row indexes to changed column fields for efficient lookups
 * during grid rendering.
 * 
 * Performance optimizations:
 * - Caches PK map separately to avoid full rebuilds
 * - Early exit when no staged commands
 */
export function useStagedChangesIndicator(
  options: UseStagedChangesIndicatorOptions,
): StagedChangesMap {
  const { connectionId, database, schema, table, rows, columns } = options;
  const { stagedCommands, getTableKey } = useCrudStore();

  const tableKey = getTableKey({
    connectionId,
    database,
    schema,
    table,
  });

  const commands = stagedCommands.get(tableKey) ?? [];

  // Memoize PK column list to avoid recomputation
  const pkColumns = useMemo(() => {
    return columns.filter((col) => col.meta?.is_pk);
  }, [columns]);

  // Memoize PK map separately to avoid rebuilding on every render
  const pkToRowIndex = useMemo(() => {
    // Skip computation when no commands
    if (commands.length === 0) {
      return new Map<string, number>();
    }

    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      // Create a stable PK key from the row using column metadata
      const pkKey = createPrimaryKeyStringFast(row, pkColumns);
      if (pkKey) {
        map.set(pkKey, index);
      }
    });
    return map;
  }, [rows, pkColumns, commands.length]);

  const result = useMemo(() => {
    // Early exit when no commands
    if (commands.length === 0) {
      return EMPTY_RESULT;
    }

    const newResult: StagedChangesMap = {
      rowChanges: new Map(),
      insertedRows: new Set(),
      deletedRows: new Set(),
    };

    commands.forEach((command: CrudCommand) => {
      switch (command.type) {
        case "data.update": {
          const payload = command.payload as {
            column?: string;
            primaryKeys?: Record<string, unknown>;
          };
          if (!payload.column || !payload.primaryKeys) break;

          const pkKey = createPrimaryKeyStringFromRecord(payload.primaryKeys);
          const rowIndex = pkToRowIndex.get(pkKey);
          if (rowIndex !== undefined) {
            let rowChangeSet = newResult.rowChanges.get(rowIndex);
            if (!rowChangeSet) {
              rowChangeSet = new Set();
              newResult.rowChanges.set(rowIndex, rowChangeSet);
            }
            rowChangeSet.add(payload.column);
          }
          break;
        }

        case "data.insert": {
          // INSERT commands are handled below after counting
          break;
        }

        case "data.delete": {
          const payload = command.payload as {
            primaryKeys?: Record<string, unknown>;
          };
          if (!payload.primaryKeys) break;

          const pkKey = createPrimaryKeyStringFromRecord(payload.primaryKeys);
          const rowIndex = pkToRowIndex.get(pkKey);
          if (rowIndex !== undefined) {
            newResult.deletedRows.add(rowIndex);
          }
          break;
        }
      }
    });

    // Mark inserted rows by checking for the __insert_temp_id__ metadata field
    // This field is added to all inserted rows in the optimistic update logic
    // and remains even after the user edits the row's primary key
    const hasInsertCommands = commands.some((cmd) => cmd.type === "data.insert");
    if (hasInsertCommands) {
      rows.forEach((row, index) => {
        // Check for the hidden __insert_temp_id__ field that marks inserted rows
        if (row["__insert_temp_id__"]) {
          newResult.insertedRows.add(index);
        }
      });
    }

    return newResult;
  }, [commands, pkToRowIndex, rows]);

  return result;
}

/**
 * Create a stable string key from a row's primary key values (optimized version)
 * Uses pre-filtered PK columns to avoid filtering on every call
 * IMPORTANT: Sorts columns by name to match createPrimaryKeyStringFromRecord
 */
function createPrimaryKeyStringFast(
  row: GridRowModel,
  pkColumns: GridColumnV2[],
): string | null {
  if (pkColumns.length === 0) {
    // Fallback: use 'id' field if no PK columns found
    const idCell = row["id"];
    if (
      idCell &&
      typeof idCell === "object" &&
      "value" in idCell &&
      idCell.value !== null
    ) {
      return String(idCell.value);
    }
    return null;
  }

  // Sort columns by name to match createPrimaryKeyStringFromRecord's alphabetical sorting
  const sortedPkColumns = [...pkColumns].sort((a, b) => a.name.localeCompare(b.name));

  // Build composite PK string from all PK columns
  const pkValues = sortedPkColumns.map((col) => {
    const cellValue = row[col.field];
    if (
      cellValue &&
      typeof cellValue === "object" &&
      "value" in cellValue
    ) {
      return String(cellValue.value ?? "null");
    }
    return "null";
  });

  return pkValues.join("|");
}

/**
 * Create a stable string key from a primary keys record
 */
function createPrimaryKeyStringFromRecord(
  primaryKeys: Record<string, unknown>,
): string {
  return Object.entries(primaryKeys)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([_key, value]) => {
      if (value === null || value === undefined) return "null";
      if (typeof value === 'object') return JSON.stringify(value);
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
      return '[Unknown]';
    })
    .join("|");
}

/**
 * Check if a specific cell has a staged change
 */
export function hasStagedCellChange(
  changes: StagedChangesMap,
  rowIndex: number,
  columnField: string,
): boolean {
  return changes.rowChanges.get(rowIndex)?.has(columnField) ?? false;
}

/**
 * Check if a row is pending deletion
 */
export function isRowPendingDeletion(
  changes: StagedChangesMap,
  rowIndex: number,
): boolean {
  return changes.deletedRows.has(rowIndex);
}

/**
 * Check if a row is pending insertion
 */
export function isRowPendingInsertion(
  changes: StagedChangesMap,
  rowIndex: number,
): boolean {
  return changes.insertedRows.has(rowIndex);
}
