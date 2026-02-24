import { tool } from "ai";
import { z } from "zod/v4";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_CELL_WIDTH = 50;

function truncateCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length > MAX_CELL_WIDTH) {
    return str.slice(0, MAX_CELL_WIDTH - 3) + "...";
  }
  return str;
}

function formatAsciiTable(
  columns: string[],
  rows: string[][],
  totalRows: number,
  truncated: boolean,
): string {
  if (columns.length === 0) return "(no columns)\n\n(0 rows)";

  // Calculate column widths
  const widths = columns.map((col) => col.length);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      widths[i] = Math.max(widths[i] ?? 0, row[i]?.length ?? 0);
    }
  }

  // Build header
  const header = columns
    .map((col, i) => col.padEnd(widths[i] ?? 0))
    .join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-+-");

  // Build rows
  const formattedRows = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join(" | "),
  );

  let output = header + "\n" + separator + "\n";
  output += formattedRows.join("\n");
  output += `\n\n(${String(totalRows)} row${totalRows !== 1 ? "s" : ""})`;

  if (truncated) {
    output += "\n(output truncated)";
  }

  return output;
}

export function createQueryDatabaseTool(connectionId: string) {
  return tool({
    description:
      "Execute a read-only SQL query against the connected database. Returns results as a formatted table. Use this to answer questions about the user's data.",
    inputSchema: z.object({
      sql: z.string().describe("The SQL SELECT query to execute"),
      database: z
        .string()
        .optional()
        .describe("Target database name (if different from current)"),
      schema: z
        .string()
        .optional()
        .describe("Target schema name (if different from current)"),
      limit: z
        .number()
        .optional()
        .describe(
          "Maximum number of rows to return. Default 100, max 500.",
        ),
    }),
    execute: async ({ sql, limit }) => {
      try {
        const effectiveLimit = Math.min(
          Math.max(limit ?? DEFAULT_LIMIT, 1),
          MAX_LIMIT,
        );

        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 30 });

        const columns = result.columns.map((c) => c.name);
        const totalRows = result.rows.length;
        const truncated = totalRows > effectiveLimit;
        const displayRows = result.rows.slice(0, effectiveLimit);

        const formattedRows = displayRows.map((row) =>
          row.map((cell) => truncateCell(cell)),
        );

        return formatAsciiTable(columns, formattedRows, totalRows, truncated);
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
