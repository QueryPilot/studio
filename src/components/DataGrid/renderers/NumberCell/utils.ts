export const normalizeValue = (val: string) => val.trim();

export const isMeaningful = (val: string) => normalizeValue(val).length > 0;

const numberPattern =
  /^([+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?|NaN|Infinity|-Infinity)$/;

export const isValidNumberText = (
  val: string,
  precision?: number | null,
  scale?: number | null,
  dbType?: string,
): boolean => {
  const normalized = normalizeValue(val);
  if (!normalized) return true;

  // Basic pattern check
  if (!numberPattern.test(normalized)) return false;

  // For precise numeric types (NUMERIC, DECIMAL), reject special values
  const isPreciseNumericType =
    dbType &&
    (dbType.includes("numeric") ||
      dbType.includes("decimal") ||
      dbType.includes("dec"));

  if (isPreciseNumericType) {
    const specialValues = ["NaN", "Infinity", "-Infinity"];
    if (specialValues.includes(normalized)) return false;
  }

  // Validate precision/scale if provided
  if (precision != null || scale != null) {
    // Parse scientific notation to decimal
    let valueToCheck = normalized;
    const scientificMatch = normalized.match(
      /^([+-]?\d*\.?\d+)[eE]([+-]?\d+)$/,
    );
    if (scientificMatch) {
      try {
        const num = parseFloat(normalized);
        if (!Number.isFinite(num)) return false;
        // Convert to fixed notation for validation
        valueToCheck = num.toFixed(Math.max(scale || 0, 20));
      } catch {
        return false;
      }
    }

    // Split into integer and decimal parts
    const parts = valueToCheck.replace(/^[+-]/, "").split(".");
    const integerPart = parts[0] || "0";
    const decimalPart = parts[1] || "";

    // Remove leading zeros for integer part count (but keep at least one digit)
    const integerDigits = integerPart.replace(/^0+/, "").length || 1;
    const decimalDigits = decimalPart.length;

    // Validate scale (decimal places)
    if (scale != null && decimalDigits > scale) {
      return false;
    }

    // Validate precision (total significant digits)
    if (precision != null) {
      // For DECIMAL/NUMERIC, precision is total digits, scale is decimal digits
      // So integer digits = precision - scale
      const maxIntegerDigits = scale != null ? precision - scale : precision;
      if (integerDigits > maxIntegerDigits) {
        return false;
      }
    }
  }

  return true;
};
