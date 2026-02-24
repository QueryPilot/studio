import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";
import { sanitizeIdentifier } from "./index";

export function createDescribeTableTool(connectionId: string) {
  return tool({
    description:
      "Get the column names, data types, and constraints for a specific table. Use this before writing queries to ensure correct column names and types.",
    inputSchema: z.object({
      table: z.string().describe("Table name to describe"),
      schema: z
        .string()
        .optional()
        .describe("Schema name. Omit for default schema."),
    }),
    execute: async ({ table, schema }) => {
      try {
        const safeTable = sanitizeIdentifier(table);
        const safeSchema = schema ? sanitizeIdentifier(schema) : undefined;
        const qualifiedTable = safeSchema
          ? `${safeSchema}.${safeTable}`
          : safeTable;
        const sql = `SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = '${safeTable}'${safeSchema ? ` AND table_schema = '${safeSchema}'` : ""}
          ORDER BY ordinal_position`;

        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 10 });

        if (result.rows.length === 0) {
          return `Table "${qualifiedTable}" not found or has no columns.`;
        }

        // Prepare column data
        const columns = result.rows.map((r) => {
          const toStr = (v: unknown): string =>
            typeof v === "string" ? v : JSON.stringify(v ?? "");
          return {
            name: toStr(r[0]),
            type: toStr(r[1]),
            nullable: toStr(r[2]),
            default: r[3] != null ? toStr(r[3]) : "-",
          };
        });

        // Calculate column widths
        const headers = ["Column", "Type", "Nullable", "Default"] as const;
        let wCol = headers[0].length;
        let wType = headers[1].length;
        let wNull = headers[2].length;
        let wDef = headers[3].length;
        for (const col of columns) {
          wCol = Math.max(wCol, col.name.length);
          wType = Math.max(wType, col.type.length);
          wNull = Math.max(wNull, col.nullable.length);
          wDef = Math.max(wDef, Math.min(col.default.length, 30));
        }

        // Build output
        let output = `Table: ${qualifiedTable}\n`;
        output += "=".repeat(50) + "\n\n";

        // Header
        output +=
          [
            "Column".padEnd(wCol),
            "Type".padEnd(wType),
            "Nullable".padEnd(wNull),
            "Default".padEnd(wDef),
          ].join(" | ") + "\n";
        output +=
          ["-".repeat(wCol), "-".repeat(wType), "-".repeat(wNull), "-".repeat(wDef)].join(
            "-+-",
          ) + "\n";

        // Rows
        for (const col of columns) {
          const defaultDisplay =
            col.default.length > 30
              ? col.default.slice(0, 27) + "..."
              : col.default;
          output +=
            [
              col.name.padEnd(wCol),
              col.type.padEnd(wType),
              col.nullable.padEnd(wNull),
              defaultDisplay.padEnd(wDef),
            ].join(" | ") + "\n";
        }

        output += `\nTotal columns: ${columns.length}`;
        return output;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
