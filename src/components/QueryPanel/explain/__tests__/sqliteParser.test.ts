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

  it("captures SQLite index usage and temp b-tree purpose details", () => {
    const parsed = parseSQLiteExplainQueryPlan({
      columns: ["id", "parent", "notused", "detail"],
      rows: [
        [2, 0, 0, "SEARCH o USING INDEX idx_orders_status (status=?)"],
        [8, 2, 0, "SEARCH c USING INTEGER PRIMARY KEY (rowid=?)"],
        [9, 2, 0, "USE TEMP B-TREE FOR GROUP BY"],
        [10, 2, 0, "USE TEMP B-TREE FOR ORDER BY"],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    const root = parsed.nodes[0];
    expect(root?.indexName).toBe("idx_orders_status");
    expect(root?.indexCond).toBe("status=?");

    const children = root?.children ?? [];
    expect(children[0]?.indexName).toBe("INTEGER PRIMARY KEY");
    expect(children[0]?.indexCond).toBe("rowid=?");

    expect(children[1]?.groupKey).toEqual(["TEMP B-TREE FOR GROUP BY"]);
    expect(children[2]?.sortKey).toEqual(["TEMP B-TREE FOR ORDER BY"]);
  });

  it("parses extended SQLite operators for compound/multi-index plans", () => {
    const parsed = parseSQLiteExplainQueryPlan({
      columns: ["id", "parent", "notused", "detail"],
      rows: [
        [1, 0, 0, "COMPOUND QUERY"],
        [2, 1, 0, "MATERIALIZE subq"],
        [3, 2, 0, "MULTI-INDEX OR"],
        [4, 3, 0, "SEARCH o USING INDEX idx_orders_status (status=?)"],
        [5, 3, 0, "SEARCH o USING INDEX idx_orders_created (created_at>=?)"],
        [6, 2, 0, "USE TEMP B-TREE FOR DISTINCT"],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe("COMPOUND QUERY");

    const materialized = parsed.nodes[0]?.children?.[0];
    expect(materialized?.type).toBe("MATERIALIZE");
    expect(materialized?.relation).toBe("subq");

    const multiIndexOr = materialized?.children?.[0];
    expect(multiIndexOr?.type).toBe("MULTI-INDEX OR");
    expect(multiIndexOr?.children?.[0]?.indexName).toBe("idx_orders_status");
    expect(multiIndexOr?.children?.[1]?.indexName).toBe("idx_orders_created");

    expect(materialized?.children?.[1]?.groupKey).toEqual([
      "TEMP B-TREE FOR DISTINCT",
    ]);
  });
});
