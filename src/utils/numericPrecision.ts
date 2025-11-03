import Decimal from "decimal.js";

/**
 * Numeric type categories for database columns
 */
export enum NumericCategory {
  INTEGER = "integer", // int2, int4, int8, bigint, smallint, serial
  DECIMAL = "decimal", // numeric, decimal, float, double, real, money
  NON_NUMERIC = "non_numeric", // everything else
}

/**
 * Determine if a column type is numeric and what category it falls into
 */
export const getNumericCategory = (type?: string): NumericCategory => {
  if (!type) return NumericCategory.NON_NUMERIC;

  const lowerType = type.toLowerCase();

  // Integer types
  if (
    lowerType.includes("int") || // int, integer, bigint, smallint
    lowerType.includes("serial") || // serial, bigserial
    lowerType === "int2" ||
    lowerType === "int4" ||
    lowerType === "int8"
  ) {
    return NumericCategory.INTEGER;
  }

  // Decimal types
  if (
    lowerType.includes("numeric") ||
    lowerType.includes("decimal") ||
    lowerType.includes("float") ||
    lowerType.includes("double") ||
    lowerType.includes("real") ||
    lowerType.includes("money")
  ) {
    return NumericCategory.DECIMAL;
  }

  return NumericCategory.NON_NUMERIC;
};

/**
 * Check if a column type is numeric (integer or decimal)
 */
export const isNumericColumnType = (type?: string): boolean => {
  const category = getNumericCategory(type);
  return (
    category === NumericCategory.INTEGER || category === NumericCategory.DECIMAL
  );
};

/**
 * Convert a cell value to Decimal with full precision preservation
 * Returns null if value cannot be converted to a valid number
 */
export const toDecimal = (val: unknown): Decimal | null => {
  if (val === null || val === undefined) return null;

  // BigInt: Convert via string to preserve full precision
  if (typeof val === "bigint") {
    return new Decimal(val.toString());
  }

  // Number: Direct conversion
  if (typeof val === "number") {
    // Warn about unsafe integers (beyond 2^53 - 1)
    if (Number.isInteger(val) && !Number.isSafeInteger(val)) {
      console.warn(
        "Unsafe integer detected, precision may be lost:",
        val,
        "Consider using string representation",
      );
    }
    return new Decimal(val);
  }

  // String: Try to parse as number
  if (typeof val === "string") {
    try {
      const decimal = new Decimal(val);
      // Validate it's a valid number (not NaN or Infinity)
      if (decimal.isFinite()) {
        return decimal;
      }
      return null;
    } catch {
      return null; // Invalid numeric string
    }
  }

  return null;
};

/**
 * Format a Decimal value for display based on column type and value characteristics
 */
export const formatDecimal = (
  decimal: Decimal,
  columnType?: string,
): string => {
  const category = getNumericCategory(columnType);

  // For integer types, show no decimal places
  if (category === NumericCategory.INTEGER) {
    return decimal.toFixed(0);
  }

  // For money type, always show exactly 2 decimal places
  if (columnType?.toLowerCase().includes("money")) {
    return decimal.toFixed(2);
  }

  // For decimal types, show up to 2 decimal places but remove trailing zeros
  // Special case: if the number is very large, use exponential notation
  if (decimal.abs().greaterThan(1e15)) {
    return decimal.toExponential(2);
  }

  // Show up to 2 decimal places, remove trailing zeros
  const formatted = decimal.toFixed(2, Decimal.ROUND_HALF_UP);
  return formatted.replace(/\.?0+$/, "");
};

/**
 * Format a Decimal value for display with locale-aware thousand separators
 */
export const formatDecimalWithLocale = (
  decimal: Decimal,
  columnType?: string,
): string => {
  const formatted = formatDecimal(decimal, columnType);

  // If it's in exponential notation, return as-is
  if (formatted.includes("e")) {
    return formatted;
  }

  // Split into integer and decimal parts
  const [integerPart, decimalPart] = formatted.split(".");

  // Add thousand separators to integer part
  const withSeparators = Number(integerPart).toLocaleString();

  // Rejoin with decimal part if exists
  return decimalPart ? `${withSeparators}.${decimalPart}` : withSeparators;
};

/**
 * Calculate statistics from an array of Decimal values
 */
export interface DecimalStatistics {
  sum: Decimal;
  avg: Decimal;
  median: Decimal;
  min: Decimal;
  max: Decimal;
  count: number;
}

export const calculateDecimalStatistics = (
  values: Decimal[],
): DecimalStatistics | null => {
  if (values.length === 0) return null;

  const sum = values.reduce((acc, val) => acc.plus(val), new Decimal(0));
  const avg = sum.dividedBy(values.length);
  const min = Decimal.min(...values);
  const max = Decimal.max(...values);

  // Calculate median
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? sorted[mid - 1].plus(sorted[mid]).dividedBy(2)
      : sorted[mid];

  return {
    sum,
    avg,
    median,
    min,
    max,
    count: values.length,
  };
};
