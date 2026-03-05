import { describe, expect, it } from "vitest";
import { parsePostgresExplain } from "../parsers/postgres";

describe("parsePostgresExplain", () => {
  it("parses PostgreSQL text EXPLAIN into plan nodes", () => {
    const rows: unknown[][] = [
      [
        "Seq Scan on users  (cost=0.00..10.00 rows=100 width=32) (actual time=0.010..0.020 rows=100 loops=1)",
      ],
      ["Planning Time: 0.123 ms"],
      ["Execution Time: 0.456 ms"],
    ];

    const parsed = parsePostgresExplain(rows);

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe("Seq Scan");
    expect(parsed.totalCost).toBe(10);
    expect(parsed.planningTime).toBe(0.123);
    expect(parsed.executionTime).toBe(0.456);
  });

  it("parses PostgreSQL JSON EXPLAIN into plan nodes", () => {
    const jsonExplain = JSON.stringify([
      {
        Plan: {
          "Node Type": "Index Scan",
          "Relation Name": "users",
          "Index Name": "users_pkey",
          "Startup Cost": 0.15,
          "Total Cost": 8.2,
          "Plan Rows": 1,
          "Plan Width": 64,
        },
        "Planning Time": 0.5,
        "Execution Time": 1.2,
      },
    ]);

    const parsed = parsePostgresExplain([[jsonExplain]]);

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe("Index Scan");
    expect(parsed.nodes[0]?.relation).toBe("users");
    expect(parsed.totalCost).toBe(8.2);
    expect(parsed.planningTime).toBe(0.5);
    expect(parsed.executionTime).toBe(1.2);
  });
});
