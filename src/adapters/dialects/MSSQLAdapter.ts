/**
 * Microsoft SQL Server Database Adapter
 *
 * MSSQL-specific SQL generation with:
 * - Square bracket identifiers: [column_name]
 * - TOP instead of LIMIT: SELECT TOP 10 * FROM table
 * - OUTPUT clause instead of RETURNING
 * - N-prefix for Unicode strings: N'value'
 * - Booleans as 1/0
 * - BEGIN TRANSACTION / COMMIT TRANSACTION syntax
 */

import { DbType } from '@/types/connection';
import type { ColumnDefinitionInput } from '@/types/crud';
import { SqlAdapter } from '../base/SqlAdapter';
import type {
  ColumnInfo,
  TableRef,
  SelectOptions,
  RowData,
  WhereClause,
  InsertOptions,
} from '../types';
import {
  quoteIdentifier as sharedQuoteIdentifier,
  quoteString as sharedQuoteString,
} from '../formatting';

export class MSSQLAdapter extends SqlAdapter {
  readonly dbType = DbType.SQLServer;

  /**
   * Quote identifier using square brackets (T-SQL standard)
   * Escapes embedded ] by doubling them
   */
  quoteIdentifier(name: string): string {
    return sharedQuoteIdentifier(name, DbType.SQLServer);
  }

  /**
   * Quote string with N prefix for Unicode support
   * Escapes single quotes by doubling them
   */
  quoteString(value: string): string {
    return sharedQuoteString(value, DbType.SQLServer);
  }

  /**
   * Format value for MSSQL
   * - NULL for null/undefined
   * - 1/0 for booleans
   * - Numbers as-is (with validation)
   * - Dates as ISO strings
   * - Objects as JSON strings with N prefix
   * - Strings with N prefix for Unicode
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
      // MSSQL datetime format
      return `'${value.toISOString()}'`;
    }

    // Handle Buffer/Uint8Array as hex binary
    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `0x${hex}`;
    }

    if (typeof value === 'object') {
      // JSON values as NVARCHAR strings
      return this.quoteString(JSON.stringify(value));
    }

    return this.quoteString(String(value));
  }

  /**
   * Format table reference with schema
   * MSSQL uses [schema].[table] format
   */
  protected formatTableRef(target: TableRef): string {
    if (target.schema) {
      return `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(target.table)}`;
    }
    return this.quoteIdentifier(target.table);
  }

  /**
   * MSSQL uses OUTPUT instead of RETURNING
   */
  protected supportsReturning(): boolean {
    return false;
  }

  /**
   * Override SELECT to use TOP instead of LIMIT
   * MSSQL uses TOP N for limiting results
   * OFFSET/FETCH requires ORDER BY clause
   */
  select(target: TableRef, options?: SelectOptions): string {
    const table = this.formatTableRef(target);
    const columns =
      options?.columns?.map((c) => this.quoteIdentifier(c)).join(', ') || '*';

    let sql = 'SELECT';

    // Use TOP for simple limit without offset
    // When offset is needed, we use OFFSET/FETCH which requires ORDER BY
    const hasOffset = options?.offset !== undefined && options.offset > 0;
    const hasOrderBy = options?.orderBy && options.orderBy.length > 0;

    if (options?.limit !== undefined && !hasOffset) {
      sql += ` TOP ${options.limit}`;
    }

    sql += ` ${columns} FROM ${table}`;

    if (options?.where && Object.keys(options.where).length > 0) {
      sql += ` WHERE ${this.buildWhereClause(options.where)}`;
    }

    if (hasOrderBy) {
      const orderClauses = options!.orderBy!
        .map((o) => `${this.quoteIdentifier(o.column)} ${o.direction}`)
        .join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }

    // OFFSET/FETCH syntax requires ORDER BY in MSSQL
    if (hasOffset && hasOrderBy) {
      sql += ` OFFSET ${options!.offset} ROWS`;
      if (options?.limit !== undefined) {
        sql += ` FETCH NEXT ${options.limit} ROWS ONLY`;
      }
    } else if (hasOffset && !hasOrderBy) {
      // MSSQL requires ORDER BY for OFFSET, add a default if not provided
      // This is a fallback - callers should provide ORDER BY with OFFSET
      throw new Error('MSSQL requires ORDER BY clause when using OFFSET');
    }

    return sql;
  }

  /**
   * Generate INSERT with OUTPUT clause for returning inserted rows
   */
  insert(target: TableRef, data: RowData, options?: InsertOptions): string {
    const table = this.formatTableRef(target);
    const columns = Object.keys(data);

    if (columns.length === 0) {
      // MSSQL uses DEFAULT VALUES for empty insert
      let sql = `INSERT INTO ${table}`;
      if (options?.returning) {
        sql += ` OUTPUT INSERTED.*`;
      }
      sql += ` DEFAULT VALUES`;
      return sql;
    }

    const columnList = columns.map((c) => this.quoteIdentifier(c)).join(', ');
    const valueList = columns
      .map((c) => this.formatValue(data[c], { name: c }))
      .join(', ');

    let sql = `INSERT INTO ${table} (${columnList})`;

    if (options?.returning) {
      sql += ` OUTPUT INSERTED.*`;
    }

    sql += ` VALUES (${valueList})`;

    return sql;
  }

  /**
   * Generate UPDATE with OUTPUT clause
   * OUTPUT clause goes between SET and WHERE in MSSQL
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

    // MSSQL OUTPUT clause placement: UPDATE ... SET ... OUTPUT ... WHERE ...
    return `UPDATE ${table} SET ${setClause} OUTPUT INSERTED.* WHERE ${whereClause}`;
  }

  /**
   * Generate DELETE with OUTPUT clause
   */
  delete(target: TableRef, where: WhereClause): string {
    const table = this.formatTableRef(target);
    const whereClause = this.buildWhereClause(where);

    // MSSQL OUTPUT clause placement: DELETE FROM ... OUTPUT ... WHERE ...
    return `DELETE FROM ${table} OUTPUT DELETED.* WHERE ${whereClause}`;
  }

  /**
   * MSSQL uses BEGIN TRANSACTION / COMMIT TRANSACTION
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

    return `BEGIN TRANSACTION;\n${statements.join(';\n')};\nCOMMIT TRANSACTION;`;
  }

  /**
   * MSSQL uses TOP, not LIMIT - this is handled in select() override
   */
  protected formatLimit(_limit: number, _offset?: number): string {
    // Not used - handled in select() override
    return '';
  }

  // ─────────────────────────────────────────────────────────────────
  // DDL Operations - T-SQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MSSQL ADD - doesn't use COLUMN keyword
   */
  addColumn(target: TableRef, column: ColumnDefinitionInput): string {
    const table = this.formatTableRef(target);
    const parts: string[] = [
      this.quoteIdentifier(column.name),
      column.dataType || 'NVARCHAR(MAX)',
    ];

    if (column.nullable === false) {
      parts.push('NOT NULL');
    } else {
      parts.push('NULL');
    }

    if (column.defaultValue !== undefined && column.defaultValue !== null) {
      parts.push(`DEFAULT ${this.formatValue(column.defaultValue, { name: column.name })}`);
    }

    return `ALTER TABLE ${table} ADD ${parts.join(' ')}`;
  }

  /**
   * MSSQL ALTER COLUMN syntax
   */
  modifyColumn(
    target: TableRef,
    columnName: string,
    changes: Partial<ColumnDefinitionInput>
  ): string {
    const table = this.formatTableRef(target);
    const colName = this.quoteIdentifier(columnName);
    const statements: string[] = [];

    // MSSQL ALTER COLUMN requires full type specification
    if (changes.dataType) {
      let alterStmt = `ALTER TABLE ${table} ALTER COLUMN ${colName} ${changes.dataType}`;
      if (changes.nullable !== undefined) {
        alterStmt += changes.nullable ? ' NULL' : ' NOT NULL';
      }
      statements.push(alterStmt);
    } else if (changes.nullable !== undefined) {
      // Need to specify type even when just changing nullability
      // This is a limitation - in practice, you'd need to query the current type
      statements.push(
        `-- ALTER COLUMN for nullability requires datatype: ALTER TABLE ${table} ALTER COLUMN ${colName} <datatype> ${changes.nullable ? 'NULL' : 'NOT NULL'}`
      );
    }

    // Default constraint requires ADD/DROP CONSTRAINT in MSSQL
    if (changes.defaultValue !== undefined) {
      if (changes.defaultValue === null) {
        // Need constraint name to drop - this is a placeholder
        statements.push(
          `-- DROP DEFAULT requires constraint name: ALTER TABLE ${table} DROP CONSTRAINT DF_${columnName}`
        );
      } else {
        statements.push(
          `ALTER TABLE ${table} ADD DEFAULT ${this.formatValue(changes.defaultValue, { name: columnName })} FOR ${colName}`
        );
      }
    }

    return statements.join(';\n');
  }

  /**
   * MSSQL DROP COLUMN
   */
  dropColumn(target: TableRef, columnName: string, _cascade?: boolean): string {
    const table = this.formatTableRef(target);
    // MSSQL doesn't support CASCADE - constraints must be dropped first
    return `ALTER TABLE ${table} DROP COLUMN ${this.quoteIdentifier(columnName)}`;
  }

  /**
   * MSSQL uses sp_rename for column renaming
   */
  renameColumn(target: TableRef, oldName: string, newName: string): string {
    const fullTableName = target.schema
      ? `${target.schema}.${target.table}`
      : target.table;
    // sp_rename syntax: sp_rename 'table.old_column', 'new_column', 'COLUMN'
    return `EXEC sp_rename '${fullTableName}.${oldName}', '${newName}', 'COLUMN'`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Index DDL Operations - T-SQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MSSQL DROP INDEX uses ON table syntax
   */
  dropIndex(target: TableRef, indexName: string, _ifExists?: boolean): string {
    const table = this.formatTableRef(target);
    // MSSQL: DROP INDEX index_name ON table
    // Note: IF EXISTS requires SQL Server 2016+
    return `DROP INDEX ${this.quoteIdentifier(indexName)} ON ${table}`;
  }

  /**
   * MSSQL uses sp_rename for index renaming
   */
  renameIndex(target: TableRef, oldName: string, newName: string): string {
    const fullTableName = target.schema
      ? `${target.schema}.${target.table}`
      : target.table;
    // sp_rename syntax: sp_rename 'table.old_index', 'new_index', 'INDEX'
    return `EXEC sp_rename '${fullTableName}.${oldName}', '${newName}', 'INDEX'`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations - T-SQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MSSQL DROP TRIGGER - different syntax, no ON table
   */
  dropTrigger(target: TableRef, triggerName: string, ifExists?: boolean): string {
    const schema = target.schema || 'dbo';
    const ifExistsClause = ifExists
      ? `IF EXISTS (SELECT * FROM sys.triggers WHERE name = '${triggerName}') `
      : '';
    return `${ifExistsClause}DROP TRIGGER ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(triggerName)}`;
  }

  /**
   * MSSQL uses ENABLE/DISABLE TRIGGER syntax (different from PostgreSQL)
   */
  toggleTrigger(target: TableRef, triggerName: string, enable: boolean): string {
    const table = this.formatTableRef(target);
    const action = enable ? 'ENABLE' : 'DISABLE';
    return `${action} TRIGGER ${this.quoteIdentifier(triggerName)} ON ${table}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Introspection Queries - T-SQL
  // ─────────────────────────────────────────────────────────────────

  getDatabasesQuery(): string {
    return `SELECT name FROM sys.databases WHERE state = 0 ORDER BY name`;
  }

  getSchemasQuery(): string {
    return `SELECT name FROM sys.schemas WHERE principal_id = 1 ORDER BY name`;
  }

  getTablesQuery(schema: string): string {
    return `
SELECT
    s.name as schema_name,
    t.name as table_name,
    'regular' as kind,
    NULL as owner,
    NULL as size,
    p.rows as row_count
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id < 2
WHERE s.name = '${this.escapeString(schema)}'
ORDER BY t.name`;
  }

  getViewsQuery(schema: string): string {
    return `
SELECT
    s.name as schema_name,
    v.name as view_name,
    m.definition as definition
FROM sys.views v
JOIN sys.schemas s ON v.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON v.object_id = m.object_id
WHERE s.name = '${this.escapeString(schema)}'
ORDER BY v.name`;
  }

  getFunctionsQuery(schema: string): string {
    return `
SELECT
    s.name as schema_name,
    o.name as function_name,
    o.type_desc as type,
    m.definition as source
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
WHERE s.name = '${this.escapeString(schema)}'
    AND o.type IN ('FN', 'IF', 'TF', 'P')
ORDER BY o.name`;
  }

  getIndexesQuery(schema: string, table: string): string {
    return `
SELECT
    i.name as index_name,
    t.name as table_name,
    STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) as columns,
    i.is_unique as is_unique,
    i.is_primary_key as is_primary,
    i.type_desc as index_type
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
    AND i.name IS NOT NULL
GROUP BY i.name, t.name, i.is_unique, i.is_primary_key, i.type_desc
ORDER BY i.name`;
  }

  getIndexUsageStatsQuery(schema: string, table: string): string {
    return `
SELECT
    i.name as index_name,
    us.user_seeks as seek_count,
    us.user_scans as scan_count,
    us.user_lookups as lookup_count,
    us.user_updates as update_count,
    us.last_user_seek as last_seek,
    us.last_user_scan as last_scan
FROM sys.dm_db_index_usage_stats us
JOIN sys.indexes i ON us.object_id = i.object_id AND us.index_id = i.index_id
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
    AND us.database_id = DB_ID()
ORDER BY i.name`;
  }

  getConstraintsQuery(schema: string, table: string): string {
    return `
SELECT
    c.name as constraint_name,
    t.name as table_name,
    c.type_desc as constraint_type,
    OBJECT_NAME(fk.referenced_object_id) as foreign_table
FROM sys.objects c
JOIN sys.tables t ON c.parent_object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.foreign_keys fk ON c.object_id = fk.object_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
    AND c.type IN ('PK', 'UQ', 'F', 'C')
ORDER BY c.name`;
  }

  getColumnsQuery(schema: string, table: string): string {
    return `
SELECT
    c.name as column_name,
    TYPE_NAME(c.user_type_id) + CASE
        WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'nvarchar', 'char', 'nchar')
            THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(c.max_length AS VARCHAR) END + ')'
        WHEN TYPE_NAME(c.user_type_id) IN ('decimal', 'numeric')
            THEN '(' + CAST(c.precision AS VARCHAR) + ',' + CAST(c.scale AS VARCHAR) + ')'
        ELSE ''
    END as formatted_type,
    TYPE_NAME(c.user_type_id) as data_type,
    c.is_nullable as nullable,
    CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END as is_primary_key,
    dc.definition as default_value,
    ep.value as comment
FROM sys.columns c
JOIN sys.tables t ON c.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
LEFT JOIN (
    SELECT ic.object_id, ic.column_id
    FROM sys.index_columns ic
    JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    WHERE i.is_primary_key = 1
) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
ORDER BY c.column_id`;
  }

  getTriggersQuery(schema: string, table: string): string {
    return `
SELECT
    tr.name as trigger_name,
    s.name as schema_name,
    t.name as table_name,
    tr.is_disabled,
    m.definition as definition
FROM sys.triggers tr
JOIN sys.tables t ON tr.parent_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON tr.object_id = m.object_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
ORDER BY tr.name`;
  }

  getSupportedIndexTypesQuery(): string {
    return `SELECT 'CLUSTERED' as name UNION SELECT 'NONCLUSTERED' UNION SELECT 'UNIQUE' UNION SELECT 'COLUMNSTORE'`;
  }

  getSupportedColumnTypesQuery(): string {
    return `
SELECT name as type_name, 'mssql' as category
FROM sys.types
WHERE is_user_defined = 0
ORDER BY name`;
  }

  getTableCountQuery(schema: string, table: string, exact?: boolean): string {
    if (exact) {
      return `SELECT COUNT(*) as count FROM ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
    }
    return `
SELECT SUM(p.rows) as count
FROM sys.partitions p
JOIN sys.tables t ON p.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
    AND p.index_id < 2`;
  }

  getTableStatsQuery(schema: string, table: string): string {
    return `
SELECT
    NULL as owner,
    NULL as size,
    SUM(p.rows) as row_count,
    ep.value as comment
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id < 2
LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
GROUP BY ep.value`;
  }

  getForeignKeyTargetsQuery(schema: string): string {
    return `
SELECT DISTINCT
    t.name as table_name,
    c.name as column_name,
    TYPE_NAME(c.user_type_id) as data_type
FROM sys.index_columns ic
JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE s.name = '${this.escapeString(schema)}'
    AND (i.is_primary_key = 1 OR i.is_unique = 1)
ORDER BY table_name, column_name`;
  }

  getObjectDefinitionQuery(
    objectType: import('../types').ObjectDefinitionType,
    schema: string,
    name: string
  ): string {
    switch (objectType) {
      case 'table':
        // MSSQL doesn't have a simple way to get CREATE TABLE - need to construct it
        return `
SELECT 'CREATE TABLE ' + QUOTENAME(s.name) + '.' + QUOTENAME(t.name) as definition
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(name)}'`;
      case 'sequence':
        return `
SELECT
    'CREATE SEQUENCE ' + QUOTENAME(s.name) + '.' + QUOTENAME(seq.name) +
    ' AS ' + t.name +
    ' START WITH ' + CAST(seq.start_value AS VARCHAR) +
    ' INCREMENT BY ' + CAST(seq.increment AS VARCHAR) +
    ' MINVALUE ' + CAST(seq.minimum_value AS VARCHAR) +
    ' MAXVALUE ' + CAST(seq.maximum_value AS VARCHAR) +
    CASE WHEN seq.is_cycling = 1 THEN ' CYCLE' ELSE ' NO CYCLE' END +
    CASE WHEN seq.cache_size IS NOT NULL THEN ' CACHE ' + CAST(seq.cache_size AS VARCHAR) ELSE '' END +
    ';' as definition
FROM sys.sequences seq
JOIN sys.schemas s ON seq.schema_id = s.schema_id
JOIN sys.types t ON seq.user_type_id = t.user_type_id
WHERE s.name = '${this.escapeString(schema)}'
    AND seq.name = '${this.escapeString(name)}'`;
      case 'index':
        return `
SELECT
    'CREATE ' +
    CASE WHEN i.is_unique = 1 THEN 'UNIQUE ' ELSE '' END +
    CASE WHEN i.type_desc = 'CLUSTERED' THEN 'CLUSTERED ' ELSE 'NONCLUSTERED ' END +
    'INDEX ' + QUOTENAME(i.name) +
    ' ON ' + QUOTENAME(s.name) + '.' + QUOTENAME(t.name) + ' (' +
    STUFF((
        SELECT ', ' + QUOTENAME(c.name) + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END
        FROM sys.index_columns ic
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal
        FOR XML PATH('')
    ), 1, 2, '') +
    ')' +
    CASE WHEN EXISTS (
        SELECT 1 FROM sys.index_columns ic WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
    ) THEN ' INCLUDE (' + STUFF((
        SELECT ', ' + QUOTENAME(c.name)
        FROM sys.index_columns ic
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
        ORDER BY ic.key_ordinal
        FOR XML PATH('')
    ), 1, 2, '') + ')' ELSE '' END +
    CASE WHEN i.has_filter = 1 THEN ' WHERE ' + i.filter_definition ELSE '' END +
    ';' as definition
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
    AND i.name = '${this.escapeString(name)}'`;
      case 'enum':
      case 'domain':
      case 'composite':
        // MSSQL doesn't support these PostgreSQL-specific types
        return `SELECT '-- ${objectType} is not supported in SQL Server' as definition`;
      case 'view':
      case 'materialized_view':
      case 'function':
      case 'procedure':
      default:
        // For views, functions, procedures - use sys.sql_modules
        return `
SELECT m.definition
FROM sys.sql_modules m
JOIN sys.objects o ON m.object_id = o.object_id
JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
    AND o.name = '${this.escapeString(name)}'`;
    }
  }
}
