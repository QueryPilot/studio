import { describe, expect, it } from "vitest";
import type { QueryResult } from "@/stores/tabStateStore";
import {
  buildResultViewPresentation,
  isExplainStatement,
} from "./query-result-view";

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: ["id"],
    rows: [[1]],
    rowCount: 1,
    ...overrides,
  };
}

describe("query-result-view", () => {
  it("detects EXPLAIN statements with leading comments", () => {
    expect(isExplainStatement("-- note\nEXPLAIN SELECT 1")).toBe(true);
    expect(isExplainStatement("/* note */ EXPLAIN ANALYZE SELECT 1")).toBe(true);
    expect(isExplainStatement("SELECT 1")).toBe(false);
  });

  it("returns explain modes for explain statements and preserves previous mode", () => {
    const presentation = buildResultViewPresentation({
      sql: "EXPLAIN SELECT 1",
      result: makeResult({
        columns: ["QUERY PLAN"],
        rows: [["Seq Scan on users"]],
      }),
      previousMode: "raw",
    });

    expect(presentation.supportedModes).toEqual(["explain", "raw", "stats"]);
    expect(presentation.mode).toBe("raw");
    expect(presentation.isExplainLike).toBe(true);
  });

  it("hides modes for non-tabular results", () => {
    const presentation = buildResultViewPresentation({
      sql: "UPDATE users SET name = 'x'",
      result: makeResult({
        columns: [],
        rows: [],
        rowCount: 0,
        message: "Query executed successfully",
      }),
    });

    expect(presentation.supportedModes).toEqual([]);
    expect(presentation.mode).toBe("table");
  });
});
