import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryResultGrid } from "../QueryResultGrid";

const capturedBaseGridProps: Array<Record<string, unknown>> = [];

vi.mock("../../base/BaseDataGrid", () => ({
  BaseDataGrid: (props: Record<string, unknown>) => {
    capturedBaseGridProps.push(props);
    return <div data-testid="base-datagrid" />;
  },
}));

describe("QueryResultGrid stable row count state", () => {
  beforeEach(() => {
    capturedBaseGridProps.length = 0;
  });

  it("marks active backend streams as streaming for the status bar", () => {
    render(
      <QueryResultGrid
        gridId="query-grid"
        isStreaming
        data={{
          columns: ["id"],
          rows: Array.from({ length: 8_000 }, (_, index) => [index]),
          rowCount: 8_000,
        }}
      />,
    );

    expect(capturedBaseGridProps.at(-1)?.rowCountLoadingState).toBe("streaming");
  });
});
