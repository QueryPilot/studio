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
import type { ColumnDefinitionInput } from '@/types/crud';
import { SqlAdapter } from '../base/SqlAdapter';
import type { ColumnInfo, TableRef } from '../types';
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
    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
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

  // ─────────────────────────────────────────────────────────────────
  // DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL uses MODIFY COLUMN instead of ALTER COLUMN
   */
  modifyColumn(
    target: TableRef,
    columnName: string,
    changes: Partial<ColumnDefinitionInput>
  ): string {
    const table = this.formatTableRef(target);
    const colName = this.quoteIdentifier(columnName);

    // MySQL requires full column definition with MODIFY COLUMN
    // Build the complete definition from changes
    const parts: string[] = [colName];

    if (changes.dataType) {
      parts.push(changes.dataType);
    } else {
      // MySQL requires datatype - use TEXT as fallback
      parts.push('TEXT');
    }

    if (changes.nullable === false) {
      parts.push('NOT NULL');
    } else if (changes.nullable === true) {
      parts.push('NULL');
    }

    if (changes.defaultValue !== undefined) {
      if (changes.defaultValue === null) {
        parts.push('DEFAULT NULL');
      } else {
        parts.push(`DEFAULT ${this.formatValue(changes.defaultValue, { name: columnName })}`);
      }
    }

    return `ALTER TABLE ${table} MODIFY COLUMN ${parts.join(' ')}`;
  }

  /**
   * MySQL uses CHANGE COLUMN for rename
   */
  renameColumn(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    // MySQL CHANGE requires full column definition - simplified version
    // In practice, you'd need to query the current column definition first
    return `ALTER TABLE ${table} RENAME COLUMN ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Index DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL DROP INDEX requires ON table
   */
  dropIndex(target: TableRef, indexName: string, ifExists?: boolean): string {
    const table = this.formatTableRef(target);
    // MySQL 8.0.29+ supports IF EXISTS, older versions don't
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP INDEX ${ifExistsClause}${this.quoteIdentifier(indexName)} ON ${table}`;
  }

  /**
   * MySQL uses ALTER TABLE ... RENAME INDEX
   */
  renameIndex(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} RENAME INDEX ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL DROP TRIGGER doesn't use ON table
   */
  dropTrigger(_target: TableRef, triggerName: string, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP TRIGGER ${ifExistsClause}${this.quoteIdentifier(triggerName)}`;
  }

  /**
   * MySQL doesn't support ENABLE/DISABLE TRIGGER
   * Returns empty string (no-op)
   */
  toggleTrigger(_target: TableRef, _triggerName: string, _enable: boolean): string {
    // MySQL doesn't have enable/disable trigger - must drop and recreate
    return '-- MySQL does not support ENABLE/DISABLE TRIGGER';
  }
}
