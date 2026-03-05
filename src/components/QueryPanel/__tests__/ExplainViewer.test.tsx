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
          columns: [
            "id",
            "select_type",
            "table",
            "type",
            "possible_keys",
            "key",
            "key_len",
            "ref",
            "rows",
            "filtered",
            "Extra",
          ],
          rows: [
            [
              "1",
              "SIMPLE",
              "o",
              "range",
              "PRIMARY,idx_customer,idx_status,idx_orders_status_payment_method",
              "idx_status",
              "2",
              "NULL",
              "1",
              "100.00",
              "Using index condition; Using temporary; Using filesort",
            ],
            [
              "1",
              "SIMPLE",
              "c",
              "eq_ref",
              "PRIMARY",
              "PRIMARY",
              "4",
              "todoapp.o.customer_id",
              "1",
              "100.00",
              "",
            ],
          ],
        }}
      />,
    );

    expect(screen.queryByTestId("code-editor")).toBeNull();
    expect(screen.getByText("range")).toBeTruthy();
    expect(screen.getByText("o")).toBeTruthy();
    expect(screen.getByText("eq_ref")).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
    expect(screen.getByText("idx_status")).toBeTruthy();
    expect(
      screen.getByText(
        "Using index condition; Using temporary; Using filesort",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "PRIMARY, idx_customer, idx_status, idx_orders_status_payment_method",
      ),
    ).toBeTruthy();
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
