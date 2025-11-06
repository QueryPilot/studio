import { useMemo } from "react";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand } from "@/types/crud";
import type { GridRowModel, GridColumnV2 } from "../types";

interface StagedChangesMap {
  /** Map of row index → set of changed column fields */
  rowChanges: Map<number, Set<string>>;
  /** Set of row indexes that are pending INSERT */
  insertedRows: Set<number>;
  /** Set of row indexes that are pending DELETE */
  deletedRows: Set<number>;
}

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

  return useMemo(() => {
    const result: StagedChangesMap = {
      rowChanges: new Map(),
      insertedRows: new Set(),
      deletedRows: new Set(),
    };

    // Build a map of primary keys to row indexes for lookups
    const pkToRowIndex = new Map<string, number>();
    rows.forEach((row, index) => {
      // Create a stable PK key from the row using column metadata
      const pkKey = createPrimaryKeyString(row, columns);
      if (pkKey) {
        pkToRowIndex.set(pkKey, index);
      }
    });

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
            if (!result.rowChanges.has(rowIndex)) {
              result.rowChanges.set(rowIndex, new Set());
            }
            result.rowChanges.get(rowIndex)!.add(payload.column);
          }
          break;
        }

        case "data.insert": {
          // Track inserts - we don't have row index yet as they're new
          // For now, we'll mark them differently in the UI
          // TODO: Track temp IDs to row indexes
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
            result.deletedRows.add(rowIndex);
          }
          break;
        }
      }
    });

    return result;
  }, [commands, rows, columns]);
}

/**
 * Create a stable string key from a row's primary key values
 */
function createPrimaryKeyString(
  row: GridRowModel,
  columns: GridColumnV2[],
): string | null {
  // Find all primary key columns
  const pkColumns = columns.filter((col) => col.meta?.is_pk);

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

  // Build composite PK string from all PK columns (sorted for consistency)
  const pkValues = pkColumns
    .map((col) => {
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
    .map(([_key, value]) => String(value ?? "null"))
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
