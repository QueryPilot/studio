import { describe, it, expect } from "vitest";
import { parseSqlServerShowplanAll } from "../parsers/sqlserver";

describe("parseSqlServerShowplanAll - STATISTICS PROFILE", () => {
  it("extracts Rows and Executes columns as actual execution data", () => {
    const input = {
      columns: [
        "Rows", "Executes", "StmtText", "StmtId", "NodeId", "Parent",
        "PhysicalOp", "LogicalOp", "Argument", "DefinedValues",
        "EstimateRows", "EstimateIO", "EstimateCPU", "AvgRowSize",
        "TotalSubtreeCost", "OutputList", "Warnings", "Type",
        "Parallel", "EstimateExecutions",
      ],
      rows: [
        [100, 1, "SELECT * FROM orders", 1, 1, 0,
         "Clustered Index Scan", "Clustered Index Scan",
         "OBJECT:([dbo].[orders].[pk_orders])", null,
         100, 0.1, 0.01, 50, 0.11, null, null, "SELECT", 0, 1],
      ],
    };
    const result = parseSqlServerShowplanAll(input);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.actualRows).toBe(100);
    expect(result.nodes[0]!.loops).toBe(1);
  });

  it("ignores Rows/Executes when not present (standard SHOWPLAN_ALL)", () => {
    const input = {
      columns: [
        "StmtText", "StmtId", "NodeId", "Parent",
        "PhysicalOp", "LogicalOp", "Argument",
        "EstimateRows", "TotalSubtreeCost",
      ],
      rows: [
        ["SELECT 1", 1, 1, 0, "Constant Scan", "Constant Scan",
         null, 1, 0.0001],
      ],
    };
    const result = parseSqlServerShowplanAll(input);
    expect(result.nodes[0]!.actualRows).toBeUndefined();
    expect(result.nodes[0]!.loops).toBeUndefined();
  });
});
