import { useCallback } from "react";
import type { GridEditCommitEvent, GridRowModel } from "../../types";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand, CrudCommandTarget, JsonValue } from "@/types/crud";

export interface UseCrudOperationsOptions {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  primaryKeyColumns: string[];
}

export interface UseCrudOperationsResult {
  /** Stage a cell edit */
  stageEdit: (event: GridEditCommitEvent) => void;
  /** Stage a row deletion */
  stageDelete: (row: GridRowModel) => void;
  /** Stage a row insertion */
  stageInsert: (row: GridRowModel) => void;
  /** Commit all staged changes */
  commitChanges: () => Promise<void>;
  /** Discard all staged changes */
  discardChanges: () => void;
  /** Number of pending changes */
  pendingCount: number;
}

function extractPrimaryKeys(
  row: GridRowModel | undefined,
  primaryKeyColumns: string[],
): Record<string, JsonValue> {
  if (!row) return {};
  const keys: Record<string, JsonValue> = {};
  for (const col of primaryKeyColumns) {
    keys[col] = row[col] as unknown as JsonValue;
  }
  return keys;
}

/**
 * Hook to manage CRUD operations for a table
 */
export function useCrudOperations(
  options: UseCrudOperationsOptions,
): UseCrudOperationsResult {
  const { connectionId, database, schema, table, primaryKeyColumns } = options;
  const { stageCommand, commitChanges: commitForTable, discardChanges: discardForTable, getTableKey, stagedCommands } =
    useCrudStore();

  const target: CrudCommandTarget = { connectionId, database, schema, table };
  const tableKey = getTableKey(target);
  const commands = stagedCommands.get(tableKey) ?? [];
  const pendingCount = commands.length;

  const stageEdit = useCallback<UseCrudOperationsResult["stageEdit"]>(
    (event) => {
      const cmd: CrudCommand = {
        id: crypto.randomUUID(),
        type: "data.update",
        target,
        payload: {
          column: event.column.id,
          primaryKeys: extractPrimaryKeys(event.row, primaryKeyColumns),
          newValue: event.newValue as unknown as JsonValue,
          oldValue: event.previousValue as unknown as JsonValue,
        },
        metadata: { timestamp: new Date().toISOString() },
        state: "staged",
      };
      stageCommand(cmd);
    },
    [stageCommand, target, primaryKeyColumns],
  );

  const stageDelete = useCallback<UseCrudOperationsResult["stageDelete"]>(
    (row) => {
      const cmd: CrudCommand = {
        id: crypto.randomUUID(),
        type: "data.delete",
        target,
        payload: {
          primaryKeys: extractPrimaryKeys(row, primaryKeyColumns),
        },
        metadata: { timestamp: new Date().toISOString() },
        state: "staged",
      };
      stageCommand(cmd);
    },
    [stageCommand, target, primaryKeyColumns],
  );

  const stageInsert = useCallback<UseCrudOperationsResult["stageInsert"]>(
    (row) => {
      const cmd: CrudCommand = {
        id: crypto.randomUUID(),
        type: "data.insert",
        target,
        payload: {
          values: row as unknown as Record<string, JsonValue>,
        },
        metadata: { timestamp: new Date().toISOString() },
        state: "staged",
      };
      stageCommand(cmd);
    },
    [stageCommand, target, primaryKeyColumns],
  );

  const commitChanges = useCallback<UseCrudOperationsResult["commitChanges"]>(
    async () => {
      await commitForTable(tableKey);
    },
    [commitForTable, tableKey],
  );

  const discardChanges = useCallback<UseCrudOperationsResult["discardChanges"]>(
    () => {
      discardForTable(tableKey);
    },
    [discardForTable, tableKey],
  );

  return {
    stageEdit,
    stageDelete,
    stageInsert,
    commitChanges,
    discardChanges,
    pendingCount,
  };
}
