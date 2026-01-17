/**
 * List Tables Tool Tests
 *
 * Tests for the list_tables tool using the new registry pattern.
 */

import { describe, it, expect, mock } from "bun:test";
import listTablesTool from "./list-tables";
import type { TauriClient, ToolContext } from "../types";

describe("list_tables tool", () => {
  describe("metadata", () => {
    it("should have correct tool name", () => {
      expect(listTablesTool.name).toBe("list_tables");
    });

    it("should have SQL capability", () => {
      expect(listTablesTool.capabilities).toContain("sql");
      expect(listTablesTool.capabilities).toHaveLength(1);
    });

    it("should have schema category", () => {
      expect(listTablesTool.category).toBe("schema");
    });

    it("should have friendly name", () => {
      expect(listTablesTool.friendlyName).toBeDefined();
      expect(listTablesTool.friendlyName.length).toBeGreaterThan(0);
    });

    it("should have description", () => {
      expect(listTablesTool.description).toBeDefined();
      expect(listTablesTool.description.length).toBeGreaterThan(0);
    });
  });

  describe("parameters", () => {
    it("should have schema parameter with default", () => {
      expect(listTablesTool.parameters.schema).toBeDefined();
      expect(listTablesTool.parameters.schema.type).toBe("string");
      expect(listTablesTool.parameters.schema.default).toBe("public");
    });

    it("should generate valid Zod schema", () => {
      // Schema should be optional with default
      const valid1 = listTablesTool.schema.safeParse({});
      expect(valid1.success).toBe(true);

      const valid2 = listTablesTool.schema.safeParse({ schema: "custom" });
      expect(valid2.success).toBe(true);
    });
  });

  describe("messages", () => {
    it("should generate pending message with schema", () => {
      const msg = listTablesTool.messages.pending({ schema: "public" });
      expect(msg).toContain("public");
      expect(msg.toLowerCase()).toContain("list");
    });

    it("should generate success message with count", () => {
      const output = [{ name: "users" }, { name: "posts" }];
      const msg = listTablesTool.messages.success({ schema: "public" }, output);
      expect(msg).toContain("2");
    });

    it("should generate error message", () => {
      const err = new Error("Connection failed");
      const msg = listTablesTool.messages.error({ schema: "public" }, err);
      expect(msg.toLowerCase()).toContain("failed");
      expect(msg).toContain("Connection failed");
    });
  });

  describe("execute", () => {
    let mockTauri: TauriClient;
    let mockCtx: ToolContext;

    it("should call ai_sql_execute with list_tables operation", async () => {
      const invokeMock = mock(() =>
        Promise.resolve({
          columns: ["schema", "name", "kind"],
          rows: [
            ["public", "users", "table"],
            ["public", "posts", "table"],
          ],
        })
      );

      mockTauri = { invoke: invokeMock };
      mockCtx = {
        connectionId: "conn1",
        conversationId: "conv1",
      };

      const result = await listTablesTool.execute({ schema: "public" }, mockCtx, mockTauri);

      expect(invokeMock).toHaveBeenCalledWith("ai_sql_execute", {
        connId: "conn1",
        operation: { type: "list_tables", schema: "public" },
      });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("users");
      expect(result[1].name).toBe("posts");
    });

    it("should use default schema if not provided", async () => {
      const invokeMock = mock(() =>
        Promise.resolve({
          columns: ["schema", "name", "kind"],
          rows: [["public", "users", "table"]],
        })
      );

      mockTauri = { invoke: invokeMock };
      mockCtx = {
        connectionId: "conn1",
        conversationId: "conv1",
      };

      await listTablesTool.execute({}, mockCtx, mockTauri);

      expect(invokeMock).toHaveBeenCalledWith("ai_sql_execute", {
        connId: "conn1",
        operation: { type: "list_tables", schema: "public" },
      });
    });

    it("should handle errors gracefully", async () => {
      const invokeMock = mock(() => Promise.reject(new Error("Database error")));

      mockTauri = { invoke: invokeMock };
      mockCtx = {
        connectionId: "conn1",
        conversationId: "conv1",
      };

      await expect(
        listTablesTool.execute({ schema: "public" }, mockCtx, mockTauri)
      ).rejects.toThrow("Database error");
    });

    it("should transform rows to structured output", async () => {
      const invokeMock = mock(() =>
        Promise.resolve({
          columns: ["schema", "name", "kind"],
          rows: [
            ["public", "users", "table"],
            ["public", "user_roles", "table"],
            ["public", "posts", "table"],
          ],
        })
      );

      mockTauri = { invoke: invokeMock };
      mockCtx = {
        connectionId: "conn1",
        conversationId: "conv1",
      };

      const result = await listTablesTool.execute({ schema: "public" }, mockCtx, mockTauri);

      expect(result).toHaveLength(3);
      result.forEach((table) => {
        expect(table).toHaveProperty("name");
        expect(table).toHaveProperty("schema");
        expect(typeof table.name).toBe("string");
      });
    });
  });
});
