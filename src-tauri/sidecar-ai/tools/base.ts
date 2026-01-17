/**
 * Base Tool Utilities
 *
 * Provides a declarative way to define tools with:
 * - Type-safe parameter definitions
 * - Automatic Zod schema generation
 * - AI SDK tool conversion
 * - Circuit breaker integration
 * - Consistent message generation
 */

import { tool } from "ai";
import { z } from "zod";
import {
  checkTurnLimit,
  recordToolCall,
} from "../utils/circuit-breaker";
import type {
  ToolDefinition,
  RegisteredTool,
  ParameterDef,
  ToolContext,
  TauriClient,
} from "./types";

/**
 * Create a Zod schema from parameter definitions
 */
export function createZodSchema(
  parameters: Record<string, ParameterDef>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, param] of Object.entries(parameters)) {
    let fieldSchema: z.ZodTypeAny;

    switch (param.type) {
      case "string":
        if (param.enum && param.enum.length > 0) {
          // Create enum schema
          fieldSchema = z.enum(param.enum as [string, ...string[]]);
        } else {
          fieldSchema = z.string();
          if (param.minLength !== undefined) {
            fieldSchema = (fieldSchema as z.ZodString).min(param.minLength);
          }
          if (param.maxLength !== undefined) {
            fieldSchema = (fieldSchema as z.ZodString).max(param.maxLength);
          }
        }
        break;

      case "number":
        fieldSchema = z.number();
        if (param.min !== undefined) {
          fieldSchema = (fieldSchema as z.ZodNumber).min(param.min);
        }
        if (param.max !== undefined) {
          fieldSchema = (fieldSchema as z.ZodNumber).max(param.max);
        }
        break;

      case "boolean":
        fieldSchema = z.boolean();
        break;

      case "object":
        fieldSchema = z.record(z.string(), z.unknown());
        break;

      case "array":
        fieldSchema = z.array(z.unknown());
        break;

      default:
        fieldSchema = z.unknown();
    }

    // Add description if provided
    if (param.description) {
      fieldSchema = fieldSchema.describe(param.description);
    }

    // Handle optional/required and defaults
    if (param.required) {
      shape[name] = fieldSchema;
    } else if (param.default !== undefined) {
      shape[name] = fieldSchema.optional().default(param.default);
    } else {
      shape[name] = fieldSchema.optional();
    }
  }

  return z.object(shape);
}

/**
 * Define a new tool with type-safe configuration
 *
 * @example
 * ```ts
 * const listTables = defineTool({
 *   name: "list_tables",
 *   friendlyName: "List Tables",
 *   description: "Get all tables in a schema",
 *   category: "schema",
 *   capabilities: ["sql"],
 *   parameters: {
 *     schema: { type: "string", default: "public" },
 *   },
 *   messages: {
 *     pending: (input) => `Listing tables in ${input.schema}...`,
 *     success: (_, output) => `Found ${output.length} tables`,
 *     error: (_, err) => `Failed: ${err.message}`,
 *   },
 *   execute: async ({ schema }, ctx, tauri) => {
 *     return tauri.invoke("ai_sql_execute", {
 *       connId: ctx.connectionId,
 *       operation: { type: "list_tables", schema },
 *     });
 *   },
 * });
 * ```
 */
export function defineTool<TInput extends Record<string, unknown>, TOutput>(
  definition: ToolDefinition<TInput, TOutput>
): RegisteredTool<TInput, TOutput> {
  const schema = createZodSchema(definition.parameters) as z.ZodType<TInput>;

  return {
    ...definition,
    schema,
  };
}

/**
 * Convert a registered tool to an AI SDK compatible tool
 *
 * Wraps execution with:
 * - Circuit breaker checks
 * - Error handling
 * - Tool call recording
 */
export function createAiSdkTool<TInput extends Record<string, unknown>, TOutput>(
  registeredTool: RegisteredTool<TInput, TOutput>,
  ctx: ToolContext,
  tauri: TauriClient
): ReturnType<typeof tool> {
  return tool({
    description: registeredTool.description,
    parameters: registeredTool.schema,
    execute: async (input: TInput) => {
      const { conversationId } = ctx;

      // Check circuit breaker before execution
      const check = checkTurnLimit(conversationId, registeredTool.name);
      if (!check.allowed) {
        return {
          success: false,
          error: check.reason,
          errorCode: "CIRCUIT_BREAKER",
        };
      }

      try {
        // Execute the tool
        const result = await registeredTool.execute(input, ctx, tauri);

        // Record successful call
        recordToolCall(conversationId, registeredTool.name, true);

        return result;
      } catch (error) {
        // Record failed call
        recordToolCall(conversationId, registeredTool.name, false);

        // Return error result
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          errorCode: "EXECUTION_FAILED",
        };
      }
    },
  });
}

/**
 * Create multiple AI SDK tools from registered tools
 */
export function createAiSdkTools(
  tools: RegisteredTool[],
  ctx: ToolContext,
  tauri: TauriClient
): Record<string, ReturnType<typeof tool>> {
  const result: Record<string, ReturnType<typeof tool>> = {};

  for (const registeredTool of tools) {
    result[registeredTool.name] = createAiSdkTool(registeredTool, ctx, tauri);
  }

  return result;
}

/**
 * Filter tools by capabilities
 */
export function filterToolsByCapabilities<T extends RegisteredTool>(
  tools: T[],
  capabilities: string[]
): T[] {
  return tools.filter((tool) =>
    tool.capabilities.some((cap) => capabilities.includes(cap))
  );
}

/**
 * Get tool metadata for UI display
 */
export function getToolMetadata(tool: RegisteredTool) {
  return {
    name: tool.name,
    friendlyName: tool.friendlyName,
    description: tool.description,
    category: tool.category,
    icon: tool.icon,
    capabilities: tool.capabilities,
    parameters: Object.entries(tool.parameters).map(([name, def]) => ({
      name,
      type: def.type,
      required: def.required || false,
      default: def.default,
      description: def.description,
    })),
  };
}
