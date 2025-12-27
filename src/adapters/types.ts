/**
 * Frontend Database Adapter Types
 *
 * Multi-paradigm adapter pattern for SQL, NoSQL, and Graph databases.
 * Each adapter generates appropriate queries for its database type.
 */

import type { DbType } from '@/types/connection';
import type { ColumnMeta } from '@/types/database';

/**
 * Query payload - SQL string for relational DBs, object for document/graph DBs
 */
export type QueryPayload = string | object;

/**
 * Database paradigm type
 */
export type DatabaseParadigm = 'sql' | 'document' | 'graph' | 'keyvalue';

/**
 * Table reference with optional schema
 */
export interface TableRef {
  schema?: string;
  table: string;
}

/**
 * Simple WHERE clause - column to value mapping
 * For complex queries, use raw SQL via select()
 */
export interface WhereClause {
  [column: string]: unknown;
}

/**
 * Row data for INSERT/UPDATE operations
 */
export type RowData = Record<string, unknown>;

/**
 * Options for SELECT queries
 */
export interface SelectOptions {
  columns?: string[];
  where?: WhereClause;
  orderBy?: { column: string; direction: 'ASC' | 'DESC' }[];
  limit?: number;
  offset?: number;
}

/**
 * Options for INSERT operations
 */
export interface InsertOptions {
  returning?: boolean;
}

/**
 * Query result from database
 */
export interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  rowCount?: number;
}

/**
 * Column metadata for value formatting
 */
export interface ColumnInfo {
  name: string;
  dbType?: string;
}

/**
 * Core database adapter interface
 *
 * Implementations generate appropriate queries for their database type
 * and execute them via the backend.
 */
export interface DatabaseAdapter {
  /** Database type (PostgreSQL, MySQL, etc.) */
  readonly dbType: DbType;

  /** Database paradigm (sql, document, graph, keyvalue) */
  readonly paradigm: DatabaseParadigm;

  /** Connection ID for this adapter */
  readonly connectionId: string;

  /**
   * Execute a query via the backend
   * @param query - SQL string or query object
   * @returns Query result with rows and columns
   */
  execute(query: QueryPayload): Promise<QueryResult>;

  /**
   * Generate INSERT query
   * @param target - Table reference
   * @param data - Row data to insert
   * @param options - Insert options (returning, etc.)
   */
  insert(target: TableRef, data: RowData, options?: InsertOptions): QueryPayload;

  /**
   * Generate UPDATE query
   * @param target - Table reference
   * @param data - Columns to update
   * @param where - WHERE clause conditions
   */
  update(target: TableRef, data: RowData, where: WhereClause): QueryPayload;

  /**
   * Generate DELETE query
   * @param target - Table reference
   * @param where - WHERE clause conditions
   */
  delete(target: TableRef, where: WhereClause): QueryPayload;

  /**
   * Generate SELECT query
   * @param target - Table reference
   * @param options - Select options (columns, where, limit, etc.)
   */
  select(target: TableRef, options?: SelectOptions): QueryPayload;

  /**
   * Wrap multiple operations in a transaction
   * @param operations - Array of query payloads
   */
  transaction(operations: QueryPayload[]): QueryPayload;

  /**
   * Format a value for SQL (handles escaping, type casting)
   * @param value - Value to format
   * @param column - Column metadata for type-aware formatting
   */
  formatValue(value: unknown, column: ColumnInfo): string;

  /**
   * Quote an identifier (table/column name)
   * @param name - Identifier to quote
   */
  quoteIdentifier(name: string): string;

  /**
   * Quote/escape a string value
   * @param value - String to quote
   */
  quoteString(value: string): string;
}
