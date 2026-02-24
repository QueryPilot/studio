import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { usePersistentViewState } from "../usePersistentViewState";

// Mock the stores
vi.mock("../../../stores", () => ({
  useGridPreferencesHydrated: vi.fn(() => true),
  useGridViewState: vi.fn(() => ({
    selection: { rows: [], columns: [], current: undefined },
    activeCell: null,
    scrollOffset: { x: 0, y: 0 },
  })),
  upsertGridViewState: vi.fn(),
}));

// Mock the utilities
vi.mock("../../../utils", () => ({
  serializeGridSelection: vi.fn((selection) => selection),
  deserializeGridSelection: vi.fn((selection) => selection),
}));

describe("usePersistentViewState", () => {
  it("should initialize with hydrated state", () => {
    const { result } = renderHook(() => usePersistentViewState("test-grid"));

    expect(result.current.hydrated).toBe(true);
    expect(result.current.persistedView).toBeDefined();
  });

  it("should provide persist functions", () => {
    const { result } = renderHook(() => usePersistentViewState("test-grid"));

    expect(typeof result.current.persistSelection).toBe("function");
    expect(typeof result.current.persistScrollOffset).toBe("function");
    expect(typeof result.current.persistActiveCell).toBe("function");
    expect(typeof result.current.clearViewState).toBe("function");
  });

  it("should persist scroll offset", async () => {
    const stores = await import("../../../stores");
    const { result } = renderHook(() => usePersistentViewState("test-grid"));

    act(() => {
      result.current.persistScrollOffset({ x: 100, y: 200 });
    });

    expect(stores.upsertGridViewState).toHaveBeenCalledWith(
      "test-grid",
      expect.any(Function),
    );
  });

  it("should clear view state", async () => {
    const stores = await import("../../../stores");
    const { result } = renderHook(() => usePersistentViewState("test-grid"));

    vi.mocked(stores.upsertGridViewState).mockClear();

    act(() => {
      result.current.clearViewState();
    });

    expect(stores.upsertGridViewState).toHaveBeenCalledWith(
      "test-grid",
      expect.any(Function),
    );
  });
});
