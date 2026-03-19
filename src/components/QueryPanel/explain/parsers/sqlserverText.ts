import type { ParsedExplain } from "../types";

interface ParseSqlServerTextInput {
  columns: string[];
  rows: unknown[][];
}

export function parseSqlServerTextShowplan(
  input: ParseSqlServerTextInput,
): ParsedExplain {
  const raw = input.rows
    .map((row) => {
      const value = row[0];
      if (typeof value === "string") return value;
      if (value == null) return "";
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
      }
      return "";
    })
    .join("\n");

  return {
    nodes: [],
    totalCost: 0,
    raw,
  };
}
