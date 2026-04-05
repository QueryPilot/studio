import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamEntityPageMock, fetchTableStructureMock } = vi.hoisted(() => ({
  streamEntityPageMock: vi.fn(),
  fetchTableStructureMock: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/services/tableStreamingService", () => ({
  streamEntityPage: (...args: unknown[]) => streamEntityPageMock(...args),
}));

vi.mock("../useTableFullStructure", () => ({
  fetchTableStructure: (...args: unknown[]) => fetchTableStructureMock(...args),
}));

import { useTableDataQuery } from "../useTableDataQuery";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useTableDataQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    fetchTableStructureMock.mockResolvedValue({
      name: "nation",
      schema: "tiny",
      database: "tpch",
      columns: [],
      primaryKeys: [],
      foreignKeys: [],
      indexes: [],
      constraints: [],
      triggers: [],
    });
  });

  it("updates the cached first page when a late row count arrives", async () => {
    streamEntityPageMock.mockImplementation(
      async ({
        onProgress,
      }: {
        onProgress?: (progress: {
          rowsFetched: number;
          totalRows?: number;
          isEstimatedCount?: boolean;
        }) => void;
      }) => {
        setTimeout(() => {
          onProgress?.({
            rowsFetched: 100,
            totalRows: 100,
            isEstimatedCount: false,
          });
        }, 0);

        return {
          columns: [{ name: "id", db_type: "bigint", ordinal: 0 }],
          rows: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })),
          hasMore: true,
          estimatedTotal: undefined,
          isEstimatedCount: true,
          executionTimeMs: 12,
        };
      },
    );

    const { result } = renderHook(
      () =>
        useTableDataQuery({
          connectionId: "trino-conn",
          database: "tpch",
          schema: "tiny",
          entityName: "nation",
          entityType: "table",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    await waitFor(() => {
      expect(result.current.estimatedTotal).toBe(100);
      expect(result.current.isEstimatedCount).toBe(false);
      expect(result.current.hasNextPage).toBe(false);
    });
  });
});
