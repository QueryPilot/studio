import { nanoid } from "nanoid";
import { create } from "zustand";

import { logger } from "@/lib/logger";
import { getOperationExecutor } from "@/services/operationExecutors";
import type {
  CommitResult,
  CrudCommand,
  CrudCommandTarget,
  StageCommandResult,
} from "@/types/crud";
import { useConnectionStore } from "./connectionStoreNew";

const HISTORY_LIMIT = 100;

type CrudHistorySnapshot = Map<string, CrudCommand[]>;

const createTableKey = (target: CrudCommandTarget): string => {
  const { connectionId, database = "", schema, table = "" } = target;
  const normalizedSchema =
    typeof schema === "string" && schema.trim().length > 0 ? schema : "public";
  return [connectionId, database, normalizedSchema, table].join(":");
};

/** Deep-clone all tables' command arrays (used for history snapshots). */
const cloneStagedCommands = (
  staged: Map<string, CrudCommand[]>,
): CrudHistorySnapshot =>
  new Map(
    Array.from(staged.entries(), ([key, commands]) => [key, [...commands]]),
  );

/**
 * Shallow-clone the map, deep-clone only the changed table's array.
 * All other tables share their existing array references.
 * This reduces clone cost from O(total_commands_all_tables) to O(changed_table_commands).
 */
const cloneStagedCommandsForTable = (
  staged: Map<string, CrudCommand[]>,
  changedTableKey: string,
): CrudHistorySnapshot => {
  const snapshot = new Map(staged);
  const cmds = staged.get(changedTableKey);
  if (cmds) snapshot.set(changedTableKey, [...cmds]);
  return snapshot;
};

/** Compute a dedup key for an UPDATE command: "pkSig:columnName" */
const computeUpdateDedupKey = (
  primaryKeys: Record<string, unknown>,
  column: string,
): string => {
  const pkSig = Object.entries(primaryKeys)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("|");
  return `${pkSig}:${column}`;
};

/** Build a temporary Map from dedup key -> index for O(1) UPDATE dedup lookup */
const buildUpdateDedupIndex = (
  commands: CrudCommand[],
): Map<string, number> => {
  const index = new Map<string, number>();
  commands.forEach((cmd, idx) => {
    if (cmd.type !== "data.update") return;
    const p = cmd.payload as {
      primaryKeys?: Record<string, unknown>;
      column?: string;
    };
    if (p.primaryKeys && p.column) {
      index.set(computeUpdateDedupKey(p.primaryKeys, p.column), idx);
    }
  });
  return index;
};

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
  isCommittingAll: boolean; // Track global commit-all state (for Cmd+S)

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
  setIsCommittingAll: (value: boolean) => void;
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
    isCommittingAll: false,

    setIsCommittingAll: (value: boolean) => {
      set({ isCommittingAll: value });
    },

    stageCommand: (command) => {
      let result: StageCommandResult | undefined;
      set((state) => {
        const tableKey = createTableKey(command.target);
        // Structural sharing: shallow-clone map, deep-clone only the target table's array.
        // Other tables share their existing array references → O(changed_table) not O(all_tables).
        const stagedCommands = cloneStagedCommandsForTable(state.stagedCommands, tableKey);
        const commandIndex = new Map(state.commandIndex);

        const previousTableKey = commandIndex.get(command.id);
        if (previousTableKey && previousTableKey !== tableKey) {
          // Cross-table move: deep-clone the previous table too
          const prevCmds = state.stagedCommands.get(previousTableKey);
          if (prevCmds) {
            const filtered = prevCmds.filter((item) => item.id !== command.id);
            if (filtered.length > 0) {
              stagedCommands.set(previousTableKey, filtered);
            } else {
              stagedCommands.delete(previousTableKey);
            }
          }
          commandIndex.delete(command.id);
        }

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

              const snapshot = cloneStagedCommandsForTable(stagedCommands, tableKey);
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

          // Build temp index for O(1) lookup of existing UPDATE commands
          const updateDedupIndex = buildUpdateDedupIndex(existing);

          // Find existing UPDATE command for the same cell (same PK + column)
          const existingUpdateIndex =
            updatePayload.primaryKeys && updatePayload.column
              ? (updateDedupIndex.get(
                  computeUpdateDedupKey(updatePayload.primaryKeys, updatePayload.column),
                ) ?? -1)
              : -1;

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

        const snapshot = cloneStagedCommandsForTable(stagedCommands, tableKey);
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

        // cloneStagedCommands already deep-clones all arrays, so we can
        // safely mutate them in-place (.push, [idx]=) instead of spreading
        // new arrays on every iteration. This turns O(N²) into O(N).

        // Per-table lazy caches for O(1) lookups (built once, maintained incrementally).
        const tableIdMaps = new Map<string, Map<string, number>>();
        const tableUpdateDedupMaps = new Map<string, Map<string, number>>();
        const getIdMap = (key: string): Map<string, number> => {
          let m = tableIdMaps.get(key);
          if (!m) {
            const newMap = new Map<string, number>();
            const cmds = stagedCommands.get(key);
            if (cmds) cmds.forEach((c, i) => newMap.set(c.id, i));
            tableIdMaps.set(key, newMap);
            m = newMap;
          }
          return m;
        };
        const getUpdateDedupMap = (key: string): Map<string, number> => {
          let m = tableUpdateDedupMaps.get(key);
          if (!m) {
            m = buildUpdateDedupIndex(stagedCommands.get(key) ?? []);
            tableUpdateDedupMaps.set(key, m);
          }
          return m;
        };
        const ensureArray = (key: string): CrudCommand[] => {
          let arr = stagedCommands.get(key);
          if (!arr) { arr = []; stagedCommands.set(key, arr); }
          return arr;
        };

        for (const command of commands) {
          const tableKey = createTableKey(command.target);
          const previousTableKey = commandIndex.get(command.id);
          if (previousTableKey && previousTableKey !== tableKey) {
            const previousCommands = stagedCommands.get(previousTableKey) ?? [];
            const filtered = previousCommands.filter((item) => item.id !== command.id);
            if (filtered.length > 0) {
              stagedCommands.set(previousTableKey, filtered);
            } else {
              stagedCommands.delete(previousTableKey);
            }
            tableIdMaps.delete(previousTableKey); // invalidate stale caches
            tableUpdateDedupMaps.delete(previousTableKey);
            commandIndex.delete(command.id);
          }

          const currentCommands = ensureArray(tableKey);
          const idMap = getIdMap(tableKey);

          // Handle UPDATE commands on inserted rows
          if (command.type === "data.update") {
            const updatePayload = command.payload as { tempId?: string; column?: string; newValue?: unknown };
            if (updatePayload.tempId) {
              const insertIdx = currentCommands.findIndex((cmd) => {
                if (cmd.type !== "data.insert") return false;
                const insertPayload = cmd.payload as { tempId?: string };
                return insertPayload.tempId === updatePayload.tempId;
              });

              const insertCommand = insertIdx >= 0 ? currentCommands[insertIdx] : undefined;
              if (insertCommand && updatePayload.column) {
                const insertPayload = insertCommand.payload as { values?: Record<string, unknown>; tempId?: string };
                const updatedInsertCommand: CrudCommand = {
                  ...insertCommand,
                  payload: {
                    ...insertPayload,
                    values: {
                      ...(insertPayload.values ?? {}),
                      [updatePayload.column]: updatePayload.newValue,
                    },
                  },
                };

                currentCommands[insertIdx] = updatedInsertCommand; // mutate in-place
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

            // Use cached per-table dedup index (built once, maintained incrementally)
            const updateDedupMap = getUpdateDedupMap(tableKey);
            const dedupKey =
              updatePayload.primaryKeys && updatePayload.column
                ? computeUpdateDedupKey(updatePayload.primaryKeys, updatePayload.column)
                : null;

            const existingUpdateIndex = dedupKey
              ? (updateDedupMap.get(dedupKey) ?? -1)
              : -1;

            if (existingUpdateIndex >= 0) {
              const oldCommand = currentCommands[existingUpdateIndex];
              currentCommands[existingUpdateIndex] = command; // mutate in-place
              // Update dedup map: new command replaces at same index
              if (dedupKey) updateDedupMap.set(dedupKey, existingUpdateIndex);
              idMap.set(command.id, existingUpdateIndex);
              commandIndex.set(command.id, tableKey);
              if (oldCommand) {
                idMap.delete(oldCommand.id);
                commandIndex.delete(oldCommand.id);
              }
            } else {
              const newIdx = currentCommands.length;
              currentCommands.push(command); // mutate in-place
              if (dedupKey) updateDedupMap.set(dedupKey, newIdx);
              idMap.set(command.id, newIdx);
              commandIndex.set(command.id, tableKey);
            }
          } else {
            // Default: INSERT, DELETE, and other commands — O(1) via idMap
            const existingIdx = idMap.get(command.id);
            if (existingIdx !== undefined) {
              currentCommands[existingIdx] = command; // replace in-place
            } else {
              idMap.set(command.id, currentCommands.length);
              currentCommands.push(command); // append in-place
            }
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
      const transactionId = nanoid();
      const startTime = performance.now();

      if (commands.length === 0) {
        return {
          transactionId,
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

      // Get dbType from connection store
      const connection = useConnectionStore.getState().getConnection(connectionId);
      if (!connection) {
        throw new Error(`CrudStore: Connection not found: ${connectionId}`);
      }
      const dbType = connection.profile.db_type;

      // Mark table as committing (for optimistic updates)
      set((state) => ({
        committingTableKeys: new Set(state.committingTableKeys).add(tableKey),
      }));

      try {
        // Get operation executor for this connection
        const executor = await getOperationExecutor(connectionId, dbType);

        logger.info("[CrudStore] Executing commands via executor:", {
          connectionId,
          commandCount: commands.length,
          paradigm: executor.paradigm,
        });

        // Execute via executor
        const execResult = await executor.execute(commands);

        if (!execResult.success) {
          throw new Error(execResult.errors[0]?.message ?? "Execution failed");
        }

        const durationMs = Math.round(performance.now() - startTime);

        // Build success result
        const result: CommitResult = {
          transactionId,
          success: true,
          durationMs,
          committed: commands.map((cmd) => ({
            id: cmd.id,
            type: cmd.type,
            target: cmd.target,
            description: cmd.metadata.description,
            affectedRows: cmd.metadata.affectedRows,
          })),
          failures: [],
        };

        logger.info("[CrudStore] Commit succeeded:", result);

        // SUCCESS: Keep staged commands for optimistic display
        // They will be cleared after refetch completes via clearCommittedChanges()
        return result;
      } catch (error) {
        // Unmark as committing on error
        set((state) => {
          const committingTableKeys = new Set(state.committingTableKeys);
          committingTableKeys.delete(tableKey);
          return { committingTableKeys };
        });

        // Log failure and rethrow
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("[CrudStore] Commit failed:", errorMessage);

        throw new Error(errorMessage);
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
