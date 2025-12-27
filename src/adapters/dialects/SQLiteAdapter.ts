/**
 * SQLite Database Adapter
 *
 * SQLite-specific SQL generation with:
 * - Double-quoted identifiers: "column_name"
 * - No schema support (SQLite doesn't have schemas)
 * - Booleans as 1/0
 * - Dates as ISO strings
 * - RETURNING clause support (SQLite 3.35+)
 */

import { DbType } from '@/types/connection';
import { SqlAdapter } from '../base/SqlAdapter';
import type { ColumnInfo, TableRef, InsertOptions, RowData, WhereClause } from '../types';
import { quoteIdentifier as sharedQuoteIdentifier } from '../formatting';

export class SQLiteAdapter extends SqlAdapter {
  readonly dbType = DbType.SQLite;

  /**
   * Quote identifier using double quotes (SQL standard)
   * Escapes embedded double quotes by doubling them
   */
  quoteIdentifier(name: string): string {
    return sharedQuoteIdentifier(name, DbType.SQLite);
  }

  /**
   * Quote string using single quotes (SQL standard)
   */
  quoteString(value: string): string {
    return `'${this.escapeString(value)}'`;
  }

  /**
   * Format value for SQLite
   * - NULL for null/undefined
   * - 1/0 for booleans
   * - Numbers as-is (with validation)
   * - Dates as ISO strings
   * - Objects as JSON strings
   * - Strings quoted and escaped
   */
  formatValue(value: unknown, column: ColumnInfo): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number value for column "${column.name}": ${value}`);
      }
      return String(value);
    }

    if (value instanceof Date) {
      // SQLite stores dates as ISO 8601 strings
      return `'${value.toISOString()}'`;
    }

    // Handle Buffer/Uint8Array as hex blob
    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `X'${hex}'`;
    }

    if (typeof value === 'object') {
      // JSON values stored as text
      return this.quoteString(JSON.stringify(value));
    }

    return this.quoteString(String(value));
  }

  /**
   * Format table reference - SQLite ignores schema
   */
  protected formatTableRef(target: TableRef): string {
    // SQLite doesn't have schemas in the traditional sense
    // (attached databases use a different syntax: db_name.table_name)
    // For simplicity, we just use the table name
    return this.quoteIdentifier(target.table);
  }

  /**
   * SQLite 3.35+ supports RETURNING clause
   */
  protected supportsReturning(): boolean {
    return true;
  }

  /**
   * Generate INSERT statement with optional RETURNING
   * Handles INSERT OR REPLACE, INSERT OR IGNORE patterns if needed
   */
  insert(target: TableRef, data: RowData, options?: InsertOptions): string {
    const table = this.formatTableRef(target);
    const columns = Object.keys(data);

    if (columns.length === 0) {
      // SQLite supports INSERT INTO table DEFAULT VALUES
      let sql = `INSERT INTO ${table} DEFAULT VALUES`;
      if (options?.returning && this.supportsReturning()) {
        sql += ' RETURNING *';
      }
      return sql;
    }

    const columnList = columns.map((c) => this.quoteIdentifier(c)).join(', ');
    const valueList = columns
      .map((c) => this.formatValue(data[c], { name: c }))
      .join(', ');

    let sql = `INSERT INTO ${table} (${columnList}) VALUES (${valueList})`;

    if (options?.returning && this.supportsReturning()) {
      sql += ' RETURNING *';
    }

    return sql;
  }

  /**
   * Generate UPDATE statement with RETURNING
   */
  update(target: TableRef, data: RowData, where: WhereClause): string {
    const table = this.formatTableRef(target);

    const setClause = Object.entries(data)
      .map(
        ([col, val]) =>
          `${this.quoteIdentifier(col)} = ${this.formatValue(val, { name: col })}`
      )
      .join(', ');

    const whereClause = this.buildWhereClause(where);

    // SQLite 3.35+ supports RETURNING
    return `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING *`;
  }

  /**
   * Generate DELETE statement with RETURNING
   */
  delete(target: TableRef, where: WhereClause): string {
    const table = this.formatTableRef(target);
    const whereClause = this.buildWhereClause(where);

    // SQLite 3.35+ supports RETURNING
    return `DELETE FROM ${table} WHERE ${whereClause} RETURNING *`;
  }

  /**
   * SQLite uses LIMIT ... OFFSET syntax
   */
  protected formatLimit(limit: number, offset?: number): string {
    let clause = ` LIMIT ${limit}`;
    if (offset !== undefined && offset > 0) {
      clause += ` OFFSET ${offset}`;
    }
    return clause;
  }

  /**
   * SQLite transaction syntax
   */
  transaction(operations: string[]): string {
    if (operations.length === 0) {
      return '';
    }

    // Filter out non-string operations
    const statements = operations.filter(
      (op): op is string => typeof op === 'string' && op.trim().length > 0
    );

    if (statements.length === 0) {
      return '';
    }

    return `BEGIN TRANSACTION;\n${statements.join(';\n')};\nCOMMIT;`;
  }
}
