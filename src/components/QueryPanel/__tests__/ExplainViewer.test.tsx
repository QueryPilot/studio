import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExplainViewer } from "../ExplainViewer";

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({ value }: { value: string }) => (
    <pre data-testid="code-editor">{value}</pre>
  ),
}));

describe("ExplainViewer fallback rendering", () => {
  it("shows full MySQL EXPLAIN row details instead of only numeric id", () => {
    render(
      <ExplainViewer
        result={{
          columns: ["id", "select_type", "table", "type", "rows", "Extra"],
          rows: [
            ["1", "SIMPLE", "reviews", "ALL", "1200", "Using where"],
            ["1", "SIMPLE", "customers", "eq_ref", "1", "Using index"],
          ],
        }}
      />,
    );

    const content = screen.getByTestId("code-editor").textContent;

    expect(content).toContain("select_type");
    expect(content).toContain("SIMPLE");
    expect(content).toContain("Using where");
    expect(content).toContain("customers");
  });

  it("uses SQLite detail column for EXPLAIN QUERY PLAN output", () => {
    render(
      <ExplainViewer
        result={{
          columns: ["id", "parent", "notused", "detail"],
          rows: [
            [2, 0, 0, "SCAN reviews"],
            [8, 0, 0, "SEARCH customers USING INTEGER PRIMARY KEY (rowid=?)"],
          ],
        }}
      />,
    );

    const content = screen.getByTestId("code-editor").textContent;

    expect(content).toContain("SCAN reviews");
    expect(content).toContain("SEARCH customers");
    expect(content).not.toContain("parent=");
    expect(content).not.toContain("notused=");
  });
});
