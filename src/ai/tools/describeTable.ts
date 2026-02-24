import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";

export function createDescribeTableTool(connectionId: string) {
  return tool({
    description:
      "Get the column names, data types, and constraints for a specific table. Use this before writing queries to ensure correct column names.",
    inputSchema: z.object({
      table: z.string().describe("Table name to describe"),
      schema: z
        .string()
        .optional()
        .describe("Schema name. Omit for default schema."),
    }),
    execute: async ({ table, schema }) => {
      try {
        const qualifiedTable = schema ? `${schema}.${table}` : table;
        const sql = `SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = '${table}'${schema ? ` AND table_schema = '${schema}'` : ""}
          ORDER BY ordinal_position`;

        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 10 });

        return {
          success: true as const,
          table: qualifiedTable,
          columns: result.rows.map((r) => ({
            name: r[0] as string,
            type: r[1] as string,
            nullable: r[2] === "YES",
            default: r[3] as string | null,
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
