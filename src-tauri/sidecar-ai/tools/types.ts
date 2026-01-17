/**
 * Tool Definition Types
 *
 * Declarative tool definitions with metadata for UI rendering,
 * capability filtering, and dynamic message generation.
 */

import { z } from "zod";

/**
 * Database paradigm capabilities
 */
export type Capability = "sql" | "document" | "keyvalue";

/**
 * Parameter definition for a tool
 */
export interface ParameterDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  default?: unknown;
  description?: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

/**
 * Tool execution context
 */
export interface ToolContext {
  connectionId: string;
  conversationId: string;
  schema?: string;
  database?: string;
}

/**
 * Tool invocation for HTTP API
 */
export interface TauriClient {
  invoke<T = unknown>(command: string, args: Record<string, unknown>): Promise<T>;
}

/**
 * Tool messages for pending/success/error states
 */
export interface ToolMessages<TInput, TOutput> {
  pending: (input: TInput) => string;
  success: (input: TInput, output: TOutput) => string;
  error: (input: TInput, err: Error) => string;
}

/**
 * Tool definition with metadata
 */
export interface ToolDefinition<TInput = Record<string, unknown>, TOutput = unknown> {
  /** Internal tool name (snake_case) */
  name: string;

  /** Human-readable name for UI */
  friendlyName: string;

  /** Description for AI prompt */
  description: string;

  /** Category for grouping (schema, query, data, etc.) */
  category: string;

  /** Icon name for UI (optional) */
  icon?: string;

  /** Which database paradigms this tool supports */
  capabilities: Capability[];

  /** Parameter definitions */
  parameters: Record<string, ParameterDef>;

  /** Dynamic message generators */
  messages: ToolMessages<TInput, TOutput>;

  /** Tool execution function */
  execute: (input: TInput, ctx: ToolContext, tauri: TauriClient) => Promise<TOutput>;
}

/**
 * Registered tool with Zod schema
 */
export interface RegisteredTool<TInput = Record<string, unknown>, TOutput = unknown>
  extends ToolDefinition<TInput, TOutput> {
  /** Generated Zod schema */
  schema: z.ZodType<TInput>;
}

/**
 * Tool result wrapper
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  fromCache?: boolean;
}

/**
 * Tool category for organization
 */
export type ToolCategory =
  | "schema" // Schema exploration (list_tables, get_structure)
  | "query" // Query execution (execute_query, explain)
  | "data" // Data operations (sample_data, search)
  | "metadata" // Metadata (indexes, constraints, FKs)
  | "analysis" // Analysis (statistics, relationships)
  | "keyvalue" // Redis-specific
  | "document"; // MongoDB-specific
