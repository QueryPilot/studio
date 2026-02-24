import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";

export function createQueryDatabaseTool(connectionId: string) {
  return tool({
    description:
      "Execute a read-only SQL query against the connected database. Returns column names and rows. Use this to answer questions about the user's data.",
    inputSchema: z.object({
      sql: z.string().describe("The SQL SELECT query to execute"),
    }),
    execute: async ({ sql }) => {
      try {
        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 30 });

        const columns = result.columns.map((c) => c.name);
        const preview = result.rows.slice(0, 50);
        return {
          success: true as const,
          columns,
          rowCount: result.rows.length,
          rows: preview,
          truncated: result.rows.length > 50,
        };
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
