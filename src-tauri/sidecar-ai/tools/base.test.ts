/**
 * Base Tool Tests
 *
 * Tests for the defineTool helper and Zod schema generation.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { defineTool, createZodSchema, createAiSdkTool } from "./base";
import { clearAllState } from "../utils/circuit-breaker";
import type { ToolContext, TauriClient } from "./types";

describe("defineTool", () => {
  it("should create a tool with correct metadata", () => {
    const tool = defineTool({
      name: "test_tool",
      friendlyName: "Test Tool",
      description: "A test tool for unit testing",
      category: "test",
      capabilities: ["sql"],
      parameters: {
        connectionId: { type: "string", required: true, description: "The connection ID" },
        limit: { type: "number", default: 10, description: "Row limit" },
      },
      messages: {
        pending: () => "Running test...",
        success: () => "Test completed",
        error: (_, e) => `Test failed: ${e.message}`,
      },
      execute: async () => ({ result: "ok" }),
    });

    expect(tool.name).toBe("test_tool");
    expect(tool.friendlyName).toBe("Test Tool");
    expect(tool.capabilities).toContain("sql");
    expect(tool.category).toBe("test");
  });

  it("should preserve all parameter definitions", () => {
    const tool = defineTool({
      name: "param_test",
      friendlyName: "Param Test",
      description: "Tests parameters",
      category: "test",
      capabilities: ["sql"],
      parameters: {
        required_param: { type: "string", required: true },
        optional_param: { type: "string" },
        with_default: { type: "number", default: 42 },
        enum_param: { type: "string", enum: ["a", "b", "c"] },
      },
      messages: {
        pending: () => "Running...",
        success: () => "Done",
        error: (_, e) => e.message,
      },
      execute: async () => ({}),
    });

    expect(tool.parameters.required_param.required).toBe(true);
    expect(tool.parameters.optional_param.required).toBeUndefined();
    expect(tool.parameters.with_default.default).toBe(42);
    expect(tool.parameters.enum_param.enum).toEqual(["a", "b", "c"]);
  });

  it("should generate valid Zod schema from parameters", () => {
    const tool = defineTool({
      name: "schema_test",
      friendlyName: "Schema Test",
      description: "Tests schema generation",
      category: "test",
      capabilities: ["sql"],
      parameters: {
        connectionId: { type: "string", required: true },
        limit: { type: "number", default: 10 },
        includeEmpty: { type: "boolean", default: false },
      },
      messages: {
        pending: () => "Running...",
        success: () => "Done",
        error: (_, e) => e.message,
      },
      execute: async () => ({}),
    });

    // Valid input
    const valid = tool.schema.safeParse({ connectionId: "abc" });
    expect(valid.success).toBe(true);

    // Missing required field
    const invalid = tool.schema.safeParse({});
    expect(invalid.success).toBe(false);

    // With optional fields
    const withOptional = tool.schema.safeParse({
      connectionId: "abc",
      limit: 20,
      includeEmpty: true,
    });
    expect(withOptional.success).toBe(true);
  });

  it("should support multiple capabilities", () => {
    const tool = defineTool({
      name: "multi_cap",
      friendlyName: "Multi Capability",
      description: "Works with multiple paradigms",
      category: "test",
      capabilities: ["sql", "document"],
      parameters: {},
      messages: {
        pending: () => "Running...",
        success: () => "Done",
        error: (_, e) => e.message,
      },
      execute: async () => ({}),
    });

    expect(tool.capabilities).toContain("sql");
    expect(tool.capabilities).toContain("document");
    expect(tool.capabilities.length).toBe(2);
  });
});

describe("createZodSchema", () => {
  it("should create string schema", () => {
    const schema = createZodSchema({
      name: { type: "string", required: true },
    });

    expect(schema.safeParse({ name: "test" }).success).toBe(true);
    expect(schema.safeParse({ name: 123 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("should create number schema", () => {
    const schema = createZodSchema({
      count: { type: "number", required: true, min: 1, max: 100 },
    });

    expect(schema.safeParse({ count: 50 }).success).toBe(true);
    expect(schema.safeParse({ count: 0 }).success).toBe(false);
    expect(schema.safeParse({ count: 101 }).success).toBe(false);
  });

  it("should create boolean schema", () => {
    const schema = createZodSchema({
      enabled: { type: "boolean", default: true },
    });

    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ enabled: false }).success).toBe(true);
  });

  it("should create enum schema", () => {
    const schema = createZodSchema({
      status: { type: "string", enum: ["active", "inactive", "pending"] },
    });

    expect(schema.safeParse({ status: "active" }).success).toBe(true);
    expect(schema.safeParse({ status: "invalid" }).success).toBe(false);
  });

  it("should create object schema", () => {
    const schema = createZodSchema({
      options: { type: "object" },
    });

    expect(schema.safeParse({ options: { a: 1 } }).success).toBe(true);
    expect(schema.safeParse({ options: "string" }).success).toBe(false);
  });

  it("should create array schema", () => {
    const schema = createZodSchema({
      items: { type: "array" },
    });

    expect(schema.safeParse({ items: [1, 2, 3] }).success).toBe(true);
    expect(schema.safeParse({ items: "not array" }).success).toBe(false);
  });

  it("should handle string length constraints", () => {
    const schema = createZodSchema({
      code: { type: "string", minLength: 2, maxLength: 5 },
    });

    expect(schema.safeParse({ code: "abc" }).success).toBe(true);
    expect(schema.safeParse({ code: "a" }).success).toBe(false);
    expect(schema.safeParse({ code: "abcdef" }).success).toBe(false);
  });
});

describe("createAiSdkTool", () => {
  let mockTauri: TauriClient;
  let mockCtx: ToolContext;

  beforeEach(() => {
    clearAllState();
    mockTauri = {
      invoke: mock(() => Promise.resolve({ data: "test" })),
    };
    mockCtx = {
      connectionId: "test-conn",
      conversationId: "test-conv",
    };
  });

  it("should create AI SDK compatible tool", () => {
    const definition = defineTool({
      name: "ai_sdk_test",
      friendlyName: "AI SDK Test",
      description: "Test AI SDK integration",
      category: "test",
      capabilities: ["sql"],
      parameters: {
        query: { type: "string", required: true },
      },
      messages: {
        pending: () => "Running...",
        success: () => "Done",
        error: (_, e) => e.message,
      },
      execute: async () => ({ result: "success" }),
    });

    const aiTool = createAiSdkTool(definition, mockCtx, mockTauri);

    expect(aiTool).toBeDefined();
    expect(aiTool.description).toBe("Test AI SDK integration");
  });

  it("should execute tool and return result", async () => {
    const definition = defineTool({
      name: "execute_test",
      friendlyName: "Execute Test",
      description: "Tests execution",
      category: "test",
      capabilities: ["sql"],
      parameters: {
        value: { type: "string", required: true },
      },
      messages: {
        pending: (input) => `Processing ${input.value}...`,
        success: (_, output) => `Got: ${JSON.stringify(output)}`,
        error: (_, e) => e.message,
      },
      execute: async ({ value }) => ({ echo: value }),
    });

    const aiTool = createAiSdkTool(definition, mockCtx, mockTauri);
    const result = await aiTool.execute({ value: "hello" }, {});

    expect(result).toEqual({ echo: "hello" });
  });

  it("should handle execution errors gracefully", async () => {
    const definition = defineTool({
      name: "error_test",
      friendlyName: "Error Test",
      description: "Tests error handling",
      category: "test",
      capabilities: ["sql"],
      parameters: {},
      messages: {
        pending: () => "Running...",
        success: () => "Done",
        error: (_, e) => `Error: ${e.message}`,
      },
      execute: async () => {
        throw new Error("Test error");
      },
    });

    const aiTool = createAiSdkTool(definition, mockCtx, mockTauri);
    const result = await aiTool.execute({}, {});

    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error");
  });
});
