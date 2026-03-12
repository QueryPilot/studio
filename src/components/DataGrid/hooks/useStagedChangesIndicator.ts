import { useMemo } from "react";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand } from "@/types";
import type { GridRowModel, GridColumnV2 } from "../types";

// Stable empty array to avoid unstable `?? []` references on every render
const EMPTY_COMMANDS: CrudCommand[] = [];

export interface StagedChangesMap {
  /** Map of row index → set of changed column fields */
  rowChanges: Map<number, Set<string>>;
  /** Set of row indexes that are pending INSERT */
  insertedRows: Set<number>;
  /** Set of row indexes that are pending DELETE */
  deletedRows: Set<number>;
  /** Reusable PK string → row index map (shared to avoid duplicate computation) */
  pkToRowIndex: Map<string, number>;
}

// Empty/default result to avoid allocations when disabled
const EMPTY_PK_MAP = new Map<string, number>();
const EMPTY_RESULT: StagedChangesMap = {
  rowChanges: new Map(),
  insertedRows: new Set(),
  deletedRows: new Set(),
  pkToRowIndex: EMPTY_PK_MAP,
};

interface UseStagedChangesIndicatorOptions {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  /** Optional row identity column names (PK/UNIQUE/custom) used by command matcher */
  rowIdentityColumns?: string[];
  rows: GridRowModel[];
  /** Original rows before optimistic updates — stable reference for PK map.
   *  Falls back to `rows` if not provided. */
  baseRows?: GridRowModel[];
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
  const {
    connectionId,
    database,
    schema,
    table,
    rowIdentityColumns,
    rows,
    baseRows,
    columns,
  } = options;
  // Use scoped selectors to avoid re-renders from changes in other tabs.
  const getTableKey = useCrudStore((s) => s.getTableKey);

  const tableKey = getTableKey({
    connectionId,
    database,
    schema,
    table,
  });

  // Scope to this table's commands only.
  const commands =
    useCrudStore((s) => s.stagedCommands.get(tableKey)) ?? EMPTY_COMMANDS;

  // Memoize PK column list to avoid recomputation
  // For document paradigm (MongoDB), _id is always the PK
  // For keyvalue paradigm (Redis), key is always the PK
  const pkColumns = useMemo(() => {
    if (rowIdentityColumns && rowIdentityColumns.length > 0) {
      const deduped = new Map<string, GridColumnV2>();

      for (const identityColumn of rowIdentityColumns) {
        const matchedColumn = columns.find(
          (col) =>
            col.name === identityColumn ||
            col.field === identityColumn ||
            col.title === identityColumn,
        );

        if (matchedColumn) {
          deduped.set(matchedColumn.field, matchedColumn);
          continue;
        }

        const hasIdentityOnRows = rows.some((row) =>
          Object.prototype.hasOwnProperty.call(row, identityColumn),
        );

        // Some paradigms keep identity fields on the row model but intentionally
        // hide those columns in the visible grid (e.g. document array __index).
        // Create a virtual identity column so PK mapping remains deterministic.
        if (hasIdentityOnRows) {
          deduped.set(identityColumn, {
            id: identityColumn,
            field: identityColumn,
            name: identityColumn,
            title: identityColumn,
            width: 1,
            meta: {
              name: identityColumn,
              db_type: "synthetic",
              nullable: false,
              default: null,
              is_pk: true,
              is_fk: false,
              ordinal: -1,
            },
          });
        }
      }

      if (deduped.size > 0) {
        return Array.from(deduped.values());
      }
    }

    let pks = columns.filter((col) => col.meta?.is_pk);

    // Fallback: If no PK columns found, check for common paradigm-specific keys
    if (pks.length === 0 && columns.length > 0) {
      // MongoDB: _id is always the primary key
      const idColumn = columns.find(
        (col) => col.field === "_id" || col.name === "_id",
      );
      if (idColumn) {
        pks = [idColumn];
      }
      // Redis: key is always the primary key
      const keyColumn = columns.find(
        (col) => col.field === "key" || col.name === "key",
      );
      if (keyColumn && pks.length === 0) {
        pks = [keyColumn];
      }
    }

    return pks;
  }, [columns, rowIdentityColumns, rows]);

  // Use baseRows (pre-optimistic, stable reference) for the PK map when safe.
  // Optimistic cell UPDATES don't change PKs or row count, so baseRows indices
  // are still correct. But optimistic INSERTs add rows and shift indices,
  // so we must fall back to the full `rows` when inserts exist.
  const hasInserts = useMemo(
    () => commands.some((cmd) => cmd.type === "data.insert"),
    [commands],
  );
  const pkMapRows = !hasInserts && baseRows ? baseRows : rows;
  const pkToRowIndex = useMemo(() => {
    if (pkMapRows.length === 0 || pkColumns.length === 0) {
      return new Map<string, number>();
    }

    const map = new Map<string, number>();
    pkMapRows.forEach((row, index) => {
      const pkKey = createPrimaryKeyStringFast(row, pkColumns);
      if (pkKey) {
        map.set(pkKey, index);
      }
    });
    return map;
  }, [pkMapRows, pkColumns]);

  // Names used to look up keys in command's primaryKeys record.
  // When rowIdentityColumns is provided, use those directly — they match the keys
  // used in command payloads (e.g. "__kv_key" for document KV mode, or "email"
  // for SQL composite keys). When falling back to auto-detected PK columns,
  // use col.name since SQL commands key primaryKeys by column name.
  const pkColNames = useMemo(
    () =>
      rowIdentityColumns && rowIdentityColumns.length > 0
        ? rowIdentityColumns
        : pkColumns.map((col) => col.name || col.field),
    [rowIdentityColumns, pkColumns],
  );

  const result = useMemo(() => {
    // Early exit when no commands — still expose the PK map so consumers
    // that read pkToRowIndex don't get a stale empty map.
    if (commands.length === 0) {
      if (pkToRowIndex.size === 0) return EMPTY_RESULT;
      return { ...EMPTY_RESULT, pkToRowIndex };
    }

    const newResult: StagedChangesMap = {
      rowChanges: new Map(),
      insertedRows: new Set(),
      deletedRows: new Set(),
      pkToRowIndex,
    };

    commands.forEach((command: CrudCommand) => {
      switch (command.type) {
        case "data.update": {
          const payload = command.payload as {
            column?: string;
            primaryKeys?: Record<string, unknown>;
          };
          if (!payload.column || !payload.primaryKeys) break;

          const pkKey = createPrimaryKeyStringFromRecord(payload.primaryKeys, pkColNames);
          const rowIndex = pkToRowIndex.get(pkKey);
          if (rowIndex !== undefined) {
            let rowChangeSet = newResult.rowChanges.get(rowIndex);
            if (!rowChangeSet) {
              rowChangeSet = new Set();
              newResult.rowChanges.set(rowIndex, rowChangeSet);
            }
            // Use gridColumn from metadata if available (for KV mode where
            // payload.column is the full nested path but the grid column is __kv_value)
            const displayCol = command.metadata.gridColumn ?? payload.column;
            rowChangeSet.add(displayCol);

            // For nested document updates (e.g. "items.2.productSku"), also mark
            // the top-level field ("items"). This keeps root drillable cells
            // visually staged when navigating back out of nested views.
            if (
              payload.column.includes(".") &&
              displayCol !== payload.column
            ) {
              const rootField = payload.column.split(".")[0];
              if (rootField) {
                rowChangeSet.add(rootField);
              }
            }
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

          const pkKey = createPrimaryKeyStringFromRecord(payload.primaryKeys, pkColNames);
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
    if (hasInserts) {
      rows.forEach((row, index) => {
        // Check for the hidden __insert_temp_id__ field that marks inserted rows
        if (row["__insert_temp_id__"]) {
          newResult.insertedRows.add(index);
        }
      });
    }

    return newResult;
  }, [commands, pkToRowIndex, pkColNames, rows, hasInserts]);

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
    return null;
  }

  // Sort columns by name to match createPrimaryKeyStringFromRecord's alphabetical sorting
  const sortedPkColumns = [...pkColumns].sort((a, b) =>
    (a.name || a.field).localeCompare(b.name || b.field),
  );

  // Build composite PK string from all PK columns
  // IMPORTANT: Must match createPrimaryKeyStringFromRecord's serialization format
  const pkValues = sortedPkColumns.map((col) => {
    const cellValue = row[col.field];
    if (cellValue && typeof cellValue === "object" && "value" in cellValue) {
      const value = cellValue.value;
      if (value === null || value === undefined) return "null";
      // Use JSON.stringify for objects (e.g., MongoDB ObjectId) to match createPrimaryKeyStringFromRecord
      if (typeof value === "object") return JSON.stringify(value);
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return String(value);
      }
      return "[Unknown]";
    }
    return "null";
  });

  return pkValues.join("|");
}

/**
 * Create a stable string key from a primary keys record.
 * When pkColumnNames is provided, only those keys are used (allows commands
 * with extra metadata keys like __kv_key alongside _id to match correctly).
 */
export function createPrimaryKeyStringFromRecord(
  primaryKeys: Record<string, unknown>,
  pkColumnNames?: string[],
): string {
  const entries =
    pkColumnNames && pkColumnNames.length > 0
      ? [...pkColumnNames]
          .sort((a, b) => a.localeCompare(b))
          .map((name) => [name, primaryKeys[name]] as const)
      : Object.entries(primaryKeys).sort(([a], [b]) => a.localeCompare(b));

  return entries
    .map(([_key, value]) => {
      if (value === null || value === undefined) return "null";
      if (typeof value === "object") return JSON.stringify(value);
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
        return String(value);
      return "[Unknown]";
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
