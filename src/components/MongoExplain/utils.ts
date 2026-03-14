import type { MongoExplainResult } from "@/adapters/types/mongodb";

/**
 * Extract summary statistics from a MongoDB explain result for display
 * in the stats bar.
 */
export function getExplainSummary(
  result: MongoExplainResult | null,
): Array<{ label: string; value: string }> {
  if (!result || typeof result !== "object") {
    return [];
  }

  const record = result as Record<string, unknown>;
  const stats =
    record.executionStats && typeof record.executionStats === "object"
      ? (record.executionStats as Record<string, unknown>)
      : undefined;
  const planner =
    record.queryPlanner && typeof record.queryPlanner === "object"
      ? (record.queryPlanner as Record<string, unknown>)
      : undefined;
  const winningPlan =
    planner?.winningPlan && typeof planner.winningPlan === "object"
      ? (planner.winningPlan as Record<string, unknown>)
      : undefined;

  const summary: Array<{ label: string; value: string }> = [];
  if (typeof winningPlan?.stage === "string") {
    summary.push({ label: "Winning stage", value: winningPlan.stage });
  }
  if (typeof stats?.nReturned === "number") {
    summary.push({ label: "Returned", value: String(stats.nReturned) });
  }
  if (typeof stats?.totalDocsExamined === "number") {
    summary.push({
      label: "Docs examined",
      value: String(stats.totalDocsExamined),
    });
  }
  if (typeof stats?.totalKeysExamined === "number") {
    summary.push({
      label: "Keys examined",
      value: String(stats.totalKeysExamined),
    });
  }
  if (typeof stats?.executionTimeMillis === "number") {
    summary.push({
      label: "Execution ms",
      value: String(stats.executionTimeMillis),
    });
  }

  return summary;
}

/**
 * Build a sort object from grid sort columns for the explain request.
 */
export function getSortObject(
  sortColumns: Array<{ columnId: string; direction: "asc" | "desc" }>,
): Record<string, 1 | -1> | undefined {
  if (sortColumns.length === 0) {
    return undefined;
  }

  return sortColumns.reduce<Record<string, 1 | -1>>((acc, sort) => {
    acc[sort.columnId] = sort.direction === "desc" ? -1 : 1;
    return acc;
  }, {});
}
