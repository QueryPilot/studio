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

describe("buildResultViewPresentation - MSSQL SHOWPLAN", () => {
  it("forces explain mode when showplanFormat is provided", () => {
    const result = buildResultViewPresentation({
      sql: "SET SHOWPLAN_ALL ON\nSELECT * FROM orders\nSET SHOWPLAN_ALL OFF",
      result: {
        columns: ["NodeId", "Parent", "PhysicalOp", "LogicalOp"],
        rows: [[1, 0, "Scan", "Scan"]],
        rowCount: 1,
      },
      showplanFormat: "all",
    });
    expect(result.isExplainLike).toBe(true);
    expect(result.mode).toBe("explain");
    expect(result.supportedModes).toEqual(["explain", "raw", "stats"]);
  });

  it("forces raw mode for SHOWPLAN_TEXT", () => {
    const result = buildResultViewPresentation({
      sql: "SET SHOWPLAN_TEXT ON\nSELECT 1\nSET SHOWPLAN_TEXT OFF",
      result: {
        columns: ["StmtText"],
        rows: [["  |--Constant Scan"]],
        rowCount: 1,
      },
      showplanFormat: "text",
    });
    expect(result.isExplainLike).toBe(true);
    expect(result.mode).toBe("raw");
    expect(result.supportedModes).toEqual(["raw"]);
  });

  it("does not force explain when showplanFormat is null", () => {
    const result = buildResultViewPresentation({
      sql: "SELECT * FROM orders",
      result: {
        columns: ["id", "name"],
        rows: [[1, "test"]],
        rowCount: 1,
      },
    });
    expect(result.isExplainLike).toBe(false);
    expect(result.mode).toBe("table");
  });
});
