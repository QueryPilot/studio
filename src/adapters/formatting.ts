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
    return dbType === DbType.MariaDB ? DbType.MySQL : dbType;
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
      // PostgreSQL: ~ (case-sensitive regex)
      // MySQL/MariaDB: REGEXP BINARY (case-sensitive)
      // SQLite: REGEXP (requires extension, may not be available)
      // SQL Server: No native regex - fall back to LIKE (limited pattern support)
      switch (dbType) {
        case DbType.PostgreSQL:
          return '~';
        case DbType.MySQL:
          return 'REGEXP BINARY';
        case DbType.SQLite:
          return 'REGEXP'; // Note: requires regexp extension
        case DbType.SQLServer:
          return 'LIKE'; // Fallback - regex patterns won't work correctly
        default:
          return 'REGEXP BINARY';
      }
    case 'REGEX_I':
      // PostgreSQL: ~* (case-insensitive regex)
      // MySQL/MariaDB: REGEXP (case-insensitive by default)
      // SQLite: REGEXP (no case-insensitive variant)
      // SQL Server: No native regex - fall back to LIKE
      switch (dbType) {
        case DbType.PostgreSQL:
          return '~*';
        case DbType.MySQL:
          return 'REGEXP';
        case DbType.SQLite:
          return 'REGEXP'; // Note: requires regexp extension
        case DbType.SQLServer:
          return 'LIKE'; // Fallback - regex patterns won't work correctly
        default:
          return 'REGEXP';
      }
    case 'ILIKE':
      // MySQL/SQLite don't have ILIKE, use LIKE (case-insensitive by default in MySQL)
      // SQLite LIKE is case-insensitive for ASCII letters
      return dbType === DbType.PostgreSQL ? 'ILIKE' : 'LIKE';
    case 'NOT ILIKE':
      return dbType === DbType.PostgreSQL ? 'NOT ILIKE' : 'NOT LIKE';
    default:
      return operator;
  }
}

/**
 * Cast a column to text type for the given database
 */
function castToText(column: string, dbType: DbType): string {
  switch (dbType) {
    case DbType.PostgreSQL:
      return `${column}::text`;
    case DbType.MySQL:
      // MySQL/MariaDB use CAST(col AS CHAR)
      return `CAST(${column} AS CHAR)`;
    case DbType.SQLite:
      return `CAST(${column} AS TEXT)`;
    case DbType.SQLServer:
      return `CAST(${column} AS NVARCHAR(MAX))`;
    default:
      return `${column}::text`;
  }
}

/**
 * Convert a single FilterCondition to SQL WHERE fragment
 */
function conditionToSql(
  condition: FilterCondition,
  dbType: DbType,
  columnPrefix?: string
): string {
  const baseColumn = quoteIdentifier(condition.column, dbType);
  const qualifiedColumn = columnPrefix ? `${columnPrefix}.${baseColumn}` : baseColumn;
  const column = condition.castToText ? castToText(qualifiedColumn, dbType) : qualifiedColumn;

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
function groupToSql(
  group: FilterGroup,
  dbType: DbType,
  columnPrefix?: string
): string {
  if (group.conditions.length === 0) {
    return '';
  }

  const parts: string[] = [];

  for (const item of group.conditions) {
    if ('type' in item && item.type === 'group') {
      const nested = groupToSql(item as FilterGroup, dbType, columnPrefix);
      if (nested) {
        parts.push(`(${nested})`);
      }
    } else {
      const sql = conditionToSql(item as FilterCondition, dbType, columnPrefix);
      if (sql) {
        parts.push(sql);
      }
    }
  }

  return parts.join(` ${group.logical} `);
}

function qualifyRawWhereClause(
  clause: string,
  columnPrefix: string,
  columnNames: string[]
): string {
  const prefix = `${columnPrefix}.`;
  const columnSet = new Set(columnNames);
  const columnLowerSet = new Set(columnNames.map((name) => name.toLowerCase()));
  const isWhitespace = (char: string) => /\s/.test(char);

  const findPrevNonWhitespace = (fromIndex: number) => {
    for (let i = fromIndex; i >= 0; i--) {
      const char = clause.charAt(i);
      if (!isWhitespace(char)) {
        return char;
      }
    }
    return undefined;
  };

  const findNextNonWhitespace = (fromIndex: number) => {
    for (let i = fromIndex; i < clause.length; i++) {
      const char = clause.charAt(i);
      if (!isWhitespace(char)) {
        return char;
      }
    }
    return undefined;
  };

  const isIdentifierStart = (char: string) => /[A-Za-z_]/.test(char);
  const isIdentifierPart = (char: string) => /[A-Za-z0-9_]/.test(char);

  let result = '';
  let i = 0;
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < clause.length) {
    const char = clause.charAt(i);
    const nextChar = clause.charAt(i + 1);

    if (inLineComment) {
      result += char;
      if (char === '\n') {
        inLineComment = false;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      result += char;
      if (char === '*' && nextChar === '/') {
        result += nextChar;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }

    if (!inSingleQuote && char === '-' && nextChar === '-') {
      result += char + nextChar;
      i += 2;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && char === '/' && nextChar === '*') {
      result += char + nextChar;
      i += 2;
      inBlockComment = true;
      continue;
    }

    if (inSingleQuote) {
      result += char;
      if (char === "'" && nextChar === "'") {
        result += nextChar;
        i += 2;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      result += char;
      i += 1;
      continue;
    }

    if (char === '"' || char === '`') {
      const quoteChar = char;
      const start = i;
      i += 1;
      let identifier = '';
      while (i < clause.length) {
        const innerChar = clause.charAt(i);
        const innerNext = clause.charAt(i + 1);
        if (innerChar === quoteChar && innerNext === quoteChar) {
          identifier += quoteChar;
          i += 2;
          continue;
        }
        if (innerChar === quoteChar) {
          i += 1;
          break;
        }
        identifier += innerChar;
        i += 1;
      }
      const token = clause.slice(start, i);
      const prevChar = findPrevNonWhitespace(start - 1);
      const nextNonWhitespace = findNextNonWhitespace(i);
      const isQualified =
        prevChar === '.' || prevChar === ':' || nextNonWhitespace === '.';
      const shouldPrefix = !isQualified && columnSet.has(identifier);

      result += shouldPrefix ? prefix + token : token;
      continue;
    }

    if (char === '[') {
      const start = i;
      i += 1;
      let identifier = '';
      while (i < clause.length) {
        const innerChar = clause.charAt(i);
        const innerNext = clause.charAt(i + 1);
        if (innerChar === ']' && innerNext === ']') {
          identifier += ']';
          i += 2;
          continue;
        }
        if (innerChar === ']') {
          i += 1;
          break;
        }
        identifier += innerChar;
        i += 1;
      }
      const token = clause.slice(start, i);
      const prevChar = findPrevNonWhitespace(start - 1);
      const nextNonWhitespace = findNextNonWhitespace(i);
      const isQualified =
        prevChar === '.' || prevChar === ':' || nextNonWhitespace === '.';
      const shouldPrefix = !isQualified && columnSet.has(identifier);

      result += shouldPrefix ? prefix + token : token;
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = i;
      i += 1;
      while (i < clause.length && isIdentifierPart(clause.charAt(i))) {
        i += 1;
      }
      const token = clause.slice(start, i);
      const prevChar = findPrevNonWhitespace(start - 1);
      const nextNonWhitespace = findNextNonWhitespace(i);
      const isQualified =
        prevChar === '.' || prevChar === ':' || nextNonWhitespace === '.';
      const isFunctionCall = nextNonWhitespace === '(';
      const shouldPrefix =
        !isQualified &&
        !isFunctionCall &&
        columnLowerSet.has(token.toLowerCase());

      result += shouldPrefix ? prefix + token : token;
      continue;
    }

    result += char;
    i += 1;
  }

  return result;
}

/**
 * Convert FilterConfig to a raw SQL WHERE clause string
 * Returns undefined if no filters are configured
 */
export function filterConfigToWhereClause(
  filter: FilterConfig | undefined,
  dbType: DbType | string,
  columnPrefix?: string,
  columnNames?: string[]
): string | undefined {
  if (!filter) {
    return undefined;
  }

  // Raw WHERE clause takes precedence (AI-generated filters)
  if (filter.rawWhereClause) {
    if (columnPrefix && columnNames?.length) {
      return qualifyRawWhereClause(
        filter.rawWhereClause,
        columnPrefix,
        columnNames
      );
    }
    return filter.rawWhereClause;
  }

  // Convert structured filter to SQL
  const type = toDbType(dbType);
  const sql = groupToSql(filter.root, type, columnPrefix);

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
