import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCrudStore, crudSelectors, buildCrudTableKey } from "../crudStore";
import { BackendAPI } from "@/services/backend";
import type {
  CrudCommand,
  CrudCommandTarget,
  CommitResult,
} from "@/types/crud";

// Mock BackendAPI
vi.mock("@/services/backend", () => ({
  BackendAPI: {
    executeCrudTransaction: vi.fn(),
  },
}));

describe("crudStore", () => {
  const mockTarget: CrudCommandTarget = {
    connectionId: "conn-1",
    database: "testdb",
    schema: "public",
    table: "users",
  };

  const mockCommand: CrudCommand = {
    id: "cmd-1",
    type: "data.insert",
    target: mockTarget,
    payload: { values: { name: "John Doe" } },
    metadata: { timestamp: new Date().toISOString() },
    state: "staged",
  };

  const mockTarget2: CrudCommandTarget = {
    connectionId: "conn-1",
    database: "testdb",
    schema: "public",
    table: "posts",
  };

  const mockCommand2: CrudCommand = {
    id: "cmd-2",
    type: "data.update",
    target: mockTarget2,
    payload: { column: "title", primaryKeys: { id: 1 }, newValue: "Updated Post" },
    metadata: { timestamp: new Date().toISOString() },
    state: "staged",
  };

  beforeEach(() => {
    // Reset store to initial state
    useCrudStore.setState({
      stagedCommands: new Map(),
      commandIndex: new Map(),
      history: [new Map()],
      historyIndex: 0,
      previewMode: "split",
      isDirty: false,
    });
    vi.clearAllMocks();
  });

  describe("Command Staging", () => {
    it("should stage a single command", () => {
      const store = useCrudStore.getState();
      const result = store.stageCommand(mockCommand);

      expect(result.command).toEqual(mockCommand);

      const state = useCrudStore.getState();
      const tableKey = store.getTableKey(mockTarget);
      const commands = state.stagedCommands.get(tableKey);

      expect(commands).toHaveLength(1);
      expect(commands?.[0]).toEqual(mockCommand);
      expect(state.commandIndex.get(mockCommand.id)).toBe(tableKey);
      expect(state.isDirty).toBe(true);
    });

    it("should stage multiple commands", () => {
      const store = useCrudStore.getState();
      const commands = [mockCommand, mockCommand2];
      const results = store.stageCommands(commands);

      expect(results).toHaveLength(2);

      const state = useCrudStore.getState();
      expect(state.stagedCommands.size).toBe(2);
      expect(state.commandIndex.size).toBe(2);
      expect(state.isDirty).toBe(true);
    });

    it("should update existing command when staging with same id", () => {
      const store = useCrudStore.getState();

      // Stage initial command
      store.stageCommand(mockCommand);

      // Stage updated command with same id
      const updatedCommand = {
        ...mockCommand,
        payload: { name: "Jane Doe" },
      };
      store.stageCommand(updatedCommand);

      const state = useCrudStore.getState();
      const tableKey = store.getTableKey(mockTarget);
      const commands = state.stagedCommands.get(tableKey);

      expect(commands).toHaveLength(1);
      expect(commands?.[0]?.payload).toEqual({ name: "Jane Doe" });
    });

    it("should create history snapshot when staging command", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);

      const state = useCrudStore.getState();
      expect(state.history.length).toBe(2); // initial + 1 snapshot
      expect(state.historyIndex).toBe(1);
    });

    it("should group commands by table key", () => {
      const store = useCrudStore.getState();

      const cmd1 = { ...mockCommand, id: "cmd-1" };
      const cmd2 = { ...mockCommand, id: "cmd-2" };
      const cmd3 = { ...mockCommand2, id: "cmd-3" };

      store.stageCommand(cmd1);
      store.stageCommand(cmd2);
      store.stageCommand(cmd3);

      const state = useCrudStore.getState();
      const tableKey1 = store.getTableKey(mockTarget);
      const tableKey2 = store.getTableKey(mockTarget2);

      expect(state.stagedCommands.get(tableKey1)).toHaveLength(2);
      expect(state.stagedCommands.get(tableKey2)).toHaveLength(1);
    });
  });

  describe("Command Unstaging", () => {
    it("should unstage a command", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.unstageCommand(mockCommand.id);

      const state = useCrudStore.getState();
      const tableKey = store.getTableKey(mockTarget);

      expect(state.stagedCommands.get(tableKey)).toBeUndefined();
      expect(state.commandIndex.get(mockCommand.id)).toBeUndefined();
      expect(state.isDirty).toBe(false);
    });

    it("should handle unstaging non-existent command", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.unstageCommand("non-existent-id");

      const state = useCrudStore.getState();
      const tableKey = store.getTableKey(mockTarget);
      const commands = state.stagedCommands.get(tableKey);

      expect(commands).toHaveLength(1);
      expect(state.isDirty).toBe(true);
    });

    it("should remove table entry when last command is unstaged", () => {
      const store = useCrudStore.getState();

      const cmd1 = { ...mockCommand, id: "cmd-1" };
      const cmd2 = { ...mockCommand, id: "cmd-2" };

      store.stageCommand(cmd1);
      store.stageCommand(cmd2);

      store.unstageCommand("cmd-1");

      const state1 = useCrudStore.getState();
      const tableKey = store.getTableKey(mockTarget);
      expect(state1.stagedCommands.get(tableKey)).toHaveLength(1);

      store.unstageCommand("cmd-2");

      const state2 = useCrudStore.getState();
      expect(state2.stagedCommands.has(tableKey)).toBe(false);
      expect(state2.isDirty).toBe(false);
    });

    it("should create history snapshot when unstaging", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      const historyLengthBefore = useCrudStore.getState().history.length;

      store.unstageCommand(mockCommand.id);

      const state = useCrudStore.getState();
      expect(state.history.length).toBe(historyLengthBefore + 1);
    });
  });

  describe("Discard Changes", () => {
    it("should discard changes for specific table", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.stageCommand(mockCommand2);

      const tableKey1 = store.getTableKey(mockTarget);
      store.discardChanges(tableKey1);

      const state = useCrudStore.getState();
      expect(state.stagedCommands.has(tableKey1)).toBe(false);
      expect(state.stagedCommands.size).toBe(1);
      expect(state.isDirty).toBe(true); // Still dirty because mockCommand2 remains
    });

    it("should handle discarding non-existent table", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.discardChanges("non-existent-table-key");

      const state = useCrudStore.getState();
      expect(state.stagedCommands.size).toBe(1);
    });

    it("should discard all changes", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.stageCommand(mockCommand2);

      store.discardAll();

      const state = useCrudStore.getState();
      expect(state.stagedCommands.size).toBe(0);
      expect(state.commandIndex.size).toBe(0);
      expect(state.isDirty).toBe(false);
    });

    it("should handle discardAll when no changes exist", () => {
      const store = useCrudStore.getState();

      store.discardAll();

      const state = useCrudStore.getState();
      expect(state.stagedCommands.size).toBe(0);
      expect(state.isDirty).toBe(false);
    });

    it("should reset history when discarding (discarded changes not recoverable)", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      expect(useCrudStore.getState().history.length).toBe(2);

      store.discardAll();

      const state = useCrudStore.getState();
      // History is reset to 1 entry (empty state) - discarded changes should not be undoable
      expect(state.history.length).toBe(1);
      expect(state.historyIndex).toBe(0);
    });
  });

  describe("Undo/Redo", () => {
    it("should undo staged command", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      expect(useCrudStore.getState().stagedCommands.size).toBe(1);

      store.undo();

      const state = useCrudStore.getState();
      expect(state.stagedCommands.size).toBe(0);
      expect(state.historyIndex).toBe(0);
      expect(state.isDirty).toBe(false);
    });

    it("should redo unstaged command", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.undo();

      expect(useCrudStore.getState().stagedCommands.size).toBe(0);

      store.redo();

      const state = useCrudStore.getState();
      expect(state.stagedCommands.size).toBe(1);
      expect(state.isDirty).toBe(true);
    });

    it("should not undo beyond initial state", () => {
      const store = useCrudStore.getState();

      store.undo(); // Try to undo when at initial state

      const state = useCrudStore.getState();
      expect(state.historyIndex).toBe(0);
    });

    it("should not redo beyond current state", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.redo(); // Try to redo when at latest state

      const state = useCrudStore.getState();
      expect(state.historyIndex).toBe(1);
    });

    it("should handle multiple undo/redo operations", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.stageCommand(mockCommand2);

      expect(useCrudStore.getState().historyIndex).toBe(2);

      store.undo();
      expect(useCrudStore.getState().historyIndex).toBe(1);

      store.undo();
      expect(useCrudStore.getState().historyIndex).toBe(0);

      store.redo();
      expect(useCrudStore.getState().historyIndex).toBe(1);

      store.redo();
      expect(useCrudStore.getState().historyIndex).toBe(2);
    });

    it("should rebuild command index after undo", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      expect(useCrudStore.getState().commandIndex.has(mockCommand.id)).toBe(
        true,
      );

      store.undo();
      expect(useCrudStore.getState().commandIndex.has(mockCommand.id)).toBe(
        false,
      );

      store.redo();
      expect(useCrudStore.getState().commandIndex.has(mockCommand.id)).toBe(
        true,
      );
    });

    it("should clear future history when staging after undo", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.stageCommand(mockCommand2);
      store.undo();

      expect(useCrudStore.getState().history.length).toBe(3);

      // Stage new command after undo
      const newCommand = { ...mockCommand, id: "cmd-3" };
      store.stageCommand(newCommand);

      const state = useCrudStore.getState();
      expect(state.history.length).toBe(3); // Should truncate future history
    });
  });

  describe("History Limit", () => {
    it("should enforce 100 history limit", () => {
      const store = useCrudStore.getState();

      // Stage 102 commands to exceed limit
      for (let i = 0; i < 102; i++) {
        const cmd = {
          ...mockCommand,
          id: `cmd-${i}`,
        };
        store.stageCommand(cmd);
      }

      const state = useCrudStore.getState();
      expect(state.history.length).toBe(100);
      expect(state.historyIndex).toBe(99);
    });
  });

  describe("Commit Changes", () => {
    it("should commit changes successfully", async () => {
      const store = useCrudStore.getState();

      const mockResult: CommitResult = {
        transactionId: "tx-1",
        success: true,
        durationMs: 50,
        committed: [mockCommand],
        failures: [],
      };

      vi.mocked(BackendAPI.executeCrudTransaction).mockResolvedValue(
        mockResult,
      );

      store.stageCommand(mockCommand);
      const tableKey = store.getTableKey(mockTarget);

      const result = await store.commitChanges(tableKey);

      expect(result.success).toBe(true);
      expect(BackendAPI.executeCrudTransaction).toHaveBeenCalledWith(
        "conn-1",
        [mockCommand],
      );

      // Commands are kept for optimistic display until clearCommittedChanges is called
      store.clearCommittedChanges(tableKey);

      const state = useCrudStore.getState();
      expect(state.stagedCommands.has(tableKey)).toBe(false);
      expect(state.commandIndex.has(mockCommand.id)).toBe(false);
      expect(state.isDirty).toBe(false);
    });

    it("should handle commit failure", async () => {
      const store = useCrudStore.getState();

      const mockResult: CommitResult = {
        transactionId: "tx-1",
        success: false,
        durationMs: 50,
        committed: [],
        failures: [
          {
            id: mockCommand.id,
            type: mockCommand.type,
            target: mockCommand.target,
            error: { message: "Constraint violation", code: "23505", severity: "error", recoverable: false },
            rolledBack: true,
          },
        ],
      };

      vi.mocked(BackendAPI.executeCrudTransaction).mockResolvedValue(
        mockResult,
      );

      store.stageCommand(mockCommand);
      const tableKey = store.getTableKey(mockTarget);

      await expect(store.commitChanges(tableKey)).rejects.toThrow(
        "Constraint violation",
      );

      // Staged commands should remain on failure
      const state = useCrudStore.getState();
      expect(state.stagedCommands.has(tableKey)).toBe(true);
    });

    it("should return success for empty table", async () => {
      const store = useCrudStore.getState();

      const result = await store.commitChanges("non-existent-table");

      expect(result.success).toBe(true);
      expect(result.committed).toEqual([]);
      expect(BackendAPI.executeCrudTransaction).not.toHaveBeenCalled();
    });

    it("should commit all tables", async () => {
      const store = useCrudStore.getState();

      const mockResult1: CommitResult = {
        transactionId: "tx-1",
        success: true,
        durationMs: 50,
        committed: [mockCommand],
        failures: [],
      };

      const mockResult2: CommitResult = {
        transactionId: "tx-2",
        success: true,
        durationMs: 60,
        committed: [mockCommand2],
        failures: [],
      };

      vi.mocked(BackendAPI.executeCrudTransaction)
        .mockResolvedValueOnce(mockResult1)
        .mockResolvedValueOnce(mockResult2);

      store.stageCommand(mockCommand);
      store.stageCommand(mockCommand2);

      const tableKey1 = store.getTableKey(mockTarget);
      const tableKey2 = store.getTableKey(mockTarget2);

      const results = await store.commitAll();

      expect(Object.keys(results)).toHaveLength(2);
      expect(BackendAPI.executeCrudTransaction).toHaveBeenCalledTimes(2);

      // Commands are kept for optimistic display until clearCommittedChanges is called
      store.clearCommittedChanges(tableKey1);
      store.clearCommittedChanges(tableKey2);

      const state = useCrudStore.getState();
      expect(state.stagedCommands.size).toBe(0);
      expect(state.isDirty).toBe(false);
    });

    it("should create history snapshot after clearCommittedChanges", async () => {
      const store = useCrudStore.getState();

      const mockResult: CommitResult = {
        transactionId: "tx-1",
        success: true,
        durationMs: 50,
        committed: [mockCommand],
        failures: [],
      };

      vi.mocked(BackendAPI.executeCrudTransaction).mockResolvedValue(
        mockResult,
      );

      store.stageCommand(mockCommand);
      const tableKey = store.getTableKey(mockTarget);

      await store.commitChanges(tableKey);

      // clearCommittedChanges resets history (committed changes not undoable)
      store.clearCommittedChanges(tableKey);

      const state = useCrudStore.getState();
      // History is reset to 1 entry - committed changes should not be undoable
      expect(state.history.length).toBe(1);
      expect(state.historyIndex).toBe(0);
    });
  });

  describe("Table Key Generation", () => {
    it("should generate consistent table keys", () => {
      const store = useCrudStore.getState();

      const key1 = store.getTableKey(mockTarget);
      const key2 = store.getTableKey(mockTarget);

      expect(key1).toBe(key2);
      expect(key1).toBe("conn-1:testdb:public:users");
    });

    it("should generate different keys for different tables", () => {
      const store = useCrudStore.getState();

      const key1 = store.getTableKey(mockTarget);
      const key2 = store.getTableKey(mockTarget2);

      expect(key1).not.toBe(key2);
    });

    it("should handle missing database/schema/table", () => {
      const store = useCrudStore.getState();

      const targetWithMissing: CrudCommandTarget = {
        connectionId: "conn-1",
      };

      const key = store.getTableKey(targetWithMissing);
      expect(key).toBe("conn-1:::");
    });

    it("should use exported buildCrudTableKey function", () => {
      const key = buildCrudTableKey(mockTarget);
      expect(key).toBe("conn-1:testdb:public:users");
    });
  });

  describe("Get Staged Commands", () => {
    it("should get staged commands for table", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      const tableKey = store.getTableKey(mockTarget);

      const commands = store.getStagedCommands(tableKey);

      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual(mockCommand);
    });

    it("should return empty array for non-existent table", () => {
      const store = useCrudStore.getState();

      const commands = store.getStagedCommands("non-existent-table");

      expect(commands).toEqual([]);
    });
  });

  describe("Selectors", () => {
    it("should check if has staged changes", () => {
      const store = useCrudStore.getState();

      let state = useCrudStore.getState();
      expect(crudSelectors.hasStagedChanges(state)).toBe(false);

      store.stageCommand(mockCommand);

      state = useCrudStore.getState();
      expect(crudSelectors.hasStagedChanges(state)).toBe(true);
    });

    it("should check if can undo", () => {
      const store = useCrudStore.getState();

      let state = useCrudStore.getState();
      expect(crudSelectors.canUndo(state)).toBe(false);

      store.stageCommand(mockCommand);

      state = useCrudStore.getState();
      expect(crudSelectors.canUndo(state)).toBe(true);
    });

    it("should check if can redo", () => {
      const store = useCrudStore.getState();

      let state = useCrudStore.getState();
      expect(crudSelectors.canRedo(state)).toBe(false);

      store.stageCommand(mockCommand);
      store.undo();

      state = useCrudStore.getState();
      expect(crudSelectors.canRedo(state)).toBe(true);
    });

    it("should get all table keys", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.stageCommand(mockCommand2);

      const state = useCrudStore.getState();
      const keys = crudSelectors.getTableKeys(state);

      expect(keys).toHaveLength(2);
      expect(keys).toContain("conn-1:testdb:public:users");
      expect(keys).toContain("conn-1:testdb:public:posts");
    });
  });

  describe("Dirty State", () => {
    it("should set dirty when commands are staged", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);

      expect(useCrudStore.getState().isDirty).toBe(true);
    });

    it("should clear dirty when all commands are removed", () => {
      const store = useCrudStore.getState();

      store.stageCommand(mockCommand);
      store.unstageCommand(mockCommand.id);

      expect(useCrudStore.getState().isDirty).toBe(false);
    });

    it("should remain dirty when some commands remain", () => {
      const store = useCrudStore.getState();

      const cmd1 = { ...mockCommand, id: "cmd-1" };
      const cmd2 = { ...mockCommand, id: "cmd-2" };

      store.stageCommand(cmd1);
      store.stageCommand(cmd2);
      store.unstageCommand("cmd-1");

      expect(useCrudStore.getState().isDirty).toBe(true);
    });
  });
});
