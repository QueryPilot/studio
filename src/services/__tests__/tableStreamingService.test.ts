import { describe, it, expect } from "vitest";

/**
 * Tests for BigInt normalization in the streaming service.
 *
 * The normalizeRawRows function is internal to tableStreamingService,
 * so we test the normalization logic directly using the same implementation.
 */

import { normalizeBackendValue } from "../tableDataTransform";
import type { RawCellValue } from "../backend";

// Mirror the internal normalizeRawRows function for testing
function normalizeRawRows(rows: RawCellValue[][]): RawCellValue[][] {
  return rows.map((row) =>
    row.map((cell) => normalizeBackendValue(cell) as RawCellValue),
  );
}

describe("normalizeRawRows (streaming BigInt fix)", () => {
  describe("BigInt normalization in streaming batches", () => {
    it("normalizes BigInt values in 2D row arrays", () => {
      const rawRows: RawCellValue[][] = [
        [BigInt("9223372036854775807"), "text", 42],
        [BigInt(123), null, true],
      ];

      const result = normalizeRawRows(rawRows);

      expect(result[0]![0]).toBe("9223372036854775807");
      expect(result[0]![1]).toBe("text");
      expect(result[0]![2]).toBe(42);
      expect(result[1]![0]).toBe("123");
      expect(result[1]![1]).toBe(null);
      expect(result[1]![2]).toBe(true);
    });

    it("handles empty rows array", () => {
      const result = normalizeRawRows([]);
      expect(result).toEqual([]);
    });

    it("handles rows with empty cells", () => {
      const rawRows: RawCellValue[][] = [[]];
      const result = normalizeRawRows(rawRows);
      expect(result).toEqual([[]]);
    });

    it("handles mixed BigInt positions across rows", () => {
      const rawRows: RawCellValue[][] = [
        [1, BigInt(2), 3],
        [BigInt(4), 5, BigInt(6)],
        [7, 8, 9],
      ];

      const result = normalizeRawRows(rawRows);

      expect(result[0]).toEqual([1, "2", 3]);
      expect(result[1]).toEqual(["4", 5, "6"]);
      expect(result[2]).toEqual([7, 8, 9]);
    });

    it("handles nested arrays with BigInt", () => {
      const rawRows: RawCellValue[][] = [
        [[BigInt(1), BigInt(2)] as RawCellValue, "text"],
      ];

      const result = normalizeRawRows(rawRows);

      expect(result[0]![0]).toEqual(["1", "2"]);
    });

    it("handles nested objects with BigInt (JSON columns)", () => {
      const rawRows: RawCellValue[][] = [
        [{ id: BigInt(123), nested: { count: BigInt(456) } } as RawCellValue],
      ];

      const result = normalizeRawRows(rawRows);

      expect(result[0]![0]).toEqual({
        id: "123",
        nested: { count: "456" },
      });
    });
  });

  describe("JSON.stringify safety (prevents React DevTools crash)", () => {
    it("result is safe for JSON.stringify", () => {
      const rawRows: RawCellValue[][] = [
        [BigInt("9223372036854775807"), BigInt("-9223372036854775808")],
        [{ data: BigInt(123) } as RawCellValue, [BigInt(1), BigInt(2)]],
      ];

      const result = normalizeRawRows(rawRows);

      // This would throw TypeError if BigInt was present
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it("raw rows with BigInt throws on JSON.stringify (proving the issue)", () => {
      const rawRows = [[BigInt(123)]];

      expect(() => JSON.stringify(rawRows)).toThrow(TypeError);
    });
  });

  describe("preserves other types correctly", () => {
    it("preserves null values", () => {
      const rawRows: RawCellValue[][] = [[null, null]];
      const result = normalizeRawRows(rawRows);
      expect(result).toEqual([[null, null]]);
    });

    it("preserves number values (within safe integer range)", () => {
      const rawRows: RawCellValue[][] = [
        [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0, -1, 3.14159],
      ];
      const result = normalizeRawRows(rawRows);
      expect(result).toEqual([
        [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0, -1, 3.14159],
      ]);
    });

    it("preserves string values", () => {
      const rawRows: RawCellValue[][] = [
        ["hello", "", "9223372036854775807"], // String that looks like BigInt
      ];
      const result = normalizeRawRows(rawRows);
      expect(result).toEqual([["hello", "", "9223372036854775807"]]);
    });

    it("preserves boolean values", () => {
      const rawRows: RawCellValue[][] = [[true, false]];
      const result = normalizeRawRows(rawRows);
      expect(result).toEqual([[true, false]]);
    });
  });

  describe("real-world scenarios", () => {
    it("handles typical PostgreSQL BIGSERIAL id column", () => {
      // Simulates: SELECT id, name FROM sales WHERE id > 9007199254740991
      const rawRows: RawCellValue[][] = [
        [BigInt("9007199254740992"), "Product A"], // Just above MAX_SAFE_INTEGER
        [BigInt("9007199254740993"), "Product B"],
        [BigInt("9223372036854775807"), "Product C"], // Max BIGINT
      ];

      const result = normalizeRawRows(rawRows);

      expect(result[0]![0]).toBe("9007199254740992");
      expect(result[1]![0]).toBe("9007199254740993");
      expect(result[2]![0]).toBe("9223372036854775807");

      // All can be safely serialized
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it("handles PostgreSQL JSONB with BigInt values", () => {
      const rawRows: RawCellValue[][] = [
        [
          1,
          {
            user_id: BigInt("9007199254740993"),
            metrics: {
              total_count: BigInt("100000000000"),
              nested: { value: BigInt(42) },
            },
          } as RawCellValue,
        ],
      ];

      const result = normalizeRawRows(rawRows);

      expect(result[0]![1]).toEqual({
        user_id: "9007199254740993",
        metrics: {
          total_count: "100000000000",
          nested: { value: "42" },
        },
      });
    });

    it("handles PostgreSQL array columns with BigInt", () => {
      // Simulates: SELECT bigint_array FROM table
      const rawRows: RawCellValue[][] = [
        [[BigInt(1), BigInt(2), BigInt(3)] as RawCellValue],
        [[BigInt("9223372036854775807")] as RawCellValue],
      ];

      const result = normalizeRawRows(rawRows);

      expect(result[0]![0]).toEqual(["1", "2", "3"]);
      expect(result[1]![0]).toEqual(["9223372036854775807"]);
    });
  });
});
