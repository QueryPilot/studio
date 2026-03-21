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

  it("parses PostgreSQL XML EXPLAIN into plan nodes", () => {
    const xml = `<explain xmlns="http://www.postgresql.org/2009/explain">
  <Query>
    <Plan>
      <Node-Type>Seq Scan</Node-Type>
      <Relation-Name>users</Relation-Name>
      <Startup-Cost>0.00</Startup-Cost>
      <Total-Cost>35.50</Total-Cost>
      <Plan-Rows>2550</Plan-Rows>
      <Plan-Width>244</Plan-Width>
    </Plan>
    <Planning-Time>0.123</Planning-Time>
    <Execution-Time>0.456</Execution-Time>
  </Query>
</explain>`;

    const parsed = parsePostgresExplain([[xml]]);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]!.type).toBe("Seq Scan");
    expect(parsed.nodes[0]!.relation).toBe("users");
    expect(parsed.nodes[0]!.cost).toEqual({ startup: 0, total: 35.5 });
    expect(parsed.nodes[0]!.rows).toBe(2550);
    expect(parsed.planningTime).toBe(0.123);
    expect(parsed.executionTime).toBe(0.456);
  });

  it("parses PostgreSQL XML EXPLAIN with nested plans", () => {
    const xml = `<explain xmlns="http://www.postgresql.org/2009/explain">
  <Query>
    <Plan>
      <Node-Type>Hash Join</Node-Type>
      <Join-Type>Inner</Join-Type>
      <Hash-Cond>(a.id = b.a_id)</Hash-Cond>
      <Startup-Cost>1.00</Startup-Cost>
      <Total-Cost>50.00</Total-Cost>
      <Plan-Rows>100</Plan-Rows>
      <Plan-Width>64</Plan-Width>
      <Plans>
        <Plan>
          <Node-Type>Seq Scan</Node-Type>
          <Relation-Name>a</Relation-Name>
          <Startup-Cost>0.00</Startup-Cost>
          <Total-Cost>10.00</Total-Cost>
          <Plan-Rows>100</Plan-Rows>
          <Plan-Width>32</Plan-Width>
        </Plan>
        <Plan>
          <Node-Type>Hash</Node-Type>
          <Startup-Cost>5.00</Startup-Cost>
          <Total-Cost>5.00</Total-Cost>
          <Plan-Rows>50</Plan-Rows>
          <Plan-Width>32</Plan-Width>
          <Plans>
            <Plan>
              <Node-Type>Seq Scan</Node-Type>
              <Relation-Name>b</Relation-Name>
              <Startup-Cost>0.00</Startup-Cost>
              <Total-Cost>5.00</Total-Cost>
              <Plan-Rows>50</Plan-Rows>
              <Plan-Width>32</Plan-Width>
            </Plan>
          </Plans>
        </Plan>
      </Plans>
    </Plan>
  </Query>
</explain>`;

    const parsed = parsePostgresExplain([[xml]]);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]!.type).toBe("Hash Join");
    expect(parsed.nodes[0]!.joinType).toBe("Inner");
    expect(parsed.nodes[0]!.hashCond).toBe("(a.id = b.a_id)");
    expect(parsed.nodes[0]!.children).toHaveLength(2);
    expect(parsed.nodes[0]!.children![0]!.type).toBe("Seq Scan");
    expect(parsed.nodes[0]!.children![0]!.relation).toBe("a");
    expect(parsed.nodes[0]!.children![1]!.type).toBe("Hash");
    expect(parsed.nodes[0]!.children![1]!.children).toHaveLength(1);
    expect(parsed.nodes[0]!.children![1]!.children![0]!.type).toBe("Seq Scan");
    expect(parsed.nodes[0]!.children![1]!.children![0]!.relation).toBe("b");
  });

  it("handles PostgreSQL YAML EXPLAIN as raw text (nodes empty)", () => {
    const yaml = `- Plan:
    Node Type: "Seq Scan"
    Relation Name: "users"
    Startup Cost: 0.00
    Total Cost: 35.50
    Plan Rows: 2550
  Planning Time: 0.123
  Execution Time: 0.456`;

    const parsed = parsePostgresExplain([[yaml]]);
    // YAML falls to raw view
    expect(parsed.nodes).toHaveLength(0);
    expect(parsed.raw).toContain("Seq Scan");
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
