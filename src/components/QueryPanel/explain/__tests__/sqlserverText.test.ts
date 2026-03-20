import { describe, it, expect } from "vitest";
import { parseSqlServerTextShowplan } from "../parsers/sqlserverText";

describe("parseSqlServerTextShowplan", () => {
  it("parses SHOWPLAN_TEXT output into raw text", () => {
    const input = {
      columns: ["StmtText"],
      rows: [
        ["SELECT * FROM [dbo].[orders]"],
        ["  |--Clustered Index Scan(OBJECT:([todoapp].[dbo].[orders].[pk_orders]))"],
      ],
    };
    const result = parseSqlServerTextShowplan(input);
    expect(result.raw).toContain("Clustered Index Scan");
    expect(result.nodes).toHaveLength(0);
    expect(result.totalCost).toBe(0);
  });

  it("handles empty input", () => {
    const result = parseSqlServerTextShowplan({ columns: ["StmtText"], rows: [] });
    expect(result.raw).toBe("");
    expect(result.nodes).toHaveLength(0);
  });
});
