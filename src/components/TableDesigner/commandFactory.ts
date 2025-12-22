import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandTarget,
  ColumnDefinitionInput,
  TableCreatePayload,
  TableDropPayload,
} from "@/types/crud";

export function generateCommandId(): string {
  return nanoid();
}

export function createTableCreateCommand(
  target: CrudCommandTarget,
  payload: {
    tableName: string;
    columns: ColumnDefinitionInput[];
    primaryKey?: string[];
    ifNotExists?: boolean;
  },
): CrudCommand<TableCreatePayload> {
  return {
    id: generateCommandId(),
    type: "table.create",
    target,
    payload: {
      tableName: payload.tableName,
      columns: payload.columns,
      primaryKey: payload.primaryKey,
      ifNotExists: payload.ifNotExists,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Create table ${payload.tableName}`,
    },
    state: "staged",
  };
}

export function createTableDropCommand(
  target: CrudCommandTarget,
  tableName: string,
  options?: { cascade?: boolean; ifExists?: boolean },
): CrudCommand<TableDropPayload> {
  return {
    id: generateCommandId(),
    type: "table.drop",
    target,
    payload: {
      tableName,
      cascade: options?.cascade,
      ifExists: options?.ifExists ?? true,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Drop table ${tableName}`,
    },
    state: "staged",
  };
}
