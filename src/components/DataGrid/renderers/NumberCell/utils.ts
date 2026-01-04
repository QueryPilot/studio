import Decimal from 'decimal.js';

/**
 * Remove commas and whitespace from number string
 * Supports: "9,223,372,036,854,775,807" -> "9223372036854775807"
 */
export const normalizeValue = (val: string) => {
  return val.trim().replace(/,/g, '');
};

export const isMeaningful = (val: string) => normalizeValue(val).length > 0;

/**
 * Format number string with thousand separators for display
 * Uses Decimal.js to handle numbers beyond JavaScript's safe integer range
 * "9223372036854775807" -> "9,223,372,036,854,775,807"
 */
export const formatNumberForDisplay = (val: string | null): string | null => {
  if (val == null || val.trim() === '') return val;
  
  const normalized = normalizeValue(val);
  
  // Don't format special values
  if (normalized === 'NaN' || normalized === 'Infinity' || normalized === '-Infinity') {
    return normalized;
  }
  
  // Don't format if it's in scientific notation (e.g., 1.23e10)
  if (/[eE]/.test(normalized)) {
    return normalized;
  }
  
  try {
    // Use Decimal.js to handle large numbers safely
    const decimal = new Decimal(normalized);
    
    // Convert to fixed notation (no scientific notation)
    const fixed = decimal.toFixed();
    
    // Split into parts (sign, integer, decimal)
    const match = fixed.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!match) return val; // Return original if pattern doesn't match
    
    const [, sign, integerPart, decimalPart] = match;
    
    // Add thousand separators to integer part (with null check)
    if (!integerPart) return val;
    const formatted = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    
    // Reconstruct with sign and decimal part if present
    return `${sign}${formatted}${decimalPart ? `.${decimalPart}` : ''}`;
  } catch (error) {
    // If Decimal.js can't parse it, return original
    return val;
  }
};

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

  // Basic pattern check (after removing commas)
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
    try {
      // Use Decimal.js to handle large numbers safely
      const decimal = new Decimal(normalized);
      
      // Get the value in fixed notation (no scientific notation)
      const fixed = decimal.toFixed();
      
      // Split into integer and decimal parts
      const parts = fixed.replace(/^[+-]/, "").split(".");
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
    } catch (error) {
      // If Decimal.js can't parse it, it's invalid
      return false;
    }
  }

  return true;
};
