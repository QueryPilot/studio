import type { ToolSet } from "ai";
import { createQueryDatabaseTool } from "./queryDatabase";
import { createListTablesTool } from "./listTables";
import { createDescribeTableTool } from "./describeTable";
import { createGetCurrentContextTool } from "./getCurrentContext";
import { createListConnectionsTool } from "./listConnections";
import { createGetQueryHistoryTool } from "./getQueryHistory";
import { createGetExecutionPlanTool } from "./getExecutionPlan";

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

export function createTools(ctx: ToolContext, options?: { autoExecuteQueries?: boolean }): ToolSet {
  const tools: ToolSet = {
    listTables: createListTablesTool(ctx.connectionId),
    describeTable: createDescribeTableTool(ctx.connectionId),
    getCurrentContext: createGetCurrentContextTool(ctx.getEditorContext),
    listConnections: createListConnectionsTool(),
    getQueryHistory: createGetQueryHistoryTool(),
  };

  if (options?.autoExecuteQueries !== false) {
    tools.queryDatabase = createQueryDatabaseTool(ctx.connectionId);
    tools.getExecutionPlan = createGetExecutionPlanTool(ctx.connectionId);
  }

  return tools;
}
