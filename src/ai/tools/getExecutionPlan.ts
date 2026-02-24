import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";

export function createGetExecutionPlanTool(connectionId: string) {
  return tool({
    description:
      "Get the query execution plan (EXPLAIN) for a SQL query. Use this to analyze query performance and suggest optimizations.",
    inputSchema: z.object({
      sql: z.string().describe("The SQL query to analyze"),
      analyze: z
        .boolean()
        .optional()
        .describe(
          "If true, run EXPLAIN ANALYZE for actual execution stats. Default false.",
        ),
    }),
    execute: async ({ sql, analyze }) => {
      try {
        const trimmed = sql.trim().toUpperCase();
        const allowedPrefixes = [
          "SELECT",
          "WITH",
          "TABLE",
          "VALUES",
          "SHOW",
        ];
        if (!allowedPrefixes.some((p) => trimmed.startsWith(p))) {
          return "Error: EXPLAIN only supports SELECT/WITH/SHOW queries.";
        }

        const explainPrefix = analyze ? "EXPLAIN ANALYZE " : "EXPLAIN ";
        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", {
          connId: connectionId,
          sql: explainPrefix + sql,
          timeoutSecs: 30,
        });

        if (result.rows.length === 0) {
          return "No execution plan available.";
        }

        // EXPLAIN output is typically a single column with text rows
        const plan = result.rows.map((r) => String(r[0])).join("\n");

        let output = "## Query Execution Plan\n\n";
        if (analyze) {
          output +=
            "*Note: This is an ANALYZED plan with actual execution statistics.*\n\n";
        }
        output += "```\n" + plan + "\n```";

        return output;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
