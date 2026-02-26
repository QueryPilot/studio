import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandTarget,
  DataUpdatePayload,
  DataInsertPayload,
  DataDeletePayload,
  CrudPrimitive,
  JsonValue,
  CellValue,
} from "@/types";
import type { GridRowModel, GridColumnV2, GridEditCommitEvent } from "../types";
import { convertEditValue } from "../hooks/crudConversion";

export type RowMatcherMode = "deterministic" | "best_effort";

export interface RowMatcherOptions {
  /**
   * Column names used to identify a row.
   * If omitted, fallback behavior uses columns marked `meta.is_pk`.
   */
  identityColumns?: string[];
  /**
   * Diagnostic mode tag for command metadata.
   */
  matcherMode?: RowMatcherMode;
}

const toCrudPrimitive = (value: unknown): CrudPrimitive => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return value != null ? String(value) : null;
};

function appendMatcherTags(
  existingTags: string[] | undefined,
  options: RowMatcherOptions | undefined,
  matcherColumns: string[],
): string[] | undefined {
  if (!options?.matcherMode) {
    return existingTags;
  }

  const tags = new Set(existingTags ?? []);
  tags.add(`matcher:${options.matcherMode}`);
  if (matcherColumns.length > 0) {
    tags.add(`matcher-columns:${matcherColumns.join("|")}`);
  }

  return Array.from(tags);
}

/**
 * Extract primary key values from a row
 * Uses col.field for row data access, but col.name for SQL column names
 */
export function extractPrimaryKeys(
  row: GridRowModel,
  columns: GridColumnV2[],
  options?: RowMatcherOptions,
): Record<string, CrudPrimitive> {
  const requestedIdentityColumns = options?.identityColumns;
  if (requestedIdentityColumns && requestedIdentityColumns.length === 0) {
    throw new Error("Cannot edit row: No deterministic identity columns configured");
  }

  const matcherPairs: Array<{ columnName: string; field: string }> = [];

  if (requestedIdentityColumns && requestedIdentityColumns.length > 0) {
    for (const identityColumn of requestedIdentityColumns) {
      const matched = columns.find(
        (col) =>
          col.name === identityColumn ||
          col.field === identityColumn ||
          col.title === identityColumn,
      );
      if (!matched) {
        throw new Error(
          `Cannot edit row: Identity column \"${identityColumn}\" is not available in the row`,
        );
      }
      matcherPairs.push({ columnName: identityColumn, field: matched.field });
    }
  } else {
    const pkColumns = columns.filter((col) => col.meta?.is_pk);
    if (pkColumns.length === 0) {
      throw new Error("Cannot edit row: No primary key columns found");
    }

    for (const pkCol of pkColumns) {
      matcherPairs.push({
        columnName: pkCol.name ?? pkCol.field,
        field: pkCol.field,
      });
    }
  }

  const primaryKeys: Record<string, CrudPrimitive> = {};
  matcherPairs.forEach((pair) => {
    // Use field (col_N) to access row data, but columnName for SQL identifier
    const cellValue = row[pair.field] as CellValue | null | undefined;
    const value = cellValue?.value ?? null;
    primaryKeys[pair.columnName] = toCrudPrimitive(value);
  });

  return primaryKeys;
}

/**
 * Create a data.update CRUD command from a cell edit event
 */
export function createUpdateCommand(
  event: GridEditCommitEvent,
  target: CrudCommandTarget,
  columns: GridColumnV2[],
  options?: RowMatcherOptions,
): CrudCommand<DataUpdatePayload> {
  if (!event.row) {
    throw new Error("Cannot create update command: Missing row data");
  }

  const primaryKeys = extractPrimaryKeys(event.row, columns, options);
  const matcherColumns = Object.keys(primaryKeys);

  // Check if this row is from an INSERT command (by checking for tempId metadata)
  const tempIdCell = event.row["__insert_temp_id__"] as CellValue | null | undefined;
  const insertTempId = tempIdCell?.value ? String(tempIdCell.value) : undefined;

  // Extract old value from previousValue in the event
  let oldValue: JsonValue = null;
  if (event.previousValue) {
    if (
      typeof event.previousValue === "object" &&
      "value" in event.previousValue
    ) {
      oldValue = event.previousValue.value as JsonValue;
    } else {
      oldValue = event.previousValue as JsonValue;
    }
  }

  // Extract new value from the GridCell and ensure it's a JsonValue with correct type
  let newValue: JsonValue = null;
  if ("data" in event.newValue) {
    const data = event.newValue.data;

    // For custom cells, extract the value from the data object
    if (typeof data === "object" && data !== null && "value" in data) {
      const extractedValue = data.value;

      const columnDbType = event.column.meta?.db_type.toLowerCase() || "";
      newValue =
        typeof extractedValue === "string" && extractedValue !== ""
          ? convertEditValue(extractedValue, columnDbType)
          : (extractedValue as JsonValue);
    } else if (
      typeof data === "string" ||
      typeof data === "number" ||
      typeof data === "boolean" ||
      data === null ||
      data === undefined
    ) {
      newValue = data ?? null;
    } else if (typeof data === "object") {
      newValue = JSON.stringify(data);
    } else {
      newValue = "[Unknown]";
    }
  }

  // Use actual column name for SQL, not the internal field identifier
  const columnName = event.column.name ?? event.column.field;

  // Get column type for explicit casting (needed for specialty types like money, inet, etc.)
  // Use meta.db_type first, fall back to column.type which also stores db_type
  const columnType = event.column.meta?.db_type ?? event.column.type;

  const payload: DataUpdatePayload = {
    column: columnName,
    columnType,
    oldValue,
    newValue,
    primaryKeys,
    ...(insertTempId && { tempId: insertTempId }),
  };

  return {
    id: nanoid(),
    type: "data.update",
    target,
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Update ${event.column.field} in ${target.table}`,
      tags: appendMatcherTags(undefined, options, matcherColumns),
    },
    state: "staged",
  };
}

/**
 * Create a data.insert CRUD command from a row
 */
export function createInsertCommand(
  row: GridRowModel,
  target: CrudCommandTarget,
  columns: GridColumnV2[],
  tempId?: string,
): CrudCommand<DataInsertPayload> {
  const values: Record<string, JsonValue> = {};
  const columnTypes: Record<string, string> = {};

  columns.forEach((col) => {
    const cellValue = row[col.field] as CellValue | null | undefined;
    const value = cellValue?.value;
    // Use actual column name for SQL, not the internal field identifier
    const columnName = col.name ?? col.field;
    // Track column type for explicit casting
    if (col.meta?.db_type) {
      columnTypes[columnName] = col.meta.db_type;
    }
    // Only include non-null values, ensure they're JsonValue compatible
    if (value !== null && value !== undefined) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        values[columnName] = value;
      } else {
        values[columnName] = String(value);
      }
    }
  });

  const payload: DataInsertPayload = {
    values,
    columnTypes: Object.keys(columnTypes).length > 0 ? columnTypes : undefined,
    tempId: tempId ?? nanoid(),
  };

  return {
    id: nanoid(),
    type: "data.insert",
    target,
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Insert row into ${target.table}`,
    },
    state: "staged",
  };
}

/**
 * Create a data.delete CRUD command from a row
 */
export function createDeleteCommand(
  row: GridRowModel,
  target: CrudCommandTarget,
  columns: GridColumnV2[],
  options?: RowMatcherOptions,
): CrudCommand<DataDeletePayload> {
  const primaryKeys = extractPrimaryKeys(row, columns, options);
  const matcherColumns = Object.keys(primaryKeys);

  const payload: DataDeletePayload = {
    primaryKeys,
  };

  return {
    id: nanoid(),
    type: "data.delete",
    target,
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Delete row from ${target.table}`,
      tags: appendMatcherTags(undefined, options, matcherColumns),
    },
    state: "staged",
  };
}

/**
 * Create a CrudCommandTarget from table information
 */
export function createCrudTarget(
  connectionId: string,
  database: string,
  schema: string | undefined,
  table: string,
): CrudCommandTarget {
  return {
    connectionId,
    database,
    schema,
    table,
  };
}
