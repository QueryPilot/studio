import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataGridStatusBar } from "../DataGridStatusBar";

describe("DataGridStatusBar", () => {
  it("shows numeric progress while query result streaming is active", () => {
    render(
      <DataGridStatusBar
        loadedRows={5_000}
        estimatedTotal={7_500}
        hasMore
        rowCountLoadingState="streaming"
      />,
    );

    expect(screen.getByText("5,000 / 7,500 rows")).toBeInTheDocument();
    expect(screen.queryByText("Streaming rows...")).not.toBeInTheDocument();
  });

  it("shows the final total while frontend rendering catches up", () => {
    render(
      <DataGridStatusBar
        loadedRows={84_848}
        estimatedTotal={100_000}
        hasMore
        rowCountLoadingState="rendering"
      />,
    );

    expect(
      screen.getByText("100,000 rows (rendering...)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/84,848 \/ 100,000 rows/)).not.toBeInTheDocument();
  });
});
