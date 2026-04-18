import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ERDSchemaLegend, schemaTintClass } from "@/components/Erd/ERDSchemaLegend";

describe("ERDSchemaLegend", () => {
  it("renders one chip per schema with its table count", () => {
    render(
      <ERDSchemaLegend
        schemas={["public", "reporting"]}
        tableCounts={{ public: 12, reporting: 7 }}
      />,
    );
    expect(screen.getByText(/public \(12\)/)).toBeInTheDocument();
    expect(screen.getByText(/reporting \(7\)/)).toBeInTheDocument();
  });

  it("renders (0) for schemas with no tables", () => {
    render(
      <ERDSchemaLegend schemas={["empty"]} tableCounts={{}} />,
    );
    expect(screen.getByText(/empty \(0\)/)).toBeInTheDocument();
  });
});

describe("schemaTintClass", () => {
  it("returns a deterministic class for a given schema name", () => {
    const a1 = schemaTintClass("public");
    const a2 = schemaTintClass("public");
    const b = schemaTintClass("reporting");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
