import { describe, expect, it } from "vitest";
import { parseMySqlExplain } from "../parsers/mysql";

describe("parseMySqlExplain JSON/TREE", () => {
  it("parses FORMAT=JSON output", () => {
    const jsonPlan = {
      query_block: {
        select_id: 1,
        table: {
          table_name: "users",
          access_type: "ALL",
          rows_examined_per_scan: 1000,
        },
      },
    };

    const parsed = parseMySqlExplain({
      columns: ["EXPLAIN"],
      rows: [[JSON.stringify(jsonPlan)]],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe("ALL");
    expect(parsed.nodes[0]?.relation).toBe("users");
    expect(parsed.nodes[0]?.rows).toBe(1000);
  });

  it("parses TREE/ANALYZE style text output", () => {
    const parsed = parseMySqlExplain({
      columns: ["EXPLAIN"],
      rows: [
        [
          "-> Nested loop inner join  (cost=10.00 rows=5) (actual time=0.10..0.40 rows=5 loops=1)",
        ],
        [
          "    -> Table scan on users  (cost=1.00 rows=100) (actual time=0.01..0.10 rows=100 loops=1)",
        ],
        [
          "    -> Single-row index lookup on orders using PRIMARY (user_id=users.id)  (cost=0.80 rows=1) (actual time=0.01..0.02 rows=1 loops=100)",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type.toLowerCase()).toContain("nested loop");
    expect(parsed.nodes[0]?.children).toHaveLength(2);
    expect(parsed.nodes[0]?.children?.[0]?.relation).toBe("users");
    expect(parsed.nodes[0]?.children?.[1]?.relation).toBe("orders");
    expect(parsed.nodes[0]?.children?.[1]?.indexName).toBe("PRIMARY");
    expect(parsed.nodes[0]?.children?.[1]?.indexCond).toBe("user_id=users.id");
  });
});
