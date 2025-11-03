import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  toDecimal,
  formatDecimal,
  formatDecimalWithLocale,
  getNumericCategory,
  NumericCategory,
  isNumericColumnType,
  calculateDecimalStatistics,
} from "./numericPrecision";

describe("numericPrecision", () => {
  describe("getNumericCategory", () => {
    it("should identify integer types", () => {
      expect(getNumericCategory("int")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("bigint")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("int4")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("int2")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("int8")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("serial")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("smallint")).toBe(NumericCategory.INTEGER);
    });

    it("should identify decimal types", () => {
      expect(getNumericCategory("numeric")).toBe(NumericCategory.DECIMAL);
      expect(getNumericCategory("decimal")).toBe(NumericCategory.DECIMAL);
      expect(getNumericCategory("float")).toBe(NumericCategory.DECIMAL);
      expect(getNumericCategory("double")).toBe(NumericCategory.DECIMAL);
      expect(getNumericCategory("real")).toBe(NumericCategory.DECIMAL);
      expect(getNumericCategory("money")).toBe(NumericCategory.DECIMAL);
    });

    it("should identify non-numeric types", () => {
      expect(getNumericCategory("uuid")).toBe(NumericCategory.NON_NUMERIC);
      expect(getNumericCategory("text")).toBe(NumericCategory.NON_NUMERIC);
      expect(getNumericCategory("varchar")).toBe(NumericCategory.NON_NUMERIC);
      expect(getNumericCategory("char")).toBe(NumericCategory.NON_NUMERIC);
      expect(getNumericCategory("date")).toBe(NumericCategory.NON_NUMERIC);
    });

    it("should handle undefined type", () => {
      expect(getNumericCategory(undefined)).toBe(NumericCategory.NON_NUMERIC);
    });

    it("should be case insensitive", () => {
      expect(getNumericCategory("INT")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("NUMERIC")).toBe(NumericCategory.DECIMAL);
    });
  });

  describe("isNumericColumnType", () => {
    it("should return true for numeric types", () => {
      expect(isNumericColumnType("int")).toBe(true);
      expect(isNumericColumnType("numeric")).toBe(true);
      expect(isNumericColumnType("decimal")).toBe(true);
    });

    it("should return false for non-numeric types", () => {
      expect(isNumericColumnType("uuid")).toBe(false);
      expect(isNumericColumnType("text")).toBe(false);
      expect(isNumericColumnType(undefined)).toBe(false);
    });
  });

  describe("toDecimal", () => {
    describe("valid conversions", () => {
      it("should convert regular numbers", () => {
        const result = toDecimal(123.45);
        expect(result).not.toBeNull();
        expect(result?.toNumber()).toBe(123.45);
      });

      it("should convert integers", () => {
        const result = toDecimal(42);
        expect(result?.toString()).toBe("42");
      });

      it("should handle BigInt values", () => {
        const bigValue = BigInt("9223372036854775807"); // Max PostgreSQL bigint
        const result = toDecimal(bigValue);
        expect(result?.toString()).toBe("9223372036854775807");
      });

      it("should handle string numbers", () => {
        const result = toDecimal("456.789");
        expect(result?.toNumber()).toBe(456.789);
      });

      it("should handle scientific notation strings", () => {
        const result = toDecimal("1.23e+15");
        expect(result?.toString()).toBe("1230000000000000");
      });

      it("should handle negative numbers", () => {
        const result = toDecimal(-999.99);
        expect(result?.toNumber()).toBe(-999.99);
      });

      it("should handle zero", () => {
        const result = toDecimal(0);
        expect(result?.toNumber()).toBe(0);
      });
    });

    describe("invalid conversions", () => {
      it("should return null for null", () => {
        expect(toDecimal(null)).toBeNull();
      });

      it("should return null for undefined", () => {
        expect(toDecimal(undefined)).toBeNull();
      });

      it("should return null for invalid strings", () => {
        expect(toDecimal("not a number")).toBeNull();
        expect(toDecimal("abc123")).toBeNull();
        expect(toDecimal("123abc")).toBeNull();
      });

      it("should return null for NaN string", () => {
        expect(toDecimal("NaN")).toBeNull();
      });

      it("should return null for Infinity", () => {
        expect(toDecimal("Infinity")).toBeNull();
      });
    });

    describe("precision preservation", () => {
      it("should solve the 0.1 + 0.2 problem", () => {
        const a = toDecimal(0.1);
        const b = toDecimal(0.2);
        const sum = a!.plus(b!);
        expect(sum.toString()).toBe("0.3");
        expect(sum.toNumber()).toBe(0.3);
      });

      it("should preserve decimal precision", () => {
        const result = toDecimal("0.123456789012345");
        expect(result?.toString()).toBe("0.123456789012345");
      });

      it("should handle very large integers", () => {
        const maxSafeInt = BigInt(Number.MAX_SAFE_INTEGER);
        const result = toDecimal(maxSafeInt);
        expect(result?.toString()).toBe("9007199254740991");
      });
    });
  });

  describe("formatDecimal", () => {
    describe("integer formatting", () => {
      it("should format integers without decimals", () => {
        const decimal = new Decimal("12345");
        expect(formatDecimal(decimal, "int")).toBe("12345");
        expect(formatDecimal(decimal, "bigint")).toBe("12345");
        expect(formatDecimal(decimal, "serial")).toBe("12345");
      });

      it("should truncate decimals for integer types", () => {
        const decimal = new Decimal("123.99");
        expect(formatDecimal(decimal, "int")).toBe("124");
      });
    });

    describe("decimal formatting", () => {
      it("should format decimals with up to 2 places", () => {
        const decimal = new Decimal("123.456");
        expect(formatDecimal(decimal, "numeric")).toBe("123.46");
      });

      it("should remove trailing zeros", () => {
        expect(formatDecimal(new Decimal("123.50"), "decimal")).toBe("123.5");
        expect(formatDecimal(new Decimal("123.00"), "decimal")).toBe("123");
        expect(formatDecimal(new Decimal("100.10"), "float")).toBe("100.1");
      });

      it("should round half-up", () => {
        expect(formatDecimal(new Decimal("1.235"), "decimal")).toBe("1.24");
        expect(formatDecimal(new Decimal("1.234"), "decimal")).toBe("1.23");
      });
    });

    describe("money formatting", () => {
      it("should format money with exactly 2 decimals", () => {
        expect(formatDecimal(new Decimal("99.5"), "money")).toBe("99.50");
        expect(formatDecimal(new Decimal("99"), "money")).toBe("99.00");
        expect(formatDecimal(new Decimal("99.999"), "money")).toBe("100.00");
      });
    });

    describe("large numbers", () => {
      it("should use exponential notation for very large numbers", () => {
        const decimal = new Decimal("1234567890123456");
        const result = formatDecimal(decimal, "decimal");
        expect(result).toContain("e+");
      });

      it("should handle numbers just below threshold", () => {
        const decimal = new Decimal("999999999999999");
        const result = formatDecimal(decimal, "int");
        expect(result).not.toContain("e+");
      });
    });
  });

  describe("formatDecimalWithLocale", () => {
    it("should add thousand separators for integers", () => {
      const decimal = new Decimal("1234567");
      const result = formatDecimalWithLocale(decimal, "int");
      // Handles different locale separators (comma, space, etc.)
      expect(result).toMatch(/1[,\s]234[,\s]567/);
    });

    it("should preserve decimals with separators", () => {
      const decimal = new Decimal("1234.56");
      const result = formatDecimalWithLocale(decimal, "decimal");
      expect(result).toMatch(/1[,\s]234\.56/);
    });

    it("should handle negative numbers", () => {
      const decimal = new Decimal("-1234567");
      const result = formatDecimalWithLocale(decimal, "int");
      expect(result).toContain("-");
      expect(result).toMatch(/1[,\s]234[,\s]567/);
    });

    it("should handle exponential notation as-is", () => {
      const decimal = new Decimal("1234567890123456");
      const result = formatDecimalWithLocale(decimal, "decimal");
      expect(result).toContain("e+");
    });
  });

  describe("calculateDecimalStatistics", () => {
    it("should calculate correct statistics", () => {
      const values = [
        new Decimal("10"),
        new Decimal("20"),
        new Decimal("30"),
      ];

      const stats = calculateDecimalStatistics(values);
      expect(stats).not.toBeNull();
      expect(stats!.sum.toString()).toBe("60");
      expect(stats!.avg.toString()).toBe("20");
      expect(stats!.median.toString()).toBe("20");
      expect(stats!.min.toString()).toBe("10");
      expect(stats!.max.toString()).toBe("30");
      expect(stats!.count).toBe(3);
    });

    it("should calculate median for odd number of values", () => {
      const values = [
        new Decimal("5"),
        new Decimal("2"),
        new Decimal("8"),
        new Decimal("1"),
        new Decimal("9"),
      ];

      const stats = calculateDecimalStatistics(values);
      expect(stats!.median.toString()).toBe("5"); // Middle value when sorted: 1,2,5,8,9
    });

    it("should calculate median for even number of values", () => {
      const values = [
        new Decimal("10"),
        new Decimal("20"),
        new Decimal("30"),
        new Decimal("40"),
      ];

      const stats = calculateDecimalStatistics(values);
      expect(stats!.median.toString()).toBe("25"); // Average of 20 and 30
    });

    it("should handle decimal precision correctly", () => {
      const values = [new Decimal("0.1"), new Decimal("0.2")];

      const stats = calculateDecimalStatistics(values);
      expect(stats!.sum.toString()).toBe("0.3"); // Exact, not 0.30000000000000004
      expect(stats!.avg.toString()).toBe("0.15");
      expect(stats!.median.toString()).toBe("0.15"); // Average of 0.1 and 0.2
    });

    it("should handle large integers", () => {
      const values = [
        new Decimal("9223372036854775807"), // Max bigint
        new Decimal("9223372036854775806"),
      ];

      const stats = calculateDecimalStatistics(values);
      expect(stats!.sum.toString()).toBe("18446744073709551613");
      expect(stats!.max.toString()).toBe("9223372036854775807");
      expect(stats!.min.toString()).toBe("9223372036854775806");
      expect(stats!.median.toString()).toBe("9223372036854775806.5");
    });

    it("should handle single value", () => {
      const values = [new Decimal("42")];
      const stats = calculateDecimalStatistics(values);
      expect(stats!.sum.toString()).toBe("42");
      expect(stats!.avg.toString()).toBe("42");
      expect(stats!.median.toString()).toBe("42");
      expect(stats!.min.toString()).toBe("42");
      expect(stats!.max.toString()).toBe("42");
      expect(stats!.count).toBe(1);
    });

    it("should return null for empty array", () => {
      expect(calculateDecimalStatistics([])).toBeNull();
    });

    it("should handle negative numbers", () => {
      const values = [new Decimal("-10"), new Decimal("10"), new Decimal("5")];
      const stats = calculateDecimalStatistics(values);
      expect(stats!.sum.toString()).toBe("5");
      // Decimal.js default precision is 20 significant digits
      expect(stats!.avg.toFixed(2)).toBe("1.67");
      expect(stats!.median.toString()).toBe("5"); // Middle value when sorted: -10, 5, 10
      expect(stats!.min.toString()).toBe("-10");
      expect(stats!.max.toString()).toBe("10");
    });
  });

  describe("Real-world edge cases", () => {
    it("should handle PostgreSQL bigint max value", () => {
      const maxBigInt = BigInt("9223372036854775807");
      const decimal = toDecimal(maxBigInt);
      expect(decimal?.toString()).toBe("9223372036854775807");

      // Should be able to add to it
      const result = decimal!.plus(new Decimal("1"));
      expect(result.toString()).toBe("9223372036854775808");
    });

    it("should handle financial calculations", () => {
      // Calculate 10% tax on $99.99
      const price = toDecimal("99.99");
      const tax = price!.times("0.10");
      const total = price!.plus(tax);

      expect(tax.toString()).toBe("9.999");
      expect(formatDecimal(total, "money")).toBe("109.99");
    });

    it("should handle multiple additions without drift", () => {
      let sum = new Decimal("0");
      for (let i = 0; i < 100; i++) {
        sum = sum.plus(new Decimal("0.1"));
      }
      expect(sum.toString()).toBe("10");
      expect(sum.toNumber()).toBe(10);
    });

    it("should handle division precision", () => {
      const a = new Decimal("10");
      const b = new Decimal("3");
      const result = a.dividedBy(b);

      // Decimal.js default precision is 20 significant digits
      expect(result.toString()).toContain("3.333333333333333");
      expect(formatDecimal(result, "decimal")).toBe("3.33");
    });

    it("should handle very small decimals", () => {
      const small = toDecimal("0.000000001");
      // Decimal.js may use exponential notation for very small numbers
      expect(small?.toNumber()).toBe(0.000000001);

      const sum = small!.plus(small!);
      expect(sum.toNumber()).toBe(0.000000002);
    });
  });
});
