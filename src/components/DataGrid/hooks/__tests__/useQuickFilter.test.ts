import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQuickFilter } from "../useQuickFilter";
import type { FilterColumnInfo } from "@/utils/filterParser";

// Sample columns for testing
const mockColumns: FilterColumnInfo[] = [
  {
    name: "id",
    dataType: "integer",
    nullable: false,
    isPrimaryKey: true,
    isForeignKey: false,
  },
  {
    name: "name",
    dataType: "varchar",
    nullable: true,
    isPrimaryKey: false,
    isForeignKey: false,
  },
  {
    name: "status",
    dataType: "varchar",
    nullable: false,
    isPrimaryKey: false,
    isForeignKey: false,
    enumValues: ["active", "inactive", "pending"],
  },
];

describe("useQuickFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Initial State", () => {
    it("should initialize with empty value and search mode", () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      expect(result.current.value).toBe("");
      expect(result.current.mode).toBe("search");
      expect(result.current.error).toBeNull();
      expect(result.current.aiExplanation).toBeNull();
      expect(result.current.activeFilter).toBeUndefined();
    });

    it("should initialize with initialFilter in where mode", () => {
      const { result } = renderHook(() =>
        useQuickFilter({
          columns: mockColumns,
          initialFilter: 'name = \'test\'',
        })
      );

      expect(result.current.value).toBe("?name = 'test'");
      expect(result.current.mode).toBe("where");
    });

    it("should apply initialFilter when columns are available", async () => {
      const { result, rerender } = renderHook(
        ({ columns }) =>
          useQuickFilter({
            columns,
            initialFilter: 'name = \'test\'',
          }),
        { initialProps: { columns: [] as FilterColumnInfo[] } }
      );

      // Initially no filter applied (columns empty)
      expect(result.current.activeFilter).toBeUndefined();

      // Rerender with columns
      rerender({ columns: mockColumns });

      // Filter should be applied
      await waitFor(() => {
        expect(result.current.activeFilter).toBeDefined();
      });
    });
  });

  describe("Value Changes", () => {
    it("should update value when setValue is called", () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      act(() => {
        result.current.setValue("test");
      });

      expect(result.current.value).toBe("test");
      expect(result.current.mode).toBe("search"); // Still search mode
    });

    it("should auto-detect where mode when value starts with ?", () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      act(() => {
        result.current.setValue("?id > 10");
      });

      expect(result.current.value).toBe("?id > 10");
      expect(result.current.mode).toBe("where");
    });

    it("should auto-detect AI mode when value starts with #", () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      act(() => {
        result.current.setValue("#show active users");
      });

      expect(result.current.value).toBe("#show active users");
      expect(result.current.mode).toBe("ai");
    });

    it("should clear filter when value is empty", () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      // First set a value and submit
      act(() => {
        result.current.setValue("test");
      });

      // Then clear it
      act(() => {
        result.current.setValue("");
      });

      expect(result.current.activeFilter).toBeUndefined();
    });

    it("should clear errors when value changes", async () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      // Set invalid WHERE clause
      act(() => {
        result.current.setValue("?invalid syntax {{{}");
      });

      await act(async () => {
        await result.current.submit();
      });

      // Should have an error
      expect(result.current.error).not.toBeNull();

      // Clear error by changing value
      act(() => {
        result.current.setValue("?id = 1");
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("Filter Submission", () => {
    it("should parse and apply search filter", async () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      act(() => {
        result.current.setValue("test");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.activeFilter).toBeDefined();
      expect(result.current.error).toBeNull();
    });

    it("should parse and apply WHERE clause filter", async () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      act(() => {
        result.current.setValue("?id > 10");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.activeFilter).toBeDefined();
      expect(result.current.error).toBeNull();
    });

    it("should set error for invalid WHERE clause", async () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      act(() => {
        result.current.setValue("?INVALID SYNTAX {{{}");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.error).not.toBeNull();
    });

    it("should clear filter for empty value", async () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      // First apply a filter
      act(() => {
        result.current.setValue("test");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.activeFilter).toBeDefined();

      // Then submit empty
      act(() => {
        result.current.setValue("");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.activeFilter).toBeUndefined();
    });
  });

  describe("AI Filter", () => {
    it("should call generateAIFilter for AI mode", async () => {
      const mockGenerateAIFilter = vi.fn().mockResolvedValue({
        clause: "status = 'active'",
        explanation: "Filtering for active records",
      });

      const { result } = renderHook(() =>
        useQuickFilter({
          columns: mockColumns,
          generateAIFilter: mockGenerateAIFilter,
        })
      );

      act(() => {
        result.current.setValue("#show active records");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(mockGenerateAIFilter).toHaveBeenCalledWith("show active records");
      expect(result.current.activeFilter).toBeDefined();
      expect(result.current.aiExplanation).toBe("Filtering for active records");
      // Should switch to WHERE mode with the generated clause
      expect(result.current.mode).toBe("where");
      expect(result.current.value).toBe("?status = 'active'");
    });

    it("should handle AI filter error", async () => {
      const mockGenerateAIFilter = vi.fn().mockResolvedValue({
        error: "Failed to generate filter",
      });

      const { result } = renderHook(() =>
        useQuickFilter({
          columns: mockColumns,
          generateAIFilter: mockGenerateAIFilter,
        })
      );

      act(() => {
        result.current.setValue("#something");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.error).toBe("Failed to generate filter");
      expect(result.current.activeFilter).toBeUndefined();
    });

    it("should show error when AI filter not available", async () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      act(() => {
        result.current.setValue("#show active");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.error).toBe("AI filter not available");
    });
  });

  describe("Clear", () => {
    it("should reset all state when clear is called", async () => {
      const { result } = renderHook(() =>
        useQuickFilter({
          columns: mockColumns,
          initialFilter: 'name = \'test\'',
        })
      );

      // Verify initial state
      expect(result.current.value).not.toBe("");
      expect(result.current.mode).toBe("where");

      // Clear
      act(() => {
        result.current.clear();
      });

      expect(result.current.value).toBe("");
      expect(result.current.mode).toBe("search");
      expect(result.current.error).toBeNull();
      expect(result.current.aiExplanation).toBeNull();
      expect(result.current.activeFilter).toBeUndefined();
    });
  });

  describe("Mode Changes", () => {
    it("should allow manual mode changes", () => {
      const { result } = renderHook(() =>
        useQuickFilter({ columns: mockColumns })
      );

      act(() => {
        result.current.setMode("where");
      });

      expect(result.current.mode).toBe("where");

      act(() => {
        result.current.setMode("ai");
      });

      expect(result.current.mode).toBe("ai");
    });
  });
});
