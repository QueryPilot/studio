/**
 * AI Command Executor Tests
 *
 * Tests for the command execution layer that handles mutation and UI commands.
 * Note: Read commands (SQL, MongoDB, Redis) have been removed - AI uses MCP tools.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  executeCommand,
  formatResultForConversation,
  executeCommandWithTimeout,
  executeCommandsInParallel,
  formatBatchedResultsForAgent,
  type CommandResult,
  type BatchExecutionResult,
} from "../aiCommandExecutor";
import type {
  ParsedCommand,
  CrudStageParams,
  TabUpdateParams,
  TabCreateParams,
  EditorInsertParams,
} from "@/types/aiCommands";

// Mock Tauri invoke (still needed for potential future use)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock nanoid for predictable IDs
vi.mock("nanoid", () => ({
  nanoid: () => "test-generated-id",
}));

// Mock stores
vi.mock("@/stores/crudStore", () => ({
  useCrudStore: {
    getState: () => ({
      getTableKey: vi.fn(() => "conn:db:schema:table"),
      stageCommand: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [
        { profile: { id: "test-conn-id", name: "Test Connection" } },
      ],
    }),
  },
}));

vi.mock("@/stores/workspaceScreenStore", () => ({
  useWorkspaceScreenStore: {
    getState: () => ({
      activeConnectionId: "test-conn-id",
      workspaces: new Map([
        [
          "test-conn-id",
          {
            panels: new Map([
              [
                "panel-1",
                {
                  activeTabId: "tab-1",
                  tabs: new Map([
                    ["tab-1", { payload: { sql: "SELECT 1" }, title: "Query" }],
                  ]),
                },
              ],
            ]),
          },
        ],
      ]),
      getPanels: () => {
        const panel = {
          activeTabId: "tab-1",
          tabs: new Map([
            ["tab-1", { payload: { sql: "SELECT 1" } }],
          ]),
        };
        return new Map([["panel-1", panel]]);
      },
      getActivePanelId: () => "panel-1",
      addTab: vi.fn(() => "new-tab-id"),
      updateTab: vi.fn(),
    }),
  },
}));

/**
 * Helper to create a parsed command
 */
function createCommand<T>(
  name: ParsedCommand["name"],
  params: T
): ParsedCommand<T> {
  return {
    id: `cmd-${Date.now()}`,
    name,
    params,
    raw: `<command name="${name}">${JSON.stringify(params)}</command>`,
    startIndex: 0,
    endIndex: 100,
  };
}

describe("executeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("CRUD Commands", () => {
    describe("crud.stage", () => {
      it("should stage insert operation", async () => {
        const command = createCommand<CrudStageParams>("crud.stage", {
          connectionId: "conn-123",
          database: "testdb",
          schema: "public",
          table: "users",
          operation: "insert",
          document: { name: "Alice", email: "alice@example.com" },
          description: "Add new user",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as { staged: boolean; commandId: string };
          expect(data.staged).toBe(true);
          expect(data.commandId).toBeDefined();
        }
      });

      it("should stage update operation", async () => {
        const command = createCommand<CrudStageParams>("crud.stage", {
          connectionId: "conn-123",
          database: "testdb",
          schema: "public",
          table: "users",
          operation: "update",
          primaryKeys: { id: 1 },
          update: { email: "newemail@example.com" },
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
      });

      it("should stage delete operation", async () => {
        const command = createCommand<CrudStageParams>("crud.stage", {
          connectionId: "conn-123",
          database: "testdb",
          schema: "public",
          table: "users",
          operation: "delete",
          primaryKeys: { id: 1 },
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
      });

      it("should reject unknown operations", async () => {
        const command = createCommand<CrudStageParams>("crud.stage", {
          connectionId: "conn-123",
          database: "testdb",
          table: "users",
          // @ts-expect-error - Testing invalid operation
          operation: "truncate",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("Unknown operation");
        }
      });

      it("should reject insert without document", async () => {
        const command = createCommand<CrudStageParams>("crud.stage", {
          connectionId: "conn-123",
          table: "users",
          operation: "insert",
          document: {},
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("non-empty document");
        }
      });

      it("should reject update without identifier", async () => {
        const command = createCommand<CrudStageParams>("crud.stage", {
          connectionId: "conn-123",
          table: "users",
          operation: "update",
          update: { name: "Bob" },
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("primaryKeys or filter");
        }
      });

      it("should reject delete without identifier", async () => {
        const command = createCommand<CrudStageParams>("crud.stage", {
          connectionId: "conn-123",
          table: "users",
          operation: "delete",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("primaryKeys or filter");
        }
      });
    });

    describe("tab.update", () => {
      it("should update tab content", async () => {
        const command = createCommand<TabUpdateParams>("tab.update", {
          tabId: "tab-1",
          content: "SELECT * FROM new_query",
          title: "Updated Query",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
      });

      it("should handle tab update with existing mock", async () => {
        const command = createCommand<TabUpdateParams>("tab.update", {
          content: "SELECT 1",
          title: "Test Query",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
      });
    });

    describe("tab.create", () => {
      it("should create new tab", async () => {
        // Use test connection ID
        const command = createCommand<TabCreateParams>("tab.create", {
          connectionId: "test-conn-id",
          type: "query",
          title: "New Query Tab",
          content: "SELECT * FROM users",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as { success: boolean; tabId: string };
          expect(data.success).toBe(true);
          expect(data.tabId).toBeDefined();
        }
      });

      it("should reject invalid connectionId", async () => {
        const command = createCommand<TabCreateParams>("tab.create", {
          connectionId: "invalid-conn-id",
          type: "query",
          title: "Test Tab",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("Connection not found");
        }
      });
    });

    describe("editor.insert", () => {
      it("should insert text at end", async () => {
        const command = createCommand<EditorInsertParams>("editor.insert", {
          text: "-- New comment\n",
          position: "end",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
      });

      it("should replace content", async () => {
        const command = createCommand<EditorInsertParams>("editor.insert", {
          text: "SELECT * FROM new_table",
          position: "replace",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
      });
    });
  });

  describe("Unknown Commands", () => {
    it("should return error for unknown command", async () => {
      const command = createCommand(
        // @ts-expect-error - Testing unknown command
        "unknown.command",
        { some: "params" }
      );

      const result = await executeCommand(command);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Unknown command");
      }
    });
  });
});

describe("formatResultForConversation", () => {
  describe("CRUD Results", () => {
    it("should format crud.stage result", () => {
      const command = createCommand<CrudStageParams>("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "insert",
        document: { name: "Alice" },
      });

      const result: CommandResult = {
        success: true,
        data: {
          staged: true,
          commandId: "cmd-123",
          tableKey: "conn:db:schema:table",
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Change staged");
      expect(formatted).toContain("cmd-123");
    });

    it("should format tab commands", () => {
      const command = createCommand<TabUpdateParams>("tab.update", {
        content: "SELECT 1",
      });

      const result: CommandResult = {
        success: true,
        data: { success: true, tabId: "tab-1" },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Done");
    });
  });

  describe("Error Results", () => {
    it("should format error result", () => {
      const command = createCommand<CrudStageParams>("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "insert",
        document: {},
      });

      const result: CommandResult = {
        success: false,
        error: "Insert operation requires a non-empty document",
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Error");
      expect(formatted).toContain("non-empty document");
    });
  });
});

// ============================================================================
// Timeout and Batch Execution Tests
// ============================================================================

describe("executeCommandWithTimeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return result within timeout", async () => {
    const command = createCommand<TabUpdateParams>("tab.update", {
      content: "SELECT 1",
    });

    const resultPromise = executeCommandWithTimeout(command, 5000);

    // Let the promise resolve
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.success).toBe(true);
  });
});

describe("executeCommandsInParallel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute all commands in parallel", async () => {
    const commands = [
      createCommand<TabUpdateParams>("tab.update", { content: "SELECT 1" }),
      createCommand<EditorInsertParams>("editor.insert", { text: "SELECT 2" }),
    ];

    const result = await executeCommandsInParallel(commands, 30000);

    expect(result.results).toHaveLength(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
  });

  it("should handle empty command array", async () => {
    const result = await executeCommandsInParallel([], 30000);

    expect(result.results).toHaveLength(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
  });

  it("should report correct execution times", async () => {
    const commands = [
      createCommand<TabUpdateParams>("tab.update", { content: "SELECT 1" }),
    ];

    const result = await executeCommandsInParallel(commands, 30000);

    expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.results[0]?.executionTimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe("formatBatchedResultsForAgent", () => {
  it("should format successful batch results", () => {
    const batchResult: BatchExecutionResult = {
      results: [
        {
          commandId: "cmd-1",
          commandName: "tab.update",
          result: { success: true, data: { success: true, tabId: "tab-1" } },
          executionTimeMs: 100,
        },
        {
          commandId: "cmd-2",
          commandName: "editor.insert",
          result: { success: true, data: { success: true } },
          executionTimeMs: 80,
        },
      ],
      totalTimeMs: 150,
      successCount: 2,
      failureCount: 0,
    };

    const formatted = formatBatchedResultsForAgent(batchResult);

    expect(formatted).toContain("Batch Execution Complete");
    expect(formatted).toContain("150ms total");
    expect(formatted).toContain("**2** succeeded");
    expect(formatted).toContain("**0** failed");
  });

  it("should format batch with failures", () => {
    const batchResult: BatchExecutionResult = {
      results: [
        {
          commandId: "cmd-1",
          commandName: "tab.update",
          result: { success: true, data: { success: true, tabId: "tab-1" } },
          executionTimeMs: 100,
        },
        {
          commandId: "cmd-2",
          commandName: "crud.stage",
          result: { success: false, error: "Missing required parameter" },
          executionTimeMs: 50,
        },
      ],
      totalTimeMs: 120,
      successCount: 1,
      failureCount: 1,
    };

    const formatted = formatBatchedResultsForAgent(batchResult);

    expect(formatted).toContain("**1** succeeded");
    expect(formatted).toContain("**1** failed");
    expect(formatted).toContain("Missing required parameter");
  });
});
