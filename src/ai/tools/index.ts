import type { ToolSet } from "ai";
import { createQueryDatabaseTool } from "./queryDatabase";
import { createListTablesTool } from "./listTables";
import { createDescribeTableTool } from "./describeTable";
import { createGetCurrentContextTool } from "./getCurrentContext";
import { createListConnectionsTool } from "./listConnections";
import { createGetQueryHistoryTool } from "./getQueryHistory";
import { createGetExecutionPlanTool } from "./getExecutionPlan";

export interface ToolContext {
  connectionId: string;
  getEditorContext: () => {
    connectionId: string | null;
    database: string | null;
    schema: string | null;
    editorContent: string | null;
  };
}

export function createTools(ctx: ToolContext): ToolSet {
  return {
    queryDatabase: createQueryDatabaseTool(ctx.connectionId),
    listTables: createListTablesTool(ctx.connectionId),
    describeTable: createDescribeTableTool(ctx.connectionId),
    getCurrentContext: createGetCurrentContextTool(ctx.getEditorContext),
    listConnections: createListConnectionsTool(),
    getQueryHistory: createGetQueryHistoryTool(),
    getExecutionPlan: createGetExecutionPlanTool(ctx.connectionId),
  };
}
