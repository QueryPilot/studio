import { tool } from "ai";
import { z } from "zod/v4";

export function createGetCurrentContextTool(
  getContext: () => {
    connectionId: string | null;
    database: string | null;
    schema: string | null;
    editorContent: string | null;
  }
) {
  return tool({
    description:
      "Get the current editor context: active connection, database, schema, and SQL in the editor.",
    inputSchema: z.object({}),
    execute: () => {
      return Promise.resolve(getContext());
    },
  });
}
