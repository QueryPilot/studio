import { useCallback } from "react";
import type { GridEditCommitEvent, GridRowModel } from "../../types";
import { useCrudStore } from "@/stores/crudStore";

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

/**
 * Hook to manage CRUD operations for a table
 */
export function useCrudOperations(
  options: UseCrudOperationsOptions,
): UseCrudOperationsResult {
  const { connectionId, database, schema, table, primaryKeyColumns } = options;
  const { stageCommand, commitAllForTable, discardAllForTable, getTableKey, stagedCommands } =
    useCrudStore();

  const tableKey = getTableKey({ connectionId, database, schema, table });
  const commands = stagedCommands.get(tableKey) ?? [];
  const pendingCount = commands.length;

  const stageEdit = useCallback<UseCrudOperationsResult["stageEdit"]>(
    (event) => {
      stageCommand({
        type: "update",
        connectionId,
        database,
        schema,
        table,
        primaryKeyColumns,
        rowData: event.row.data,
        changes: { [event.columnId]: event.newValue },
      });
    },
    [stageCommand, connectionId, database, schema, table, primaryKeyColumns],
  );

  const stageDelete = useCallback<UseCrudOperationsResult["stageDelete"]>(
    (row) => {
      stageCommand({
        type: "delete",
        connectionId,
        database,
        schema,
        table,
        primaryKeyColumns,
        rowData: row.data,
      });
    },
    [stageCommand, connectionId, database, schema, table, primaryKeyColumns],
  );

  const stageInsert = useCallback<UseCrudOperationsResult["stageInsert"]>(
    (row) => {
      stageCommand({
        type: "insert",
        connectionId,
        database,
        schema,
        table,
        primaryKeyColumns,
        rowData: row.data,
      });
    },
    [stageCommand, connectionId, database, schema, table, primaryKeyColumns],
  );

  const commitChanges = useCallback<UseCrudOperationsResult["commitChanges"]>(
    async () => {
      await commitAllForTable(tableKey);
    },
    [commitAllForTable, tableKey],
  );

  const discardChanges = useCallback<UseCrudOperationsResult["discardChanges"]>(
    () => {
      discardAllForTable(tableKey);
    },
    [discardAllForTable, tableKey],
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
