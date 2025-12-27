/**
 * MySQL Database Adapter
 *
 * MySQL-specific SQL generation with:
 * - Backtick identifier quoting
 * - Backslash string escaping
 * - Boolean as 1/0
 * - No RETURNING clause support
 * - DateTime format without timezone
 */

import { DbType } from '@/types/connection';
import { SqlAdapter } from '../base/SqlAdapter';
import type { ColumnInfo } from '../types';
import {
  quoteIdentifier as sharedQuoteIdentifier,
  escapeString as sharedEscapeString,
} from '../formatting';

export class MySQLAdapter extends SqlAdapter {
  readonly dbType = DbType.MySQL;

  /**
   * Quote identifier with backticks (MySQL standard)
   * Escapes embedded backticks by doubling them
   */
  quoteIdentifier(name: string): string {
    return sharedQuoteIdentifier(name, DbType.MySQL);
  }

  /**
   * Quote and escape a string value for MySQL
   * Uses backslash escaping which is MySQL's default behavior
   */
  quoteString(value: string): string {
    return `'${this.escapeString(value)}'`;
  }

  /**
   * Format a value for MySQL SQL statements
   * Handles type-specific formatting and escaping
   */
  formatValue(value: unknown, _column: ColumnInfo): string {
    // NULL handling
    if (value === null || value === undefined) {
      return 'NULL';
    }

    // Boolean as 1/0 (MySQL uses TINYINT for booleans)
    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    // Number validation and formatting
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number value: ${value}`);
      }
      return String(value);
    }

    // BigInt support
    if (typeof value === 'bigint') {
      return String(value);
    }

    // Date formatting without timezone (MySQL DATETIME format)
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new Error('Invalid Date value');
      }
      // Format: 'YYYY-MM-DD HH:MM:SS'
      const formatted = value.toISOString().slice(0, 19).replace('T', ' ');
      return `'${formatted}'`;
    }

    // Buffer/Uint8Array as hex literal
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
      const hex = Array.from(value)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `X'${hex}'`;
    }

    // Object/Array as JSON string
    if (typeof value === 'object') {
      const json = JSON.stringify(value);
      return this.quoteString(json);
    }

    // Default: treat as string
    return this.quoteString(String(value));
  }

  /**
   * MySQL does not support RETURNING clause
   * Use LAST_INSERT_ID() separately after INSERT
   */
  protected supportsReturning(): boolean {
    return false;
  }

  /**
   * Escape special characters for MySQL string literals
   * Uses backslash escaping (MySQL's default sql_mode)
   */
  protected escapeString(value: string): string {
    return sharedEscapeString(value, DbType.MySQL);
  }
}
