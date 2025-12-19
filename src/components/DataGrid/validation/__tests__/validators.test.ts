import { describe, it, expect } from "vitest";
import { validateCell, getValidator, validateCells } from "../validators";
import type { GridColumnV2 } from "../../types";
import type { ColumnMeta } from "@/types";

// Helper to create column with db_type
function createColumn(dbType: string, nullable = true): GridColumnV2 {
  return {
    id: "test",
    field: "test",
    title: "Test",
    name: "test",
    type: "text",
    meta: {
      name: "test",
      db_type: dbType,
      nullable,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: 0,
    } as ColumnMeta,
  };
}

describe("validators", () => {
  describe("validateCell", () => {
    describe("integer validation", () => {
      it("should accept valid integers", () => {
        const col = createColumn("integer");
        expect(validateCell(42, col).valid).toBe(true);
        expect(validateCell(0, col).valid).toBe(true);
        expect(validateCell(-100, col).valid).toBe(true);
        expect(validateCell("123", col).valid).toBe(true);
      });

      it("should reject non-integers", () => {
        const col = createColumn("integer");
        expect(validateCell(3.14, col).valid).toBe(false);
        expect(validateCell("abc", col).valid).toBe(false);
      });

      it("should accept null for nullable columns", () => {
        const col = createColumn("integer", true);
        expect(validateCell(null, col).valid).toBe(true);
      });

      it("should reject null for non-nullable columns", () => {
        const col = createColumn("integer", false);
        const result = validateCell(null, col);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("cannot be null");
      });
    });

    describe("smallint validation", () => {
      it("should accept valid smallints", () => {
        const col = createColumn("smallint");
        expect(validateCell(100, col).valid).toBe(true);
        expect(validateCell(-32768, col).valid).toBe(true);
        expect(validateCell(32767, col).valid).toBe(true);
      });

      it("should reject out of range values", () => {
        const col = createColumn("smallint");
        expect(validateCell(40000, col).valid).toBe(false);
        expect(validateCell(-40000, col).valid).toBe(false);
      });
    });

    describe("bigint validation", () => {
      it("should accept valid bigints", () => {
        const col = createColumn("bigint");
        expect(validateCell("9007199254740991", col).valid).toBe(true);
        expect(validateCell(0, col).valid).toBe(true);
      });
    });

    describe("numeric/decimal validation", () => {
      it("should accept valid decimals", () => {
        const col = createColumn("numeric");
        expect(validateCell(3.14, col).valid).toBe(true);
        expect(validateCell("123.456", col).valid).toBe(true);
      });

      it("should reject non-numbers", () => {
        const col = createColumn("numeric");
        expect(validateCell("abc", col).valid).toBe(false);
      });
    });

    describe("boolean validation", () => {
      it("should accept boolean values", () => {
        const col = createColumn("boolean");
        expect(validateCell(true, col).valid).toBe(true);
        expect(validateCell(false, col).valid).toBe(true);
      });

      it("should accept boolean-like strings", () => {
        const col = createColumn("boolean");
        expect(validateCell("true", col).valid).toBe(true);
        expect(validateCell("false", col).valid).toBe(true);
        expect(validateCell("t", col).valid).toBe(true);
        expect(validateCell("f", col).valid).toBe(true);
        expect(validateCell("yes", col).valid).toBe(true);
        expect(validateCell("no", col).valid).toBe(true);
        expect(validateCell("1", col).valid).toBe(true);
        expect(validateCell("0", col).valid).toBe(true);
      });

      it("should reject invalid boolean values", () => {
        const col = createColumn("boolean");
        expect(validateCell("maybe", col).valid).toBe(false);
        expect(validateCell("2", col).valid).toBe(false);
      });
    });

    describe("uuid validation", () => {
      it("should accept valid UUIDs", () => {
        const col = createColumn("uuid");
        expect(validateCell("550e8400-e29b-41d4-a716-446655440000", col).valid).toBe(true);
        expect(validateCell("00000000-0000-0000-0000-000000000000", col).valid).toBe(true);
      });

      it("should reject invalid UUIDs", () => {
        const col = createColumn("uuid");
        expect(validateCell("not-a-uuid", col).valid).toBe(false);
        expect(validateCell("550e8400-e29b-41d4-a716", col).valid).toBe(false);
      });
    });

    describe("json/jsonb validation", () => {
      it("should accept valid JSON", () => {
        const col = createColumn("jsonb");
        expect(validateCell('{"key": "value"}', col).valid).toBe(true);
        expect(validateCell("[1, 2, 3]", col).valid).toBe(true);
        expect(validateCell("null", col).valid).toBe(true);
      });

      it("should reject invalid JSON", () => {
        const col = createColumn("jsonb");
        expect(validateCell("{invalid}", col).valid).toBe(false);
      });
    });

    describe("date validation", () => {
      it("should accept valid dates", () => {
        const col = createColumn("date");
        expect(validateCell("2024-01-15", col).valid).toBe(true);
        expect(validateCell("2024-12-31", col).valid).toBe(true);
      });

      it("should reject invalid dates", () => {
        const col = createColumn("date");
        expect(validateCell("not-a-date", col).valid).toBe(false);
      });
    });

    describe("timestamp validation", () => {
      it("should accept valid timestamps", () => {
        const col = createColumn("timestamp");
        expect(validateCell("2024-01-15T10:30:00", col).valid).toBe(true);
        expect(validateCell("2024-01-15T10:30:00Z", col).valid).toBe(true);
      });

      it("should reject invalid timestamps", () => {
        const col = createColumn("timestamp");
        expect(validateCell("not-a-timestamp", col).valid).toBe(false);
      });
    });

    describe("inet validation", () => {
      it("should accept valid IPv4 addresses", () => {
        const col = createColumn("inet");
        expect(validateCell("192.168.1.1", col).valid).toBe(true);
        expect(validateCell("10.0.0.0", col).valid).toBe(true);
        expect(validateCell("192.168.1.0/24", col).valid).toBe(true);
      });

      it("should reject invalid addresses", () => {
        const col = createColumn("inet");
        expect(validateCell("not-an-ip", col).valid).toBe(false);
        expect(validateCell("256.1.1.1", col).valid).toBe(false);
      });
    });

    describe("macaddr validation", () => {
      it("should accept valid MAC addresses", () => {
        const col = createColumn("macaddr");
        expect(validateCell("00:1a:2b:3c:4d:5e", col).valid).toBe(true);
        expect(validateCell("aa:bb:cc:dd:ee:ff", col).valid).toBe(true);
      });

      it("should reject invalid MAC addresses", () => {
        const col = createColumn("macaddr");
        expect(validateCell("not-a-mac", col).valid).toBe(false);
        expect(validateCell("00:1a:2b:3c:4d", col).valid).toBe(false);
      });
    });

    describe("bytea validation", () => {
      it("should accept valid bytea formats", () => {
        const col = createColumn("bytea");
        expect(validateCell("\\x48656c6c6f", col).valid).toBe(true);
        expect(validateCell("\\xDEADBEEF", col).valid).toBe(true);
      });

      it("should accept null/empty", () => {
        const col = createColumn("bytea");
        expect(validateCell(null, col).valid).toBe(true);
        expect(validateCell("", col).valid).toBe(true);
      });
    });

    describe("point validation", () => {
      it("should accept valid point format", () => {
        const col = createColumn("point");
        expect(validateCell("(1,2)", col).valid).toBe(true);
        expect(validateCell("(-1.5, 3.14)", col).valid).toBe(true);
      });

      it("should reject invalid point format", () => {
        const col = createColumn("point");
        expect(validateCell("not a point", col).valid).toBe(false);
      });
    });
  });

  describe("getValidator", () => {
    it("should return validator for known types", () => {
      expect(getValidator("integer")).toBeDefined();
      expect(getValidator("uuid")).toBeDefined();
      expect(getValidator("jsonb")).toBeDefined();
      expect(getValidator("timestamp")).toBeDefined();
    });

    it("should return undefined for unknown types", () => {
      expect(getValidator("unknown_type")).toBeUndefined();
    });

    it("should handle type variants", () => {
      expect(getValidator("timestamp with time zone")).toBeDefined();
      expect(getValidator("character varying")).toBeUndefined(); // text types skip validation
    });
  });

  describe("validateCells", () => {
    it("should validate multiple cells", () => {
      const results = validateCells([
        { value: 42, column: createColumn("integer") },
        { value: "550e8400-e29b-41d4-a716-446655440000", column: createColumn("uuid") },
        { value: "invalid", column: createColumn("integer") },
      ]);

      expect(results.length).toBe(3);
      expect(results[0]?.valid).toBe(true);
      expect(results[1]?.valid).toBe(true);
      expect(results[2]?.valid).toBe(false);
    });
  });
});
