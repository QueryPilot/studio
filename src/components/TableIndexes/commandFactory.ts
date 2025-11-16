import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandTarget,
  IndexDefinitionInput,
  IndexCreatePayload,
  IndexDropPayload,
  IndexRenamePayload,
} from "@/types/crud";

export function generateCommandId(): string {
  return nanoid();
}

export function createIndexCreateCommand(
  target: CrudCommandTarget,
  definition: Partial<IndexDefinitionInput>,
  tempId?: string,
): CrudCommand<IndexCreatePayload> {
  return {
    id: generateCommandId(),
    type: "index.create",
    target,
    payload: {
      definition: {
        name: definition.name || "",
        columns: definition.columns || [],
        unique: definition.unique ?? false,
        using: definition.using || "btree",
        where: definition.where,
        includeColumns: definition.includeColumns,
      },
      tempId: tempId || generateCommandId(),
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Create index ${definition.name || "(unnamed)"}`,
    },
    state: "staged",
  };
}

export function createIndexDropCommand(
  target: CrudCommandTarget,
  indexName: string,
  ifExists = true,
): CrudCommand<IndexDropPayload> {
  return {
    id: generateCommandId(),
    type: "index.drop",
    target,
    payload: {
      indexName,
      ifExists,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Drop index ${indexName}`,
    },
    state: "staged",
  };
}

export function createIndexRenameCommand(
  target: CrudCommandTarget,
  indexName: string,
  newName: string,
): CrudCommand<IndexRenamePayload> {
  return {
    id: generateCommandId(),
    type: "index.rename",
    target,
    payload: {
      indexName,
      newName,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Rename index ${indexName} to ${newName}`,
    },
    state: "staged",
  };
}
