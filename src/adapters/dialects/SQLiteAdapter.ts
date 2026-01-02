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
import type { ColumnDefinitionInput } from '@/types/crud';
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

  // ─────────────────────────────────────────────────────────────────
  // DDL Operations - SQLite has limited ALTER TABLE support
  // ─────────────────────────────────────────────────────────────────

  /**
   * SQLite ADD COLUMN - simplified (SQLite doesn't support all constraints inline)
   */
  addColumn(target: TableRef, column: ColumnDefinitionInput): string {
    const table = this.formatTableRef(target);
    const parts: string[] = [
      this.quoteIdentifier(column.name),
      column.dataType || 'TEXT',
    ];

    // SQLite ADD COLUMN has restrictions on what can be specified
    if (column.defaultValue !== undefined && column.defaultValue !== null) {
      parts.push(`DEFAULT ${this.formatValue(column.defaultValue, { name: column.name })}`);
    }

    // NOT NULL requires a default value in SQLite ADD COLUMN
    if (column.nullable === false && column.defaultValue !== undefined) {
      parts.push('NOT NULL');
    }

    return `ALTER TABLE ${table} ADD COLUMN ${parts.join(' ')}`;
  }

  /**
   * SQLite doesn't support MODIFY COLUMN - requires table recreation
   * Return a comment explaining this limitation
   */
  modifyColumn(
    _target: TableRef,
    columnName: string,
    _changes: Partial<ColumnDefinitionInput>
  ): string {
    // SQLite doesn't support modifying column definitions
    // This would require recreating the table
    return `-- SQLite does not support ALTER COLUMN for "${columnName}". Table recreation required.`;
  }

  /**
   * SQLite 3.35+ supports DROP COLUMN
   */
  dropColumn(target: TableRef, columnName: string, _cascade?: boolean): string {
    const table = this.formatTableRef(target);
    // SQLite doesn't support CASCADE
    return `ALTER TABLE ${table} DROP COLUMN ${this.quoteIdentifier(columnName)}`;
  }

  /**
   * SQLite 3.25+ supports RENAME COLUMN
   */
  renameColumn(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} RENAME COLUMN ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Index DDL Operations - SQLite syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * SQLite doesn't support RENAME INDEX - requires drop and recreate
   */
  renameIndex(_target: TableRef, oldName: string, _newName: string): string {
    return `-- SQLite does not support RENAME INDEX. Drop "${oldName}" and recreate with new name.`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations - SQLite syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * SQLite DROP TRIGGER doesn't use ON table
   */
  dropTrigger(_target: TableRef, triggerName: string, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP TRIGGER ${ifExistsClause}${this.quoteIdentifier(triggerName)}`;
  }

  /**
   * SQLite doesn't support ENABLE/DISABLE TRIGGER
   */
  renameTrigger(_target: TableRef, _triggerName: string, _newName: string): string {
    return '-- SQLite does not support RENAME TRIGGER (drop and recreate instead)';
  }

  toggleTrigger(_target: TableRef, _triggerName: string, _enable: boolean): string {
    return '-- SQLite does not support ENABLE/DISABLE TRIGGER';
  }

  // ─────────────────────────────────────────────────────────────────
  // Introspection Queries - SQLite
  // ─────────────────────────────────────────────────────────────────

  getDatabasesQuery(): string {
    // SQLite uses attached databases, show main and attached
    return `SELECT 'main' as name UNION SELECT name FROM pragma_database_list WHERE name != 'main'`;
  }

  getSchemasQuery(): string {
    // SQLite doesn't have schemas - return single 'main'
    return `SELECT 'main' as name`;
  }

  getTablesQuery(_schema: string): string {
    return `
SELECT
    'main' as schema_name,
    name as table_name,
    'regular' as kind,
    NULL as owner,
    NULL as size,
    NULL as row_count
FROM sqlite_master
WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
ORDER BY name`;
  }

  getViewsQuery(_schema: string): string {
    return `
SELECT
    'main' as schema_name,
    name as view_name,
    sql as definition
FROM sqlite_master
WHERE type = 'view'
ORDER BY name`;
  }

  getFunctionsQuery(_schema: string): string {
    // SQLite doesn't have stored functions in the same way
    return `SELECT 'Not supported' as message WHERE 0`;
  }

  getIndexesQuery(_schema: string, table: string): string {
    return `
SELECT
    name as index_name,
    '${this.escapeString(table)}' as table_name,
    \`unique\` as is_unique,
    origin = 'pk' as is_primary,
    sql as definition
FROM pragma_index_list('${this.escapeString(table)}')
ORDER BY name`;
  }

  getIndexUsageStatsQuery(_schema: string, _table: string): string {
    // SQLite doesn't track index usage stats
    return `SELECT 'Not supported' as message WHERE 0`;
  }

  getConstraintsQuery(_schema: string, table: string): string {
    return `
SELECT
    name as constraint_name,
    '${this.escapeString(table)}' as table_name,
    CASE
        WHEN pk THEN 'PRIMARY KEY'
        ELSE 'FOREIGN KEY'
    END as constraint_type
FROM pragma_table_info('${this.escapeString(table)}')
WHERE pk > 0
UNION ALL
SELECT
    'fk_' || id as constraint_name,
    '${this.escapeString(table)}' as table_name,
    'FOREIGN KEY' as constraint_type
FROM pragma_foreign_key_list('${this.escapeString(table)}')`;
  }

  getColumnsQuery(_schema: string, table: string): string {
    return `
SELECT
    name as column_name,
    type as formatted_type,
    type as data_type,
    NOT \`notnull\` as nullable,
    pk > 0 as is_primary_key,
    dflt_value as default_value,
    NULL as comment
FROM pragma_table_info('${this.escapeString(table)}')
ORDER BY cid`;
  }

  getTriggersQuery(_schema: string, table: string): string {
    return `
SELECT
    name as trigger_name,
    'main' as schema_name,
    '${this.escapeString(table)}' as table_name,
    sql as definition
FROM sqlite_master
WHERE type = 'trigger'
    AND tbl_name = '${this.escapeString(table)}'
ORDER BY name`;
  }

  getSupportedIndexTypesQuery(): string {
    return `SELECT 'BTREE' as name`;
  }

  getSupportedColumnTypesQuery(): string {
    return `
SELECT 'INTEGER' as type_name, 'numeric' as category
UNION SELECT 'TEXT', 'string'
UNION SELECT 'REAL', 'numeric'
UNION SELECT 'BLOB', 'binary'
UNION SELECT 'NULL', 'other'`;
  }

  getTableCountQuery(_schema: string, table: string, _exact?: boolean): string {
    // SQLite always does exact counts
    return `SELECT COUNT(*) as count FROM ${this.quoteIdentifier(table)}`;
  }

  getTableStatsQuery(_schema: string, table: string): string {
    return `
SELECT
    NULL as owner,
    NULL as size,
    (SELECT COUNT(*) FROM ${this.quoteIdentifier(table)}) as row_count,
    NULL as comment`;
  }

  getForeignKeyTargetsQuery(_schema: string): string {
    // Get all tables with primary keys
    return `
SELECT DISTINCT
    m.name as table_name,
    ti.name as column_name,
    ti.type as data_type
FROM sqlite_master m
CROSS JOIN pragma_table_info(m.name) ti
WHERE m.type = 'table'
    AND ti.pk > 0
    AND m.name NOT LIKE 'sqlite_%'
ORDER BY table_name, column_name`;
  }

  getObjectDefinitionQuery(
    objectType: import('../types').ObjectDefinitionType,
    _schema: string,
    name: string
  ): string {
    switch (objectType) {
      case 'table':
      case 'view':
      case 'index':
        // SQLite stores all DDL in sqlite_master
        return `SELECT sql || ';' as definition FROM sqlite_master WHERE name = '${this.escapeString(name)}'`;
      case 'sequence':
      case 'enum':
      case 'domain':
      case 'composite':
      case 'function':
      case 'procedure':
      case 'materialized_view':
        // SQLite doesn't support these object types
        return `SELECT '-- ${objectType} is not supported in SQLite' as definition`;
      default:
        return `SELECT sql || ';' as definition FROM sqlite_master WHERE name = '${this.escapeString(name)}'`;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // View DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createView(_schema: string, definition: import("@/types/crud").ViewDefinitionInput): string {
    if (definition.isMaterialized) {
      throw new Error('SQLite does not support materialized views');
    }
    
    const viewName = this.quoteIdentifier(definition.name);
    return `CREATE VIEW ${viewName} AS\n${definition.definition}`;
  }

  dropView(
    _schema: string,
    viewName: string,
    ifExists?: boolean,
    _cascade?: boolean,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('SQLite does not support materialized views');
    }
    
    const quotedName = this.quoteIdentifier(viewName);
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP VIEW ${ifExistsClause}${quotedName}`;
  }

  replaceView(
    _schema: string,
    viewName: string,
    definition: string,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('SQLite does not support materialized views');
    }
    
    // SQLite doesn't support CREATE OR REPLACE VIEW, so we drop and recreate
    const quotedName = this.quoteIdentifier(viewName);
    return `DROP VIEW IF EXISTS ${quotedName};\nCREATE VIEW ${quotedName} AS\n${definition}`;
  }

  renameView(
    _schema: string,
    oldName: string,
    newName: string,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('SQLite does not support materialized views');
    }
    
    const quotedOld = this.quoteIdentifier(oldName);
    const quotedNew = this.quoteIdentifier(newName);
    return `ALTER TABLE ${quotedOld} RENAME TO ${quotedNew}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Constraint DDL Operations
  // ─────────────────────────────────────────────────────────────────

  addConstraint(
    _target: import('../types').TableRef,
    _definition: import("@/types/crud").ConstraintDefinitionInput
  ): string {
    throw new Error('SQLite does not support ALTER TABLE ADD CONSTRAINT. Constraints must be defined when creating the table.');
  }

  dropConstraint(
    _target: import('../types').TableRef,
    _constraintName: string,
    _cascade?: boolean,
    _ifExists?: boolean
  ): string {
    throw new Error('SQLite does not support ALTER TABLE DROP CONSTRAINT. You must recreate the table without the constraint.');
  }

  renameConstraint(
    _target: import('../types').TableRef,
    _oldName: string,
    _newName: string
  ): string {
    throw new Error('SQLite does not support renaming constraints.');
  }

  // ─────────────────────────────────────────────────────────────────
  // Sequence DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createSequence(
    _schema: string,
    _definition: import("@/types/crud").SequenceDefinitionInput
  ): string {
    throw new Error('SQLite does not support sequences. Use AUTOINCREMENT instead.');
  }

  alterSequence(
    _schema: string,
    _sequenceName: string,
    _changes: Partial<import("@/types/crud").SequenceDefinitionInput>
  ): string {
    throw new Error('SQLite does not support sequences. Use AUTOINCREMENT instead.');
  }

  dropSequence(
    _schema: string,
    _sequenceName: string,
    _ifExists?: boolean,
    _cascade?: boolean
  ): string {
    throw new Error('SQLite does not support sequences. Use AUTOINCREMENT instead.');
  }

  renameSequence(
    _schema: string,
    _oldName: string,
    _newName: string
  ): string {
    throw new Error('SQLite does not support sequences. Use AUTOINCREMENT instead.');
  }
}
