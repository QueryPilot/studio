import { describe, it, expect } from "vitest";
import {
  calculateColumnStats,
  formatNumber,
  formatPercentage,
} from "./columnStats";

describe("columnStats", () => {
  describe("calculateColumnStats", () => {
    it("should calculate basic stats for numeric column", () => {
      const rows = [
        [1, "test"],
        [2, "test2"],
        [3, "test3"],
        [null, "test4"],
      ];

      const stats = calculateColumnStats(rows, 0);

      expect(stats.totalRows).toBe(4);
      expect(stats.nullCount).toBe(1);
      expect(stats.distinctCount).toBe(3);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(3);
      expect(stats.avg).toBe(2);
    });

    it("should calculate stats for string column", () => {
      const rows = [
        [1, "hello"],
        [2, "world"],
        [3, "test"],
        [4, null],
      ];

      const stats = calculateColumnStats(rows, 1);

      expect(stats.totalRows).toBe(4);
      expect(stats.nullCount).toBe(1);
      expect(stats.distinctCount).toBe(3);
      expect(stats.minLength).toBe(4); // "test"
      expect(stats.maxLength).toBe(5); // "hello" or "world"
    });

    it("should handle all null values", () => {
      const rows = [
        [null, "test"],
        [null, "test2"],
        [null, "test3"],
      ];

      const stats = calculateColumnStats(rows, 0);

      expect(stats.totalRows).toBe(3);
      expect(stats.nullCount).toBe(3);
      expect(stats.distinctCount).toBe(0);
      expect(stats.min).toBeUndefined();
      expect(stats.max).toBeUndefined();
      expect(stats.avg).toBeUndefined();
    });

    it("should handle duplicate values correctly", () => {
      const rows = [[1], [1], [2], [2], [2]];

      const stats = calculateColumnStats(rows, 0);

      expect(stats.totalRows).toBe(5);
      expect(stats.nullCount).toBe(0);
      expect(stats.distinctCount).toBe(2); // Only 1 and 2
    });

    it("should handle empty dataset", () => {
      const rows: unknown[][] = [];

      const stats = calculateColumnStats(rows, 0);

      expect(stats.totalRows).toBe(0);
      expect(stats.nullCount).toBe(0);
      expect(stats.distinctCount).toBe(0);
    });

    it("should handle mixed types (non-numeric)", () => {
      const rows = [[1], ["2"], [3]];

      const stats = calculateColumnStats(rows, 0);

      // Should not treat as numeric since there's a string
      expect(stats.min).toBeUndefined();
      expect(stats.max).toBeUndefined();
      expect(stats.avg).toBeUndefined();
    });
  });

  describe("formatNumber", () => {
    it("should format numbers with locale", () => {
      expect(formatNumber(1234.5678)).toBe("1,234.57");
      expect(formatNumber(1000000)).toBe("1,000,000");
    });

    it("should respect decimal places", () => {
      expect(formatNumber(1234.5678, 0)).toBe("1,235");
      expect(formatNumber(1234.5678, 3)).toBe("1,234.568");
    });
  });

  describe("formatPercentage", () => {
    it("should calculate percentage correctly", () => {
      expect(formatPercentage(25, 100)).toBe("25%");
      expect(formatPercentage(1, 3)).toMatch(/33\.33%/);
    });

    it("should handle zero total", () => {
      expect(formatPercentage(0, 0)).toBe("0%");
    });

    it("should handle zero value", () => {
      expect(formatPercentage(0, 100)).toBe("0%");
    });
  });
});
