import { describe, it, expect } from "vitest";
import {
  normalizeBackendValue,
  deriveValueType,
  mapRowsToTableData,
} from "../tableDataTransform";
import type { ColumnMeta } from "@/types/schema";

describe("normalizeBackendValue", () => {
  describe("BigInt handling (JS limitation: JSON.stringify cannot serialize BigInt)", () => {
    it("converts BigInt to string", () => {
      const bigIntValue = BigInt("9223372036854775807"); // Max i64
      const result = normalizeBackendValue(bigIntValue);
      expect(result).toBe("9223372036854775807");
      expect(typeof result).toBe("string");
    });

    it("converts negative BigInt to string", () => {
      const bigIntValue = BigInt("-9223372036854775808"); // Min i64
      const result = normalizeBackendValue(bigIntValue);
      expect(result).toBe("-9223372036854775808");
    });

    it("converts small BigInt to string (preserves type consistency)", () => {
      const bigIntValue = BigInt(42);
      const result = normalizeBackendValue(bigIntValue);
      expect(result).toBe("42");
      expect(typeof result).toBe("string");
    });

    it("converts zero BigInt to string", () => {
      const bigIntValue = BigInt(0);
      const result = normalizeBackendValue(bigIntValue);
      expect(result).toBe("0");
    });

    it("handles BigInt in nested arrays", () => {
      const input = [BigInt(1), BigInt(2), BigInt(3)];
      const result = normalizeBackendValue(input);
      expect(result).toEqual(["1", "2", "3"]);
    });

    it("handles BigInt in nested objects", () => {
      const input = {
        id: BigInt("9007199254740993"), // Beyond MAX_SAFE_INTEGER
        count: BigInt(100),
      };
      const result = normalizeBackendValue(input);
      expect(result).toEqual({
        id: "9007199254740993",
        count: "100",
      });
    });

    it("handles deeply nested BigInt values", () => {
      const input = {
        level1: {
          level2: {
            value: BigInt("12345678901234567890"),
          },
        },
        arr: [{ num: BigInt(999) }],
      };
      const result = normalizeBackendValue(input);
      expect(result).toEqual({
        level1: {
          level2: {
            value: "12345678901234567890",
          },
        },
        arr: [{ num: "999" }],
      });
    });
  });

  describe("null and undefined handling", () => {
    it("passes null through unchanged", () => {
      expect(normalizeBackendValue(null)).toBe(null);
    });

    it("passes undefined through unchanged", () => {
      expect(normalizeBackendValue(undefined)).toBe(undefined);
    });
  });

  describe("primitive types (pass through)", () => {
    it("passes numbers through unchanged", () => {
      expect(normalizeBackendValue(42)).toBe(42);
      expect(normalizeBackendValue(3.14159)).toBe(3.14159);
      expect(normalizeBackendValue(-100)).toBe(-100);
      expect(normalizeBackendValue(0)).toBe(0);
    });

    it("passes strings through unchanged", () => {
      expect(normalizeBackendValue("hello")).toBe("hello");
      expect(normalizeBackendValue("")).toBe("");
      expect(normalizeBackendValue("9223372036854775807")).toBe(
        "9223372036854775807",
      );
    });

    it("passes booleans through unchanged", () => {
      expect(normalizeBackendValue(true)).toBe(true);
      expect(normalizeBackendValue(false)).toBe(false);
    });
  });

  describe("array handling", () => {
    it("normalizes arrays recursively", () => {
      const input = [1, "two", null, BigInt(3)];
      const result = normalizeBackendValue(input);
      expect(result).toEqual([1, "two", null, "3"]);
    });

    it("handles empty arrays", () => {
      expect(normalizeBackendValue([])).toEqual([]);
    });

    it("handles nested arrays", () => {
      const input = [[BigInt(1)], [BigInt(2), [BigInt(3)]]];
      const result = normalizeBackendValue(input);
      expect(result).toEqual([["1"], ["2", ["3"]]]);
    });
  });

  describe("object handling", () => {
    it("normalizes objects recursively", () => {
      const input = { a: 1, b: "two", c: BigInt(3) };
      const result = normalizeBackendValue(input);
      expect(result).toEqual({ a: 1, b: "two", c: "3" });
    });

    it("handles empty objects", () => {
      expect(normalizeBackendValue({})).toEqual({});
    });
  });

  describe("JSON.stringify compatibility (the actual bug we fixed)", () => {
    it("result can be JSON.stringify-ed without error", () => {
      const input = {
        id: BigInt("9223372036854775807"),
        nested: {
          values: [BigInt(1), BigInt(2)],
        },
      };
      const normalized = normalizeBackendValue(input);
      expect(() => JSON.stringify(normalized)).not.toThrow();
    });

    it("BigInt directly throws on JSON.stringify (proving the bug)", () => {
      const bigInt = BigInt(123);
      expect(() => JSON.stringify({ value: bigInt })).toThrow(TypeError);
    });
  });
});

describe("deriveValueType", () => {
  describe("BigInt values", () => {
    it("returns Integer for BigInt regardless of db_type", () => {
      expect(deriveValueType(BigInt(123), "bigint")).toBe("Integer");
      expect(deriveValueType(BigInt(123), "int8")).toBe("Integer");
      expect(deriveValueType(BigInt(123), "serial")).toBe("Integer");
    });
  });

  describe("null/undefined", () => {
    it("returns Null for null values", () => {
      expect(deriveValueType(null, "text")).toBe("Null");
    });

    it("returns Null for undefined values", () => {
      expect(deriveValueType(undefined, "text")).toBe("Null");
    });
  });

  describe("boolean values", () => {
    it("returns Boolean for boolean values", () => {
      expect(deriveValueType(true, "bool")).toBe("Boolean");
      expect(deriveValueType(false, "boolean")).toBe("Boolean");
    });
  });

  describe("numeric values", () => {
    it("returns Integer for int types", () => {
      expect(deriveValueType(42, "int4")).toBe("Integer");
      expect(deriveValueType(42, "integer")).toBe("Integer");
      expect(deriveValueType(42, "smallint")).toBe("Integer");
      expect(deriveValueType(42, "bigserial")).toBe("Integer");
    });

    it("returns Decimal for float types", () => {
      expect(deriveValueType(3.14, "float8")).toBe("Decimal");
      expect(deriveValueType(3.14, "numeric")).toBe("Decimal");
      expect(deriveValueType(3.14, "decimal")).toBe("Decimal");
    });
  });

  describe("array values", () => {
    it("returns Binary for bytea/blob types", () => {
      expect(deriveValueType([1, 2, 3], "bytea")).toBe("Binary");
      expect(deriveValueType([1, 2, 3], "blob")).toBe("Binary");
      expect(deriveValueType([1, 2, 3], "binary")).toBe("Binary");
    });

    it("returns Array for other array types", () => {
      expect(deriveValueType([1, 2, 3], "int4[]")).toBe("Array");
      expect(deriveValueType(["a", "b"], "text[]")).toBe("Array");
    });
  });

  describe("object values", () => {
    it("returns Json for object values", () => {
      expect(deriveValueType({ key: "value" }, "json")).toBe("Json");
      expect(deriveValueType({ key: "value" }, "jsonb")).toBe("Json");
    });
  });

  describe("string values", () => {
    it("returns Text for string values", () => {
      expect(deriveValueType("hello", "text")).toBe("Text");
      expect(deriveValueType("hello", "varchar")).toBe("Text");
    });
  });
});

describe("mapRowsToTableData", () => {
  const mockColumns: ColumnMeta[] = [
    {
      name: "id",
      db_type: "int8",
      nullable: false,
      default: null,
      is_pk: true,
      is_fk: false,
      ordinal: 0,
      precision: null,
      scale: null,
      comment: null,
    },
    {
      name: "name",
      db_type: "text",
      nullable: true,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: 1,
      precision: null,
      scale: null,
      comment: null,
    },
  ];

  it("normalizes BigInt values in rows", () => {
    const rawRows = [[BigInt("9223372036854775807"), "Test"]];
    const result = mapRowsToTableData(mockColumns, rawRows);

    expect(result[0]!["col_0"]!.value).toBe("9223372036854775807");
    expect(result[0]!["col_0"]!.value_type).toBe("Integer");
    expect(result[0]!["col_0"]!.metadata?.attributes?.originalBigInt).toBe(
      "9223372036854775807",
    );
  });

  it("preserves metadata for BigInt values", () => {
    const rawRows = [[BigInt(123), "Test"]];
    const result = mapRowsToTableData(mockColumns, rawRows);

    expect(result[0]!["col_0"]!.metadata).toEqual({
      attributes: { originalBigInt: "123" },
    });
  });

  it("does not add metadata for non-BigInt values", () => {
    const rawRows = [[42, "Test"]];
    const result = mapRowsToTableData(mockColumns, rawRows);

    expect(result[0]!["col_0"]!.metadata).toBeUndefined();
    expect(result[0]!["col_1"]!.metadata).toBeUndefined();
  });

  it("result can be JSON.stringify-ed", () => {
    const rawRows = [
      [BigInt("9223372036854775807"), "Test"],
      [BigInt(123), null],
    ];
    const result = mapRowsToTableData(mockColumns, rawRows);

    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
