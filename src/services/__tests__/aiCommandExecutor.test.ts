/**
 * AI Command Executor Tests
 *
 * Tests for the command execution layer that handles
 * SQL, MongoDB, Redis, and universal commands.
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
  SqlExecuteParams,
  SqlExecuteResult,
  MongodbFindParams,
  MongodbFindResult,
  MongodbAggregateParams,
  MongodbCountParams,
  RedisGetParams,
  RedisKeysParams,
  RedisScanParams,
  CrudStageParams,
  TabUpdateParams,
  TabCreateParams,
  EditorInsertParams,
} from "@/types/aiCommands";

// Mock Tauri invoke
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

vi.mock("@/stores/workspaceScreenStore", () => ({
  useWorkspaceScreenStore: {
    getState: () => ({
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

  describe("SQL Commands", () => {
    describe("sql.execute", () => {
      it("should execute SELECT query successfully", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue({
          columns: [{ name: "id" }, { name: "name" }],
          rows: [
            [1, "Alice"],
            [2, "Bob"],
          ],
        });

        const command = createCommand<SqlExecuteParams>("sql.execute", {
          connectionId: "conn-123",
          sql: "SELECT id, name FROM users",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        expect(invoke).toHaveBeenCalledWith("query", {
          conn_id: "conn-123",
          sql: expect.stringContaining("SELECT id, name FROM users"),
          timeout_secs: null,
        });

        if (result.success) {
          const data = result.data as SqlExecuteResult;
          expect(data.columns).toEqual(["id", "name"]);
          expect(data.rows).toHaveLength(2);
          expect(data.rowCount).toBe(2);
        }
      });

      it("should add LIMIT if not present", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue({
          columns: [{ name: "id" }],
          rows: [],
        });

        const command = createCommand<SqlExecuteParams>("sql.execute", {
          connectionId: "conn-123",
          sql: "SELECT * FROM users",
          limit: 50,
        });

        await executeCommand(command);

        expect(invoke).toHaveBeenCalledWith("query", {
          conn_id: "conn-123",
          sql: expect.stringContaining("LIMIT 50"),
          timeout_secs: null,
        });
      });

      it("should not add LIMIT if already present", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue({
          columns: [{ name: "id" }],
          rows: [],
        });

        const command = createCommand<SqlExecuteParams>("sql.execute", {
          connectionId: "conn-123",
          sql: "SELECT * FROM users LIMIT 10",
        });

        await executeCommand(command);

        expect(invoke).toHaveBeenCalledWith("query", {
          conn_id: "conn-123",
          sql: "SELECT * FROM users LIMIT 10",
          timeout_secs: null,
        });
      });

      it("should reject non-SELECT queries", async () => {
        const command = createCommand<SqlExecuteParams>("sql.execute", {
          connectionId: "conn-123",
          sql: "DELETE FROM users WHERE id = 1",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("Only SELECT queries are allowed");
        }
      });

      it("should allow WITH queries (CTEs)", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue({
          columns: [{ name: "count" }],
          rows: [[10]],
        });

        const command = createCommand<SqlExecuteParams>("sql.execute", {
          connectionId: "conn-123",
          sql: "WITH active AS (SELECT * FROM users WHERE active) SELECT COUNT(*) FROM active",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
      });

      it("should handle database errors", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockRejectedValue(new Error("relation \"users\" does not exist"));

        const command = createCommand<SqlExecuteParams>("sql.execute", {
          connectionId: "conn-123",
          sql: "SELECT * FROM users",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("relation");
        }
      });
    });

    describe("sql.explain", () => {
      it("should execute EXPLAIN query", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue({
          columns: [{ name: "QUERY PLAN" }],
          rows: [["Seq Scan on users"], ["  Filter: (active = true)"]],
        });

        const command = createCommand("sql.explain", {
          connectionId: "conn-123",
          sql: "SELECT * FROM users WHERE active = true",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        expect(invoke).toHaveBeenCalledWith("query", {
          conn_id: "conn-123",
          sql: "EXPLAIN SELECT * FROM users WHERE active = true",
          timeout_secs: null,
        });

        if (result.success) {
          const data = result.data as { plan: string };
          expect(data.plan).toContain("Seq Scan");
        }
      });
    });
  });

  describe("MongoDB Commands", () => {
    describe("mongodb.find", () => {
      it("should execute find successfully", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        const mockDocuments = [
          { _id: "1", name: "Alice", active: true },
          { _id: "2", name: "Bob", active: true },
        ];
        vi.mocked(invoke).mockResolvedValue(mockDocuments);

        const command = createCommand<MongodbFindParams>("mongodb.find", {
          connectionId: "conn-mongo",
          collection: "users",
          filter: { active: true },
          limit: 20,
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        expect(invoke).toHaveBeenCalledWith("mongo_find_documents", {
          conn_id: "conn-mongo",
          collection: "users",
          filter: { active: true },
          projection: null,
          sort: null,
          skip: null,
          limit: 20,
        });

        if (result.success) {
          const data = result.data as MongodbFindResult;
          expect(data.documents).toHaveLength(2);
          expect(data.count).toBe(2);
        }
      });

      it("should handle empty results", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue([]);

        const command = createCommand<MongodbFindParams>("mongodb.find", {
          connectionId: "conn-mongo",
          collection: "users",
          filter: { nonexistent: true },
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as MongodbFindResult;
          expect(data.documents).toHaveLength(0);
          expect(data.count).toBe(0);
        }
      });

      it("should pass projection and sort options", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue([]);

        const command = createCommand<MongodbFindParams>("mongodb.find", {
          connectionId: "conn-mongo",
          collection: "users",
          filter: {},
          projection: { name: 1, email: 1 },
          sort: { createdAt: -1 },
        });

        await executeCommand(command);

        expect(invoke).toHaveBeenCalledWith("mongo_find_documents", {
          conn_id: "conn-mongo",
          collection: "users",
          filter: {},
          projection: { name: 1, email: 1 },
          sort: { createdAt: -1 },
          skip: null,
          limit: 20,
        });
      });
    });

    describe("mongodb.aggregate", () => {
      it("should execute aggregation pipeline", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue([
          { _id: "active", count: 10 },
          { _id: "inactive", count: 5 },
        ]);

        const command = createCommand<MongodbAggregateParams>("mongodb.aggregate", {
          connectionId: "conn-mongo",
          collection: "users",
          pipeline: [
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ],
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        expect(invoke).toHaveBeenCalledWith("mongo_aggregate", {
          conn_id: "conn-mongo",
          collection: "users",
          pipeline: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        });

        if (result.success) {
          const data = result.data as { results: unknown[] };
          expect(data.results).toHaveLength(2);
        }
      });
    });

    describe("mongodb.count", () => {
      it("should count documents", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue(42);

        const command = createCommand<MongodbCountParams>("mongodb.count", {
          connectionId: "conn-mongo",
          collection: "users",
          filter: { active: true },
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        expect(invoke).toHaveBeenCalledWith("mongo_count_documents", {
          conn_id: "conn-mongo",
          collection: "users",
          filter: { active: true },
        });

        if (result.success) {
          const data = result.data as { count: number };
          expect(data.count).toBe(42);
        }
      });

      it("should pass null filter for empty filter object", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue(100);

        const command = createCommand<MongodbCountParams>("mongodb.count", {
          connectionId: "conn-mongo",
          collection: "users",
          filter: {},
        });

        await executeCommand(command);

        expect(invoke).toHaveBeenCalledWith("mongo_count_documents", {
          conn_id: "conn-mongo",
          collection: "users",
          filter: null,
        });
      });
    });
  });

  describe("Redis Commands", () => {
    describe("redis.get", () => {
      it("should get key value with type and TTL", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke)
          .mockResolvedValueOnce("string") // redis_type
          .mockResolvedValueOnce("hello world") // redis_get
          .mockResolvedValueOnce(3600); // redis_ttl

        const command = createCommand<RedisGetParams>("redis.get", {
          connectionId: "conn-redis",
          key: "mykey",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        expect(invoke).toHaveBeenCalledTimes(3);
        expect(invoke).toHaveBeenCalledWith("redis_type", {
          conn_id: "conn-redis",
          key: "mykey",
        });

        if (result.success) {
          const data = result.data as { key: string; type: string; value: unknown; ttl: number };
          expect(data.key).toBe("mykey");
          expect(data.type).toBe("string");
          expect(data.value).toBe("hello world");
          expect(data.ttl).toBe(3600);
        }
      });

      it("should handle non-existent key", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke)
          .mockResolvedValueOnce("none") // redis_type
          .mockResolvedValueOnce(null) // redis_get
          .mockResolvedValueOnce(-2); // redis_ttl (key doesn't exist)

        const command = createCommand<RedisGetParams>("redis.get", {
          connectionId: "conn-redis",
          key: "nonexistent",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as { type: string; ttl: number };
          expect(data.type).toBe("none");
          expect(data.ttl).toBe(-2);
        }
      });
    });

    describe("redis.keys", () => {
      it("should list keys matching pattern", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue({
          type: "scan",
          data: {
            keys: ["user:1", "user:2", "user:3"],
            cursor: 0,
          },
        });

        const command = createCommand<RedisKeysParams>("redis.keys", {
          connectionId: "conn-redis",
          pattern: "user:*",
          limit: 100,
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        expect(invoke).toHaveBeenCalledWith("keyvalue_execute", {
          conn_id: "conn-redis",
          operation: { type: "scan", pattern: "user:*", cursor: 0, count: 100 },
        });

        if (result.success) {
          const data = result.data as { keys: string[]; count: number };
          expect(data.keys).toHaveLength(3);
          expect(data.count).toBe(3);
        }
      });
    });

    describe("redis.scan", () => {
      it("should scan keys with cursor", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue({
          type: "scan",
          data: {
            keys: ["key1", "key2"],
            cursor: 42,
          },
        });

        const command = createCommand<RedisScanParams>("redis.scan", {
          connectionId: "conn-redis",
          pattern: "*",
          count: 10,
          cursor: "0",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as { keys: string[]; cursor: string; done: boolean };
          expect(data.keys).toHaveLength(2);
          expect(data.cursor).toBe("42");
          expect(data.done).toBe(false);
        }
      });

      it("should indicate done when cursor is 0", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockResolvedValue({
          type: "scan",
          data: {
            keys: ["final-key"],
            cursor: 0,
          },
        });

        const command = createCommand<RedisScanParams>("redis.scan", {
          connectionId: "conn-redis",
          pattern: "*",
          cursor: "123",
        });

        const result = await executeCommand(command);

        expect(result.success).toBe(true);
        if (result.success) {
          const data = result.data as { done: boolean };
          expect(data.done).toBe(true);
        }
      });
    });
  });

  describe("Universal Commands", () => {
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
        // With our default mock that has a tab, the update should succeed
        const command = createCommand<TabUpdateParams>("tab.update", {
          content: "SELECT 1",
          title: "Test Query",
        });

        const result = await executeCommand(command);

        // With our mock, tab update should succeed
        expect(result.success).toBe(true);
      });
    });

    describe("tab.create", () => {
      it("should create new tab", async () => {
        // Don't pass connectionId to skip connection validation in tests
        const command = createCommand<TabCreateParams>("tab.create", {
          connectionId: undefined,
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

  describe("Error Handling", () => {
    it("should catch and return errors from invoke", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValue(new Error("Connection timeout"));

      const command = createCommand<SqlExecuteParams>("sql.execute", {
        connectionId: "conn-123",
        sql: "SELECT 1",
      });

      const result = await executeCommand(command);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Connection timeout");
      }
    });

    it("should handle non-Error exceptions", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValue("String error message");

      const command = createCommand<SqlExecuteParams>("sql.execute", {
        connectionId: "conn-123",
        sql: "SELECT 1",
      });

      const result = await executeCommand(command);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("String error message");
      }
    });
  });
});

describe("formatResultForConversation", () => {
  describe("SQL Results", () => {
    it("should format SQL execute result with data", () => {
      const command = createCommand<SqlExecuteParams>("sql.execute", {
        connectionId: "conn-123",
        sql: "SELECT * FROM users",
      });

      const result: CommandResult = {
        success: true,
        data: {
          columns: ["id", "name"],
          rows: [[1, "Alice"], [2, "Bob"]],
          rowCount: 2,
          executionTimeMs: 15,
          truncated: false,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("2 rows");
      expect(formatted).toContain("15ms");
      expect(formatted).toContain("id");
      expect(formatted).toContain("name");
      expect(formatted).toContain("Alice");
    });

    it("should format empty SQL result", () => {
      const command = createCommand<SqlExecuteParams>("sql.execute", {
        connectionId: "conn-123",
        sql: "SELECT * FROM users WHERE 1=0",
      });

      const result: CommandResult = {
        success: true,
        data: {
          columns: ["id"],
          rows: [],
          rowCount: 0,
          executionTimeMs: 5,
          truncated: false,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("no results");
    });

    it("should format SQL explain result", () => {
      const command = createCommand("sql.explain", {
        connectionId: "conn-123",
        sql: "SELECT * FROM users",
      });

      const result: CommandResult = {
        success: true,
        data: {
          plan: "Seq Scan on users (cost=0.00..1.50 rows=50 width=36)",
          executionTimeMs: 3,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Query Plan");
      expect(formatted).toContain("Seq Scan");
    });
  });

  describe("MongoDB Results", () => {
    it("should format MongoDB find result", () => {
      const command = createCommand<MongodbFindParams>("mongodb.find", {
        connectionId: "conn-mongo",
        collection: "users",
        filter: {},
      });

      const result: CommandResult = {
        success: true,
        data: {
          documents: [{ _id: "1", name: "Alice" }],
          count: 1,
          executionTimeMs: 10,
          truncated: false,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Found 1 documents");
      expect(formatted).toContain("Alice");
    });

    it("should format MongoDB count result", () => {
      const command = createCommand<MongodbCountParams>("mongodb.count", {
        connectionId: "conn-mongo",
        collection: "users",
      });

      const result: CommandResult = {
        success: true,
        data: {
          count: 42,
          executionTimeMs: 5,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Document count: 42");
    });

    it("should format MongoDB aggregate result", () => {
      const command = createCommand<MongodbAggregateParams>("mongodb.aggregate", {
        connectionId: "conn-mongo",
        collection: "users",
        pipeline: [],
      });

      const result: CommandResult = {
        success: true,
        data: {
          results: [{ _id: "status", count: 10 }],
          executionTimeMs: 20,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Aggregation Result");
    });
  });

  describe("Redis Results", () => {
    it("should format Redis get result", () => {
      const command = createCommand<RedisGetParams>("redis.get", {
        connectionId: "conn-redis",
        key: "user:123",
      });

      const result: CommandResult = {
        success: true,
        data: {
          key: "user:123",
          type: "string",
          value: '{"name":"Alice"}',
          ttl: 3600,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("user:123");
      expect(formatted).toContain("string");
      expect(formatted).toContain("TTL: 3600s");
    });

    it("should format Redis key not found", () => {
      const command = createCommand<RedisGetParams>("redis.get", {
        connectionId: "conn-redis",
        key: "nonexistent",
      });

      const result: CommandResult = {
        success: true,
        data: {
          key: "nonexistent",
          type: "none",
          value: null,
          ttl: -2,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Key not found");
    });

    it("should format Redis keys result", () => {
      const command = createCommand<RedisKeysParams>("redis.keys", {
        connectionId: "conn-redis",
        pattern: "user:*",
      });

      const result: CommandResult = {
        success: true,
        data: {
          keys: ["user:1", "user:2", "user:3"],
          count: 3,
          truncated: false,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Found 3 keys");
      expect(formatted).toContain("user:1");
    });

    it("should format Redis scan result", () => {
      const command = createCommand<RedisScanParams>("redis.scan", {
        connectionId: "conn-redis",
        pattern: "*",
      });

      const result: CommandResult = {
        success: true,
        data: {
          keys: ["key1", "key2"],
          cursor: "42",
          done: false,
        },
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Scanned 2 keys");
      expect(formatted).toContain("cursor: 42");
      expect(formatted).toContain("done: false");
    });
  });

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
  });

  describe("Error Results", () => {
    it("should format error result", () => {
      const command = createCommand<SqlExecuteParams>("sql.execute", {
        connectionId: "conn-123",
        sql: "SELECT * FROM nonexistent",
      });

      const result: CommandResult = {
        success: false,
        error: "relation \"nonexistent\" does not exist",
      };

      const formatted = formatResultForConversation(command, result);

      expect(formatted).toContain("Error");
      expect(formatted).toContain("relation");
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
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue({
      columns: [{ name: "id" }],
      rows: [[1]],
    });

    const command = createCommand<SqlExecuteParams>("sql.execute", {
      connectionId: "conn-123",
      sql: "SELECT 1",
    });

    const resultPromise = executeCommandWithTimeout(command, 5000);

    // Let the promise resolve
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.success).toBe(true);
  });

  it("should return error when command times out", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // Mock a slow command that never resolves
    vi.mocked(invoke).mockImplementation(() => new Promise(() => {}));

    const command = createCommand<SqlExecuteParams>("sql.execute", {
      connectionId: "conn-123",
      sql: "SELECT SLOW_QUERY()",
    });

    const resultPromise = executeCommandWithTimeout(command, 1000);

    // Advance time past the timeout
    await vi.advanceTimersByTimeAsync(1500);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Timeout");
    expect(result.error).toContain("sql.execute");
  });

  it("should handle non-timeout errors correctly", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValue(new Error("Connection refused"));

    const command = createCommand<SqlExecuteParams>("sql.execute", {
      connectionId: "conn-123",
      sql: "SELECT 1",
    });

    const resultPromise = executeCommandWithTimeout(command, 5000);
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
    // Should NOT say "Timeout"
    expect(result.error).not.toContain("Timeout");
  });
});

describe("executeCommandsInParallel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute all commands in parallel", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue({
      columns: [{ name: "id" }],
      rows: [[1]],
    });

    const commands = [
      createCommand<SqlExecuteParams>("sql.execute", { connectionId: "c1", sql: "SELECT 1" }),
      createCommand<SqlExecuteParams>("sql.execute", { connectionId: "c1", sql: "SELECT 2" }),
    ];

    const result = await executeCommandsInParallel(commands, 30000);

    expect(result.results).toHaveLength(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("should handle mixed success/failure results", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke)
      .mockResolvedValueOnce({ columns: [{ name: "id" }], rows: [[1]] })
      .mockRejectedValueOnce(new Error("Query failed"));

    const commands = [
      createCommand<SqlExecuteParams>("sql.execute", { connectionId: "c1", sql: "SELECT 1" }),
      createCommand<SqlExecuteParams>("sql.execute", { connectionId: "c1", sql: "SELECT FAIL" }),
    ];

    const result = await executeCommandsInParallel(commands, 30000);

    expect(result.results).toHaveLength(2);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.results[0]?.result.success).toBe(true);
    expect(result.results[1]?.result.success).toBe(false);
  });

  it("should handle empty command array", async () => {
    const result = await executeCommandsInParallel([], 30000);

    expect(result.results).toHaveLength(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
  });

  it("should report correct execution times", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue({
      columns: [{ name: "id" }],
      rows: [[1]],
    });

    const commands = [
      createCommand<SqlExecuteParams>("sql.execute", { connectionId: "c1", sql: "SELECT 1" }),
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
          commandName: "sql.execute",
          result: { success: true, data: { rowCount: 10, columns: ["id"], rows: [], executionTimeMs: 50, truncated: false } },
          executionTimeMs: 100,
        },
        {
          commandId: "cmd-2",
          commandName: "sql.execute",
          result: { success: true, data: { rowCount: 5, columns: ["name"], rows: [], executionTimeMs: 30, truncated: false } },
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
    expect(formatted).toContain("✓ sql.execute");
    expect(formatted).toContain("Returned 10 rows");
    expect(formatted).toContain("Returned 5 rows");
  });

  it("should format batch with failures", () => {
    const batchResult: BatchExecutionResult = {
      results: [
        {
          commandId: "cmd-1",
          commandName: "sql.execute",
          result: { success: true, data: { rowCount: 10, columns: ["id"], rows: [], executionTimeMs: 50, truncated: false } },
          executionTimeMs: 100,
        },
        {
          commandId: "cmd-2",
          commandName: "sql.execute",
          result: { success: false, error: "Connection refused" },
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
    expect(formatted).toContain("✓ sql.execute");
    expect(formatted).toContain("✗ sql.execute");
    expect(formatted).toContain("Connection refused");
  });

  it("should truncate long results", () => {
    const longData = { data: "x".repeat(600) };
    const batchResult: BatchExecutionResult = {
      results: [
        {
          commandId: "cmd-1",
          commandName: "tab.update",
          result: { success: true, data: longData },
          executionTimeMs: 10,
        },
      ],
      totalTimeMs: 10,
      successCount: 1,
      failureCount: 0,
    };

    const formatted = formatBatchedResultsForAgent(batchResult);

    expect(formatted).toContain("...");
    // Should be truncated, not the full 600+ character string
    expect(formatted.length).toBeLessThan(800);
  });
});
