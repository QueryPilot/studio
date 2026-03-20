import { describe, it, expect } from "vitest";
import { parseSqlServerXmlShowplan } from "../parsers/sqlserver";

describe("parseSqlServerXmlShowplan", () => {
  it("extracts actual rows from STATISTICS XML RunTimeCountersPerThread", () => {
    const xml = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
      <BatchSequence><Batch><Statements><StmtSimple>
        <QueryPlan>
          <RelOp PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="100" EstimatedTotalSubtreeCost="0.05" EstimateIO="0.03" EstimateCPU="0.02">
            <RunTimeInformation>
              <RunTimeCountersPerThread Thread="0" ActualRows="95" ActualExecutions="1" ActualElapsedms="12" />
            </RunTimeInformation>
          </RelOp>
        </QueryPlan>
      </StmtSimple></Statements></Batch></BatchSequence>
    </ShowPlanXML>`;
    const result = parseSqlServerXmlShowplan({ columns: ["xml"], rows: [[xml]] });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.actualRows).toBe(95);
    expect(result.nodes[0]!.loops).toBe(1);
    expect(result.nodes[0]!.operatorCost).toBeCloseTo(0.05);
    expect(result.nodes[0]!.actualTime?.total).toBe(12);
  });

  it("extracts EstimateIO + EstimateCPU as operatorCost from XML", () => {
    const xml = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
      <BatchSequence><Batch><Statements><StmtSimple>
        <QueryPlan>
          <RelOp PhysicalOp="Sort" LogicalOp="Sort" EstimateRows="50" EstimatedTotalSubtreeCost="0.1" EstimateIO="0.04" EstimateCPU="0.01">
          </RelOp>
        </QueryPlan>
      </StmtSimple></Statements></Batch></BatchSequence>
    </ShowPlanXML>`;
    const result = parseSqlServerXmlShowplan({ columns: ["xml"], rows: [[xml]] });
    expect(result.nodes[0]!.operatorCost).toBeCloseTo(0.05);
  });

  it("aggregates multiple RunTimeCountersPerThread entries", () => {
    const xml = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
      <BatchSequence><Batch><Statements><StmtSimple>
        <QueryPlan>
          <RelOp PhysicalOp="Parallelism" LogicalOp="Gather Streams" EstimateRows="200" EstimatedTotalSubtreeCost="0.2">
            <RunTimeInformation>
              <RunTimeCountersPerThread Thread="1" ActualRows="50" ActualExecutions="1" ActualElapsedms="10" />
              <RunTimeCountersPerThread Thread="2" ActualRows="60" ActualExecutions="1" ActualElapsedms="8" />
              <RunTimeCountersPerThread Thread="0" ActualRows="110" ActualExecutions="2" ActualElapsedms="15" />
            </RunTimeInformation>
          </RelOp>
        </QueryPlan>
      </StmtSimple></Statements></Batch></BatchSequence>
    </ShowPlanXML>`;
    const result = parseSqlServerXmlShowplan({ columns: ["xml"], rows: [[xml]] });
    expect(result.nodes[0]!.actualRows).toBe(220);
    expect(result.nodes[0]!.loops).toBe(4);
    expect(result.nodes[0]!.actualTime?.total).toBe(33);
  });

  it("does not set actualRows when no RunTimeInformation present", () => {
    const xml = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
      <BatchSequence><Batch><Statements><StmtSimple>
        <QueryPlan>
          <RelOp PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimateRows="10" EstimatedTotalSubtreeCost="0.01">
          </RelOp>
        </QueryPlan>
      </StmtSimple></Statements></Batch></BatchSequence>
    </ShowPlanXML>`;
    const result = parseSqlServerXmlShowplan({ columns: ["xml"], rows: [[xml]] });
    expect(result.nodes[0]!.actualRows).toBeUndefined();
    expect(result.nodes[0]!.loops).toBeUndefined();
    expect(result.nodes[0]!.actualTime).toBeUndefined();
  });
});
