import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandTarget,
  DataUpdatePayload,
  DataInsertPayload,
  DataDeletePayload,
  CrudPrimitive,
  JsonValue,
} from "@/types/crud";
import type { GridRowModel, GridColumnV2, GridEditCommitEvent } from "../types";
import type { CellValue } from "@/types/cellValue";

/**
 * Extract primary key values from a row
 */
export function extractPrimaryKeys(
  row: GridRowModel,
  columns: GridColumnV2[],
): Record<string, CrudPrimitive> {
  const pkColumns = columns.filter((col) => col.meta?.is_pk);
  if (pkColumns.length === 0) {
    throw new Error("Cannot edit row: No primary key columns found");
  }

  const primaryKeys: Record<string, CrudPrimitive> = {};
  pkColumns.forEach((pkCol) => {
    const cellValue = row[pkCol.field] as CellValue | null | undefined;
    const value = cellValue?.value ?? null;
    // Ensure value is a CrudPrimitive (string, number, boolean, or null)
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      primaryKeys[pkCol.field] = value;
    } else {
      // Convert other types to string or null
      primaryKeys[pkCol.field] = value != null ? String(value) : null;
    }
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
): CrudCommand<DataUpdatePayload> {
  if (!event.row) {
    throw new Error("Cannot create update command: Missing row data");
  }

  const primaryKeys = extractPrimaryKeys(event.row, columns);

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

      // Convert numeric strings to numbers based on column type
      const columnDbType = event.column.meta?.db_type.toLowerCase() || "";
      const isNumericColumn =
        columnDbType.includes("int") ||
        columnDbType.includes("numeric") ||
        columnDbType.includes("decimal") ||
        columnDbType.includes("float") ||
        columnDbType.includes("double") ||
        columnDbType.includes("real") ||
        columnDbType.includes("money");

      if (
        isNumericColumn &&
        typeof extractedValue === "string" &&
        extractedValue !== ""
      ) {
        // Convert string to number for numeric columns
        const numValue = Number(extractedValue);
        newValue = isNaN(numValue) ? extractedValue : numValue;
      } else {
        newValue = extractedValue as JsonValue;
      }
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

  const payload: DataUpdatePayload = {
    column: event.column.field,
    oldValue,
    newValue,
    primaryKeys,
  };

  return {
    id: nanoid(),
    type: "data.update",
    target,
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Update ${event.column.field} in ${target.table}`,
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

  columns.forEach((col) => {
    const cellValue = row[col.field] as CellValue | null | undefined;
    const value = cellValue?.value;
    // Only include non-null values, ensure they're JsonValue compatible
    if (value !== null && value !== undefined) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        values[col.field] = value;
      } else {
        values[col.field] = String(value);
      }
    }
  });

  const payload: DataInsertPayload = {
    values,
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
): CrudCommand<DataDeletePayload> {
  const primaryKeys = extractPrimaryKeys(row, columns);

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
