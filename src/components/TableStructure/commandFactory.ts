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
  return {
    id: generateCommandId(),
    type: "column.modify",
    target,
    payload: {
      columnName,
      newDefinition: {
        name: newDefinition.name || columnName,
        dataType: newDefinition.dataType || "text",
        nullable: newDefinition.nullable ?? true,
        defaultValue: newDefinition.defaultValue,
        comment: newDefinition.comment,
        length: newDefinition.length,
        precision: newDefinition.precision,
        scale: newDefinition.scale,
      },
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
