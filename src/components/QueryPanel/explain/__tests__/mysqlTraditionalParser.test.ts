import { describe, expect, it } from "vitest";
import { parseMySqlTraditionalExplain } from "../parsers/mysql";

describe("parseMySqlTraditionalExplain", () => {
  it("parses tabular EXPLAIN output into nodes", () => {
    const parsed = parseMySqlTraditionalExplain({
      columns: ["id", "select_type", "table", "type", "rows", "filtered", "Extra"],
      rows: [
        ["1", "SIMPLE", "reviews", "ALL", "1200", "100.00", "Using where"],
        ["1", "SIMPLE", "customers", "eq_ref", "1", "100.00", "Using index"],
      ],
    });

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]?.type).toBe("ALL");
    expect(parsed.nodes[0]?.relation).toBe("reviews");
    expect(parsed.nodes[0]?.rows).toBe(1200);
    expect(parsed.nodes[0]?.raw).toContain("Using where");

    expect(parsed.nodes[1]?.type).toBe("eq_ref");
    expect(parsed.nodes[1]?.relation).toBe("customers");
  });

  it("returns empty nodes when not a traditional EXPLAIN shape", () => {
    const parsed = parseMySqlTraditionalExplain({
      columns: ["query_plan"],
      rows: [["something else"]],
    });

    expect(parsed.nodes).toHaveLength(0);
  });
});
