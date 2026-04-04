import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryResultGrid } from "../QueryResultGrid";

const capturedBaseGridProps: Array<Record<string, unknown>> = [];

vi.mock("../../base/BaseDataGrid", () => ({
  BaseDataGrid: (props: Record<string, unknown>) => {
    capturedBaseGridProps.push(props);
    return <div data-testid="base-datagrid" />;
  },
}));

describe("QueryResultGrid", () => {
  beforeEach(() => {
    capturedBaseGridProps.length = 0;
    vi.useRealTimers();
  });

  it("continues materializing large streamed result sets until all rows are available", async () => {
    vi.useFakeTimers();

    const rows = Array.from({ length: 12_000 }, (_, index) => [index]);

    render(
      <QueryResultGrid
        gridId="query-grid"
        isStreaming
        data={{
          columns: ["id"],
          rows,
          rowCount: rows.length,
        }}
      />,
    );

    const initialProps = capturedBaseGridProps.at(-1);
    expect(initialProps).toBeDefined();
    expect((initialProps?.rows as unknown[] | undefined)?.length).toBe(5_000);
    expect(initialProps?.hasMore).toBe(true);

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
    }

    const latestProps = capturedBaseGridProps.at(-1);
    expect(latestProps).toBeDefined();
    expect((latestProps?.rows as unknown[] | undefined)?.length).toBe(12_000);
    expect(latestProps?.estimatedTotal).toBe(12_000);
    expect(latestProps?.hasMore).toBe(false);
  });

  it("flushes remaining rows immediately once streaming completes", () => {
    vi.useFakeTimers();

    const rows = Array.from({ length: 12_000 }, (_, index) => [index]);

    const { rerender } = render(
      <QueryResultGrid
        gridId="query-grid"
        isStreaming
        data={{
          columns: ["id"],
          rows,
          rowCount: rows.length,
        }}
      />,
    );

    const streamingProps = capturedBaseGridProps.at(-1);
    expect(streamingProps).toBeDefined();
    expect((streamingProps?.rows as unknown[] | undefined)?.length).toBe(5_000);

    rerender(
      <QueryResultGrid
        gridId="query-grid"
        isStreaming={false}
        data={{
          columns: ["id"],
          rows,
          rowCount: rows.length,
        }}
      />,
    );

    const completedProps = capturedBaseGridProps.at(-1);
    expect(completedProps).toBeDefined();
    expect((completedProps?.rows as unknown[] | undefined)?.length).toBe(12_000);
    expect(completedProps?.hasMore).toBe(false);
  });
});
