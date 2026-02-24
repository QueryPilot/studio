import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";

export function createListTablesTool(connectionId: string) {
  return tool({
    description:
      "List all tables and views in the current database schema. Use this to understand what data is available.",
    inputSchema: z.object({
      schema: z
        .string()
        .optional()
        .describe(
          "Schema name to list tables from. Omit for default schema."
        ),
    }),
    execute: async ({ schema }) => {
      try {
        const sql = schema
          ? `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = '${schema}' ORDER BY table_name`
          : `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog') ORDER BY table_name`;

        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 10 });

        return {
          success: true as const,
          tables: result.rows.map((r) => ({
            name: r[0] as string,
            type: r[1] as string,
          })),
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
