import { tool } from "ai";
import { z } from "zod/v4";

export function createGetCurrentContextTool(
  getContext: () => {
    connectionId: string | null;
    database: string | null;
    schema: string | null;
    editorContent: string | null;
  },
) {
  return tool({
    description:
      "Get the current focused tab/editor context including connection, database, schema, and editor SQL.",
    inputSchema: z.object({}),
    execute: () => {
      try {
        const ctx = getContext();
        return {
          connectionId: ctx.connectionId,
          database: ctx.database,
          schema: ctx.schema,
          editorContent: ctx.editorContent,
        };
      } catch (error) {
        return {
          error:
            error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
