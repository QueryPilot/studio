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
}
