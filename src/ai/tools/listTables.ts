import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";
import { sanitizeIdentifier } from "./index";

export function createListTablesTool(connectionId: string) {
  return tool({
    description:
      "List all tables and views in the current database. Use this to understand what data is available before writing queries.",
    inputSchema: z.object({
      database: z
        .string()
        .optional()
        .describe("Target database name (if different from current)"),
      schema: z
        .string()
        .optional()
        .describe(
          "Schema name to list tables from. Omit to list all non-system schemas.",
        ),
    }),
    execute: async ({ schema }) => {
      try {
        const safeSchema = schema ? sanitizeIdentifier(schema) : undefined;
        const sql = safeSchema
          ? `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = '${safeSchema}' ORDER BY table_schema, table_name`
          : `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog') ORDER BY table_schema, table_name`;

        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 10 });

        if (result.rows.length === 0) {
          return schema
            ? `No tables found in schema "${schema}".`
            : "No tables found in non-system schemas.";
        }

        // Group by schema
        const bySchema = new Map<
          string,
          Array<{ name: string; type: string }>
        >();
        for (const row of result.rows) {
          const schemaName = String(row[0]);
          const tableName = String(row[1]);
          const tableType = String(row[2]);
          const existing = bySchema.get(schemaName);
          if (existing) {
            existing.push({ name: tableName, type: tableType });
          } else {
            bySchema.set(schemaName, [{ name: tableName, type: tableType }]);
          }
        }

        let output = "";
        for (const [schemaName, tables] of bySchema) {
          output += `Schema: ${schemaName}\n`;
          output += "----------------------------------------\n";
          for (const t of tables) {
            output += `  - ${t.name} (${t.type})\n`;
          }
          output += "\n";
        }

        output += `Total: ${result.rows.length} table${result.rows.length !== 1 ? "s" : ""}`;
        return output;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
