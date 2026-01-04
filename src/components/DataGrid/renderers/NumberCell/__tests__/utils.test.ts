/**
 * Tests for NumberCell utilities - number formatting and validation
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeValue,
  formatNumberForDisplay,
  isValidNumberText,
} from '../utils';

describe('NumberCell Utils', () => {
  describe('normalizeValue', () => {
    it('should remove commas from number strings', () => {
      expect(normalizeValue('9,223,372,036,854,775,807')).toBe('9223372036854775807');
      expect(normalizeValue('1,000')).toBe('1000');
      expect(normalizeValue('1,000,000.50')).toBe('1000000.50');
    });

    it('should trim whitespace', () => {
      expect(normalizeValue('  123  ')).toBe('123');
      expect(normalizeValue('  1,234  ')).toBe('1234');
    });

    it('should handle negative numbers', () => {
      expect(normalizeValue('-9,223,372,036,854,775,807')).toBe('-9223372036854775807');
      expect(normalizeValue('-1,000.50')).toBe('-1000.50');
    });

    it('should handle numbers without commas', () => {
      expect(normalizeValue('123')).toBe('123');
      expect(normalizeValue('123.45')).toBe('123.45');
    });
  });

  describe('formatNumberForDisplay', () => {
    it('should add thousand separators to large integers', () => {
      expect(formatNumberForDisplay('9223372036854775807')).toBe('9,223,372,036,854,775,807');
      expect(formatNumberForDisplay('1000')).toBe('1,000');
      expect(formatNumberForDisplay('1000000')).toBe('1,000,000');
    });

    it('should preserve decimal places', () => {
      // Decimal.js removes trailing zeros
      expect(formatNumberForDisplay('1000.50')).toBe('1,000.5');
      expect(formatNumberForDisplay('1234567.89')).toBe('1,234,567.89');
      expect(formatNumberForDisplay('1000.00')).toBe('1,000');
    });

    it('should handle negative numbers', () => {
      expect(formatNumberForDisplay('-9223372036854775807')).toBe('-9,223,372,036,854,775,807');
      expect(formatNumberForDisplay('-1000')).toBe('-1,000');
      // Decimal.js removes trailing zeros
      expect(formatNumberForDisplay('-1000.50')).toBe('-1,000.5');
    });

    it('should handle positive sign (Decimal.js normalizes it)', () => {
      // Decimal.js removes explicit positive signs
      expect(formatNumberForDisplay('+1000')).toBe('1,000');
      expect(formatNumberForDisplay('+1234.56')).toBe('1,234.56');
    });

    it('should not format special values', () => {
      expect(formatNumberForDisplay('NaN')).toBe('NaN');
      expect(formatNumberForDisplay('Infinity')).toBe('Infinity');
      expect(formatNumberForDisplay('-Infinity')).toBe('-Infinity');
    });

    it('should not format scientific notation', () => {
      expect(formatNumberForDisplay('1.23e10')).toBe('1.23e10');
      expect(formatNumberForDisplay('1.23E-5')).toBe('1.23E-5');
    });

    it('should handle null and empty strings', () => {
      expect(formatNumberForDisplay(null)).toBe(null);
      expect(formatNumberForDisplay('')).toBe('');
      expect(formatNumberForDisplay('   ')).toBe('   ');
    });

    it('should handle numbers that are already formatted', () => {
      expect(formatNumberForDisplay('1,000')).toBe('1,000');
      expect(formatNumberForDisplay('9,223,372,036,854,775,807')).toBe('9,223,372,036,854,775,807');
    });

    it('should not add commas to small numbers', () => {
      expect(formatNumberForDisplay('999')).toBe('999');
      expect(formatNumberForDisplay('99')).toBe('99');
      expect(formatNumberForDisplay('9')).toBe('9');
    });
  });

  describe('isValidNumberText', () => {
    it('should accept numbers with commas', () => {
      expect(isValidNumberText('9,223,372,036,854,775,807')).toBe(true);
      expect(isValidNumberText('1,000')).toBe(true);
      expect(isValidNumberText('1,000,000.50')).toBe(true);
    });

    it('should accept numbers without commas', () => {
      expect(isValidNumberText('123')).toBe(true);
      expect(isValidNumberText('123.45')).toBe(true);
      expect(isValidNumberText('9223372036854775807')).toBe(true);
    });

    it('should accept negative numbers', () => {
      expect(isValidNumberText('-123')).toBe(true);
      expect(isValidNumberText('-1,000')).toBe(true);
      expect(isValidNumberText('-123.45')).toBe(true);
    });

    it('should accept scientific notation', () => {
      expect(isValidNumberText('1.23e10')).toBe(true);
      expect(isValidNumberText('1.23E-5')).toBe(true);
      expect(isValidNumberText('-1.5e+3')).toBe(true);
    });

    it('should accept special values for non-precise types', () => {
      expect(isValidNumberText('NaN')).toBe(true);
      expect(isValidNumberText('Infinity')).toBe(true);
      expect(isValidNumberText('-Infinity')).toBe(true);
    });

    it('should reject special values for DECIMAL/NUMERIC types', () => {
      expect(isValidNumberText('NaN', null, null, 'numeric')).toBe(false);
      expect(isValidNumberText('Infinity', null, null, 'decimal')).toBe(false);
      expect(isValidNumberText('-Infinity', null, null, 'numeric')).toBe(false);
    });

    it('should validate precision and scale', () => {
      // DECIMAL(5, 2) - max 3 integer digits, 2 decimal digits
      expect(isValidNumberText('123.45', 5, 2)).toBe(true);
      expect(isValidNumberText('999.99', 5, 2)).toBe(true);
      expect(isValidNumberText('1,234.56', 5, 2)).toBe(false); // Too many integer digits
      expect(isValidNumberText('123.456', 5, 2)).toBe(false); // Too many decimal digits
    });

    it('should handle BIGINT max value with commas', () => {
      // BIGINT max is 9,223,372,036,854,775,807 (19 digits)
      expect(isValidNumberText('9,223,372,036,854,775,807')).toBe(true);
      expect(isValidNumberText('9223372036854775807')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidNumberText('abc')).toBe(false);
      expect(isValidNumberText('12.34.56')).toBe(false);
      expect(isValidNumberText('1.2.3.4')).toBe(false); // Multiple decimal points
      expect(isValidNumberText('12a34')).toBe(false); // Letters mixed with numbers
      expect(isValidNumberText('--123')).toBe(false); // Double negative
    });

    it('should accept empty strings', () => {
      expect(isValidNumberText('')).toBe(true);
      expect(isValidNumberText('   ')).toBe(true);
    });
  });

  describe('Round trip: format -> normalize', () => {
    it('should maintain value through format and normalize cycle', () => {
      const original = '9223372036854775807';
      const formatted = formatNumberForDisplay(original);
      const normalized = normalizeValue(formatted ?? '');
      expect(normalized).toBe(original);
    });

    it('should handle decimal numbers', () => {
      const original = '1234567.89';
      const formatted = formatNumberForDisplay(original);
      const normalized = normalizeValue(formatted ?? '');
      expect(normalized).toBe(original);
    });

    it('should handle negative numbers', () => {
      const original = '-9223372036854775807';
      const formatted = formatNumberForDisplay(original);
      const normalized = normalizeValue(formatted ?? '');
      expect(normalized).toBe(original);
    });
  });
});

