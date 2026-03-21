import type { ParsedExplain } from "../types";
import { formatCell } from "./utils";

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
      if (value == null) return "";
      return formatCell(value);
    })
    .join("\n");

  return {
    nodes: [],
    totalCost: 0,
    raw,
  };
}
