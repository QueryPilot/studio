import { describe, expect, it } from "vitest";
import { parseMySqlExplain, parseMySqlTraditionalExplain } from "../parsers/mysql";

describe("parseMySqlTraditionalExplain", () => {
  it("parses tabular EXPLAIN output into nodes", () => {
    const parsed = parseMySqlTraditionalExplain({
      columns: [
        "id",
        "select_type",
        "table",
        "type",
        "possible_keys",
        "key",
        "key_len",
        "ref",
        "rows",
        "filtered",
        "Extra",
      ],
      rows: [
        [
          "1",
          "SIMPLE",
          "reviews",
          "range",
          "PRIMARY,idx_reviews_created_at",
          "idx_reviews_created_at",
          "5",
          "NULL",
          "1200",
          "100.00",
          "Using where; Using filesort",
        ],
        [
          "1",
          "SIMPLE",
          "customers",
          "eq_ref",
          "PRIMARY",
          "PRIMARY",
          "4",
          "todoapp.reviews.customer_id",
          "1",
          "100.00",
          "Using index",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]?.type).toBe("range");
    expect(parsed.nodes[0]?.relation).toBe("reviews");
    expect(parsed.nodes[0]?.rows).toBe(1200);
    expect(parsed.nodes[0]?.indexName).toBe("idx_reviews_created_at");
    expect(parsed.nodes[0]?.possibleKeys).toEqual([
      "PRIMARY",
      "idx_reviews_created_at",
    ]);
    expect(parsed.nodes[0]?.keyLen).toBe("5");
    expect(parsed.nodes[0]?.ref).toBeUndefined();
    expect(parsed.nodes[0]?.extra).toBe("Using where; Using filesort");
    expect(parsed.nodes[0]?.raw).toContain("Using where; Using filesort");

    expect(parsed.nodes[1]?.type).toBe("eq_ref");
    expect(parsed.nodes[1]?.relation).toBe("customers");
    expect(parsed.nodes[1]?.indexName).toBe("PRIMARY");
    expect(parsed.nodes[1]?.ref).toBe("todoapp.reviews.customer_id");
  });

  it("builds nested tree from subquery rows with different ids", () => {
    const parsed = parseMySqlTraditionalExplain({
      columns: [
        "id",
        "select_type",
        "table",
        "type",
        "possible_keys",
        "key",
        "key_len",
        "ref",
        "rows",
        "filtered",
        "Extra",
      ],
      rows: [
        [
          "1",
          "PRIMARY",
          "orders",
          "ALL",
          "NULL",
          "NULL",
          "NULL",
          "NULL",
          "500",
          "100.00",
          "Using where",
        ],
        [
          "2",
          "SUBQUERY",
          "products",
          "index",
          "PRIMARY",
          "PRIMARY",
          "4",
          "NULL",
          "100",
          "50.00",
          "Using index",
        ],
      ],
    });

    // id=1 row should be root, id=2 row should be child
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.relation).toBe("orders");
    expect(parsed.nodes[0]?.children).toHaveLength(1);
    expect(parsed.nodes[0]?.children?.[0]?.relation).toBe("products");
    expect(parsed.nodes[0]?.children?.[0]?.selectType).toBe("SUBQUERY");
  });

  it("extracts MariaDB ANALYZE SELECT actual stats (r_rows, r_filtered, r_total_time_ms)", () => {
    const parsed = parseMySqlExplain({
      columns: ["id", "select_type", "table", "type", "possible_keys", "key", "key_len", "ref", "rows", "filtered", "Extra", "r_rows", "r_filtered", "r_total_time_ms"],
      rows: [
        [1, "SIMPLE", "customers", "ALL", null, null, null, null, 20, 100.0, "Using where", 20, 50.0, 0.123],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]!.actualRows).toBe(20);
    expect(parsed.nodes[0]!.actualTime).toEqual({ startup: 0, total: 0.123 });
  });

  it("returns empty nodes when not a traditional EXPLAIN shape", () => {
    const parsed = parseMySqlTraditionalExplain({
      columns: ["query_plan"],
      rows: [["something else"]],
    });

    expect(parsed.nodes).toHaveLength(0);
  });
});
