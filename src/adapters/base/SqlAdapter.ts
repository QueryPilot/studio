/**
 * Base SQL Adapter
 *
 * Provides shared SQL generation logic for relational databases.
 * Dialect-specific adapters extend this class and override formatting methods.
 */

import { invoke } from '@tauri-apps/api/core';
import type { DbType } from '@/types/connection';
import type {
  DatabaseAdapter,
  DatabaseParadigm,
  TableRef,
  RowData,
  WhereClause,
  SelectOptions,
  InsertOptions,
  QueryPayload,
  QueryResult,
  ColumnInfo,
} from '../types';

/**
 * Abstract base class for SQL database adapters
 */
export abstract class SqlAdapter implements DatabaseAdapter {
  readonly paradigm: DatabaseParadigm = 'sql';
  readonly connectionId: string;
  abstract readonly dbType: DbType;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  /**
   * Execute SQL via backend execute_query command
   */
  async execute(sql: QueryPayload): Promise<QueryResult> {
    if (typeof sql !== 'string') {
      throw new Error('SQL adapter expects string query');
    }

    const result = await invoke<QueryResult>('execute_query', {
      connId: this.connectionId,
      sql,
    });

    return result;
  }

  /**
   * Generate INSERT statement
   */
  insert(target: TableRef, data: RowData, options?: InsertOptions): string {
    const table = this.formatTableRef(target);
    const columns = Object.keys(data);
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
   * Generate UPDATE statement
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

    let sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;

    if (this.supportsReturning()) {
      sql += ' RETURNING *';
    }

    return sql;
  }

  /**
   * Generate DELETE statement
   */
  delete(target: TableRef, where: WhereClause): string {
    const table = this.formatTableRef(target);
    const whereClause = this.buildWhereClause(where);

    return `DELETE FROM ${table} WHERE ${whereClause}`;
  }

  /**
   * Generate SELECT statement
   */
  select(target: TableRef, options?: SelectOptions): string {
    const table = this.formatTableRef(target);
    const columns =
      options?.columns?.map((c) => this.quoteIdentifier(c)).join(', ') || '*';

    let sql = `SELECT ${columns} FROM ${table}`;

    if (options?.where && Object.keys(options.where).length > 0) {
      sql += ` WHERE ${this.buildWhereClause(options.where)}`;
    }

    if (options?.orderBy && options.orderBy.length > 0) {
      const orderClauses = options.orderBy
        .map((o) => `${this.quoteIdentifier(o.column)} ${o.direction}`)
        .join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }

    if (options?.limit !== undefined) {
      sql += this.formatLimit(options.limit, options.offset);
    }

    return sql;
  }

  /**
   * Wrap statements in a transaction
   */
  transaction(operations: QueryPayload[]): string {
    const statements = operations.filter(
      (op): op is string => typeof op === 'string'
    );

    if (statements.length === 0) {
      return '';
    }

    return `BEGIN;\n${statements.join(';\n')};\nCOMMIT;`;
  }

  /**
   * Format a table reference with optional schema
   */
  protected formatTableRef(target: TableRef): string {
    if (target.schema) {
      return `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(target.table)}`;
    }
    return this.quoteIdentifier(target.table);
  }

  /**
   * Build WHERE clause from conditions
   */
  protected buildWhereClause(where: WhereClause): string {
    const conditions = Object.entries(where).map(([col, val]) => {
      if (val === null) {
        return `${this.quoteIdentifier(col)} IS NULL`;
      }
      return `${this.quoteIdentifier(col)} = ${this.formatValue(val, { name: col })}`;
    });

    return conditions.join(' AND ');
  }

  /**
   * Format LIMIT clause (dialect-specific, override if needed)
   */
  protected formatLimit(limit: number, offset?: number): string {
    let clause = ` LIMIT ${limit}`;
    if (offset !== undefined && offset > 0) {
      clause += ` OFFSET ${offset}`;
    }
    return clause;
  }

  /**
   * Whether this dialect supports RETURNING clause
   */
  protected supportsReturning(): boolean {
    return true; // Override in dialects that don't support it
  }

  /**
   * Escape a string by doubling single quotes (standard SQL)
   */
  protected escapeString(value: string): string {
    return value.replace(/'/g, "''");
  }

  // Abstract methods - must be implemented by each dialect
  abstract quoteIdentifier(name: string): string;
  abstract quoteString(value: string): string;
  abstract formatValue(value: unknown, column: ColumnInfo): string;
}
