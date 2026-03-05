import { describe, expect, it } from "vitest";
import { parseSqlServerShowplanAll } from "../parsers/sqlserver";

describe("parseSqlServerShowplanAll", () => {
  it("builds a tree from NodeId/Parent", () => {
    const parsed = parseSqlServerShowplanAll({
      columns: [
        "StmtText",
        "StmtId",
        "NodeId",
        "Parent",
        "PhysicalOp",
        "LogicalOp",
        "EstimateRows",
        "EstimateCPU",
        "EstimateIO",
        "TotalSubtreeCost",
        "Argument",
      ],
      rows: [
        [
          "SELECT * FROM users",
          1,
          0,
          null,
          "SELECT",
          "SELECT",
          1,
          0.0001,
          0.0002,
          0.01,
          "",
        ],
        [
          "",
          1,
          1,
          0,
          "Clustered Index Scan",
          "Clustered Index Scan",
          1000,
          0.01,
          0.2,
          0.3,
          "OBJECT:([dbo].[users])",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe("SELECT");
    expect(parsed.nodes[0]?.children).toHaveLength(1);
    expect(parsed.nodes[0]?.children?.[0]?.type).toBe("Clustered Index Scan");
    expect(parsed.nodes[0]?.children?.[0]?.rows).toBe(1000);
    expect(parsed.nodes[0]?.children?.[0]?.cost?.total).toBe(0.3);
  });

  it("returns empty nodes for non-showplan shapes", () => {
    const parsed = parseSqlServerShowplanAll({
      columns: ["plan"],
      rows: [["not showplan"]],
    });

    expect(parsed.nodes).toHaveLength(0);
  });

  it("extracts table relation from three-part OBJECT names", () => {
    const parsed = parseSqlServerShowplanAll({
      columns: [
        "StmtText",
        "StmtId",
        "NodeId",
        "Parent",
        "PhysicalOp",
        "LogicalOp",
        "EstimateRows",
        "TotalSubtreeCost",
        "Argument",
      ],
      rows: [
        [
          "SELECT * FROM users",
          1,
          0,
          null,
          "Clustered Index Scan",
          "Clustered Index Scan",
          100,
          0.12,
          "OBJECT:([db].[dbo].[users])",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.relation).toBe("users");
  });

  it("keeps separate statement roots when NodeId resets per statement", () => {
    const parsed = parseSqlServerShowplanAll({
      columns: [
        "StmtText",
        "StmtId",
        "NodeId",
        "Parent",
        "PhysicalOp",
        "LogicalOp",
        "EstimateRows",
        "TotalSubtreeCost",
        "Argument",
      ],
      rows: [
        ["SELECT * FROM users", 1, 0, null, "SELECT", "SELECT", 1, 0.01, ""],
        [
          "",
          1,
          1,
          0,
          "Clustered Index Scan",
          "Clustered Index Scan",
          100,
          0.2,
          "OBJECT:([dbo].[users])",
        ],
        ["SELECT * FROM orders", 2, 0, null, "SELECT", "SELECT", 1, 0.02, ""],
        [
          "",
          2,
          1,
          0,
          "Clustered Index Scan",
          "Clustered Index Scan",
          200,
          0.3,
          "OBJECT:([dbo].[orders])",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]?.children?.[0]?.relation).toBe("users");
    expect(parsed.nodes[1]?.children?.[0]?.relation).toBe("orders");
    expect(parsed.totalCost).toBeCloseTo(0.03);
  });

  it("extracts index name and argument predicates from SHOWPLAN argument", () => {
    const parsed = parseSqlServerShowplanAll({
      columns: [
        "StmtText",
        "StmtId",
        "NodeId",
        "Parent",
        "PhysicalOp",
        "LogicalOp",
        "EstimateRows",
        "TotalSubtreeCost",
        "Argument",
      ],
      rows: [
        [
          "SELECT * FROM orders",
          1,
          0,
          null,
          "Index Seek",
          "Index Seek",
          42,
          0.12,
          "OBJECT:([todoapp].[dbo].[orders].[idx_orders_status]), SEEK:([orders].[status]=N'shipped'), WHERE:([orders].[created_at]>='2024-01-01')",
        ],
      ],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.relation).toBe("orders");
    expect(parsed.nodes[0]?.indexName).toBe("idx_orders_status");
    expect(parsed.nodes[0]?.indexCond).toContain("[orders].[status]");
    expect(parsed.nodes[0]?.filter).toContain("[orders].[created_at]");
  });
});
