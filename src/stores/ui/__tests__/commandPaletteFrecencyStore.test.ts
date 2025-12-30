import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useCommandPaletteFrecencyStore,
  calculateFrecencyScore,
} from "../commandPaletteFrecencyStore";

describe("commandPaletteFrecencyStore", () => {
  beforeEach(() => {
    // Reset store state
    const { result } = renderHook(() => useCommandPaletteFrecencyStore());
    act(() => {
      result.current.clearHistory();
    });
  });

  describe("recordAccess", () => {
    it("should record first access for an item", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());

      act(() => {
        result.current.recordAccess("item-1");
      });

      expect(result.current.items["item-1"]).toBeDefined();
      expect(result.current.items["item-1"].accessCount).toBe(1);
    });

    it("should increment access count on subsequent accesses", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());

      act(() => {
        result.current.recordAccess("item-1");
        result.current.recordAccess("item-1");
        result.current.recordAccess("item-1");
      });

      expect(result.current.items["item-1"].accessCount).toBe(3);
    });

    it("should update lastAccessed timestamp", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());
      const before = Date.now();

      act(() => {
        result.current.recordAccess("item-1");
      });

      const after = Date.now();
      expect(result.current.items["item-1"].lastAccessed).toBeGreaterThanOrEqual(before);
      expect(result.current.items["item-1"].lastAccessed).toBeLessThanOrEqual(after);
    });

    it("should track multiple items independently", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());

      act(() => {
        result.current.recordAccess("item-1");
        result.current.recordAccess("item-2");
        result.current.recordAccess("item-1");
      });

      expect(result.current.items["item-1"].accessCount).toBe(2);
      expect(result.current.items["item-2"].accessCount).toBe(1);
    });
  });

  describe("clearHistory", () => {
    it("should clear all items", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());

      act(() => {
        result.current.recordAccess("item-1");
        result.current.recordAccess("item-2");
        result.current.clearHistory();
      });

      expect(Object.keys(result.current.items)).toHaveLength(0);
    });

    it("should allow recording after clearing", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());

      act(() => {
        result.current.recordAccess("item-1");
        result.current.clearHistory();
        result.current.recordAccess("item-2");
      });

      expect(result.current.items["item-1"]).toBeUndefined();
      expect(result.current.items["item-2"]).toBeDefined();
      expect(result.current.items["item-2"].accessCount).toBe(1);
    });
  });

  describe("calculateFrecencyScore", () => {
    it("should return 0 for undefined entry", () => {
      expect(calculateFrecencyScore(undefined)).toBe(0);
    });

    it("should return accessCount * 1.0 for recent access (today)", () => {
      const entry = {
        lastAccessed: Date.now() - 1000, // 1 second ago
        accessCount: 5,
      };
      expect(calculateFrecencyScore(entry)).toBe(5);
    });

    it("should return accessCount * 0.7 for access this week", () => {
      const entry = {
        lastAccessed: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
        accessCount: 10,
      };
      expect(calculateFrecencyScore(entry)).toBe(7);
    });

    it("should return accessCount * 0.5 for access this month", () => {
      const entry = {
        lastAccessed: Date.now() - 14 * 24 * 60 * 60 * 1000, // 14 days ago
        accessCount: 10,
      };
      expect(calculateFrecencyScore(entry)).toBe(5);
    });

    it("should return accessCount * 0.3 for old access", () => {
      const entry = {
        lastAccessed: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days ago
        accessCount: 10,
      };
      expect(calculateFrecencyScore(entry)).toBe(3);
    });

    it("should handle edge cases at day boundary", () => {
      const DAY_MS = 24 * 60 * 60 * 1000;

      // Just under 1 day (should be weight 1.0)
      const justUnderDay = {
        lastAccessed: Date.now() - (DAY_MS - 1000),
        accessCount: 10,
      };
      expect(calculateFrecencyScore(justUnderDay)).toBe(10);

      // Just over 1 day (should be weight 0.7)
      const justOverDay = {
        lastAccessed: Date.now() - (DAY_MS + 1000),
        accessCount: 10,
      };
      expect(calculateFrecencyScore(justOverDay)).toBe(7);
    });

    it("should handle edge cases at week boundary", () => {
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

      // Just under 1 week (should be weight 0.7)
      const justUnderWeek = {
        lastAccessed: Date.now() - (WEEK_MS - 1000),
        accessCount: 10,
      };
      expect(calculateFrecencyScore(justUnderWeek)).toBe(7);

      // Just over 1 week (should be weight 0.5)
      const justOverWeek = {
        lastAccessed: Date.now() - (WEEK_MS + 1000),
        accessCount: 10,
      };
      expect(calculateFrecencyScore(justOverWeek)).toBe(5);
    });

    it("should handle edge cases at month boundary", () => {
      const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

      // Just under 1 month (should be weight 0.5)
      const justUnderMonth = {
        lastAccessed: Date.now() - (MONTH_MS - 1000),
        accessCount: 10,
      };
      expect(calculateFrecencyScore(justUnderMonth)).toBe(5);

      // Just over 1 month (should be weight 0.3)
      const justOverMonth = {
        lastAccessed: Date.now() - (MONTH_MS + 1000),
        accessCount: 10,
      };
      expect(calculateFrecencyScore(justOverMonth)).toBe(3);
    });

    it("should calculate correctly with different access counts", () => {
      const now = Date.now();

      // 1 access today
      expect(calculateFrecencyScore({ lastAccessed: now, accessCount: 1 })).toBe(1);

      // 100 accesses today
      expect(calculateFrecencyScore({ lastAccessed: now, accessCount: 100 })).toBe(100);

      // 5 accesses 3 days ago
      const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
      expect(calculateFrecencyScore({ lastAccessed: threeDaysAgo, accessCount: 5 })).toBe(3.5);
    });
  });
});
