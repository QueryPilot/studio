import { tool } from "ai";
import { z } from "zod/v4";
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";

const MAX_QUERY_DISPLAY = 80;

function truncateQuery(sql: string): string {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  if (oneLine.length > MAX_QUERY_DISPLAY) {
    return oneLine.slice(0, MAX_QUERY_DISPLAY - 3) + "...";
  }
  return oneLine;
}

export function createGetQueryHistoryTool() {
  return tool({
    description:
      "Get recent query execution history. Shows the SQL, status, execution time, and row count for recently executed queries.",
    inputSchema: z.object({
      limit: z
        .number()
        .optional()
        .describe("Maximum number of history entries to return. Default 20."),
    }),
    execute: ({ limit }) => {
      const effectiveLimit = Math.min(Math.max(limit ?? 20, 1), 100);
      const history = useQueryHistoryStore.getState().recentHistory;

      if (history.length === 0) {
        return "No query history available. Execute some queries first.";
      }

      const entries = history.slice(0, effectiveLimit);

      let output = "## Recent Query History\n\n";
      let idx = 1;
      for (const entry of entries) {
        const status = entry.success ? "OK" : "FAIL";
        const query = truncateQuery(entry.query);
        let detail = "";
        if (entry.success) {
          const parts: string[] = [];
          if (entry.executionTimeMs != null) {
            parts.push(`${entry.executionTimeMs}ms`);
          }
          if (entry.rowCount != null) {
            parts.push(
              `${entry.rowCount} row${entry.rowCount !== 1 ? "s" : ""}`,
            );
          }
          if (parts.length > 0) {
            detail = ` (${parts.join(", ")})`;
          }
        } else if (entry.error) {
          detail = ` -- ${entry.error}`;
        }
        output += `${idx}. [${status}] \`${query}\`${detail}\n`;
        idx++;
      }

      if (history.length > effectiveLimit) {
        output += `\n(showing ${effectiveLimit} of ${history.length} entries)`;
      }

      return output;
    },
  });
}
