import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandTarget,
  ColumnDefinitionInput,
  ColumnAddPayload,
  ColumnModifyPayload,
  ColumnDropPayload,
  ColumnRenamePayload,
} from "@/types/crud";

export function generateCommandId(): string {
  return nanoid();
}

export function createColumnAddCommand(
  target: CrudCommandTarget,
  column: Partial<ColumnDefinitionInput>,
  tempId?: string,
): CrudCommand<ColumnAddPayload> {
  return {
    id: generateCommandId(),
    type: "column.add",
    target,
    payload: {
      column: {
        name: column.name || "",
        dataType: column.dataType || "text",
        nullable: column.nullable ?? true,
        defaultValue: column.defaultValue,
        comment: column.comment,
        length: column.length,
        precision: column.precision,
        scale: column.scale,
        isPrimaryKey: column.isPrimaryKey ?? false,
        isUnique: column.isUnique ?? false,
        checkExpression: column.checkExpression,
      },
      tempId: tempId || generateCommandId(),
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Add column ${column.name || "(unnamed)"}`,
    },
    state: "staged",
  };
}

export function createColumnModifyCommand(
  target: CrudCommandTarget,
  columnName: string,
  newDefinition: Partial<ColumnDefinitionInput>,
  description?: string,
): CrudCommand<ColumnModifyPayload> {
  // Build clean definition - only include fields that are actually provided
  const cleanDefinition: Partial<ColumnDefinitionInput> = {};

  if (newDefinition.name !== undefined) {
    cleanDefinition.name = newDefinition.name;
  }
  if (newDefinition.dataType !== undefined) {
    cleanDefinition.dataType = newDefinition.dataType;
  }
  if (newDefinition.nullable !== undefined) {
    cleanDefinition.nullable = newDefinition.nullable;
  }
  if (newDefinition.defaultValue !== undefined) {
    cleanDefinition.defaultValue = newDefinition.defaultValue;
  }
  if (newDefinition.comment !== undefined) {
    cleanDefinition.comment = newDefinition.comment;
  }
  if (newDefinition.length !== undefined) {
    cleanDefinition.length = newDefinition.length;
  }
  if (newDefinition.precision !== undefined) {
    cleanDefinition.precision = newDefinition.precision;
  }
  if (newDefinition.scale !== undefined) {
    cleanDefinition.scale = newDefinition.scale;
  }

  return {
    id: generateCommandId(),
    type: "column.modify",
    target,
    payload: {
      columnName,
      newDefinition: cleanDefinition,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: description || `Modify column ${columnName}`,
    },
    state: "staged",
  };
}

export function createColumnDropCommand(
  target: CrudCommandTarget,
  columnName: string,
  cascade = false,
): CrudCommand<ColumnDropPayload> {
  return {
    id: generateCommandId(),
    type: "column.drop",
    target,
    payload: {
      columnName,
      cascade,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Drop column ${columnName}`,
    },
    state: "staged",
  };
}

export function createColumnRenameCommand(
  target: CrudCommandTarget,
  columnName: string,
  newName: string,
): CrudCommand<ColumnRenamePayload> {
  return {
    id: generateCommandId(),
    type: "column.rename",
    target,
    payload: {
      columnName,
      newName,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Rename column ${columnName} to ${newName}`,
    },
    state: "staged",
  };
}
