import { describe, it, expect } from "vitest";
import {
  detectPasteFormat,
  parsePasteData,
  parseJSON,
  parseTSV,
  parseCSV,
  coerceToColumnType,
  smartPasteCoerce,
  validatePasteData,
  type ColumnTypeHint,
} from "../pasteUtils";

describe("pasteUtils", () => {
  describe("detectPasteFormat", () => {
    it("should detect JSON format", () => {
      expect(detectPasteFormat('[{"a": 1}]')).toBe("json");
      expect(detectPasteFormat('{"key": "value"}')).toBe("json");
    });

    it("should detect TSV format", () => {
      expect(detectPasteFormat("a\tb\tc")).toBe("tsv");
      expect(detectPasteFormat("1\t2\t3\n4\t5\t6")).toBe("tsv");
    });

    it("should detect CSV format", () => {
      expect(detectPasteFormat("a,b,c")).toBe("csv");
      expect(detectPasteFormat("1,2,3\n4,5,6")).toBe("csv");
    });

    it("should prefer tabs over commas when both present", () => {
      expect(detectPasteFormat("a\tb\tc,d")).toBe("tsv");
    });

    it("should default to TSV for simple values", () => {
      expect(detectPasteFormat("hello")).toBe("tsv");
    });
  });

  describe("parseTSV", () => {
    it("should parse simple TSV", () => {
      const result = parseTSV("a\tb\tc");
      expect(result.format).toBe("tsv");
      expect(result.rows).toEqual([["a", "b", "c"]]);
    });

    it("should parse multi-row TSV", () => {
      const result = parseTSV("1\t2\t3\n4\t5\t6");
      expect(result.rows).toEqual([
        [1, 2, 3],
        [4, 5, 6],
      ]);
    });

    it("should coerce values", () => {
      const result = parseTSV("true\tfalse\tnull\t123");
      expect(result.rows).toEqual([[true, false, null, 123]]);
    });
  });

  describe("parseCSV", () => {
    it("should parse simple CSV", () => {
      const result = parseCSV("a,b,c");
      expect(result.format).toBe("csv");
      expect(result.rows).toEqual([["a", "b", "c"]]);
    });

    it("should handle quoted fields with commas", () => {
      const result = parseCSV('"hello, world",foo,bar');
      expect(result.rows).toEqual([["hello, world", "foo", "bar"]]);
    });

    it("should handle escaped quotes", () => {
      const result = parseCSV('"say ""hello""",test');
      expect(result.rows).toEqual([['say "hello"', "test"]]);
    });
  });

  describe("parseJSON", () => {
    it("should parse array of objects", () => {
      const result = parseJSON('[{"a": 1, "b": 2}]');
      expect(result.format).toBe("json");
      expect(result.rows).toEqual([[1, 2]]);
    });

    it("should parse single object", () => {
      const result = parseJSON('{"x": 10, "y": 20}');
      expect(result.rows).toEqual([[10, 20]]);
    });

    it("should parse array of arrays", () => {
      const result = parseJSON("[[1, 2], [3, 4]]");
      expect(result.rows).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });

  describe("parsePasteData", () => {
    it("should auto-detect and parse TSV", () => {
      const result = parsePasteData("a\tb\tc");
      expect(result.format).toBe("tsv");
    });

    it("should auto-detect and parse CSV", () => {
      const result = parsePasteData("a,b,c");
      expect(result.format).toBe("csv");
    });

    it("should auto-detect and parse JSON", () => {
      const result = parsePasteData('[{"a": 1}]');
      expect(result.format).toBe("json");
    });

    it("should fall back to TSV for invalid JSON-like content", () => {
      // Invalid JSON falls back to TSV parsing
      const result = parsePasteData("{invalid json that looks like json}");
      expect(result.format).toBe("tsv");
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe("coerceToColumnType", () => {
    it("should coerce integers", () => {
      const hint: ColumnTypeHint = { dbType: "integer" };
      expect(coerceToColumnType("42", hint)).toBe("42");
      expect(coerceToColumnType("-10", hint)).toBe("-10");
      expect(coerceToColumnType("not-int", hint)).toBe("not-int");
    });

    it("should coerce bigint", () => {
      const hint: ColumnTypeHint = { dbType: "bigint" };
      expect(coerceToColumnType("9007199254740991", hint)).toBe(
        "9007199254740991",
      );
    });

    it("should keep bigints beyond the safe integer range as strings", () => {
      const hint: ColumnTypeHint = { dbType: "bigint" };
      expect(coerceToColumnType("9223372036854775807", hint)).toBe(
        "9223372036854775807",
      );
    });

    it("should coerce decimals", () => {
      const hint: ColumnTypeHint = { dbType: "numeric" };
      expect(coerceToColumnType("3.14", hint)).toBe("3.14");
      expect(coerceToColumnType("$1,234.56", hint)).toBe("1234.56");
    });

    it("should coerce booleans", () => {
      const hint: ColumnTypeHint = { dbType: "boolean" };
      expect(coerceToColumnType("true", hint)).toBe(true);
      expect(coerceToColumnType("false", hint)).toBe(false);
      expect(coerceToColumnType("yes", hint)).toBe(true);
      expect(coerceToColumnType("no", hint)).toBe(false);
      expect(coerceToColumnType("1", hint)).toBe(true);
      expect(coerceToColumnType("0", hint)).toBe(false);
    });

    it("should coerce UUIDs", () => {
      const hint: ColumnTypeHint = { dbType: "uuid" };
      expect(coerceToColumnType("550e8400-e29b-41d4-a716-446655440000", hint)).toBe(
        "550e8400-e29b-41d4-a716-446655440000"
      );
      // Format 32 hex chars as UUID
      expect(coerceToColumnType("550e8400e29b41d4a716446655440000", hint)).toBe(
        "550e8400-e29b-41d4-a716-446655440000"
      );
    });

    it("should handle null values", () => {
      const hint: ColumnTypeHint = { dbType: "integer", nullable: true };
      expect(coerceToColumnType(null, hint)).toBe(null);
      expect(coerceToColumnType("null", hint)).toBe(null);
      expect(coerceToColumnType("", hint)).toBe(null);
      expect(coerceToColumnType("\\N", hint)).toBe(null);
    });

    it("should handle non-nullable columns", () => {
      const hint: ColumnTypeHint = { dbType: "integer", nullable: false };
      expect(coerceToColumnType(null, hint)).toBe("");
      expect(coerceToColumnType("null", hint)).toBe("");
    });

    it("should coerce dates", () => {
      const hint: ColumnTypeHint = { dbType: "date" };
      const result = coerceToColumnType("2024-01-15", hint);
      expect(result).toBe("2024-01-15");
    });

    it("should coerce timestamps", () => {
      const hint: ColumnTypeHint = { dbType: "timestamp" };
      const result = coerceToColumnType("2024-01-15T10:30:00", hint);
      expect(typeof result).toBe("string");
      expect((result as string).includes("2024-01-15")).toBe(true);
    });

    it("should handle JSON types", () => {
      const hint: ColumnTypeHint = { dbType: "jsonb" };
      expect(coerceToColumnType('{"key": "value"}', hint)).toBe('{"key": "value"}');
    });

    it("should preserve PostgreSQL array format", () => {
      const hint: ColumnTypeHint = { dbType: "integer[]" };
      expect(coerceToColumnType("{1,2,3}", hint)).toBe("{1,2,3}");
    });

    it("should pass through JSON arrays", () => {
      // JSON arrays are passed through - manual conversion may be needed
      const hint: ColumnTypeHint = { dbType: "integer[]" };
      expect(coerceToColumnType("[1,2,3]", hint)).toBe("[1,2,3]");
    });

    it("should preserve text arrays", () => {
      const hint: ColumnTypeHint = { dbType: "text[]" };
      expect(coerceToColumnType('{"a","b","c"}', hint)).toBe('{"a","b","c"}');
    });
  });

  describe("smartPasteCoerce", () => {
    it("should coerce all values based on column hints", () => {
      const rows = [
        ["42", "true", "hello"],
        ["100", "false", "world"],
      ];
      const hints: ColumnTypeHint[] = [
        { dbType: "integer" },
        { dbType: "boolean" },
        { dbType: "text" },
      ];

      const result = smartPasteCoerce(rows, hints);
      expect(result).toEqual([
        ["42", true, "hello"],
        ["100", false, "world"],
      ]);
    });

    it("should handle missing hints gracefully", () => {
      const rows = [["42", "extra"]];
      const hints: ColumnTypeHint[] = [{ dbType: "integer" }];

      const result = smartPasteCoerce(rows, hints);
      expect(result).toEqual([["42", "extra"]]);
    });
  });

  describe("validatePasteData", () => {
    it("should return empty array for valid data", () => {
      const rows = [[42, "550e8400-e29b-41d4-a716-446655440000"]];
      const hints: ColumnTypeHint[] = [{ dbType: "integer" }, { dbType: "uuid" }];

      const errors = validatePasteData(rows, hints);
      expect(errors).toEqual([]);
    });

    it("should detect null violations", () => {
      const rows = [[null]];
      const hints: ColumnTypeHint[] = [{ dbType: "integer", nullable: false }];

      const errors = validatePasteData(rows, hints);
      expect(errors.length).toBe(1);
      expect(errors[0]?.error).toContain("cannot be null");
    });

    it("should detect invalid UUID", () => {
      const rows = [["not-a-uuid"]];
      const hints: ColumnTypeHint[] = [{ dbType: "uuid" }];

      const errors = validatePasteData(rows, hints);
      expect(errors.length).toBe(1);
      expect(errors[0]?.error).toContain("UUID");
    });

    it("should detect invalid integer", () => {
      const rows = [["not-int"]];
      const hints: ColumnTypeHint[] = [{ dbType: "integer" }];

      const errors = validatePasteData(rows, hints);
      expect(errors.length).toBe(1);
      expect(errors[0]?.error).toContain("integer");
    });

    it("should detect invalid JSON", () => {
      const rows = [["{invalid}"]];
      const hints: ColumnTypeHint[] = [{ dbType: "jsonb" }];

      const errors = validatePasteData(rows, hints);
      expect(errors.length).toBe(1);
      expect(errors[0]?.error).toContain("JSON");
    });

    it("should report correct row and column indices (0-based)", () => {
      const rows = [
        [1, "550e8400-e29b-41d4-a716-446655440000"], // valid
        [2, "not-a-uuid"], // invalid UUID at row 1, col 1
      ];
      const hints: ColumnTypeHint[] = [{ dbType: "integer" }, { dbType: "uuid" }];

      const errors = validatePasteData(rows, hints);
      expect(errors.length).toBe(1);
      expect(errors[0]?.row).toBe(1); // second row (0-based)
      expect(errors[0]?.column).toBe(1); // second column (0-based)
    });
  });
});
