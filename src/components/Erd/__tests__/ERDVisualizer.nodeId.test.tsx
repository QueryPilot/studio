import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ERDVisualizer } from "@/components/Erd/ERDVisualizer";
import type { TableStructure } from "@/types/tableStructure";

const makeTable = (schema: string, name: string): TableStructure =>
  ({
    schema,
    name,
    columns: [{ name: "id", db_type: "int", is_pk: true, ordinal: 0 }],
    constraints: [],
    indexes: [],
    foreignKeys: [],
    triggers: [],
  }) as unknown as TableStructure;

describe("ERDVisualizer node-id schema qualification", () => {
  it("renders two tables of same name from different schemas as distinct nodes", () => {
    const tables = [makeTable("public", "users"), makeTable("reporting", "users")];
    const { container } = render(
      <ReactFlowProvider>
        <ERDVisualizer
          tables={tables}
          relationships={[]}
          layoutDirection="LR"
          nodePositions={{}}
          hasManualPositions={false}
        />
      </ReactFlowProvider>,
    );
    const ids = Array.from(
      container.querySelectorAll<HTMLElement>(".react-flow__node"),
    ).map((n) => n.getAttribute("data-id"));
    expect(ids).toContain("public.users");
    expect(ids).toContain("reporting.users");
    expect(new Set(ids).size).toBe(2);
  });
});
