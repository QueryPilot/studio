import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  getNumericCategory,
  isNumericColumnType,
  toDecimal,
  formatDecimal,
  formatDecimalWithLocale,
  calculateDecimalStatistics,
  NumericCategory,
} from "../numericPrecision";

describe("numericPrecision", () => {
  describe("getNumericCategory", () => {
    it("should identify integer types", () => {
      expect(getNumericCategory("int")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("integer")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("bigint")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("smallint")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("int2")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("int4")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("int8")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("serial")).toBe(NumericCategory.INTEGER);
      expect(getNumericCategory("bigserial")).toBe(NumericCategory.INTEGER);
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
      expect(getNumericCategory("varchar")).toBe(NumericCategory.NON_NUMERIC);
      expect(getNumericCategory("text")).toBe(NumericCategory.NON_NUMERIC);
      expect(getNumericCategory("date")).toBe(NumericCategory.NON_NUMERIC);
      expect(getNumericCategory(undefined)).toBe(NumericCategory.NON_NUMERIC);
    });
  });

  describe("isNumericColumnType", () => {
    it("should return true for numeric types", () => {
      expect(isNumericColumnType("int")).toBe(true);
      expect(isNumericColumnType("bigint")).toBe(true);
      expect(isNumericColumnType("decimal")).toBe(true);
      expect(isNumericColumnType("float")).toBe(true);
    });

    it("should return false for non-numeric types", () => {
      expect(isNumericColumnType("varchar")).toBe(false);
      expect(isNumericColumnType("text")).toBe(false);
      expect(isNumericColumnType(undefined)).toBe(false);
    });
  });

  describe("toDecimal", () => {
    it("should handle null and undefined", () => {
      expect(toDecimal(null)).toBeNull();
      expect(toDecimal(undefined)).toBeNull();
    });

    it("should handle numbers", () => {
      expect(toDecimal(123)?.toString()).toBe("123");
      expect(toDecimal(123.45)?.toString()).toBe("123.45");
      expect(toDecimal(0)?.toString()).toBe("0");
      expect(toDecimal(-456)?.toString()).toBe("-456");
    });

    it("should handle bigint (database values come as strings)", () => {
      // BIGINT values from databases come as strings to avoid JS precision loss
      // Testing string conversion which is the actual use case
      expect(toDecimal("9223372036854775807")?.toString()).toBe(
        "9223372036854775807",
      );
      expect(toDecimal("-9223372036854775808")?.toString()).toBe(
        "-9223372036854775808",
      );
      
      // Native BigInt type (for completeness, though less common in practice)
      const safeBigInt = BigInt("12345678901234567890");
      expect(toDecimal(safeBigInt)?.toString()).toBe("12345678901234567890");
    });

    it("should handle string numbers", () => {
      expect(toDecimal("123")?.toString()).toBe("123");
      expect(toDecimal("123.45")?.toString()).toBe("123.45");
      expect(toDecimal("9223372036854775807")?.toString()).toBe(
        "9223372036854775807",
      );
      expect(toDecimal("-9223372036854775808")?.toString()).toBe(
        "-9223372036854775808",
      );
    });

    it("should reject invalid strings", () => {
      expect(toDecimal("not a number")).toBeNull();
      expect(toDecimal("")).toBeNull();
      expect(toDecimal("abc123")).toBeNull();
    });

    it("should reject NaN and Infinity", () => {
      expect(toDecimal("NaN")).toBeNull();
      expect(toDecimal("Infinity")).toBeNull();
      expect(toDecimal("-Infinity")).toBeNull();
    });
  });

  describe("formatDecimal", () => {
    it("should format integers without decimal places", () => {
      expect(formatDecimal(new Decimal("123"), "int")).toBe("123");
      expect(formatDecimal(new Decimal("9223372036854775807"), "bigint")).toBe(
        "9223372036854775807",
      );
    });

    it("should format decimals with up to 2 decimal places", () => {
      expect(formatDecimal(new Decimal("123.456"), "decimal")).toBe("123.46");
      expect(formatDecimal(new Decimal("123.4"), "float")).toBe("123.4");
      expect(formatDecimal(new Decimal("123.00"), "numeric")).toBe("123");
    });

    it("should format money with exactly 2 decimal places", () => {
      expect(formatDecimal(new Decimal("123.4"), "money")).toBe("123.40");
      expect(formatDecimal(new Decimal("123"), "money")).toBe("123.00");
    });

    it("should use exponential notation for very large decimals", () => {
      const veryLarge = new Decimal("1e16");
      const formatted = formatDecimal(veryLarge, "decimal");
      expect(formatted).toContain("e");
    });
  });

  describe("formatDecimalWithLocale (BIGINT support)", () => {
    it("should format BIGINT max with thousand separators", () => {
      const bigintMax = new Decimal("9223372036854775807");
      expect(formatDecimalWithLocale(bigintMax, "bigint")).toBe(
        "9,223,372,036,854,775,807",
      );
    });

    it("should format BIGINT min with thousand separators", () => {
      const bigintMin = new Decimal("-9223372036854775808");
      expect(formatDecimalWithLocale(bigintMin, "bigint")).toBe(
        "-9,223,372,036,854,775,808",
      );
    });

    it("should format regular numbers with thousand separators", () => {
      expect(formatDecimalWithLocale(new Decimal("1234567"), "int")).toBe(
        "1,234,567",
      );
      expect(formatDecimalWithLocale(new Decimal("1234567.89"), "decimal")).toBe(
        "1,234,567.89",
      );
    });

    it("should handle small numbers", () => {
      expect(formatDecimalWithLocale(new Decimal("123"), "int")).toBe("123");
      expect(formatDecimalWithLocale(new Decimal("0"), "int")).toBe("0");
      expect(formatDecimalWithLocale(new Decimal("-456"), "int")).toBe("-456");
    });

    it("should preserve decimal places after thousand separators", () => {
      expect(formatDecimalWithLocale(new Decimal("1234567.12"), "decimal")).toBe(
        "1,234,567.12",
      );
      expect(formatDecimalWithLocale(new Decimal("1234567.5"), "float")).toBe(
        "1,234,567.5",
      );
    });

    it("should handle exponential notation as-is", () => {
      const veryLarge = new Decimal("1e16");
      const formatted = formatDecimalWithLocale(veryLarge, "decimal");
      expect(formatted).toContain("e");
    });
  });

  describe("calculateDecimalStatistics", () => {
    it("should return null for empty array", () => {
      expect(calculateDecimalStatistics([])).toBeNull();
    });

    it("should calculate statistics for single value", () => {
      const stats = calculateDecimalStatistics([new Decimal("100")]);
      expect(stats?.sum.toString()).toBe("100");
      expect(stats?.avg.toString()).toBe("100");
      expect(stats?.median.toString()).toBe("100");
      expect(stats?.min.toString()).toBe("100");
      expect(stats?.max.toString()).toBe("100");
      expect(stats?.count).toBe(1);
    });

    it("should calculate statistics for multiple values", () => {
      const values = [
        new Decimal("10"),
        new Decimal("20"),
        new Decimal("30"),
        new Decimal("40"),
        new Decimal("50"),
      ];
      const stats = calculateDecimalStatistics(values);

      expect(stats?.sum.toString()).toBe("150");
      expect(stats?.avg.toString()).toBe("30");
      expect(stats?.median.toString()).toBe("30");
      expect(stats?.min.toString()).toBe("10");
      expect(stats?.max.toString()).toBe("50");
      expect(stats?.count).toBe(5);
    });

    it("should calculate median for even number of values", () => {
      const values = [
        new Decimal("10"),
        new Decimal("20"),
        new Decimal("30"),
        new Decimal("40"),
      ];
      const stats = calculateDecimalStatistics(values);
      expect(stats?.median.toString()).toBe("25"); // Average of 20 and 30
    });

    it("should handle BIGINT values", () => {
      const values = [
        new Decimal("9223372036854775807"),
        new Decimal("9223372036854775806"),
        new Decimal("9223372036854775805"),
      ];
      const stats = calculateDecimalStatistics(values);

      expect(stats?.sum.toString()).toBe("27670116110564327418");
      expect(stats?.max.toString()).toBe("9223372036854775807");
      expect(stats?.min.toString()).toBe("9223372036854775805");
      expect(stats?.median.toString()).toBe("9223372036854775806");
    });

    it("should handle negative numbers", () => {
      const values = [
        new Decimal("-100"),
        new Decimal("0"),
        new Decimal("100"),
      ];
      const stats = calculateDecimalStatistics(values);

      expect(stats?.sum.toString()).toBe("0");
      expect(stats?.avg.toString()).toBe("0");
      expect(stats?.min.toString()).toBe("-100");
      expect(stats?.max.toString()).toBe("100");
    });
  });

  describe("BIGINT precision verification", () => {
    it("should not lose precision with BIGINT max value", () => {
      const bigintMaxString = "9223372036854775807";
      const decimal = toDecimal(bigintMaxString);

      expect(decimal).not.toBeNull();
      expect(decimal!.toString()).toBe(bigintMaxString);

      // Verify that Number() would lose precision
      const asNumber = Number(bigintMaxString);
      expect(asNumber.toString()).not.toBe(bigintMaxString);
      expect(asNumber.toString()).toBe("9223372036854776000"); // Wrong!

      // Verify our Decimal approach maintains precision
      const formatted = formatDecimalWithLocale(decimal!, "bigint");
      expect(formatted).toBe("9,223,372,036,854,775,807");
    });

    it("should not lose precision with BIGINT min value", () => {
      const bigintMinString = "-9223372036854775808";
      const decimal = toDecimal(bigintMinString);

      expect(decimal).not.toBeNull();
      expect(decimal!.toString()).toBe(bigintMinString);

      // Verify formatting
      const formatted = formatDecimalWithLocale(decimal!, "bigint");
      expect(formatted).toBe("-9,223,372,036,854,775,808");
    });

    it("should handle arithmetic with BIGINT values", () => {
      const bigint1 = new Decimal("9223372036854775807");
      const bigint2 = new Decimal("1");

      // This would overflow a signed 64-bit integer, but Decimal handles it
      const sum = bigint1.plus(bigint2);
      expect(sum.toString()).toBe("9223372036854775808");
    });
  });
});

