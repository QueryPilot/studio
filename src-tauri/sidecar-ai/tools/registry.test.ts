/**
 * Tool Registry Tests
 *
 * Tests for auto-loading tools and filtering by capabilities.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { ToolRegistry } from "./registry";
import { defineTool } from "./base";
import type { RegisteredTool, TauriClient } from "./types";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  // Mock tools for testing
  const sqlTool: RegisteredTool = defineTool({
    name: "sql_tool",
    friendlyName: "SQL Tool",
    description: "A SQL tool",
    category: "schema",
    capabilities: ["sql"],
    parameters: {},
    messages: {
      pending: () => "Running...",
      success: () => "Done",
      error: (_, e) => e.message,
    },
    execute: async () => ({ result: "sql" }),
  });

  const documentTool: RegisteredTool = defineTool({
    name: "document_tool",
    friendlyName: "Document Tool",
    description: "A document tool",
    category: "query",
    capabilities: ["document"],
    parameters: {},
    messages: {
      pending: () => "Running...",
      success: () => "Done",
      error: (_, e) => e.message,
    },
    execute: async () => ({ result: "document" }),
  });

  const multiCapTool: RegisteredTool = defineTool({
    name: "multi_tool",
    friendlyName: "Multi Tool",
    description: "A multi-capability tool",
    category: "query",
    capabilities: ["sql", "document", "keyvalue"],
    parameters: {},
    messages: {
      pending: () => "Running...",
      success: () => "Done",
      error: (_, e) => e.message,
    },
    execute: async () => ({ result: "multi" }),
  });

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register", () => {
    it("should register a tool", () => {
      registry.register(sqlTool);
      expect(registry.get("sql_tool")).toBeDefined();
      expect(registry.get("sql_tool")?.name).toBe("sql_tool");
    });

    it("should allow registering multiple tools", () => {
      registry.register(sqlTool);
      registry.register(documentTool);

      expect(registry.get("sql_tool")).toBeDefined();
      expect(registry.get("document_tool")).toBeDefined();
    });

    it("should overwrite tool with same name", () => {
      const tool1 = defineTool({
        name: "same_name",
        friendlyName: "First",
        description: "First tool",
        category: "test",
        capabilities: ["sql"],
        parameters: {},
        messages: {
          pending: () => "Running...",
          success: () => "Done",
          error: (_, e) => e.message,
        },
        execute: async () => ({ v: 1 }),
      });

      const tool2 = defineTool({
        name: "same_name",
        friendlyName: "Second",
        description: "Second tool",
        category: "test",
        capabilities: ["sql"],
        parameters: {},
        messages: {
          pending: () => "Running...",
          success: () => "Done",
          error: (_, e) => e.message,
        },
        execute: async () => ({ v: 2 }),
      });

      registry.register(tool1);
      registry.register(tool2);

      const retrieved = registry.get("same_name");
      expect(retrieved?.friendlyName).toBe("Second");
    });
  });

  describe("get", () => {
    it("should return tool by name", () => {
      registry.register(sqlTool);
      const tool = registry.get("sql_tool");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("sql_tool");
    });

    it("should return undefined for unknown tool", () => {
      const tool = registry.get("nonexistent");
      expect(tool).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return empty array when no tools registered", () => {
      expect(registry.getAll()).toHaveLength(0);
    });

    it("should return all registered tools", () => {
      registry.register(sqlTool);
      registry.register(documentTool);
      registry.register(multiCapTool);

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((t) => t.name)).toContain("sql_tool");
      expect(all.map((t) => t.name)).toContain("document_tool");
      expect(all.map((t) => t.name)).toContain("multi_tool");
    });
  });

  describe("getForCapabilities", () => {
    beforeEach(() => {
      registry.register(sqlTool);
      registry.register(documentTool);
      registry.register(multiCapTool);
    });

    it("should filter tools by single capability", () => {
      const sqlTools = registry.getForCapabilities(["sql"]);
      expect(sqlTools).toHaveLength(2); // sql_tool and multi_tool
      expect(sqlTools.map((t) => t.name)).toContain("sql_tool");
      expect(sqlTools.map((t) => t.name)).toContain("multi_tool");
    });

    it("should filter tools by multiple capabilities", () => {
      const docTools = registry.getForCapabilities(["document"]);
      expect(docTools).toHaveLength(2); // document_tool and multi_tool
      expect(docTools.map((t) => t.name)).toContain("document_tool");
      expect(docTools.map((t) => t.name)).toContain("multi_tool");
    });

    it("should return empty array for unknown capability", () => {
      const tools = registry.getForCapabilities(["unknown"]);
      expect(tools).toHaveLength(0);
    });

    it("should return tools matching any capability (OR logic)", () => {
      const tools = registry.getForCapabilities(["sql", "document"]);
      // All three tools should match
      expect(tools).toHaveLength(3);
    });

    it("should handle empty capabilities array", () => {
      const tools = registry.getForCapabilities([]);
      expect(tools).toHaveLength(0);
    });
  });

  describe("getToolsForConnection", () => {
    let mockTauri: TauriClient;

    beforeEach(() => {
      registry.register(sqlTool);
      registry.register(documentTool);
      registry.register(multiCapTool);
    });

    it("should fetch capabilities and filter tools", async () => {
      mockTauri = {
        invoke: mock((cmd: string) => {
          if (cmd === "ai_get_capabilities") {
            return Promise.resolve({
              kind: "sql",
              capabilities: ["sql-queryable"],
              fallback_tools: ["list_tables"],
            });
          }
          return Promise.reject(new Error("Unknown command"));
        }),
      };

      const tools = await registry.getToolsForConnection("conn1", mockTauri);

      expect(tools).toHaveLength(2); // sql_tool and multi_tool
      expect(tools.map((t) => t.name)).toContain("sql_tool");
      expect(tools.map((t) => t.name)).toContain("multi_tool");
    });

    it("should handle document database", async () => {
      mockTauri = {
        invoke: mock((cmd: string) => {
          if (cmd === "ai_get_capabilities") {
            return Promise.resolve({
              kind: "document",
              capabilities: ["document-queryable"],
              fallback_tools: ["list_collections"],
            });
          }
          return Promise.reject(new Error("Unknown command"));
        }),
      };

      const tools = await registry.getToolsForConnection("conn2", mockTauri);

      expect(tools).toHaveLength(2); // document_tool and multi_tool
      expect(tools.map((t) => t.name)).toContain("document_tool");
    });

    it("should handle keyvalue database", async () => {
      const kvTool = defineTool({
        name: "kv_tool",
        friendlyName: "KV Tool",
        description: "A keyvalue tool",
        category: "keyvalue",
        capabilities: ["keyvalue"],
        parameters: {},
        messages: {
          pending: () => "Running...",
          success: () => "Done",
          error: (_, e) => e.message,
        },
        execute: async () => ({ result: "kv" }),
      });
      registry.register(kvTool);

      mockTauri = {
        invoke: mock((cmd: string) => {
          if (cmd === "ai_get_capabilities") {
            return Promise.resolve({
              kind: "keyvalue",
              capabilities: ["keyvalue-operable"],
              fallback_tools: ["scan_keys"],
            });
          }
          return Promise.reject(new Error("Unknown command"));
        }),
      };

      const tools = await registry.getToolsForConnection("conn3", mockTauri);

      expect(tools.map((t) => t.name)).toContain("kv_tool");
      expect(tools.map((t) => t.name)).toContain("multi_tool");
    });

    it("should handle connection not found gracefully", async () => {
      mockTauri = {
        invoke: mock((cmd: string) => {
          if (cmd === "ai_get_capabilities") {
            return Promise.resolve({
              kind: "unknown",
              capabilities: [],
              error: "Connection not found",
              fallback_tools: [],
            });
          }
          return Promise.reject(new Error("Unknown command"));
        }),
      };

      const tools = await registry.getToolsForConnection("invalid", mockTauri);

      // Should return all tools as fallback
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should cache capability results", async () => {
      let callCount = 0;
      mockTauri = {
        invoke: mock((cmd: string) => {
          if (cmd === "ai_get_capabilities") {
            callCount++;
            return Promise.resolve({
              kind: "sql",
              capabilities: ["sql-queryable"],
              fallback_tools: [],
            });
          }
          return Promise.reject(new Error("Unknown command"));
        }),
      };

      // First call
      await registry.getToolsForConnection("conn1", mockTauri);
      expect(callCount).toBe(1);

      // Second call should use cache
      await registry.getToolsForConnection("conn1", mockTauri);
      expect(callCount).toBe(1); // No additional call
    });
  });

  describe("unregister", () => {
    it("should remove a tool by name", () => {
      registry.register(sqlTool);
      expect(registry.get("sql_tool")).toBeDefined();

      registry.unregister("sql_tool");
      expect(registry.get("sql_tool")).toBeUndefined();
    });

    it("should do nothing if tool doesn't exist", () => {
      registry.unregister("nonexistent");
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("should remove all tools", () => {
      registry.register(sqlTool);
      registry.register(documentTool);
      expect(registry.getAll()).toHaveLength(2);

      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
    });
  });
});
