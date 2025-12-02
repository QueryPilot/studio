import { useCallback, useState } from "react";
import { toast } from "sonner";
import isEqual from "lodash/isEqual";
import { useCrudStore } from "@/stores/crudStore";
import {
  createUpdateCommand,
  createInsertCommand,
  createDeleteCommand,
  createCrudTarget,
} from "../utils/crudHelpers";
import type { GridColumnV2, GridRowModel } from "../types";
import type {
  GridEditCommitEvent,
  GridRowAppendEvent,
  GridRowDeleteEvent,
} from "../types";
import type { JsonValue } from "@/types";
import type { EditableDataGridRef } from "../base";

/**
 * Compare two values for equality, handling null/undefined and type coercion
 */
function areValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  // Numeric string coercion
  if (typeof a === "string" && typeof b === "number") {
    return Number(a) === b;
  }
  if (typeof a === "number" && typeof b === "string") {
    return a === Number(b);
  }

  return isEqual(a, b);
}

export interface UseTableCrudOptions {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  columns: GridColumnV2[];
  gridRef: React.RefObject<EditableDataGridRef | null>;
  enabled?: boolean;
  /** External editing state (if provided, hook won't manage its own state) */
  isEditingCell?: boolean;
  /** Callback when editing state changes (required if isEditingCell is provided) */
  onEditingChange?: (editing: boolean) => void;
}

export interface UseTableCrudResult {
  // State
  isEditingCell: boolean;
  pendingChanges: ReturnType<typeof useCrudStore.getState>["stagedCommands"] extends Map<string, infer T> ? T : never;
  tableKey: string;

  // Handlers
  handleCellEditStart: () => void;
  handleCellEditCancel: () => void;
  handleCellEditCommit: (event: GridEditCommitEvent) => undefined;
  handleRowAppend: (event: GridRowAppendEvent) => undefined;
  handleRowDelete: (event: GridRowDeleteEvent) => undefined;

  // Actions
  insertRow: (draftRow: GridRowModel) => void;
}

/**
 * Hook for managing CRUD operations in TableDataGridV2.
 * Handles staging of insert, update, and delete commands.
 */
export function useTableCrud({
  connectionId,
  database,
  schema,
  table,
  columns,
  gridRef,
  enabled = true,
  isEditingCell: externalIsEditingCell,
  onEditingChange,
}: UseTableCrudOptions): UseTableCrudResult {
  // Use external state if provided, otherwise manage internally
  const [internalIsEditingCell, setInternalIsEditingCell] = useState(false);
  const isEditingCell = externalIsEditingCell ?? internalIsEditingCell;
  const setIsEditingCell = onEditingChange ?? setInternalIsEditingCell;

  const { stageCommand, getTableKey, stagedCommands } = useCrudStore();

  const tableKey = enabled
    ? getTableKey({ connectionId, database, schema, table })
    : "";
  const pendingChanges = enabled ? stagedCommands.get(tableKey) ?? [] : [];

  const target = createCrudTarget(connectionId, database, schema, table);

  // Handler: Cell edit start
  const handleCellEditStart = useCallback(() => {
    setIsEditingCell(true);
  }, [setIsEditingCell]);

  // Handler: Cell edit cancel
  const handleCellEditCancel = useCallback(() => {
    setIsEditingCell(false);
  }, [setIsEditingCell]);

  // Handler: Cell edit commit
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent): undefined => {
      if (!enabled) return undefined;

      try {
        const commands = stagedCommands.get(tableKey) ?? [];
        const insertCommands = commands.filter(
          (cmd) => cmd.type === "data.insert"
        );
        const isPendingInsert = event.rowIndex < insertCommands.length;

        if (isPendingInsert) {
          // Editing a pending insert row - update the INSERT command payload
          const insertCmd = insertCommands[event.rowIndex];
          if (insertCmd) {
            const payload = insertCmd.payload as {
              values?: Record<string, JsonValue>;
            };
            const updatedValues = { ...payload.values };
            const oldValue = payload.values?.[event.column.field];

            // Extract the new value
            let newValue: JsonValue = null;
            if ("data" in event.newValue) {
              const data = event.newValue.data;
              if (
                typeof data === "object" &&
                data !== null &&
                "value" in data
              ) {
                const extractedValue = data.value;

                // Convert numeric strings to numbers based on column type
                const columnDbType =
                  event.column.meta?.db_type.toLowerCase() || "";
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
                  const numValue = Number(extractedValue);
                  newValue = isNaN(numValue) ? extractedValue : numValue;
                } else {
                  newValue = extractedValue as JsonValue;
                }
              } else {
                newValue = data as JsonValue;
              }
            }

            // Only update if the value actually changed
            if (!areValuesEqual(oldValue, newValue)) {
              updatedValues[event.column.field] = newValue;
              const updatedCmd = {
                ...insertCmd,
                payload: { ...payload, values: updatedValues },
              };
              stageCommand(updatedCmd);
            }
          }
        } else {
          // Editing an existing row - create UPDATE command
          const command = createUpdateCommand(event, target, columns);
          const payload = command.payload as {
            oldValue: unknown;
            newValue: unknown;
          };

          if (!areValuesEqual(payload.oldValue, payload.newValue)) {
            stageCommand(command);
          }
        }

        return undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to stage change", { description: message });
        return undefined;
      } finally {
        setIsEditingCell(false);
      }
    },
    [enabled, tableKey, target, columns, stageCommand, stagedCommands, setIsEditingCell]
  );

  // Handler: Row append
  const handleRowAppend = useCallback(
    (event: GridRowAppendEvent): undefined => {
      if (!enabled) return undefined;

      try {
        const command = createInsertCommand(event.draftRow, target, columns);
        stageCommand(command);

        // Focus on the first cell of the new row
        setTimeout(() => {
          if (gridRef.current && columns.length > 0) {
            (gridRef.current as any).setFocus?.([0, 0], true);
          }
        }, 50);

        return undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to stage row", { description: message });
        return undefined;
      }
    },
    [enabled, target, columns, stageCommand, gridRef]
  );

  // Handler: Row delete
  const handleRowDelete = useCallback(
    (event: GridRowDeleteEvent): undefined => {
      if (!enabled) return undefined;

      try {
        const commands = event.rows.map((row) =>
          createDeleteCommand(row, target, columns)
        );
        commands.forEach((command) => stageCommand(command));
        return undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to stage deletion", { description: message });
        return undefined;
      }
    },
    [enabled, target, columns, stageCommand]
  );

  // Action: Insert a new row programmatically
  const insertRow = useCallback(
    (draftRow: GridRowModel) => {
      if (!enabled) return;

      try {
        const command = createInsertCommand(draftRow, target, columns);
        stageCommand(command);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to insert row", { description: message });
      }
    },
    [enabled, target, columns, stageCommand]
  );

  return {
    isEditingCell,
    pendingChanges,
    tableKey,
    handleCellEditStart,
    handleCellEditCancel,
    handleCellEditCommit,
    handleRowAppend,
    handleRowDelete,
    insertRow,
  };
}
