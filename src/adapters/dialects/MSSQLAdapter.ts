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
import type { ColumnDefinitionInput, IndexDefinitionInput, TriggerDefinitionInput } from '@/types/crud';
import { SqlAdapter } from '../base/SqlAdapter';
import type {
  ColumnInfo,
  TableRef,
  SelectOptions,
  RowData,
  WhereClause,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
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
    const orderBy = options?.orderBy ? [...options.orderBy] : [];
    const needsDefaultOrder =
      orderBy.length === 0 && (hasOffset || options?.limit !== undefined);
    if (needsDefaultOrder) {
      orderBy.push({
        column: this.getFallbackOrderByColumn(options),
        direction: 'ASC',
      });
    }
    const hasOrderBy = orderBy.length > 0;

    if (options?.limit !== undefined && !hasOffset) {
      sql += ` TOP ${options.limit}`;
    }

    sql += ` ${columns} FROM ${table}`;

    if (options?.rawWhere) {
      sql += ` WHERE ${options.rawWhere}`;
    } else if (options?.where && Object.keys(options.where).length > 0) {
      sql += ` WHERE ${this.buildWhereClause(options.where)}`;
    }

    if (hasOrderBy) {
      const orderClauses = orderBy
        .map((o) => {
          // Don't quote expressions (e.g., "(SELECT NULL)" used as fallback)
          const col = o.column.startsWith('(') ? o.column : this.quoteIdentifier(o.column);
          return `${col} ${o.direction}`;
        })
        .join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }

    // OFFSET/FETCH syntax requires ORDER BY in MSSQL
    if (hasOffset && hasOrderBy) {
      sql += ` OFFSET ${options!.offset} ROWS`;
      if (options?.limit !== undefined) {
        sql += ` FETCH NEXT ${options.limit} ROWS ONLY`;
      }
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
      .map((c) => this.formatValue(data[c], this.findColumnInfo(c, options?.columnInfos)))
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
  update(target: TableRef, data: RowData, where: WhereClause, options?: UpdateOptions): string {
    const table = this.formatTableRef(target);

    const setClause = Object.entries(data)
      .map(
        ([col, val]) =>
          `${this.quoteIdentifier(col)} = ${this.formatValue(val, this.findColumnInfo(col, options?.columnInfos))}`
      )
      .join(', ');

    const whereClause = this.buildWhereClause(where, options?.columnInfos);

    // MSSQL OUTPUT clause placement: UPDATE ... SET ... OUTPUT ... WHERE ...
    return `UPDATE ${table} SET ${setClause} OUTPUT INSERTED.* WHERE ${whereClause}`;
  }

  /**
   * Generate DELETE with OUTPUT clause
   */
  delete(target: TableRef, where: WhereClause, options?: DeleteOptions): string {
    const table = this.formatTableRef(target);
    const whereClause = this.buildWhereClause(where, options?.columnInfos);

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

  /**
   * MSSQL needs special handling for ORDER BY fallback since views may not have 'id' column
   * We use (SELECT NULL) as a no-op ordering for cases where no column is available
   */
  protected getFallbackOrderByColumn(options?: SelectOptions): string {
    const firstColumn = options?.columns?.[0];
    if (firstColumn && /^[A-Za-z_][A-Za-z0-9_]*$/.test(firstColumn)) {
      return firstColumn;
    }
    // Return (SELECT NULL) as fallback for MSSQL to avoid "Invalid column name 'id'" errors on views
    return "(SELECT NULL)";
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

    // Handle comment changes (MSSQL uses extended properties)
    if (changes.comment !== undefined) {
      const schema = target.schema || 'dbo';
      if (changes.comment === null || changes.comment === '') {
        // Drop existing comment
        statements.push(
          `EXEC sp_dropextendedproperty @name = N'MS_Description', @level0type = N'SCHEMA', @level0name = N'${this.escapeString(schema)}', @level1type = N'TABLE', @level1name = N'${this.escapeString(target.table)}', @level2type = N'COLUMN', @level2name = N'${this.escapeString(columnName)}'`
        );
      } else {
        // Add or update comment - try update first, then add if it doesn't exist
        statements.push(
          `IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = OBJECT_ID('${schema}.${target.table}') AND minor_id = (SELECT column_id FROM sys.columns WHERE object_id = OBJECT_ID('${schema}.${target.table}') AND name = '${this.escapeString(columnName)}') AND name = 'MS_Description') ` +
          `EXEC sp_updateextendedproperty @name = N'MS_Description', @value = ${this.quoteString(changes.comment)}, @level0type = N'SCHEMA', @level0name = N'${this.escapeString(schema)}', @level1type = N'TABLE', @level1name = N'${this.escapeString(target.table)}', @level2type = N'COLUMN', @level2name = N'${this.escapeString(columnName)}' ` +
          `ELSE EXEC sp_addextendedproperty @name = N'MS_Description', @value = ${this.quoteString(changes.comment)}, @level0type = N'SCHEMA', @level0name = N'${this.escapeString(schema)}', @level1type = N'TABLE', @level1name = N'${this.escapeString(target.table)}', @level2type = N'COLUMN', @level2name = N'${this.escapeString(columnName)}'`
        );
      }
    }

    // Handle check constraint changes
    if (changes.checkExpression !== undefined && changes.checkExpression !== null && changes.checkExpression !== '') {
      const constraintName = `CK_${target.table}_${columnName}`;
      statements.push(
        `ALTER TABLE ${table} ADD CONSTRAINT ${this.quoteIdentifier(constraintName)} CHECK (${changes.checkExpression})`
      );
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
      ? `${this.escapeString(target.schema)}.${this.escapeString(target.table)}`
      : this.escapeString(target.table);
    return `EXEC sp_rename '${fullTableName}.${this.escapeString(oldName)}', '${this.escapeString(newName)}', 'COLUMN'`;
  }

  /**
   * Duplicate table via SELECT INTO (SQL Server syntax).
   * This copies columns and optionally data, but not indexes/constraints/triggers.
   */
  duplicateTable(
    target: TableRef,
    options: {
      sourceTableName: string;
      newTableName: string;
      includeData?: boolean;
      includeIndexes?: boolean;
      includeConstraints?: boolean;
      includeTriggers?: boolean;
    }
  ): string {
    const schema = target.schema || 'dbo';
    const sourceTable =
      `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(options.sourceTableName)}`;
    const newTable =
      `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(options.newTableName)}`;

    const statements: string[] = [];
    if (options.includeData === false) {
      statements.push(`SELECT TOP 0 * INTO ${newTable} FROM ${sourceTable}`);
    } else {
      statements.push(`SELECT * INTO ${newTable} FROM ${sourceTable}`);
    }

    if (options.includeIndexes || options.includeConstraints || options.includeTriggers) {
      statements.push(
        '-- Note: SQL Server SELECT INTO does not copy indexes, constraints, or triggers'
      );
    }

    return statements.join(';\n') + ';';
  }

  // ─────────────────────────────────────────────────────────────────
  // Index DDL Operations - T-SQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MSSQL CREATE INDEX - no USING clause
   * MSSQL uses CLUSTERED/NONCLUSTERED as keywords, not USING.
   * Supports INCLUDE (covering indexes) and WHERE (filtered indexes).
   */
  createIndex(target: TableRef, definition: IndexDefinitionInput): string {
    const table = this.formatTableRef(target);
    const indexName = this.quoteIdentifier(definition.name);
    const uniqueClause = definition.unique ? "UNIQUE " : "";
    const columns = definition.columns
      .map((c) => this.quoteIdentifier(c))
      .join(", ");

    let sql = `CREATE ${uniqueClause}INDEX ${indexName} ON ${table} (${columns})`;

    if (definition.includeColumns && definition.includeColumns.length > 0) {
      const includes = definition.includeColumns
        .map((c) => this.quoteIdentifier(c))
        .join(", ");
      sql += ` INCLUDE (${includes})`;
    }

    if (definition.where) {
      sql += ` WHERE ${definition.where}`;
    }

    return sql;
  }

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
      ? `${this.escapeString(target.schema)}.${this.escapeString(target.table)}`
      : this.escapeString(target.table);
    return `EXEC sp_rename '${fullTableName}.${this.escapeString(oldName)}', '${this.escapeString(newName)}', 'INDEX'`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations - T-SQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MSSQL CREATE TRIGGER - T-SQL syntax with AS BEGIN...END
   *
   * MSSQL does not support BEFORE triggers (use INSTEAD OF).
   * MSSQL triggers are always statement-level (no FOR EACH ROW).
   */
  createTrigger(target: TableRef, definition: TriggerDefinitionInput): string {
    const table = this.formatTableRef(target);
    const schema = target.schema || 'dbo';
    const triggerName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(definition.name)}`;
    const timing = definition.timing === 'BEFORE' ? 'INSTEAD OF' : definition.timing;
    const events = definition.events.join(", ");

    let sql = `CREATE TRIGGER ${triggerName} ON ${table}`;
    sql += `\n${timing} ${events}`;
    sql += `\nAS`;
    sql += `\nBEGIN\n  ${definition.functionName};\nEND`;

    return sql;
  }

  /**
   * MSSQL DROP TRIGGER - different syntax, no ON table
   */
  dropTrigger(target: TableRef, triggerName: string, ifExists?: boolean): string {
    const schema = target.schema || 'dbo';
    const ifExistsClause = ifExists
      ? `IF EXISTS (SELECT * FROM sys.triggers WHERE name = '${this.escapeString(triggerName)}') `
      : '';
    return `${ifExistsClause}DROP TRIGGER ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(triggerName)}`;
  }

  /**
   * MSSQL uses sp_rename for trigger renaming
   */
  renameTrigger(target: TableRef, triggerName: string, newName: string): string {
    const schema = target.schema || 'dbo';
    return `EXEC sp_rename '${this.escapeString(schema)}.${this.escapeString(triggerName)}', '${this.escapeString(newName)}', 'OBJECT'`;
  }

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
    // Column order must match IntrospectionService.getTables expectations:
    // [0] schema_name, [1] table_name, [2] kind, [3] owner, [4] size, [5] row_count, [6] comment
    // Uses COLLATE DATABASE_DEFAULT to avoid collation conflicts
    // Aggregates partition rows to avoid duplicate table entries
    // Detects partitioned tables by checking if clustered index uses partition scheme
    return `
SELECT
    s.name COLLATE DATABASE_DEFAULT as schema_name,
    t.name COLLATE DATABASE_DEFAULT as table_name,
    CASE
        WHEN ps.name IS NOT NULL THEN 'partitioned'
        ELSE 'regular'
    END as kind,
    NULL as owner,
    NULL as size,
    SUM(p.rows) as row_count,
    CAST(ep.value AS NVARCHAR(MAX)) COLLATE DATABASE_DEFAULT as comment
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id < 2
LEFT JOIN sys.indexes i ON t.object_id = i.object_id AND i.index_id < 2
LEFT JOIN sys.partition_schemes ps ON i.data_space_id = ps.data_space_id
LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE s.name = '${this.escapeString(schema)}'
GROUP BY s.name, t.name, ps.name, CAST(ep.value AS NVARCHAR(MAX))
ORDER BY t.name`;
  }

  getViewsQuery(schema: string): string {
    // Column order must match IntrospectionService.getViews expectations:
    // [0] schema_name, [1] view_name, [2] owner, [3] definition, [4] is_materialized, [5] comment
    // Uses COLLATE DATABASE_DEFAULT to avoid collation conflicts
    return `
SELECT
    s.name COLLATE DATABASE_DEFAULT as schema_name,
    v.name COLLATE DATABASE_DEFAULT as view_name,
    NULL as owner,
    CAST(m.definition AS NVARCHAR(MAX)) COLLATE DATABASE_DEFAULT as definition,
    CAST(0 AS BIT) as is_materialized,
    NULL as comment
FROM sys.views v
JOIN sys.schemas s ON v.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON v.object_id = m.object_id
WHERE s.name = '${this.escapeString(schema)}'
ORDER BY v.name`;
  }

  getFunctionsQuery(schema: string): string {
    // Uses COLLATE DATABASE_DEFAULT to avoid collation conflicts
    return `
SELECT
    s.name COLLATE DATABASE_DEFAULT as schema_name,
    o.name COLLATE DATABASE_DEFAULT as function_name,
    '' as arguments,
    CASE WHEN o.type = 'P' THEN 'void' ELSE COALESCE(TYPE_NAME(c.user_type_id) COLLATE DATABASE_DEFAULT, 'void') END as return_type,
    'T-SQL' as language,
    CAST(0 as bit) as is_aggregate,
    CAST(0 as bit) as is_window,
    CAST(0 as bit) as is_trigger,
    CAST(m.definition AS NVARCHAR(MAX)) COLLATE DATABASE_DEFAULT as source,
    CASE WHEN o.type = 'P' THEN 'PROCEDURE' ELSE 'FUNCTION' END as routine_type
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
LEFT JOIN sys.parameters c ON o.object_id = c.object_id AND c.parameter_id = 0
WHERE s.name = '${this.escapeString(schema)}'
    AND o.type IN ('FN', 'IF', 'TF', 'P')
ORDER BY o.name`;
  }

  getIndexesQuery(schema: string, table: string): string {
    // Uses COLLATE DATABASE_DEFAULT to avoid collation conflicts
    return `
SELECT
    i.name COLLATE DATABASE_DEFAULT as index_name,
    t.name COLLATE DATABASE_DEFAULT as table_name,
    '[' + STRING_AGG('"' + REPLACE(c.name COLLATE DATABASE_DEFAULT, '"', '\"') + '"', ',') WITHIN GROUP (ORDER BY ic.key_ordinal) + ']' as columns,
    i.is_unique as is_unique,
    i.is_primary_key as is_primary,
    CASE WHEN i.has_filter = 1 THEN 1 ELSE 0 END as is_partial,
    'USING ' + COALESCE(i.type_desc COLLATE DATABASE_DEFAULT, 'NONCLUSTERED') + CASE WHEN i.has_filter = 1 THEN ' WHERE ' + CAST(i.filter_definition AS NVARCHAR(MAX)) COLLATE DATABASE_DEFAULT ELSE '' END as definition,
    0 as is_foreign_key
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
    AND i.name IS NOT NULL
GROUP BY i.name, t.name, i.is_unique, i.is_primary_key, i.type_desc, i.has_filter, i.filter_definition
ORDER BY i.name`;
  }


  getIndexUsageStatsQuery(schema: string, table: string): string {
    // Uses COLLATE DATABASE_DEFAULT to avoid collation conflicts
    // Column order: [0] index_name, [1] scan_count, [2] rows_read, [3] rows_returned, 
    //               [4] size_pretty, [5] size_bytes, [6] is_unused, [7] cache_hit_ratio, [8] last_used
    return `
SELECT
    i.name COLLATE DATABASE_DEFAULT as index_name,
    COALESCE(us.user_seeks + us.user_scans, 0) as scan_count,
    NULL as rows_read,
    NULL as rows_returned,
    NULL as size_pretty,
    COALESCE(SUM(ps.used_page_count), 0) * 8192 as size_bytes,
    CASE 
        WHEN COALESCE(us.user_seeks + us.user_scans, 0) = 0 THEN 1
        ELSE 0 
    END as is_unused,
    NULL as cache_hit_ratio,
    COALESCE(
        CASE
            WHEN us.last_user_scan IS NULL THEN us.last_user_seek
            WHEN us.last_user_seek IS NULL THEN us.last_user_scan
            WHEN us.last_user_seek >= us.last_user_scan THEN us.last_user_seek
            ELSE us.last_user_scan
        END,
        us.last_user_seek,
        us.last_user_scan
    ) as last_used
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.dm_db_index_usage_stats us 
    ON us.object_id = i.object_id 
    AND us.index_id = i.index_id 
    AND us.database_id = DB_ID()
LEFT JOIN sys.dm_db_partition_stats ps
    ON ps.object_id = i.object_id 
    AND ps.index_id = i.index_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
    AND i.name IS NOT NULL
GROUP BY i.name, us.user_seeks, us.user_scans, us.last_user_seek, us.last_user_scan
ORDER BY i.name`;
  }

  /**
   * Fallback query when DMV access is restricted (e.g. no VIEW DATABASE STATE permission).
   * Returns index names with neutral/default metrics.
   */
  getIndexUsageStatsFallbackQuery(schema: string, table: string): string {
    return `
SELECT
    i.name COLLATE DATABASE_DEFAULT as index_name,
    0 as scan_count,
    0 as rows_read,
    0 as rows_returned,
    NULL as size_pretty,
    NULL as size_bytes,
    0 as is_unused,
    NULL as cache_hit_ratio,
    NULL as last_used
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
    AND i.name IS NOT NULL
ORDER BY i.name`;
  }

  getConstraintsQuery(schema: string, table: string): string {
    // Query returns constraints with definition string matching the expected format:
    // [0] name, [1] table_name, [2] constraint_type, [3] definition, [4] foreign_table
    // Uses COLLATE DATABASE_DEFAULT to avoid collation conflicts when concatenating strings
    return `
WITH ForeignKeyDefs AS (
    SELECT
        fk.name COLLATE DATABASE_DEFAULT as constraint_name,
        t.name COLLATE DATABASE_DEFAULT as table_name,
        'FOREIGN KEY' as constraint_type,
        STUFF((
            SELECT ', ' + COL_NAME(fkc2.parent_object_id, fkc2.parent_column_id) COLLATE DATABASE_DEFAULT
            FROM sys.foreign_key_columns fkc2
            WHERE fkc2.constraint_object_id = fk.object_id
            ORDER BY fkc2.constraint_column_id
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') as local_columns,
        STUFF((
            SELECT ', ' + COL_NAME(fkc2.referenced_object_id, fkc2.referenced_column_id) COLLATE DATABASE_DEFAULT
            FROM sys.foreign_key_columns fkc2
            WHERE fkc2.constraint_object_id = fk.object_id
            ORDER BY fkc2.constraint_column_id
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') as ref_columns,
        SCHEMA_NAME(rt.schema_id) COLLATE DATABASE_DEFAULT as ref_schema,
        rt.name COLLATE DATABASE_DEFAULT as ref_table,
        fk.delete_referential_action_desc COLLATE DATABASE_DEFAULT as on_delete,
        fk.update_referential_action_desc COLLATE DATABASE_DEFAULT as on_update
    FROM sys.foreign_keys fk
    JOIN sys.tables t ON fk.parent_object_id = t.object_id
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
    WHERE s.name = '${this.escapeString(schema)}'
        AND t.name = '${this.escapeString(table)}'
),
PrimaryKeyDefs AS (
    SELECT
        kc.name COLLATE DATABASE_DEFAULT as constraint_name,
        t.name COLLATE DATABASE_DEFAULT as table_name,
        'PRIMARY KEY' as constraint_type,
        'PRIMARY KEY (' + STUFF((
            SELECT ', ' + c.name COLLATE DATABASE_DEFAULT
            FROM sys.index_columns ic
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
            ORDER BY ic.key_ordinal
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') + ')' as definition,
        CAST(NULL AS NVARCHAR(256)) as foreign_table
    FROM sys.key_constraints kc
    JOIN sys.tables t ON kc.parent_object_id = t.object_id
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
    WHERE s.name = '${this.escapeString(schema)}'
        AND t.name = '${this.escapeString(table)}'
        AND kc.type = 'PK'
),
UniqueKeyDefs AS (
    SELECT
        kc.name COLLATE DATABASE_DEFAULT as constraint_name,
        t.name COLLATE DATABASE_DEFAULT as table_name,
        'UNIQUE' as constraint_type,
        'UNIQUE (' + STUFF((
            SELECT ', ' + c.name COLLATE DATABASE_DEFAULT
            FROM sys.index_columns ic
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
            ORDER BY ic.key_ordinal
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') + ')' as definition,
        CAST(NULL AS NVARCHAR(256)) as foreign_table
    FROM sys.key_constraints kc
    JOIN sys.tables t ON kc.parent_object_id = t.object_id
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
    WHERE s.name = '${this.escapeString(schema)}'
        AND t.name = '${this.escapeString(table)}'
        AND kc.type = 'UQ'
),
CheckDefs AS (
    SELECT
        cc.name COLLATE DATABASE_DEFAULT as constraint_name,
        t.name COLLATE DATABASE_DEFAULT as table_name,
        'CHECK' as constraint_type,
        'CHECK ' + CAST(cc.definition AS NVARCHAR(MAX)) COLLATE DATABASE_DEFAULT as definition,
        CAST(NULL AS NVARCHAR(256)) as foreign_table
    FROM sys.check_constraints cc
    JOIN sys.tables t ON cc.parent_object_id = t.object_id
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = '${this.escapeString(schema)}'
        AND t.name = '${this.escapeString(table)}'
)
SELECT constraint_name, table_name, constraint_type, definition, foreign_table FROM PrimaryKeyDefs
UNION ALL
SELECT constraint_name, table_name, constraint_type, definition, foreign_table FROM UniqueKeyDefs
UNION ALL
SELECT
    constraint_name,
    table_name,
    constraint_type,
    'FOREIGN KEY (' + local_columns + ') REFERENCES ' + ref_schema + '.' + ref_table + ' (' + ref_columns + ')' +
        CASE WHEN on_delete <> 'NO_ACTION' THEN ' ON DELETE ' + REPLACE(on_delete, '_', ' ') ELSE '' END +
        CASE WHEN on_update <> 'NO_ACTION' THEN ' ON UPDATE ' + REPLACE(on_update, '_', ' ') ELSE '' END as definition,
    ref_schema + '.' + ref_table as foreign_table
FROM ForeignKeyDefs
UNION ALL
SELECT constraint_name, table_name, constraint_type, definition, foreign_table FROM CheckDefs
ORDER BY constraint_name`;
  }

  getColumnsQuery(schema: string, table: string): string {
    // Uses COLLATE DATABASE_DEFAULT to avoid collation conflicts
    return `
SELECT
    c.name COLLATE DATABASE_DEFAULT as column_name,
    TYPE_NAME(c.user_type_id) COLLATE DATABASE_DEFAULT + CASE
        WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'nvarchar', 'char', 'nchar')
            THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(c.max_length AS VARCHAR(20)) END + ')'
        WHEN TYPE_NAME(c.user_type_id) IN ('decimal', 'numeric')
            THEN '(' + CAST(c.precision AS VARCHAR(20)) + ',' + CAST(c.scale AS VARCHAR(20)) + ')'
        ELSE ''
    END as formatted_type,
    c.user_type_id as type_oid,
    c.is_nullable as nullable,
    CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END as is_primary_key,
    CAST(dc.definition AS NVARCHAR(MAX)) COLLATE DATABASE_DEFAULT as default_value,
    CAST(ep.value AS NVARCHAR(MAX)) COLLATE DATABASE_DEFAULT as comment,
    NULL as type_category,
    NULL as enum_values,
    c.is_computed as is_computed,
    c.is_identity as is_identity
FROM sys.columns c
JOIN sys.objects obj ON c.object_id = obj.object_id
JOIN sys.schemas s ON obj.schema_id = s.schema_id
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
LEFT JOIN (
    SELECT ic.object_id, ic.column_id
    FROM sys.index_columns ic
    JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    WHERE i.is_primary_key = 1
) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
WHERE s.name = '${this.escapeString(schema)}'
    AND obj.name = '${this.escapeString(table)}'
    AND obj.type IN ('U', 'V')
ORDER BY c.column_id`;
  }

  getTriggersQuery(schema: string, table: string): string {
    // Column order must match IntrospectionService.getTriggers expectations:
    // [0] name, [1] schema, [2] table_name, [3] timing, [4] event, [5] level,
    // [6] function, [7] enabled, [8] condition
    // Uses COLLATE DATABASE_DEFAULT to avoid collation conflicts
    return `
SELECT
    tr.name COLLATE DATABASE_DEFAULT as trigger_name,
    s.name COLLATE DATABASE_DEFAULT as schema_name,
    t.name COLLATE DATABASE_DEFAULT as table_name,
    CASE WHEN tr.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END as timing,
    STUFF((
        SELECT ',' + te.type_desc COLLATE DATABASE_DEFAULT
        FROM sys.trigger_events te
        WHERE te.object_id = tr.object_id
        FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 1, '') as events,
    'STATEMENT' as level,
    tr.name COLLATE DATABASE_DEFAULT as function_name,
    CASE WHEN tr.is_disabled = 0 THEN 1 ELSE 0 END as enabled,
    CAST(m.definition AS NVARCHAR(MAX)) COLLATE DATABASE_DEFAULT as definition
FROM sys.triggers tr
JOIN sys.tables t ON tr.parent_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON tr.object_id = m.object_id
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
ORDER BY tr.name`;
  }

  /**
   * Get partitions for a partitioned table in SQL Server
   * Returns partition info including boundary values and row counts
   */
  getPartitionsQuery(schema: string, table: string): string {
    return `
SELECT
    s.name COLLATE DATABASE_DEFAULT as schema_name,
    t.name COLLATE DATABASE_DEFAULT as table_name,
    'Partition_' + CAST(p.partition_number AS VARCHAR(10)) as partition_name,
    NULL as subpartition_name,
    p.partition_number as partition_ordinal_position,
    NULL as subpartition_ordinal_position,
    CASE pf.boundary_value_on_right
        WHEN 1 THEN 'RANGE RIGHT'
        ELSE 'RANGE LEFT'
    END as partition_method,
    NULL as subpartition_method,
    c.name COLLATE DATABASE_DEFAULT as partition_expression,
    NULL as subpartition_expression,
    CASE
        WHEN prv_left.value IS NOT NULL AND prv_right.value IS NOT NULL
            THEN CAST(prv_left.value AS NVARCHAR(100)) + ' - ' + CAST(prv_right.value AS NVARCHAR(100))
        WHEN prv_left.value IS NOT NULL
            THEN '>= ' + CAST(prv_left.value AS NVARCHAR(100))
        WHEN prv_right.value IS NOT NULL
            THEN '< ' + CAST(prv_right.value AS NVARCHAR(100))
        ELSE 'DEFAULT'
    END as partition_description,
    p.row_count as table_rows,
    NULL as avg_row_length,
    (p.used_page_count * 8 * 1024) as data_length,
    (p.reserved_page_count - p.used_page_count) * 8 * 1024 as index_length,
    NULL as partition_comment,
    pf.name COLLATE DATABASE_DEFAULT as partition_function_name
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.indexes i ON t.object_id = i.object_id AND i.index_id < 2
JOIN sys.partition_schemes ps ON i.data_space_id = ps.data_space_id
JOIN sys.partition_functions pf ON ps.function_id = pf.function_id
JOIN sys.dm_db_partition_stats p ON t.object_id = p.object_id AND i.index_id = p.index_id
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND ic.partition_ordinal > 0
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
LEFT JOIN sys.partition_range_values prv_left ON pf.function_id = prv_left.function_id
    AND prv_left.boundary_id = p.partition_number - 1
LEFT JOIN sys.partition_range_values prv_right ON pf.function_id = prv_right.function_id
    AND prv_right.boundary_id = p.partition_number
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
ORDER BY p.partition_number`;
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
    CAST(ep.value AS NVARCHAR(MAX)) as comment
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id < 2
LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE s.name = '${this.escapeString(schema)}'
    AND t.name = '${this.escapeString(table)}'
GROUP BY CAST(ep.value AS NVARCHAR(MAX))`;
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
        // Generate full CREATE TABLE DDL with columns, constraints, indexes, and partition info
        return `
WITH TableInfo AS (
    SELECT t.object_id, s.name as schema_name, t.name as table_name
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = '${this.escapeString(schema)}' AND t.name = '${this.escapeString(name)}'
),
ColumnDefs AS (
    SELECT
        c.column_id,
        QUOTENAME(c.name) + ' ' +
        CASE
            WHEN c.is_computed = 1 THEN 'AS ' + cc.definition
            ELSE
                UPPER(tp.name) +
                CASE
                    WHEN tp.name IN ('varchar', 'nvarchar', 'char', 'nchar', 'varbinary', 'binary')
                        THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(CASE WHEN tp.name LIKE 'n%' THEN c.max_length/2 ELSE c.max_length END AS VARCHAR) END + ')'
                    WHEN tp.name IN ('decimal', 'numeric')
                        THEN '(' + CAST(c.precision AS VARCHAR) + ',' + CAST(c.scale AS VARCHAR) + ')'
                    WHEN tp.name IN ('datetime2', 'datetimeoffset', 'time')
                        THEN '(' + CAST(c.scale AS VARCHAR) + ')'
                    ELSE ''
                END +
                CASE WHEN c.is_identity = 1 THEN ' IDENTITY(' + CAST(IDENT_SEED(QUOTENAME(ti.schema_name) + '.' + QUOTENAME(ti.table_name)) AS VARCHAR) + ',' + CAST(IDENT_INCR(QUOTENAME(ti.schema_name) + '.' + QUOTENAME(ti.table_name)) AS VARCHAR) + ')' ELSE '' END +
                CASE WHEN c.is_nullable = 0 THEN ' NOT NULL' ELSE ' NULL' END +
                CASE WHEN dc.definition IS NOT NULL THEN ' DEFAULT ' + dc.definition ELSE '' END
        END as column_def
    FROM TableInfo ti
    JOIN sys.columns c ON c.object_id = ti.object_id
    JOIN sys.types tp ON c.user_type_id = tp.user_type_id
    LEFT JOIN sys.computed_columns cc ON c.object_id = cc.object_id AND c.column_id = cc.column_id
    LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
),
PKConstraint AS (
    SELECT
        'CONSTRAINT ' + QUOTENAME(kc.name) + ' PRIMARY KEY ' +
        CASE WHEN i.type_desc = 'CLUSTERED' THEN 'CLUSTERED' ELSE 'NONCLUSTERED' END +
        ' (' + STUFF((
            SELECT ', ' + QUOTENAME(c.name) + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE '' END
            FROM sys.index_columns ic
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
            ORDER BY ic.key_ordinal
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') + ')' as pk_def
    FROM TableInfo ti
    JOIN sys.key_constraints kc ON kc.parent_object_id = ti.object_id AND kc.type = 'PK'
    JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
),
UniqueConstraints AS (
    SELECT
        'CONSTRAINT ' + QUOTENAME(kc.name) + ' UNIQUE ' +
        CASE WHEN i.type_desc = 'CLUSTERED' THEN 'CLUSTERED' ELSE 'NONCLUSTERED' END +
        ' (' + STUFF((
            SELECT ', ' + QUOTENAME(c.name)
            FROM sys.index_columns ic
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
            ORDER BY ic.key_ordinal
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') + ')' as uq_def
    FROM TableInfo ti
    JOIN sys.key_constraints kc ON kc.parent_object_id = ti.object_id AND kc.type = 'UQ'
    JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
),
FKConstraints AS (
    SELECT
        'CONSTRAINT ' + QUOTENAME(fk.name) + ' FOREIGN KEY (' +
        STUFF((
            SELECT ', ' + QUOTENAME(cp.name)
            FROM sys.foreign_key_columns fkc
            JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
            WHERE fkc.constraint_object_id = fk.object_id
            ORDER BY fkc.constraint_column_id
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') +
        ') REFERENCES ' + QUOTENAME(rs.name) + '.' + QUOTENAME(rt.name) + ' (' +
        STUFF((
            SELECT ', ' + QUOTENAME(cr.name)
            FROM sys.foreign_key_columns fkc
            JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
            WHERE fkc.constraint_object_id = fk.object_id
            ORDER BY fkc.constraint_column_id
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') + ')' +
        CASE fk.delete_referential_action WHEN 1 THEN ' ON DELETE CASCADE' WHEN 2 THEN ' ON DELETE SET NULL' WHEN 3 THEN ' ON DELETE SET DEFAULT' ELSE '' END +
        CASE fk.update_referential_action WHEN 1 THEN ' ON UPDATE CASCADE' WHEN 2 THEN ' ON UPDATE SET NULL' WHEN 3 THEN ' ON UPDATE SET DEFAULT' ELSE '' END as fk_def
    FROM TableInfo ti
    JOIN sys.foreign_keys fk ON fk.parent_object_id = ti.object_id
    JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
    JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
),
CheckConstraints AS (
    SELECT 'CONSTRAINT ' + QUOTENAME(cc.name) + ' CHECK ' + cc.definition as chk_def
    FROM TableInfo ti
    JOIN sys.check_constraints cc ON cc.parent_object_id = ti.object_id
),
PartitionInfo AS (
    SELECT
        ps.name as partition_scheme,
        c.name as partition_column,
        pf.name as partition_function
    FROM TableInfo ti
    JOIN sys.indexes i ON ti.object_id = i.object_id AND i.index_id < 2
    JOIN sys.partition_schemes ps ON i.data_space_id = ps.data_space_id
    JOIN sys.partition_functions pf ON ps.function_id = pf.function_id
    JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND ic.partition_ordinal > 0
    JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
)
SELECT
    'CREATE TABLE ' + QUOTENAME(ti.schema_name) + '.' + QUOTENAME(ti.table_name) + ' (' + CHAR(10) +
    '    ' + STUFF((
        SELECT ',' + CHAR(10) + '    ' + column_def
        FROM ColumnDefs
        ORDER BY column_id
        FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 6, '') +
    ISNULL((SELECT ',' + CHAR(10) + '    ' + pk_def FROM PKConstraint), '') +
    ISNULL(STUFF((SELECT ',' + CHAR(10) + '    ' + uq_def FROM UniqueConstraints FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 0, ''), '') +
    ISNULL(STUFF((SELECT ',' + CHAR(10) + '    ' + fk_def FROM FKConstraints FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 0, ''), '') +
    ISNULL(STUFF((SELECT ',' + CHAR(10) + '    ' + chk_def FROM CheckConstraints FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 0, ''), '') +
    CHAR(10) + ')' +
    ISNULL((SELECT ' ON ' + QUOTENAME(pi.partition_scheme) + '(' + QUOTENAME(pi.partition_column) + ')' FROM PartitionInfo pi), '') +
    ';' as definition
FROM TableInfo ti`;
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

  // ─────────────────────────────────────────────────────────────────
  // View DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createView(schema: string, definition: import("@/types/crud").ViewDefinitionInput): string {
    if (definition.isMaterialized) {
      throw new Error('SQL Server does not support materialized views. Use indexed views instead.');
    }
    
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(definition.name)}`;
    return `CREATE VIEW ${qualifiedName} AS\n${definition.definition}`;
  }

  dropView(
    schema: string,
    viewName: string,
    ifExists?: boolean,
    _cascade?: boolean,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('SQL Server does not support materialized views. Use indexed views instead.');
    }
    
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(viewName)}`;
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP VIEW ${ifExistsClause}${qualifiedName}`;
  }

  replaceView(
    schema: string,
    viewName: string,
    definition: string,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('SQL Server does not support materialized views. Use indexed views instead.');
    }
    
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(viewName)}`;
    return `CREATE OR ALTER VIEW ${qualifiedName} AS\n${definition}`;
  }

  renameView(
    schema: string,
    oldName: string,
    newName: string,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('SQL Server does not support materialized views. Use indexed views instead.');
    }
    
    return `EXEC sp_rename '${this.escapeString(schema)}.${this.escapeString(oldName)}', '${this.escapeString(newName)}', 'OBJECT'`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Constraint DDL Operations
  // ─────────────────────────────────────────────────────────────────

  addConstraint(
    target: import('../types').TableRef,
    definition: import("@/types/crud").ConstraintDefinitionInput
  ): string {
    const tableName = this.formatTableRef(target);
    const constraintName = this.quoteIdentifier(definition.name);
    
    let constraintDef = '';
    switch (definition.type) {
      case 'primary_key':
        if (!definition.columns?.length) {
          throw new Error('Primary key constraint requires columns');
        }
        constraintDef = `PRIMARY KEY (${definition.columns.map(c => this.quoteIdentifier(c)).join(', ')})`;
        break;
      
      case 'unique':
        if (!definition.columns?.length) {
          throw new Error('Unique constraint requires columns');
        }
        constraintDef = `UNIQUE (${definition.columns.map(c => this.quoteIdentifier(c)).join(', ')})`;
        break;
      
      case 'check':
        if (!definition.expression) {
          throw new Error('Check constraint requires expression');
        }
        constraintDef = `CHECK (${definition.expression})`;
        break;
      
      case 'exclusion':
        throw new Error('SQL Server does not support exclusion constraints');
    }
    
    return `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${constraintDef}`;
  }

  dropConstraint(
    target: import('../types').TableRef,
    constraintName: string,
    _cascade?: boolean,
    _ifExists?: boolean
  ): string {
    const tableName = this.formatTableRef(target);
    return `ALTER TABLE ${tableName} DROP CONSTRAINT ${this.quoteIdentifier(constraintName)}`;
  }

  renameConstraint(
    target: import('../types').TableRef,
    oldName: string,
    newName: string
  ): string {
    const schema = target.schema || 'dbo';
    const table = target.table;
    return `EXEC sp_rename '${this.escapeString(schema)}.${this.escapeString(table)}.${this.escapeString(oldName)}', '${this.escapeString(newName)}', 'OBJECT'`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Sequence DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createSequence(
    schema: string,
    definition: import("@/types/crud").SequenceDefinitionInput
  ): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(definition.name)}`;
    
    const parts: string[] = [`CREATE SEQUENCE ${qualifiedName}`];
    
    if (definition.startValue !== undefined) {
      parts.push(`START WITH ${definition.startValue}`);
    }
    if (definition.increment !== undefined) {
      parts.push(`INCREMENT BY ${definition.increment}`);
    }
    if (definition.minValue !== undefined) {
      parts.push(`MINVALUE ${definition.minValue}`);
    }
    if (definition.maxValue !== undefined) {
      parts.push(`MAXVALUE ${definition.maxValue}`);
    }
    if (definition.cycle !== undefined) {
      parts.push(definition.cycle ? 'CYCLE' : 'NO CYCLE');
    }
    if (definition.cache !== undefined) {
      parts.push(`CACHE ${definition.cache}`);
    }
    
    return parts.join(' ');
  }

  alterSequence(
    schema: string,
    sequenceName: string,
    changes: Partial<import("@/types/crud").SequenceDefinitionInput>
  ): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(sequenceName)}`;
    
    const parts: string[] = [];
    
    if (changes.startValue !== undefined) {
      parts.push(`RESTART WITH ${changes.startValue}`);
    }
    if (changes.increment !== undefined) {
      parts.push(`INCREMENT BY ${changes.increment}`);
    }
    if (changes.minValue !== undefined) {
      parts.push(`MINVALUE ${changes.minValue}`);
    }
    if (changes.maxValue !== undefined) {
      parts.push(`MAXVALUE ${changes.maxValue}`);
    }
    if (changes.cycle !== undefined) {
      parts.push(changes.cycle ? 'CYCLE' : 'NO CYCLE');
    }
    
    if (parts.length === 0) {
      throw new Error('No changes specified for ALTER SEQUENCE');
    }
    
    return `ALTER SEQUENCE ${qualifiedName} ${parts.join(' ')}`;
  }

  dropSequence(
    schema: string,
    sequenceName: string,
    ifExists?: boolean,
    _cascade?: boolean
  ): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(sequenceName)}`;
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP SEQUENCE ${ifExistsClause}${qualifiedName}`;
  }

  renameSequence(
    schema: string,
    oldName: string,
    newName: string
  ): string {
    return `EXEC sp_rename '${this.escapeString(schema)}.${this.escapeString(oldName)}', '${this.escapeString(newName)}', 'OBJECT'`;
  }
}
