import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ExplainViewer, isExplainResult } from "../ExplainViewer";
import * as parseExplainModule from "../explain/parseExplain";

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({ value }: { value: string }) => (
    <pre data-testid="code-editor">{value}</pre>
  ),
}));

describe("ExplainViewer parser selection", () => {
  it("passes databaseType to parseExplain selector", () => {
    const parseSpy = vi
      .spyOn(parseExplainModule, "parseExplain")
      .mockReturnValue({ nodes: [], totalCost: 0, raw: "" });

    render(
      <ExplainViewer
        result={{
          columns: ["QUERY PLAN"],
          rows: [["Seq Scan on users  (cost=0.00..10.00 rows=100 width=4)"]],
        }}
        databaseType="SQLite"
        viewMode="explain"
      />,
    );

    expect(parseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ databaseType: "SQLite" }),
    );
  });
});

describe("isExplainResult - MSSQL SHOWPLAN detection", () => {
  it("detects SHOWPLAN_ALL columns", () => {
    const columns = ["StmtText", "StmtId", "NodeId", "Parent", "PhysicalOp",
      "LogicalOp", "Argument", "DefinedValues", "EstimateRows",
      "EstimateIO", "EstimateCPU", "AvgRowSize", "TotalSubtreeCost"];
    const rows = [["SELECT ...", 1, 1, 0, "Clustered Index Scan", "Clustered Index Scan",
      "...", "...", 100, 0.1, 0.01, 50, 0.11]];
    expect(isExplainResult(columns, rows)).toBe(true);
  });

  it("detects SHOWPLAN_ALL with mixed case column names", () => {
    const columns = ["NodeId", "Parent", "PhysicalOp", "LogicalOp", "EstimateRows", "TotalSubtreeCost"];
    const rows = [[1, 0, "Clustered Index Scan", "Clustered Index Scan", 100, 0.11]];
    expect(isExplainResult(columns, rows)).toBe(true);
  });

  it("detects STATISTICS PROFILE columns", () => {
    const columns = ["Rows", "Executes", "StmtText", "NodeId", "Parent", "PhysicalOp"];
    const rows = [[100, 1, "SELECT ...", 1, 0, "Index Scan"]];
    expect(isExplainResult(columns, rows)).toBe(true);
  });

  it("detects SHOWPLAN_XML single column with XML", () => {
    const columns = ["Microsoft SQL Server 2005 XML Showplan"];
    const rows = [['<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">...</ShowPlanXML>']];
    expect(isExplainResult(columns, rows)).toBe(true);
  });

  it("detects SHOWPLAN_TEXT single column", () => {
    const columns = ["StmtText"];
    const rows = [["  |--Clustered Index Scan(OBJECT:([dbo].[orders]))"]];
    expect(isExplainResult(columns, rows)).toBe(true);
  });

  it("does not false-positive on regular SELECT with NodeId column", () => {
    const columns = ["NodeId", "Name", "Value"];
    const rows = [[1, "test", "value"]];
    expect(isExplainResult(columns, rows)).toBe(false);
  });
});
