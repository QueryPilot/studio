/**
 * Shared SQL Formatting Utilities
 *
 * Static functions for SQL value formatting and identifier quoting.
 * Used by both database adapters (CRUD) and export utilities (clipboard).
 */

import { DbType } from '@/types/connection';

/**
 * Map DatabaseType string to DbType enum
 * Supports both formats for flexibility
 */
export function toDbType(dbType: string | DbType): DbType {
  if (typeof dbType !== 'string') {
    return dbType;
  }

  switch (dbType.toLowerCase()) {
    case 'postgresql':
    case 'postgres':
      return DbType.PostgreSQL;
    case 'mysql':
    case 'mariadb':
      return DbType.MySQL;
    case 'sqlite':
      return DbType.SQLite;
    case 'mssql':
    case 'sqlserver':
      return DbType.SQLServer;
    default:
      return DbType.PostgreSQL;
  }
}

/**
 * Quote an identifier (table/column name) for the given database type
 */
export function quoteIdentifier(name: string, dbType: DbType | string): string {
  const type = toDbType(dbType);

  switch (type) {
    case DbType.MySQL:
      // Backticks with escaping
      return `\`${name.replace(/`/g, '``')}\``;
    case DbType.SQLServer:
      // Square brackets with escaping
      return `[${name.replace(/]/g, ']]')}]`;
    case DbType.PostgreSQL:
    case DbType.SQLite:
    default:
      // Double quotes with escaping
      return `"${name.replace(/"/g, '""')}"`;
  }
}

/**
 * Format a fully qualified table name with optional schema
 */
export function formatTableName(
  schema: string | undefined,
  table: string,
  dbType: DbType | string
): string {
  const type = toDbType(dbType);

  if (!schema) {
    return quoteIdentifier(table, type);
  }

  return `${quoteIdentifier(schema, type)}.${quoteIdentifier(table, type)}`;
}

/**
 * Escape a string for SQL (double single quotes)
 */
export function escapeString(value: string, dbType: DbType | string): string {
  const type = toDbType(dbType);

  switch (type) {
    case DbType.MySQL:
      // MySQL uses backslash escaping by default
      return value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\0/g, '\\0')
        .replace(/\x1a/g, '\\Z');
    case DbType.PostgreSQL:
    case DbType.SQLite:
    case DbType.SQLServer:
    default:
      // Standard SQL: double single quotes
      return value.replace(/'/g, "''");
  }
}

/**
 * Quote a string value for SQL
 */
export function quoteString(value: string, dbType: DbType | string): string {
  const type = toDbType(dbType);
  const escaped = escapeString(value, type);

  switch (type) {
    case DbType.SQLServer:
      // MSSQL uses N prefix for Unicode
      return `N'${escaped}'`;
    default:
      return `'${escaped}'`;
  }
}

/**
 * Format a value for SQL (simple version without column metadata)
 * For more sophisticated type-aware formatting, use adapter.formatValue()
 */
export function formatValue(value: unknown, dbType: DbType | string): string {
  const type = toDbType(dbType);

  // NULL handling
  if (value === null || value === undefined) {
    return 'NULL';
  }

  // Boolean handling
  if (typeof value === 'boolean') {
    switch (type) {
      case DbType.PostgreSQL:
        return value ? 'TRUE' : 'FALSE';
      case DbType.MySQL:
      case DbType.SQLite:
      case DbType.SQLServer:
      default:
        return value ? '1' : '0';
    }
  }

  // Number handling
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 'NULL';
    }
    return String(value);
  }

  // BigInt handling
  if (typeof value === 'bigint') {
    return String(value);
  }

  // Date handling
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      return 'NULL';
    }
    return quoteString(value.toISOString(), type);
  }

  // Buffer/Uint8Array handling
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    switch (type) {
      case DbType.PostgreSQL:
        return `'\\x${hex}'::bytea`;
      case DbType.MySQL:
      case DbType.SQLite:
        return `X'${hex}'`;
      case DbType.SQLServer:
        return `0x${hex}`;
      default:
        return `X'${hex}'`;
    }
  }

  // Object/Array handling (JSON)
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      return quoteString(json, type);
    } catch {
      return 'NULL';
    }
  }

  // Default: treat as string
  return quoteString(String(value), type);
}

/**
 * Dialect quoting helpers - returns functions for a specific dialect
 * Legacy interface for backwards compatibility with sqlInsertExport
 */
export function getDialectQuoting(dbType: DbType | string) {
  const type = toDbType(dbType);

  return {
    quoteIdentifier: (name: string) => quoteIdentifier(name, type),
    formatTableName: (schema: string, table: string) => formatTableName(schema, table, type),
    formatValue: (value: unknown) => formatValue(value, type),
    quoteString: (value: string) => quoteString(value, type),
    escapeString: (value: string) => escapeString(value, type),
  };
}
