import { tool, type ToolSet } from "ai";
import { z } from "zod/v4";
import { nanoid } from "nanoid";
import {
  COMMAND_META,
  type AiCommandName,
  type ParsedCommand,
} from "@/types/aiCommands";
import { executeCommand } from "@/services/aiCommandExecutor";

/** Only allow safe SQL identifier characters (letters, digits, underscores, spaces, dots) */
export function sanitizeIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_ .]*$/.test(value)) {
    throw new Error(`Invalid identifier: "${value}"`);
  }
  return value;
}

export interface ToolContext {
  connectionId: string;
  getEditorContext: () => {
    connectionId: string | null;
    database: string | null;
    schema: string | null;
    editorContent: string | null;
  };
}

const APPROVAL_REQUIRED_CAPABILITIES = new Set<AiCommandName>([
  "crud.stage",
]);

const CAPABILITY_INPUT_SCHEMAS: Record<AiCommandName, z.ZodType> = {
  "workspace.listTabs": z.object({}),
  "workspace.getFocusedTab": z.object({}),
  "workspace.getTabContext": z.object({
    tabId: z.string(),
  }),
  "tab.create": z.object({
    connectionId: z.string(),
    title: z.string().optional(),
    content: z.string().optional(),
    database: z.string().optional(),
    schema: z.string().optional(),
  }),
  "tab.focus": z.object({
    tabId: z.string(),
  }),
  "tab.updateContent": z.object({
    tabId: z.string().optional(),
    content: z.string().optional(),
    title: z.string().optional(),
    mode: z.enum(["replace", "append", "prepend"]).optional(),
  }),
  "editor.insert": z.object({
    text: z.string(),
    position: z.enum(["cursor", "end", "replace"]).optional(),
  }),
  "query.run": z.object({
    connectionId: z.string(),
    query: z.string(),
    language: z.enum(["sql", "mongo", "redis"]).optional(),
    title: z.string().optional(),
    database: z.string().optional(),
    schema: z.string().optional(),
    timeoutSecs: z.number().int().positive().max(300).optional(),
  }),
  "grid.setFilter": z.object({
    tabId: z.string().optional(),
    filter: z.string(),
  }),
  "grid.setSort": z.object({
    tabId: z.string().optional(),
    column: z.string(),
    direction: z.enum(["asc", "desc"]),
  }),
  "grid.setView": z.object({
    tabId: z.string().optional(),
    view: z.string(),
  }),
  "crud.stage": z.object({
    connectionId: z.string(),
    database: z.string().optional(),
    schema: z.string().optional(),
    table: z.string().optional(),
    collection: z.string().optional(),
    operation: z.enum(["insert", "update", "delete"]),
    document: z.record(z.string(), z.unknown()).optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
    update: z.record(z.string(), z.unknown()).optional(),
    primaryKeys: z.record(z.string(), z.unknown()).optional(),
    description: z.string().optional(),
  }),
  "crud.unstage": z.object({
    scope: z.enum(["id", "table", "all"]),
    commandId: z.string().optional(),
    table: z.string().optional(),
    connectionId: z.string().optional(),
  }),
};

function buildCapabilityCommand(
  name: AiCommandName,
  params: Record<string, unknown>,
): ParsedCommand<Record<string, unknown>> {
  return {
    id: `byok-${nanoid(10)}`,
    name,
    params,
    raw: `tool:${name}`,
    startIndex: 0,
    endIndex: 0,
    confidence: "high",
  };
}

function createCapabilityTool(name: AiCommandName) {
  const schema = CAPABILITY_INPUT_SCHEMAS[name];
  const meta = COMMAND_META[name];
  return tool({
    description: `${meta.description}. Capability ID: ${name}`,
    inputSchema: schema,
    execute: async (input: unknown) => {
      if (APPROVAL_REQUIRED_CAPABILITIES.has(name)) {
        return {
          type: "execution-denied" as const,
          reason:
            "This capability requires explicit user approval via qp-action blocks.",
          capability: name,
        };
      }

      const params =
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      const result = await executeCommand(buildCapabilityCommand(name, params));
      if (!result.success) {
        return {
          error: result.error,
          capability: name,
        };
      }
      return result.data;
    },
  });
}

export function createTools(ctx: ToolContext): ToolSet {
  // Capability tools are intentionally parity-aligned with ACP runtime names/schemas.
  // Keep context parameter references to preserve ToolContext contract.
  void ctx;
  const tools: ToolSet = {};

  (Object.keys(CAPABILITY_INPUT_SCHEMAS) as AiCommandName[]).forEach(
    (capabilityName) => {
      tools[capabilityName] = createCapabilityTool(capabilityName);
    },
  );

  return tools;
}
