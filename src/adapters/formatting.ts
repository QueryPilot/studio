/**
 * Shared SQL Formatting Utilities
 *
 * Static functions for SQL value formatting and identifier quoting.
 * Used by both database adapters (CRUD) and export utilities (clipboard).
 */

import { DbType } from '@/types/connection';
import type { FilterConfig, FilterCondition, FilterGroup, FilterOperator, SortConfig } from '@/types/filter';

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

/**
 * Convert a FilterOperator to dialect-specific SQL operator
 */
function operatorToSql(operator: FilterOperator | string, dbType: DbType): string {
  switch (operator) {
    case 'REGEX':
      return dbType === DbType.PostgreSQL ? '~' : 'REGEXP BINARY';
    case 'REGEX_I':
      return dbType === DbType.PostgreSQL ? '~*' : 'REGEXP';
    case 'ILIKE':
      // MySQL/SQLite don't have ILIKE, use LIKE (case-insensitive by default in MySQL)
      return dbType === DbType.PostgreSQL ? 'ILIKE' : 'LIKE';
    case 'NOT ILIKE':
      return dbType === DbType.PostgreSQL ? 'NOT ILIKE' : 'NOT LIKE';
    default:
      return operator;
  }
}

/**
 * Convert a single FilterCondition to SQL WHERE fragment
 */
function conditionToSql(condition: FilterCondition, dbType: DbType): string {
  const column = condition.castToText
    ? `${quoteIdentifier(condition.column, dbType)}::text`
    : quoteIdentifier(condition.column, dbType);

  const operator = condition.operator as FilterOperator;

  // Null checks don't need a value
  if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
    const sql = `${column} ${operator}`;
    return condition.negated ? `NOT (${sql})` : sql;
  }

  // IN / NOT IN operators need array handling
  if (operator === 'IN' || operator === 'NOT IN') {
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    const formatted = values.map((v) => formatValue(v, dbType)).join(', ');
    const sql = `${column} ${operator} (${formatted})`;
    return condition.negated ? `NOT (${sql})` : sql;
  }

  // Standard comparison operators
  const sqlOp = operatorToSql(operator, dbType);
  const value = formatValue(condition.value, dbType);
  const sql = `${column} ${sqlOp} ${value}`;

  return condition.negated ? `NOT (${sql})` : sql;
}

/**
 * Convert a FilterGroup to SQL WHERE fragment (recursive)
 */
function groupToSql(group: FilterGroup, dbType: DbType): string {
  if (group.conditions.length === 0) {
    return '';
  }

  const parts: string[] = [];

  for (const item of group.conditions) {
    if ('type' in item && item.type === 'group') {
      const nested = groupToSql(item as FilterGroup, dbType);
      if (nested) {
        parts.push(`(${nested})`);
      }
    } else {
      const sql = conditionToSql(item as FilterCondition, dbType);
      if (sql) {
        parts.push(sql);
      }
    }
  }

  return parts.join(` ${group.logical} `);
}

/**
 * Convert FilterConfig to a raw SQL WHERE clause string
 * Returns undefined if no filters are configured
 */
export function filterConfigToWhereClause(
  filter: FilterConfig | undefined,
  dbType: DbType | string
): string | undefined {
  if (!filter) {
    return undefined;
  }

  // Raw WHERE clause takes precedence (AI-generated filters)
  if (filter.rawWhereClause) {
    return filter.rawWhereClause;
  }

  // Convert structured filter to SQL
  const type = toDbType(dbType);
  const sql = groupToSql(filter.root, type);

  return sql || undefined;
}

/**
 * Convert SortConfig array to SQL ORDER BY clause components
 */
export function sortConfigToOrderBy(
  sorts: SortConfig[] | undefined
): Array<{ column: string; direction: 'ASC' | 'DESC' }> | undefined {
  if (!sorts || sorts.length === 0) {
    return undefined;
  }

  return sorts.map((s) => ({
    column: s.column,
    direction: s.direction.toUpperCase() as 'ASC' | 'DESC',
  }));
}
