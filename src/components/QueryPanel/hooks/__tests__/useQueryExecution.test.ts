import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQueryExecution } from "../useQueryExecution";

// Mock dependencies
vi.mock("@/services/tableStreamingService", () => ({
  tableStreamingService: {
    streamQuery: vi.fn(),
  },
}));

vi.mock("@/services/queryHistoryService", () => ({
  queryHistoryService: {
    addEntry: vi.fn(),
  },
}));

vi.mock("@/stores/tabStateStore", () => ({
  useTabStateStore: vi.fn((selector) => {
    const state = {
      setQueryState: vi.fn(),
      queryStates: new Map(),
    };
    return selector(state);
  }),
}));

vi.mock("@/stores/dataInvalidationStore", () => ({
  useDataInvalidationStore: {
    getState: () => ({
      invalidateTable: vi.fn(),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

describe("useQueryExecution", () => {
  const defaultOptions = {
    connectionId: "conn-1",
    database: "testdb",
    tabId: "tab-1",
    smartQueryLimit: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("should initialize with default state", () => {
      const { result } = renderHook(() => useQueryExecution(defaultOptions));

      expect(result.current.isExecuting).toBe(false);
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.result).toBeNull();
      expect(result.current.appliedLimit).toBeNull();
    });

    it("should provide execute and cancel functions", () => {
      const { result } = renderHook(() => useQueryExecution(defaultOptions));

      expect(typeof result.current.execute).toBe("function");
      expect(typeof result.current.executeMulti).toBe("function");
      expect(typeof result.current.cancel).toBe("function");
    });
  });

  describe("execute function", () => {
    it("should show error for empty query", async () => {
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useQueryExecution(defaultOptions));

      await act(async () => {
        await result.current.execute("");
      });

      expect(toast.error).toHaveBeenCalledWith("Please enter a query to execute");
      expect(result.current.isExecuting).toBe(false);
    });

    it("should show error for whitespace-only query", async () => {
      const { toast } = await import("sonner");
      const { result } = renderHook(() => useQueryExecution(defaultOptions));

      await act(async () => {
        await result.current.execute("   ");
      });

      expect(toast.error).toHaveBeenCalledWith("Please enter a query to execute");
    });

    it("should throw error if no connection selected", async () => {
      const { result } = renderHook(() =>
        useQueryExecution({
          ...defaultOptions,
          connectionId: "",
        })
      );

      await act(async () => {
        await result.current.execute("SELECT 1");
      });

      // Should have set error result
      expect(result.current.result?.error).toBeDefined();
    });
  });

  describe("cancel function", () => {
    it("should cancel execution", async () => {
      const { result } = renderHook(() => useQueryExecution(defaultOptions));

      act(() => {
        result.current.cancel();
      });

      // Should not throw
      expect(result.current.isExecuting).toBe(false);
    });
  });

  describe("executeMulti function", () => {
    it("should return early for empty statements", async () => {
      const { result } = renderHook(() => useQueryExecution(defaultOptions));

      await act(async () => {
        await result.current.executeMulti([]);
      });

      expect(result.current.isExecuting).toBe(false);
    });

    it("should filter out empty statements", async () => {
      const { result } = renderHook(() => useQueryExecution(defaultOptions));

      await act(async () => {
        await result.current.executeMulti(["", "  ", ""]);
      });

      // Should not have executed anything meaningful
      expect(result.current.isExecuting).toBe(false);
    });
  });
});
