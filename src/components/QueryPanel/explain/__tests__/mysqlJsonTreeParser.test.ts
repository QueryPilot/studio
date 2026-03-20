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
    // Root is the Query Block; table node is its child
    const root = parsed.nodes[0]!;
    expect(root.type).toBe("Query Block 1");
    expect(root.children).toHaveLength(1);
    expect(root.children![0]!.type).toBe("ALL");
    expect(root.children![0]!.relation).toBe("users");
    expect(root.children![0]!.rows).toBe(1000);
  });

  it("extracts cost_info from JSON format", () => {
    const jsonPlan = {
      query_block: {
        select_id: 1,
        cost_info: {
          query_cost: "15.50",
        },
        nested_loop: [
          {
            table: {
              table_name: "users",
              access_type: "ALL",
              rows_examined_per_scan: 1000,
              cost_info: {
                read_cost: "5.00",
                eval_cost: "10.00",
                prefix_cost: "12.50",
                data_read_per_join: "2K",
              },
            },
          },
        ],
      },
    };

    const parsed = parseMySqlExplain({
      columns: ["EXPLAIN"],
      rows: [[JSON.stringify(jsonPlan)]],
    });

    expect(parsed.nodes).toHaveLength(1);
    // The root or a descendant should have cost extracted
    // Find the users table node
    function findNode(
      node: (typeof parsed.nodes)[0],
      relation: string,
    ): (typeof parsed.nodes)[0] | undefined {
      if (node.relation === relation) return node;
      for (const child of node.children ?? []) {
        const found = findNode(child, relation);
        if (found) return found;
      }
      return undefined;
    }
    const rootNode = parsed.nodes[0];
    expect(rootNode).toBeDefined();
    const usersNode = rootNode ? findNode(rootNode, "users") : undefined;
    expect(usersNode).toBeDefined();
    expect(usersNode?.cost).toEqual({ startup: 0, total: 12.5 });
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

  it("TREE format: rows go to node.rows only, not actualRows without ANALYZE", () => {
    const parsed = parseMySqlExplain({
      columns: ["EXPLAIN"],
      rows: [
        [
          "-> Table scan on users  (cost=1.00 rows=100)",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.rows).toBe(100);
    // Without actual time, actualRows should not be set
    expect(parsed.nodes[0]?.actualRows).toBeUndefined();
  });

  it("TREE format: actualRows set only with EXPLAIN ANALYZE output", () => {
    const parsed = parseMySqlExplain({
      columns: ["EXPLAIN"],
      rows: [
        [
          "-> Table scan on users  (cost=1.00 rows=100) (actual time=0.01..0.50 rows=95 loops=1)",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.rows).toBe(100);
    expect(parsed.nodes[0]?.actualRows).toBe(95);
    expect(parsed.nodes[0]?.actualTime).toEqual({ startup: 0.01, total: 0.5 });
  });

  it("TREE format: extracts cost value", () => {
    const parsed = parseMySqlExplain({
      columns: ["EXPLAIN"],
      rows: [
        [
          "-> Nested loop inner join  (cost=10.50 rows=5)",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.cost).toEqual({ startup: 0, total: 10.5 });
    expect(parsed.nodes[0]?.rows).toBe(5);
  });

  it("parses MariaDB JSON format with filesort + temporary_table + nested_loop", () => {
    const mariadbPlan = {
      query_block: {
        select_id: 1,
        cost: 0.019,
        filesort: {
          sort_key: "p.id, p.name",
          temporary_table: {
            nested_loop: [
              {
                table: {
                  table_name: "p",
                  access_type: "ALL",
                  loops: 1,
                  rows: 2,
                  cost: 0.011,
                  filtered: 100,
                  attached_condition: "p.is_active = 1",
                },
              },
              {
                table: {
                  table_name: "cat",
                  access_type: "eq_ref",
                  possible_keys: ["PRIMARY"],
                  key: "PRIMARY",
                  key_length: "4",
                  used_key_parts: ["id"],
                  ref: ["todoapp.p.category_id"],
                  loops: 2,
                  rows: 1,
                  cost: 0.003,
                  filtered: 100,
                },
              },
            ],
          },
        },
      },
    };
    const parsed = parseMySqlExplain({
      columns: ["EXPLAIN"],
      rows: [[JSON.stringify(mariadbPlan)]],
    });

    // Root should be Query Block
    expect(parsed.nodes).toHaveLength(1);
    const root = parsed.nodes[0]!;
    expect(root.type).toBe("Query Block 1");

    // Should have Filesort child
    const filesort = root.children?.[0];
    expect(filesort).toBeDefined();
    expect(filesort!.type).toBe("Filesort");
    expect(filesort!.sortKey).toEqual(["p.id", "p.name"]);

    // Filesort → Temporary Table
    const tmpTable = filesort!.children?.[0];
    expect(tmpTable).toBeDefined();
    expect(tmpTable!.type).toBe("Temporary Table");

    // Temporary Table → Nested Loop with 2 table children
    const nestedLoop = tmpTable!.children?.[0];
    expect(nestedLoop).toBeDefined();
    expect(nestedLoop!.type).toBe("Nested Loop");

    // Table nodes
    const tables = nestedLoop!.children ?? [];
    expect(tables).toHaveLength(2);

    // First table: p
    expect(tables[0]!.relation).toBe("p");
    expect(tables[0]!.type).toBe("ALL");
    expect(tables[0]!.cost).toEqual({ startup: 0, total: 0.011 });
    expect(tables[0]!.filter).toBe("p.is_active = 1");

    // Second table: cat
    expect(tables[1]!.relation).toBe("cat");
    expect(tables[1]!.type).toBe("eq_ref");
    expect(tables[1]!.indexName).toBe("PRIMARY");
    expect(tables[1]!.possibleKeys).toEqual(["PRIMARY"]);
    expect(tables[1]!.indexCond).toBe("id");
  });

  it("parses MySQL JSON with ordering_operation → grouping_operation → buffer_result → nested_loop", () => {
    const mysqlPlan = {
      query_block: {
        select_id: 1,
        cost_info: { query_cost: "69.31" },
        ordering_operation: {
          using_filesort: true,
          grouping_operation: {
            using_temporary_table: true,
            using_filesort: true,
            buffer_result: {
              using_temporary_table: true,
              nested_loop: [
                {
                  table: {
                    table_name: "o",
                    access_type: "range",
                    possible_keys: ["PRIMARY", "idx_customer", "idx_status"],
                    key: "idx_status",
                    used_key_parts: ["status"],
                    key_length: "2",
                    rows_examined_per_scan: 84,
                    rows_produced_per_join: 27,
                    filtered: "33.33",
                    index_condition: "o.status in ('delivered','shipped')",
                    cost_info: { read_cost: "35.51", eval_cost: "2.80", prefix_cost: "38.31" },
                  },
                },
                {
                  table: {
                    table_name: "c",
                    access_type: "eq_ref",
                    possible_keys: ["PRIMARY"],
                    key: "PRIMARY",
                    used_key_parts: ["id"],
                    ref: ["todoapp.o.customer_id"],
                    rows_examined_per_scan: 1,
                    filtered: "100.00",
                    cost_info: { prefix_cost: "48.11" },
                  },
                },
                {
                  table: {
                    table_name: "oi",
                    access_type: "ref",
                    key: "idx_order",
                    used_key_parts: ["order_id"],
                    ref: ["todoapp.o.id"],
                    rows_examined_per_scan: 2,
                    filtered: "100.00",
                    cost_info: { prefix_cost: "69.31" },
                  },
                },
              ],
            },
          },
        },
      },
    };
    const parsed = parseMySqlExplain({
      columns: ["EXPLAIN"],
      rows: [[JSON.stringify(mysqlPlan)]],
    });

    const root = parsed.nodes[0]!;
    expect(root.type).toBe("Query Block 1");
    expect(root.cost).toEqual({ startup: 0, total: 69.31 });

    // Query Block → Filesort (from ordering_operation)
    const filesort = root.children?.[0];
    expect(filesort).toBeDefined();
    expect(filesort!.type).toBe("Filesort");

    // Filesort → Group (Temp Table)
    const group = filesort!.children?.[0];
    expect(group).toBeDefined();
    expect(group!.type).toBe("Group (Temp Table)");

    // Group → Buffer (Temp Table)
    const buffer = group!.children?.[0];
    expect(buffer).toBeDefined();
    expect(buffer!.type).toBe("Buffer (Temp Table)");

    // Buffer → Nested Loop → 3 tables
    const nestedLoop = buffer!.children?.[0];
    expect(nestedLoop).toBeDefined();
    expect(nestedLoop!.type).toBe("Nested Loop");

    const tables = nestedLoop!.children ?? [];
    expect(tables).toHaveLength(3);

    // Table o: range scan on idx_status
    expect(tables[0]!.relation).toBe("o");
    expect(tables[0]!.type).toBe("range");
    expect(tables[0]!.indexName).toBe("idx_status");
    expect(tables[0]!.cost).toEqual({ startup: 0, total: 38.31 });
    expect(tables[0]!.indexCond).toBe("o.status in ('delivered','shipped')");
    expect(tables[0]!.rows).toBe(84);

    // Table c: eq_ref on PRIMARY
    expect(tables[1]!.relation).toBe("c");
    expect(tables[1]!.type).toBe("eq_ref");
    expect(tables[1]!.indexName).toBe("PRIMARY");

    // Table oi: ref on idx_order
    expect(tables[2]!.relation).toBe("oi");
    expect(tables[2]!.type).toBe("ref");
    expect(tables[2]!.indexName).toBe("idx_order");
  });
});
