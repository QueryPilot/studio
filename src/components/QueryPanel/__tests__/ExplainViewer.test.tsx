import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExplainViewer } from "../ExplainViewer";

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({ value }: { value: string }) => (
    <pre data-testid="code-editor">{value}</pre>
  ),
}));

describe("ExplainViewer rendering", () => {
  it("renders MySQL EXPLAIN rows as structured plan nodes", () => {
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

    expect(screen.queryByTestId("code-editor")).toBeNull();
    expect(screen.getByText("ALL")).toBeTruthy();
    expect(screen.getByText("reviews")).toBeTruthy();
    expect(screen.getByText("eq_ref")).toBeTruthy();
    expect(screen.getByText("customers")).toBeTruthy();
  });

  it("renders SQLite EXPLAIN QUERY PLAN as a structured tree", () => {
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

    expect(screen.queryByTestId("code-editor")).toBeNull();
    expect(screen.getByText("SCAN")).toBeTruthy();
    expect(screen.getByText("reviews")).toBeTruthy();
    expect(screen.getByText("SEARCH")).toBeTruthy();
    expect(screen.getByText("customers")).toBeTruthy();
  });
});
