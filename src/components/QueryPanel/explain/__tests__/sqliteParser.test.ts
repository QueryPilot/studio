import { describe, expect, it } from "vitest";
import { parseSQLiteExplainQueryPlan } from "../parsers/sqlite";

describe("parseSQLiteExplainQueryPlan", () => {
  it("builds a tree from id/parent/detail rows", () => {
    const parsed = parseSQLiteExplainQueryPlan({
      columns: ["id", "parent", "notused", "detail"],
      rows: [
        [2, 0, 0, "SCAN reviews"],
        [8, 2, 0, "SEARCH customers USING INTEGER PRIMARY KEY (rowid=?)"],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe("SCAN");
    expect(parsed.nodes[0]?.relation).toBe("reviews");

    const child = parsed.nodes[0]?.children?.[0];
    expect(child?.type).toBe("SEARCH");
    expect(child?.relation).toBe("customers");
    expect(child?.raw).toContain("INTEGER PRIMARY KEY");
  });

  it("returns empty nodes for non-EQP shape", () => {
    const parsed = parseSQLiteExplainQueryPlan({
      columns: ["query_plan"],
      rows: [["some plan text"]],
    });

    expect(parsed.nodes).toHaveLength(0);
  });

  it("extracts relation names from legacy SCAN/SEARCH TABLE details", () => {
    const parsed = parseSQLiteExplainQueryPlan({
      columns: ["id", "parent", "notused", "detail"],
      rows: [
        [2, 0, 0, "SCAN TABLE users"],
        [3, 2, 0, "SEARCH TABLE orders USING INTEGER PRIMARY KEY (rowid=?)"],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.relation).toBe("users");
    expect(parsed.nodes[0]?.children?.[0]?.relation).toBe("orders");
  });
});
