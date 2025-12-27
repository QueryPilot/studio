/**
 * PostgreSQL Database Adapter
 *
 * Implements PostgreSQL-specific SQL generation including:
 * - Double-quote identifier quoting: "column_name"
 * - Single-quote string escaping with doubling: 'it''s'
 * - Type casts for UUID, JSONB, timestamps: 'value'::type
 * - Array literals: ARRAY[1, 2, 3]
 * - RETURNING clause support
 * - Boolean TRUE/FALSE literals
 */

import { DbType } from '@/types/connection';
import { SqlAdapter } from '../base/SqlAdapter';
import type { ColumnInfo } from '../types';
import { quoteIdentifier as sharedQuoteIdentifier } from '../formatting';

// UUID v4 pattern for detection
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgreSQL UUID type names
const UUID_TYPE_NAMES = ['uuid'];

// PostgreSQL JSON/JSONB type names
const JSON_TYPE_NAMES = ['json', 'jsonb'];

// PostgreSQL timestamp type names
const TIMESTAMP_TYPE_NAMES = [
  'timestamp',
  'timestamptz',
  'timestamp with time zone',
  'timestamp without time zone',
];

// PostgreSQL date type names
const DATE_TYPE_NAMES = ['date'];

// PostgreSQL time type names
const TIME_TYPE_NAMES = ['time', 'timetz', 'time with time zone', 'time without time zone'];

// PostgreSQL array type suffix
const ARRAY_TYPE_SUFFIX = '[]';

// PostgreSQL bytea type
const BYTEA_TYPE_NAMES = ['bytea'];

export class PostgreSQLAdapter extends SqlAdapter {
  readonly dbType = DbType.PostgreSQL;

  /**
   * Quote an identifier with double quotes (PostgreSQL standard)
   * Escapes embedded double quotes by doubling them
   */
  quoteIdentifier(name: string): string {
    return sharedQuoteIdentifier(name, DbType.PostgreSQL);
  }

  /**
   * Quote a string value with single quotes
   */
  quoteString(value: string): string {
    return `'${this.escapeString(value)}'`;
  }

  /**
   * Format a value for PostgreSQL SQL
   * Handles type-specific formatting including:
   * - NULL values
   * - Booleans (TRUE/FALSE)
   * - Numbers (with validation)
   * - Dates/timestamps (with timezone cast)
   * - UUIDs (with ::uuid cast)
   * - JSON/JSONB (with ::jsonb cast)
   * - Arrays (ARRAY[...] syntax)
   * - Binary data (bytea hex format)
   * - Plain strings
   */
  formatValue(value: unknown, column: ColumnInfo): string {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return 'NULL';
    }

    // Handle booleans - PostgreSQL uses TRUE/FALSE
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }

    // Handle numbers
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number value: ${value}`);
      }
      return String(value);
    }

    // Handle BigInt
    if (typeof value === 'bigint') {
      return String(value);
    }

    // Handle Date objects
    if (value instanceof Date) {
      return this.formatDate(value, column);
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return this.formatArray(value, column);
    }

    // Handle Uint8Array/Buffer (binary data)
    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
      return this.formatBytea(value);
    }

    // Handle objects (JSON/JSONB)
    if (typeof value === 'object') {
      return this.formatJsonb(value);
    }

    // Handle strings with type detection
    const strValue = String(value);
    return this.formatString(strValue, column);
  }

  /**
   * Format a Date value with appropriate PostgreSQL type cast
   */
  private formatDate(value: Date, column: ColumnInfo): string {
    const dbType = column.dbType?.toLowerCase() || '';

    // Check if it's a date-only type
    if (DATE_TYPE_NAMES.some((t) => dbType.includes(t)) && !dbType.includes('timestamp')) {
      // Format as date only: YYYY-MM-DD
      const dateStr = value.toISOString().split('T')[0];
      return `'${dateStr}'::date`;
    }

    // Check if it's a time-only type
    if (TIME_TYPE_NAMES.some((t) => dbType.includes(t))) {
      // Format as time only: HH:MM:SS.mmm
      const timePart = value.toISOString().split('T')[1];
      const timeStr = timePart ? timePart.replace('Z', '') : '00:00:00.000';
      const typeCast = dbType.includes('tz') ? '::timetz' : '::time';
      return `'${timeStr}'${typeCast}`;
    }

    // Default: timestamp with timezone
    return `'${value.toISOString()}'::timestamptz`;
  }

  /**
   * Format an array value using PostgreSQL ARRAY[] syntax
   */
  private formatArray(value: unknown[], column: ColumnInfo): string {
    if (value.length === 0) {
      // Empty array - need to determine type from column info
      const elementType = this.getArrayElementType(column);
      if (elementType) {
        return `ARRAY[]::${elementType}[]`;
      }
      return 'ARRAY[]::text[]'; // Default to text array
    }

    // Determine element column info for recursive formatting
    const elementColumn: ColumnInfo = {
      name: column.name,
      dbType: this.getArrayElementType(column),
    };

    const elements = value.map((v) => this.formatValue(v, elementColumn)).join(', ');
    return `ARRAY[${elements}]`;
  }

  /**
   * Get the element type for an array column
   */
  private getArrayElementType(column: ColumnInfo): string | undefined {
    const dbType = column.dbType?.toLowerCase() || '';
    if (dbType.endsWith(ARRAY_TYPE_SUFFIX)) {
      return dbType.slice(0, -2); // Remove '[]' suffix
    }
    if (dbType.startsWith('_')) {
      // PostgreSQL internal array type notation (_int4, _text, etc.)
      return dbType.slice(1);
    }
    return undefined;
  }

  /**
   * Format binary data as PostgreSQL bytea hex format
   */
  private formatBytea(value: Uint8Array): string {
    const hex = Array.from(value)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `'\\x${hex}'::bytea`;
  }

  /**
   * Format an object as JSONB
   */
  private formatJsonb(value: object): string {
    const jsonStr = JSON.stringify(value);
    return `'${this.escapeString(jsonStr)}'::jsonb`;
  }

  /**
   * Format a string value with type detection and appropriate casting
   */
  private formatString(value: string, column: ColumnInfo): string {
    const dbType = column.dbType?.toLowerCase() || '';

    // Check for UUID type from column metadata
    if (UUID_TYPE_NAMES.some((t) => dbType === t)) {
      return `'${this.escapeString(value)}'::uuid`;
    }

    // Detect UUID by pattern if no column type info
    if (!dbType && UUID_PATTERN.test(value)) {
      return `'${this.escapeString(value)}'::uuid`;
    }

    // Check for JSON/JSONB type
    if (JSON_TYPE_NAMES.some((t) => dbType === t)) {
      // Try to validate JSON
      try {
        JSON.parse(value);
        const typeCast = dbType === 'json' ? '::json' : '::jsonb';
        return `'${this.escapeString(value)}'${typeCast}`;
      } catch {
        // If not valid JSON, just treat as string
        return this.quoteString(value);
      }
    }

    // Check for timestamp types
    if (TIMESTAMP_TYPE_NAMES.some((t) => dbType.includes(t))) {
      const typeCast = dbType.includes('tz') ? '::timestamptz' : '::timestamp';
      return `'${this.escapeString(value)}'${typeCast}`;
    }

    // Check for date type
    if (DATE_TYPE_NAMES.some((t) => dbType === t)) {
      return `'${this.escapeString(value)}'::date`;
    }

    // Check for time types
    if (TIME_TYPE_NAMES.some((t) => dbType.includes(t))) {
      const typeCast = dbType.includes('tz') ? '::timetz' : '::time';
      return `'${this.escapeString(value)}'${typeCast}`;
    }

    // Check for bytea type (hex string input)
    if (BYTEA_TYPE_NAMES.some((t) => dbType === t)) {
      // If it's already in hex format, use as-is
      if (value.startsWith('\\x') || value.startsWith('0x')) {
        const hexPart = value.startsWith('0x') ? value.slice(2) : value.slice(2);
        return `'\\x${hexPart}'::bytea`;
      }
      // Otherwise, encode the string to bytea using TextEncoder (browser-compatible)
      const bytes = new TextEncoder().encode(value);
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `'\\x${hex}'::bytea`;
    }

    // Default: plain string
    return this.quoteString(value);
  }

  /**
   * PostgreSQL supports RETURNING clause
   */
  protected supportsReturning(): boolean {
    return true;
  }
}
