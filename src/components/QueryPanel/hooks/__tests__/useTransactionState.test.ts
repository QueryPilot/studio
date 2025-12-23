import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTransactionState } from "../useTransactionState";

// Mock tabStateStore
const mockSetQueryState = vi.fn();
let mockQueryState: { inTransaction?: boolean } | undefined = {};

vi.mock("@/stores/tabStateStore", () => ({
  useTabStateStore: vi.fn((selector) => {
    const state = {
      getQueryState: () => mockQueryState,
      setQueryState: mockSetQueryState,
    };
    return selector(state);
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("useTransactionState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryState = {};
  });

  describe("inTransaction state", () => {
    it("should default to false when no global state", () => {
      mockQueryState = undefined;
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      expect(result.current.inTransaction).toBe(false);
    });

    it("should reflect global inTransaction state", () => {
      mockQueryState = { inTransaction: true };
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      expect(result.current.inTransaction).toBe(true);
    });
  });

  describe("handleTransactionCommand", () => {
    it("should detect BEGIN command", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("BEGIN");
      });

      expect(response).toEqual({ isTransaction: true, message: "Transaction started" });
      expect(mockSetQueryState).toHaveBeenCalledWith("tab-1", { inTransaction: true });
    });

    it("should detect START TRANSACTION command", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("START TRANSACTION");
      });

      expect(response).toEqual({ isTransaction: true, message: "Transaction started" });
      expect(mockSetQueryState).toHaveBeenCalledWith("tab-1", { inTransaction: true });
    });

    it("should detect COMMIT command", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("COMMIT");
      });

      expect(response).toEqual({ isTransaction: true, message: "Transaction committed successfully" });
      expect(mockSetQueryState).toHaveBeenCalledWith("tab-1", { inTransaction: false });
    });

    it("should detect ROLLBACK command", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("ROLLBACK");
      });

      expect(response).toEqual({ isTransaction: true, message: "Transaction rolled back successfully" });
      expect(mockSetQueryState).toHaveBeenCalledWith("tab-1", { inTransaction: false });
    });

    it("should detect SAVEPOINT command", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("SAVEPOINT my_savepoint");
      });

      expect(response).toEqual({ isTransaction: true, message: "Savepoint created" });
    });

    it("should detect RELEASE SAVEPOINT command", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("RELEASE SAVEPOINT my_savepoint");
      });

      expect(response).toEqual({ isTransaction: true, message: "Savepoint released" });
    });

    it("should detect ROLLBACK TO command", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("ROLLBACK TO my_savepoint");
      });

      expect(response).toEqual({ isTransaction: true, message: "Transaction rolled back successfully" });
      expect(mockSetQueryState).toHaveBeenCalledWith("tab-1", { inTransaction: false });
    });

    it("should not detect regular SELECT as transaction command", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("SELECT * FROM users");
      });

      expect(response).toEqual({ isTransaction: false });
      expect(mockSetQueryState).not.toHaveBeenCalled();
    });

    it("should be case insensitive", () => {
      const { result } = renderHook(() => useTransactionState({ tabId: "tab-1" }));

      let response;
      act(() => {
        response = result.current.handleTransactionCommand("  begin  ");
      });

      expect(response).toEqual({ isTransaction: true, message: "Transaction started" });
    });
  });
});
