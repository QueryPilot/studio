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
      "Get the current editor context: active connection, database, schema, and SQL in the editor.",
    inputSchema: z.object({}),
    execute: () => {
      try {
        const ctx = getContext();

        let output = "## Current Editor Context\n\n";
        output += `**Connection:** ${ctx.connectionId ?? "none"}\n`;
        output += `**Database:** ${ctx.database ?? "none"}\n`;
        output += `**Schema:** ${ctx.schema ?? "none"}\n`;

        if (ctx.editorContent) {
          output += `\n**Current Query:**\n\`\`\`sql\n${ctx.editorContent}\n\`\`\``;
        } else {
          output += "\n**Current Query:** (editor is empty)";
        }

        return output;
      } catch (error) {
        return `Error retrieving editor context: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}
