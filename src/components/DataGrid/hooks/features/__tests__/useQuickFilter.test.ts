import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useQuickFilter } from "../useQuickFilter";

vi.mock("../../useAIFilter", () => ({
  useAIFilter: vi.fn(() => ({
    isProcessing: false,
    processAIFilter: vi.fn(),
  })),
}));

describe("useQuickFilter", () => {
  it("should provide filter state and methods", () => {
    const { result } = renderHook(() =>
      useQuickFilter({
        onFilterChange: vi.fn(),
      }),
    );

    expect(typeof result.current.mode).toBe("string");
    expect(typeof result.current.setMode).toBe("function");
    expect(typeof result.current.submit).toBe("function");
    expect(typeof result.current.clear).toBe("function");
  });
});
