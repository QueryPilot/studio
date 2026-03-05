import { describe, expect, it } from "vitest";
import { parseSqlServerXmlShowplan } from "../parsers/sqlserver";

describe("parseSqlServerXmlShowplan", () => {
  it("parses SQL Server ShowPlan XML into nodes", () => {
    const xml = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.2" Build="16.0.1000.6">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM users">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="100" EstimatedTotalSubtreeCost="0.12">
              <IndexScan>
                <Object Database="[db]" Schema="[dbo]" Table="[users]" Index="[PK_users]" />
              </IndexScan>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

    const parsed = parseSqlServerXmlShowplan({
      columns: ["Microsoft SQL Server 2005 XML Showplan"],
      rows: [[xml]],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe("Clustered Index Scan");
    expect(parsed.nodes[0]?.relation).toBe("users");
    expect(parsed.nodes[0]?.rows).toBe(100);
    expect(parsed.nodes[0]?.cost?.total).toBe(0.12);
  });

  it("does not inherit child table relation on parent join nodes", () => {
    const xml = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT u.id, o.id FROM users u JOIN orders o ON u.id = o.user_id">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="10" EstimatedTotalSubtreeCost="1.0">
              <NestedLoops>
                <RelOp NodeId="1" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="10" EstimatedTotalSubtreeCost="0.4">
                  <IndexScan>
                    <Object Database="[db]" Schema="[dbo]" Table="[users]" Index="[PK_users]" />
                  </IndexScan>
                </RelOp>
                <RelOp NodeId="2" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="20" EstimatedTotalSubtreeCost="0.5">
                  <IndexScan>
                    <Object Database="[db]" Schema="[dbo]" Table="[orders]" Index="[PK_orders]" />
                  </IndexScan>
                </RelOp>
              </NestedLoops>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

    const parsed = parseSqlServerXmlShowplan({
      columns: ["Microsoft SQL Server 2005 XML Showplan"],
      rows: [[xml]],
    });

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.type).toBe("Nested Loops");
    expect(parsed.nodes[0]?.relation).toBeUndefined();
    expect(parsed.nodes[0]?.children?.[0]?.relation).toBe("users");
    expect(parsed.nodes[0]?.children?.[1]?.relation).toBe("orders");
  });

  it("sums total cost across multiple XML query roots", () => {
    const xml = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM users">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="10" EstimatedTotalSubtreeCost="0.10">
              <IndexScan>
                <Object Table="[users]" />
              </IndexScan>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
        <StmtSimple StatementText="SELECT * FROM orders">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="20" EstimatedTotalSubtreeCost="0.20">
              <IndexScan>
                <Object Table="[orders]" />
              </IndexScan>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

    const parsed = parseSqlServerXmlShowplan({
      columns: ["Microsoft SQL Server 2005 XML Showplan"],
      rows: [[xml]],
    });

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.totalCost).toBeCloseTo(0.3);
  });
});
