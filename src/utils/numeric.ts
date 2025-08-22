/**
 * Utility class for precise numeric operations
 * Preserves full precision for database numeric types
 */
export class NumericValue {
  private value: string;
  
  constructor(value: string | number | bigint) {
    if (typeof value === 'number') {
      // Convert number to string, preserving precision
      this.value = value.toString();
    } else if (typeof value === 'bigint') {
      this.value = value.toString();
    } else {
      this.value = value;
    }
  }
  
  toString(): string {
    return this.value;
  }
  
  toBigInt(): bigint | null {
    try {
      return BigInt(this.value);
    } catch {
      return null;
    }
  }
  
  toNumber(): number | null {
    const num = parseFloat(this.value);
    return isNaN(num) ? null : num;
  }
  
  /**
   * Format with specific decimal places
   */
  toFixed(decimals: number): string {
    const num = this.toNumber();
    if (num === null) return this.value;
    return num.toFixed(decimals);
  }
  
  /**
   * Apply scale (decimal places) with rounding
   */
  toScale(scale: number): string {
    if (!this.value.includes('.')) {
      // No decimal point, just add zeros
      return scale > 0 ? `${this.value}.${'0'.repeat(scale)}` : this.value;
    }
    
    const parts = this.value.split('.');
    const decimalPart = parts[1] || '';
    
    if (decimalPart.length <= scale) {
      // Pad with zeros if needed
      const padding = '0'.repeat(scale - decimalPart.length);
      return `${parts[0]}.${decimalPart}${padding}`;
    }
    
    // Need to round
    const num = this.toNumber();
    if (num === null) return this.value;
    
    return num.toFixed(scale);
  }
  
  /**
   * Compare two numeric values
   */
  compare(other: NumericValue): -1 | 0 | 1 {
    // Try BigInt comparison first for integers
    const thisBigInt = this.toBigInt();
    const otherBigInt = other.toBigInt();
    
    if (thisBigInt !== null && otherBigInt !== null) {
      if (thisBigInt < otherBigInt) return -1;
      if (thisBigInt > otherBigInt) return 1;
      return 0;
    }
    
    // Fall back to number comparison
    const thisNum = this.toNumber();
    const otherNum = other.toNumber();
    
    if (thisNum === null || otherNum === null) {
      // String comparison as last resort
      return this.value < other.value ? -1 : this.value > other.value ? 1 : 0;
    }
    
    if (thisNum < otherNum) return -1;
    if (thisNum > otherNum) return 1;
    return 0;
  }
  
  equals(other: NumericValue): boolean {
    return this.compare(other) === 0;
  }
  
  lessThan(other: NumericValue): boolean {
    return this.compare(other) === -1;
  }
  
  greaterThan(other: NumericValue): boolean {
    return this.compare(other) === 1;
  }
  
  /**
   * Validate against database type constraints
   */
  isValidForType(dbType: string, precision?: number, scale?: number): boolean {
    const type = dbType.toUpperCase();
    
    // Integer types
    if (type.includes('INT')) {
      const bigInt = this.toBigInt();
      if (bigInt === null) return false;
      
      if (type === 'TINYINT') {
        return bigInt >= -128n && bigInt <= 127n;
      }
      if (type === 'SMALLINT') {
        return bigInt >= -32768n && bigInt <= 32767n;
      }
      if (type === 'INT' || type === 'INTEGER') {
        return bigInt >= -2147483648n && bigInt <= 2147483647n;
      }
      // BIGINT - any valid BigInt
      return true;
    }
    
    // Decimal types
    if (type.includes('DECIMAL') || type.includes('NUMERIC')) {
      if (precision && scale !== undefined) {
        const parts = this.value.replace('-', '').split('.');
        const integerDigits = parts[0]?.length || 0;
        const decimalDigits = parts[1]?.length || 0;
        
        const maxIntegerDigits = precision - scale;
        return integerDigits <= maxIntegerDigits && decimalDigits <= scale;
      }
    }
    
    return true;
  }
  
  /**
   * Format for display with thousand separators
   */
  toDisplayString(options?: { 
    thousandSeparator?: boolean; 
    currency?: boolean;
    locale?: string;
  }): string {
    const opts = {
      thousandSeparator: true,
      currency: false,
      locale: 'en-US',
      ...options
    };
    
    if (opts.currency) {
      const num = this.toNumber();
      if (num !== null) {
        return new Intl.NumberFormat(opts.locale, {
          style: 'currency',
          currency: 'USD'
        }).format(num);
      }
    }
    
    if (opts.thousandSeparator) {
      const parts = this.value.split('.');
      const integerPart = parts[0]?.replace(/^-/, '') || '';
      const formatted = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const result = parts[0]?.startsWith('-') ? `-${formatted}` : formatted;
      
      if (parts[1]) {
        return `${result}.${parts[1]}`;
      }
      return result;
    }
    
    return this.value;
  }
}

/**
 * Parse a numeric value from various formats
 */
export function parseNumeric(input: string): NumericValue | null {
  if (!input || input === 'null' || input === 'NULL') {
    return null;
  }
  
  // Remove currency symbols and thousand separators
  let cleaned = input
    .replace(/[$,]/g, '')
    .replace(/\s/g, '')
    .trim();
  
  // Check for special values
  if (cleaned === 'NaN' || cleaned === 'Infinity' || cleaned === '-Infinity') {
    return new NumericValue(cleaned);
  }
  
  // Validate numeric format
  const regex = /^-?(\d+\.?\d*|\d*\.\d+)([eE][+-]?\d+)?$/;
  if (!regex.test(cleaned)) {
    return null;
  }
  
  return new NumericValue(cleaned);
}

/**
 * Sum an array of numeric values with full precision
 */
export function sumNumeric(values: (NumericValue | null)[]): NumericValue {
  // For integers, use BigInt
  const nonNullValues = values.filter(v => v !== null) as NumericValue[];
  
  if (nonNullValues.every(v => v.toBigInt() !== null)) {
    // All integers, use BigInt math
    const sum = nonNullValues.reduce((acc, v) => {
      const bigInt = v.toBigInt();
      return bigInt !== null ? acc + bigInt : acc;
    }, 0n);
    return new NumericValue(sum);
  }
  
  // Use floating point for decimals
  // Note: This may lose precision for very large decimals
  const sum = nonNullValues.reduce((acc, v) => {
    const num = v.toNumber();
    return num !== null ? acc + num : acc;
  }, 0);
  
  return new NumericValue(sum);
}

/**
 * Calculate average with specified scale
 */
export function avgNumeric(values: (NumericValue | null)[], scale = 2): NumericValue | null {
  const nonNullValues = values.filter(v => v !== null) as NumericValue[];
  
  if (nonNullValues.length === 0) {
    return null;
  }
  
  const sum = sumNumeric(nonNullValues);
  const avg = sum.toNumber();
  
  if (avg === null) {
    return null;
  }
  
  return new NumericValue((avg / nonNullValues.length).toFixed(scale));
}

/**
 * Find min/max values
 */
export function minNumeric(values: (NumericValue | null)[]): NumericValue | null {
  const nonNullValues = values.filter(v => v !== null) as NumericValue[];
  
  if (nonNullValues.length === 0) {
    return null;
  }
  
  return nonNullValues.reduce((min, v) => 
    v.lessThan(min) ? v : min
  );
}

export function maxNumeric(values: (NumericValue | null)[]): NumericValue | null {
  const nonNullValues = values.filter(v => v !== null) as NumericValue[];
  
  if (nonNullValues.length === 0) {
    return null;
  }
  
  return nonNullValues.reduce((max, v) => 
    v.greaterThan(max) ? v : max
  );
}