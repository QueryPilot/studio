import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlanDiff } from "../PlanDiff";
import { parseExplain } from "../explain/parseExplain";

describe("PlanDiff dialect compatibility", () => {
  it("renders diff view for SQLite plans without crashing", () => {
    const onBack = vi.fn();

    const plan1 = {
      columns: ["id", "parent", "notused", "detail"],
      rows: [[2, 0, 0, "SCAN reviews"]],
      rowCount: 1,
    };

    const plan2 = {
      columns: ["id", "parent", "notused", "detail"],
      rows: [[2, 0, 0, "SEARCH reviews USING INDEX idx_reviews"]],
      rowCount: 1,
    };

    render(
      <PlanDiff
        plan1={plan1}
        plan2={plan2}
        query1="EXPLAIN QUERY PLAN SELECT * FROM reviews"
        query2="EXPLAIN QUERY PLAN SELECT * FROM reviews WHERE id = 1"
        onBack={onBack}
        parseExplain={({ columns, rows }) =>
          parseExplain({ columns, rows, databaseType: "SQLite" })
        }
      />,
    );

    expect(screen.getByText("Plan Comparison")).toBeTruthy();
    expect(screen.getByText("SCAN")).toBeTruthy();
    expect(screen.getByText("SEARCH")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
