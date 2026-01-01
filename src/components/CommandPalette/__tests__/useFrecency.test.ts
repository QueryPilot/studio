import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFrecency } from "../useFrecency";
import { useCommandPaletteFrecencyStore } from "@/stores/ui/commandPaletteFrecencyStore";

describe("useFrecency", () => {
  beforeEach(() => {
    // Reset store before each test
    const { result } = renderHook(() => useCommandPaletteFrecencyStore());
    act(() => {
      result.current.clearHistory();
    });
  });

  describe("getFrecencyScore", () => {
    it("should return 0 for items with no history", () => {
      const { result } = renderHook(() => useFrecency());

      expect(result.current.getFrecencyScore("unknown-item")).toBe(0);
    });

    it("should return score for items with access history", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      act(() => {
        storeResult.current.recordAccess("item-a");
        storeResult.current.recordAccess("item-a");
      });

      const { result } = renderHook(() => useFrecency());

      // 2 accesses today = 2 * 1.0 = 2
      expect(result.current.getFrecencyScore("item-a")).toBe(2);
    });
  });

  describe("sortByFrecency", () => {
    it("should sort items by frecency score descending", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      // Record different access patterns
      act(() => {
        storeResult.current.recordAccess("item-a");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-b");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }, { id: "item-c" }];

      const sorted = result.current.sortByFrecency(items);

      expect(sorted[0]!.id).toBe("item-b"); // 3 accesses
      expect(sorted[1]!.id).toBe("item-a"); // 1 access
      expect(sorted[2]!.id).toBe("item-c"); // 0 accesses
    });

    it("should fallback to alphabetical for equal scores", () => {
      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "zebra" }, { id: "apple" }, { id: "mango" }];

      const sorted = result.current.sortByFrecency(items);

      expect(sorted[0]!.id).toBe("apple");
      expect(sorted[1]!.id).toBe("mango");
      expect(sorted[2]!.id).toBe("zebra");
    });

    it("should handle empty arrays", () => {
      const { result } = renderHook(() => useFrecency());
      const items: { id: string }[] = [];

      const sorted = result.current.sortByFrecency(items);

      expect(sorted).toHaveLength(0);
    });

    it("should not modify original array", () => {
      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "zebra" }, { id: "apple" }];

      result.current.sortByFrecency(items);

      expect(items[0]!.id).toBe("zebra");
      expect(items[1]!.id).toBe("apple");
    });

    it("should preserve additional properties on items", () => {
      const { result } = renderHook(() => useFrecency());
      const items = [
        { id: "item-1", name: "First Item", extra: 123 },
        { id: "item-2", name: "Second Item", extra: 456 },
      ];

      const sorted = result.current.sortByFrecency(items);

      expect(sorted[0]!).toHaveProperty("name");
      expect(sorted[0]!).toHaveProperty("extra");
    });
  });

  describe("getTopFrecencyItems", () => {
    it("should return only items with frecency > 0", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      act(() => {
        storeResult.current.recordAccess("item-a");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }];

      const top = result.current.getTopFrecencyItems(items, 10);

      expect(top).toHaveLength(1);
      expect(top[0]!.id).toBe("item-a");
    });

    it("should respect limit parameter", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      act(() => {
        storeResult.current.recordAccess("item-a");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-c");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }, { id: "item-c" }];

      const top = result.current.getTopFrecencyItems(items, 2);

      expect(top).toHaveLength(2);
    });

    it("should return items sorted by frecency score", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      act(() => {
        storeResult.current.recordAccess("item-a");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-c");
        storeResult.current.recordAccess("item-c");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }, { id: "item-c" }];

      const top = result.current.getTopFrecencyItems(items, 10);

      expect(top[0]!.id).toBe("item-b"); // 3 accesses
      expect(top[1]!.id).toBe("item-c"); // 2 accesses
      expect(top[2]!.id).toBe("item-a"); // 1 access
    });

    it("should return empty array when no items have frecency", () => {
      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }];

      const top = result.current.getTopFrecencyItems(items, 10);

      expect(top).toHaveLength(0);
    });

    it("should return empty array for empty input", () => {
      const { result } = renderHook(() => useFrecency());
      const items: { id: string }[] = [];

      const top = result.current.getTopFrecencyItems(items, 10);

      expect(top).toHaveLength(0);
    });

    it("should handle limit greater than available items", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      act(() => {
        storeResult.current.recordAccess("item-a");
        storeResult.current.recordAccess("item-b");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }];

      const top = result.current.getTopFrecencyItems(items, 100);

      expect(top).toHaveLength(2);
    });

    it("should handle limit of 0", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      act(() => {
        storeResult.current.recordAccess("item-a");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }];

      const top = result.current.getTopFrecencyItems(items, 0);

      expect(top).toHaveLength(0);
    });
  });

  describe("recordAccess", () => {
    it("should record access through the hook", () => {
      const { result } = renderHook(() => useFrecency());

      act(() => {
        result.current.recordAccess("new-item");
      });

      expect(result.current.getFrecencyScore("new-item")).toBeGreaterThan(0);
    });

    it("should increment on repeated access", () => {
      const { result } = renderHook(() => useFrecency());

      act(() => {
        result.current.recordAccess("item-a");
      });

      const scoreAfterFirst = result.current.getFrecencyScore("item-a");

      act(() => {
        result.current.recordAccess("item-a");
      });

      const scoreAfterSecond = result.current.getFrecencyScore("item-a");

      expect(scoreAfterSecond).toBe(scoreAfterFirst * 2);
    });
  });
});
