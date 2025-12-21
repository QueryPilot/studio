import { logger } from "@/lib/logger";
import { create } from "zustand";

import { BackendAPI } from "@/services/backend";
import type {
  CommitResult,
  CrudCommand,
  CrudCommandTarget,
  StageCommandResult,
} from "@/types/crud";

const HISTORY_LIMIT = 100;

type CrudHistorySnapshot = Map<string, CrudCommand[]>;

const createTableKey = (target: CrudCommandTarget): string => {
  const { connectionId, database = "", schema = "", table = "" } = target;
  return [connectionId, database, schema, table].join(":");
};

const cloneStagedCommands = (
  staged: Map<string, CrudCommand[]>,
): CrudHistorySnapshot =>
  new Map(
    Array.from(staged.entries(), ([key, commands]) => [key, [...commands]]),
  );

const rebuildCommandIndex = (
  staged: Map<string, CrudCommand[]>,
): Map<string, string> => {
  const index = new Map<string, string>();
  staged.forEach((commands, tableKey) => {
    commands.forEach((command) => {
      index.set(command.id, tableKey);
    });
  });
  return index;
};

const pushHistorySnapshot = (
  history: CrudHistorySnapshot[],
  historyIndex: number,
  snapshot: CrudHistorySnapshot,
): { history: CrudHistorySnapshot[]; historyIndex: number } => {
  const base = history.slice(0, historyIndex + 1);
  base.push(snapshot);
  if (base.length > HISTORY_LIMIT) {
    base.shift();
  }
  return { history: base, historyIndex: base.length - 1 };
};

const emptySnapshot = () => cloneStagedCommands(new Map<string, CrudCommand[]>());

export interface CrudStoreState {
  stagedCommands: Map<string, CrudCommand[]>;
  commandIndex: Map<string, string>;
  history: CrudHistorySnapshot[];
  historyIndex: number;
  previewMode: "split" | "unified" | "compact";
  isDirty: boolean;
  committingTableKeys: Set<string>; // Track which tables are currently committing

  stageCommand: (command: CrudCommand) => StageCommandResult;
  stageCommands: (commands: CrudCommand[]) => StageCommandResult[];
  stageBatchWithSingleHistoryEntry: (commands: CrudCommand[]) => StageCommandResult[];
  unstageCommand: (commandId: string) => void;
  unstageCommands: (commandIds: string[]) => void;
  discardChanges: (tableKey: string) => void;
  discardAll: () => void;
  commitChanges: (tableKey: string) => Promise<CommitResult>;
  commitAll: () => Promise<Record<string, CommitResult>>;
  clearCommittedChanges: (tableKey: string) => void; // Clear after refetch completes
  undo: () => void;
  redo: () => void;
  getTableKey: (target: CrudCommandTarget) => string;
  getStagedCommands: (tableKey: string) => CrudCommand[];
  isCommitting: (tableKey: string) => boolean;
}

export const useCrudStore = create<CrudStoreState>()((set, get) => {
  const initialSnapshot = emptySnapshot();
  return {
    stagedCommands: new Map<string, CrudCommand[]>(),
    commandIndex: new Map<string, string>(),
    history: [initialSnapshot],
    historyIndex: 0,
    previewMode: "split",
    isDirty: false,
    committingTableKeys: new Set<string>(),

    stageCommand: (command) => {
      let result: StageCommandResult | undefined;
      set((state) => {
        const tableKey = createTableKey(command.target);
        const stagedCommands = cloneStagedCommands(state.stagedCommands);
        const commandIndex = new Map(state.commandIndex);

        const existing = stagedCommands.get(tableKey) ?? [];

        // Special handling for UPDATE commands on inserted rows
        if (command.type === "data.update") {
          const updatePayload = command.payload as { tempId?: string; column?: string; newValue?: unknown };
          if (updatePayload.tempId) {
            // This is an UPDATE to an inserted row - merge it into the INSERT command
            const insertCommand = existing.find((cmd) => {
              if (cmd.type !== "data.insert") return false;
              const insertPayload = cmd.payload as { tempId?: string };
              return insertPayload.tempId === updatePayload.tempId;
            });

            if (insertCommand && updatePayload.column) {
              // Merge the UPDATE into the INSERT command
              const insertPayload = insertCommand.payload as { values?: Record<string, unknown>; tempId?: string };
              const updatedInsertCommand = {
                ...insertCommand,
                payload: {
                  ...insertPayload,
                  values: {
                    ...(insertPayload.values ?? {}),
                    [updatePayload.column]: updatePayload.newValue,
                  },
                },
              };

              // Replace the INSERT command with the updated one
              const nextCommands = existing.map((item) =>
                item.id === insertCommand.id ? updatedInsertCommand : item
              );
              stagedCommands.set(tableKey, nextCommands);

              const snapshot = cloneStagedCommands(stagedCommands);
              const { history, historyIndex } = pushHistorySnapshot(
                state.history,
                state.historyIndex,
                snapshot,
              );

              result = { command: updatedInsertCommand };

              return {
                stagedCommands,
                commandIndex,
                history,
                historyIndex,
                isDirty: stagedCommands.size > 0,
              };
            }
          }
        }

        // For UPDATE commands on existing rows, check if we're updating the same cell
        // If so, replace the old UPDATE instead of adding a new one
        if (command.type === "data.update") {
          const updatePayload = command.payload as {
            primaryKeys?: Record<string, unknown>;
            column?: string;
            newValue?: unknown;
          };

          // Find existing UPDATE command for the same cell (same PK + column)
          const existingUpdateIndex = existing.findIndex((cmd) => {
            if (cmd.type !== "data.update") return false;
            const existingPayload = cmd.payload as {
              primaryKeys?: Record<string, unknown>;
              column?: string;
            };

            // Check if it's the same column
            if (existingPayload.column !== updatePayload.column) return false;

            // Check if it's the same row (by comparing primary keys)
            if (!existingPayload.primaryKeys || !updatePayload.primaryKeys) return false;

            const existingPKEntries = Object.entries(existingPayload.primaryKeys).sort(
              ([a], [b]) => a.localeCompare(b),
            );
            const newPKEntries = Object.entries(updatePayload.primaryKeys).sort(([a], [b]) =>
              a.localeCompare(b),
            );

            // Compare PK signatures
            const existingPKSig = existingPKEntries
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join("|");
            const newPKSig = newPKEntries
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join("|");

            return existingPKSig === newPKSig;
          });

          if (existingUpdateIndex >= 0) {
            // Replace the existing UPDATE command
            const oldCommand = existing[existingUpdateIndex];
            const nextCommands = [...existing];
            nextCommands[existingUpdateIndex] = command;
            stagedCommands.set(tableKey, nextCommands);
            commandIndex.set(command.id, tableKey);
            if (oldCommand) {
              commandIndex.delete(oldCommand.id);
            }
          } else {
            // No existing UPDATE for this cell, add new one
            const nextCommands = [...existing, command];
            stagedCommands.set(tableKey, nextCommands);
            commandIndex.set(command.id, tableKey);
          }
        } else {
          // Default behavior for INSERT, DELETE, and other commands
          const nextCommands = existing.some((item) => item.id === command.id)
            ? existing.map((item) => (item.id === command.id ? command : item))
            : [...existing, command];
          stagedCommands.set(tableKey, nextCommands);
          commandIndex.set(command.id, tableKey);
        }

        const snapshot = cloneStagedCommands(stagedCommands);
        const { history, historyIndex } = pushHistorySnapshot(
          state.history,
          state.historyIndex,
          snapshot,
        );

        result = { command };

        return {
          stagedCommands,
          commandIndex,
          history,
          historyIndex,
          isDirty: stagedCommands.size > 0,
        };
      });
      return result ?? { command };
    },

    stageCommands: (commands) => commands.map((command) => get().stageCommand(command)),

    stageBatchWithSingleHistoryEntry: (commands) => {
      const results: StageCommandResult[] = [];

      set((state) => {
        const stagedCommands = cloneStagedCommands(state.stagedCommands);
        const commandIndex = new Map(state.commandIndex);

        for (const command of commands) {
          const tableKey = createTableKey(command.target);
          const existing = stagedCommands.get(tableKey) ?? [];

          // Handle UPDATE commands on inserted rows
          if (command.type === "data.update") {
            const updatePayload = command.payload as { tempId?: string; column?: string; newValue?: unknown };
            if (updatePayload.tempId) {
              const insertCommand = existing.find((cmd) => {
                if (cmd.type !== "data.insert") return false;
                const insertPayload = cmd.payload as { tempId?: string };
                return insertPayload.tempId === updatePayload.tempId;
              });

              if (insertCommand && updatePayload.column) {
                const insertPayload = insertCommand.payload as { values?: Record<string, unknown>; tempId?: string };
                const updatedInsertCommand = {
                  ...insertCommand,
                  payload: {
                    ...insertPayload,
                    values: {
                      ...(insertPayload.values ?? {}),
                      [updatePayload.column]: updatePayload.newValue,
                    },
                  },
                };

                const nextCommands = existing.map((item) =>
                  item.id === insertCommand.id ? updatedInsertCommand : item
                );
                stagedCommands.set(tableKey, nextCommands);
                results.push({ command: updatedInsertCommand });
                continue;
              }
            }
          }

          // Handle UPDATE commands on existing rows - replace same cell updates
          if (command.type === "data.update") {
            const updatePayload = command.payload as {
              primaryKeys?: Record<string, unknown>;
              column?: string;
              newValue?: unknown;
            };

            const currentCommands = stagedCommands.get(tableKey) ?? [];
            const existingUpdateIndex = currentCommands.findIndex((cmd) => {
              if (cmd.type !== "data.update") return false;
              const existingPayload = cmd.payload as {
                primaryKeys?: Record<string, unknown>;
                column?: string;
              };

              if (existingPayload.column !== updatePayload.column) return false;
              if (!existingPayload.primaryKeys || !updatePayload.primaryKeys) return false;

              const existingPKEntries = Object.entries(existingPayload.primaryKeys).sort(
                ([a], [b]) => a.localeCompare(b),
              );
              const newPKEntries = Object.entries(updatePayload.primaryKeys).sort(([a], [b]) =>
                a.localeCompare(b),
              );

              const existingPKSig = existingPKEntries
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join("|");
              const newPKSig = newPKEntries
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join("|");

              return existingPKSig === newPKSig;
            });

            if (existingUpdateIndex >= 0) {
              const oldCommand = currentCommands[existingUpdateIndex];
              const nextCommands = [...currentCommands];
              nextCommands[existingUpdateIndex] = command;
              stagedCommands.set(tableKey, nextCommands);
              commandIndex.set(command.id, tableKey);
              if (oldCommand) {
                commandIndex.delete(oldCommand.id);
              }
            } else {
              const nextCommands = [...currentCommands, command];
              stagedCommands.set(tableKey, nextCommands);
              commandIndex.set(command.id, tableKey);
            }
          } else {
            // Default behavior for INSERT, DELETE, and other commands
            const currentCommands = stagedCommands.get(tableKey) ?? [];
            const nextCommands = currentCommands.some((item) => item.id === command.id)
              ? currentCommands.map((item) => (item.id === command.id ? command : item))
              : [...currentCommands, command];
            stagedCommands.set(tableKey, nextCommands);
            commandIndex.set(command.id, tableKey);
          }

          results.push({ command });
        }

        // Push only ONE history snapshot for the entire batch
        const snapshot = cloneStagedCommands(stagedCommands);
        const { history, historyIndex } = pushHistorySnapshot(
          state.history,
          state.historyIndex,
          snapshot,
        );

        return {
          stagedCommands,
          commandIndex,
          history,
          historyIndex,
          isDirty: stagedCommands.size > 0,
        };
      });

      return results;
    },

    unstageCommand: (commandId) => {
      set((state) => {
        const tableKey = state.commandIndex.get(commandId);
        if (!tableKey) {
          return state;
        }

        const stagedCommands = cloneStagedCommands(state.stagedCommands);
        const commandIndex = new Map(state.commandIndex);

        const existing = stagedCommands.get(tableKey);
        if (!existing) {
          commandIndex.delete(commandId);
          return {
            stagedCommands,
            commandIndex,
            history: state.history,
            historyIndex: state.historyIndex,
            isDirty: stagedCommands.size > 0,
          };
        }

        const filtered = existing.filter((command) => command.id !== commandId);
        if (filtered.length > 0) {
          stagedCommands.set(tableKey, filtered);
        } else {
          stagedCommands.delete(tableKey);
        }
        commandIndex.delete(commandId);

        const snapshot = cloneStagedCommands(stagedCommands);
        const { history, historyIndex } = pushHistorySnapshot(
          state.history,
          state.historyIndex,
          snapshot,
        );

        return {
          stagedCommands,
          commandIndex,
          history,
          historyIndex,
          isDirty: stagedCommands.size > 0,
        };
      });
    },

    unstageCommands: (commandIds) => {
      if (commandIds.length === 0) return;

      set((state) => {
        const stagedCommands = cloneStagedCommands(state.stagedCommands);
        const commandIndex = new Map(state.commandIndex);

        for (const commandId of commandIds) {
          const tableKey = commandIndex.get(commandId);
          if (!tableKey) continue;

          const existing = stagedCommands.get(tableKey);
          if (!existing) {
            commandIndex.delete(commandId);
            continue;
          }

          const filtered = existing.filter((command) => command.id !== commandId);
          if (filtered.length > 0) {
            stagedCommands.set(tableKey, filtered);
          } else {
            stagedCommands.delete(tableKey);
          }
          commandIndex.delete(commandId);
        }

        // Push only ONE history snapshot for the entire batch
        const snapshot = cloneStagedCommands(stagedCommands);
        const { history, historyIndex } = pushHistorySnapshot(
          state.history,
          state.historyIndex,
          snapshot,
        );

        return {
          stagedCommands,
          commandIndex,
          history,
          historyIndex,
          isDirty: stagedCommands.size > 0,
        };
      });
    },

    discardChanges: (tableKey) => {
      set((state) => {
        if (!state.stagedCommands.has(tableKey)) {
          return state;
        }

        const stagedCommands = cloneStagedCommands(state.stagedCommands);
        const commandIndex = new Map(state.commandIndex);

        const removed = stagedCommands.get(tableKey) ?? [];
        stagedCommands.delete(tableKey);
        removed.forEach((command) => {
          commandIndex.delete(command.id);
        });

        // Reset history after discard - discarded changes should not be recoverable
        const snapshot = cloneStagedCommands(stagedCommands);

        return {
          stagedCommands,
          commandIndex,
          history: [snapshot],
          historyIndex: 0,
          isDirty: stagedCommands.size > 0,
        };
      });
    },

    discardAll: () => {
      set((state) => {
        if (state.stagedCommands.size === 0) {
          return state;
        }

        // Reset to empty state with fresh history
        const emptyState = emptySnapshot();

        return {
          stagedCommands: new Map<string, CrudCommand[]>(),
          commandIndex: new Map<string, string>(),
          history: [emptyState],
          historyIndex: 0,
          isDirty: false,
        };
      });
    },

    commitChanges: async (tableKey) => {
      const commands = get().stagedCommands.get(tableKey) ?? [];
      if (commands.length === 0) {
        return {
          transactionId: "",
          success: true,
          durationMs: 0,
          committed: [],
          failures: [],
        } satisfies CommitResult;
      }

      const { connectionId } = commands[0]?.target ?? {};
      if (!connectionId) {
        logger.error("Commands:", commands);
        throw new Error("CrudStore: Missing connectionId for staged commands");
      }

      // Mark table as committing (for optimistic updates)
      set((state) => ({
        committingTableKeys: new Set(state.committingTableKeys).add(tableKey),
      }));

      logger.info("[CrudStore] Calling executeCrudTransaction with connectionId:", connectionId);
      logger.info("[CrudStore] Commands count:", commands.length);
      logger.info("[CrudStore] Commands to commit:", commands);

      try {
        const result = await BackendAPI.executeCrudTransaction(
          connectionId,
          commands,
        );

        logger.info("[CrudStore] Backend execution result:", result);

        // Check if transaction was successful
        if (!result.success) {
          // Unmark as committing on failure
          set((state) => {
            const committingTableKeys = new Set(state.committingTableKeys);
            committingTableKeys.delete(tableKey);
            return { committingTableKeys };
          });

          // Format error message from failures
          const errorMessages = result.failures
            .map((f) => f.error.message)
            .join(", ");
          throw new Error(errorMessages || "Transaction failed");
        }

        // SUCCESS: Keep staged commands for optimistic display
        // They will be cleared after refetch completes via clearCommittedChanges()
        logger.info("[CrudStore] Commit succeeded, keeping staged commands for optimistic display");

        return result;
      } catch (error) {
        // Unmark as committing on error
        set((state) => {
          const committingTableKeys = new Set(state.committingTableKeys);
          committingTableKeys.delete(tableKey);
          return { committingTableKeys };
        });
        throw error;
      }
    },

    clearCommittedChanges: (tableKey) => {
      logger.info("[CrudStore] Clearing committed changes for:", tableKey);
      set((state) => {
        const stagedCommands = cloneStagedCommands(state.stagedCommands);
        const commandIndex = new Map(state.commandIndex);
        const committingTableKeys = new Set(state.committingTableKeys);

        const commands = stagedCommands.get(tableKey) ?? [];
        stagedCommands.delete(tableKey);
        commands.forEach((command) => {
          commandIndex.delete(command.id);
        });
        committingTableKeys.delete(tableKey);

        // Reset history after commit - committed changes should not be undoable
        // Create a fresh history with current state as the only entry
        const snapshot = cloneStagedCommands(stagedCommands);

        return {
          stagedCommands,
          commandIndex,
          history: [snapshot],
          historyIndex: 0,
          isDirty: stagedCommands.size > 0,
          committingTableKeys,
        };
      });
    },

    commitAll: async () => {
      const tableKeys = Array.from(get().stagedCommands.keys());
      const results: Record<string, CommitResult> = {};
      for (const tableKey of tableKeys) {
        results[tableKey] = await get().commitChanges(tableKey);
      }
      return results;
    },

    undo: () => {
      set((state) => {
        if (state.historyIndex <= 0) {
          return state;
        }

        const targetIndex = state.historyIndex - 1;
        const historySnapshot = state.history[targetIndex];
        if (!historySnapshot) {
          return state;
        }
        const snapshot = cloneStagedCommands(historySnapshot);
        const commandIndex = rebuildCommandIndex(snapshot);

        return {
          stagedCommands: snapshot,
          commandIndex,
          history: state.history,
          historyIndex: targetIndex,
          isDirty: snapshot.size > 0,
        };
      });
    },

    redo: () => {
      set((state) => {
        if (state.historyIndex >= state.history.length - 1) {
          return state;
        }

        const targetIndex = state.historyIndex + 1;
        const historySnapshot = state.history[targetIndex];
        if (!historySnapshot) {
          return state;
        }
        const snapshot = cloneStagedCommands(historySnapshot);
        const commandIndex = rebuildCommandIndex(snapshot);

        return {
          stagedCommands: snapshot,
          commandIndex,
          history: state.history,
          historyIndex: targetIndex,
          isDirty: snapshot.size > 0,
        };
      });
    },

    getTableKey: (target) => createTableKey(target),

    getStagedCommands: (tableKey) =>
      get().stagedCommands.get(tableKey) ?? [],

    isCommitting: (tableKey) => get().committingTableKeys.has(tableKey),
  };
});

export const crudSelectors = {
  hasStagedChanges: (state: CrudStoreState) => state.stagedCommands.size > 0,
  canUndo: (state: CrudStoreState) => state.historyIndex > 0,
  canRedo: (state: CrudStoreState) =>
    state.historyIndex < state.history.length - 1,
  getTableKeys: (state: CrudStoreState) =>
    Array.from(state.stagedCommands.keys()),
};

export const buildCrudTableKey = createTableKey;

