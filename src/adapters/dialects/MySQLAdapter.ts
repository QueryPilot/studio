/**
 * MySQL Database Adapter
 *
 * MySQL-specific SQL generation with:
 * - Backtick identifier quoting
 * - Backslash string escaping
 * - Boolean as 1/0
 * - No RETURNING clause support
 * - DateTime format without timezone
 */

import { DbType } from '@/types/connection';
import type { ColumnDefinitionInput } from '@/types/crud';
import { SqlAdapter } from '../base/SqlAdapter';
import type { ColumnInfo, TableRef } from '../types';
import {
  quoteIdentifier as sharedQuoteIdentifier,
  escapeString as sharedEscapeString,
} from '../formatting';

export class MySQLAdapter extends SqlAdapter {
  readonly dbType = DbType.MySQL;

  /**
   * Quote identifier with backticks (MySQL standard)
   * Escapes embedded backticks by doubling them
   */
  quoteIdentifier(name: string): string {
    return sharedQuoteIdentifier(name, DbType.MySQL);
  }

  /**
   * Quote and escape a string value for MySQL
   * Uses backslash escaping which is MySQL's default behavior
   */
  quoteString(value: string): string {
    return `'${this.escapeString(value)}'`;
  }

  /**
   * Format a value for MySQL SQL statements
   * Handles type-specific formatting and escaping
   */
  formatValue(value: unknown, _column: ColumnInfo): string {
    // NULL handling
    if (value === null || value === undefined) {
      return 'NULL';
    }

    // Boolean as 1/0 (MySQL uses TINYINT for booleans)
    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    // Number validation and formatting
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number value: ${value}`);
      }
      return String(value);
    }

    // BigInt support
    if (typeof value === 'bigint') {
      return String(value);
    }

    // Date formatting without timezone (MySQL DATETIME format)
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new Error('Invalid Date value');
      }
      // Format: 'YYYY-MM-DD HH:MM:SS'
      const formatted = value.toISOString().slice(0, 19).replace('T', ' ');
      return `'${formatted}'`;
    }

    // Buffer/Uint8Array as hex literal
    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
      const hex = Array.from(value)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `X'${hex}'`;
    }

    // Object/Array as JSON string
    if (typeof value === 'object') {
      const json = JSON.stringify(value);
      return this.quoteString(json);
    }

    // Default: treat as string
    return this.quoteString(String(value));
  }

  /**
   * MySQL does not support RETURNING clause
   * Use LAST_INSERT_ID() separately after INSERT
   */
  protected supportsReturning(): boolean {
    return false;
  }

  /**
   * Escape special characters for MySQL string literals
   * Uses backslash escaping (MySQL's default sql_mode)
   */
  protected escapeString(value: string): string {
    return sharedEscapeString(value, DbType.MySQL);
  }

  // ─────────────────────────────────────────────────────────────────
  // DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL uses MODIFY COLUMN instead of ALTER COLUMN
   */
  modifyColumn(
    target: TableRef,
    columnName: string,
    changes: Partial<ColumnDefinitionInput>
  ): string {
    const table = this.formatTableRef(target);
    const colName = this.quoteIdentifier(columnName);

    // MySQL requires full column definition with MODIFY COLUMN
    // Build the complete definition from changes
    const parts: string[] = [colName];

    if (changes.dataType) {
      parts.push(changes.dataType);
    } else {
      // MySQL requires datatype - use TEXT as fallback
      parts.push('TEXT');
    }

    if (changes.nullable === false) {
      parts.push('NOT NULL');
    } else if (changes.nullable === true) {
      parts.push('NULL');
    }

    if (changes.defaultValue !== undefined) {
      if (changes.defaultValue === null) {
        parts.push('DEFAULT NULL');
      } else {
        parts.push(`DEFAULT ${this.formatValue(changes.defaultValue, { name: columnName })}`);
      }
    }

    return `ALTER TABLE ${table} MODIFY COLUMN ${parts.join(' ')}`;
  }

  /**
   * MySQL uses CHANGE COLUMN for rename
   */
  renameColumn(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    // MySQL CHANGE requires full column definition - simplified version
    // In practice, you'd need to query the current column definition first
    return `ALTER TABLE ${table} RENAME COLUMN ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Index DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL DROP INDEX requires ON table
   */
  dropIndex(target: TableRef, indexName: string, ifExists?: boolean): string {
    const table = this.formatTableRef(target);
    // MySQL 8.0.29+ supports IF EXISTS, older versions don't
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP INDEX ${ifExistsClause}${this.quoteIdentifier(indexName)} ON ${table}`;
  }

  /**
   * MySQL uses ALTER TABLE ... RENAME INDEX
   */
  renameIndex(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} RENAME INDEX ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL DROP TRIGGER doesn't use ON table
   */
  dropTrigger(_target: TableRef, triggerName: string, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    return `DROP TRIGGER ${ifExistsClause}${this.quoteIdentifier(triggerName)}`;
  }

  /**
   * MySQL doesn't support ENABLE/DISABLE TRIGGER
   * Returns empty string (no-op)
   */
  renameTrigger(_target: TableRef, _triggerName: string, _newName: string): string {
    // MySQL doesn't support ALTER TRIGGER RENAME - must drop and recreate
    return '-- MySQL does not support RENAME TRIGGER (drop and recreate instead)';
  }

  toggleTrigger(_target: TableRef, _triggerName: string, _enable: boolean): string {
    // MySQL doesn't have enable/disable trigger - must drop and recreate
    return '-- MySQL does not support ENABLE/DISABLE TRIGGER';
  }

  // ─────────────────────────────────────────────────────────────────
  // Introspection Queries - MySQL
  // ─────────────────────────────────────────────────────────────────

  getDatabasesQuery(): string {
    return `SHOW DATABASES`;
  }

  getSchemasQuery(): string {
    // MySQL uses databases instead of schemas
    // Return the current database as the "schema" so UI can load tables
    // If no database is selected, return empty result (connection should always have a database)
    return `SELECT DATABASE() as name WHERE DATABASE() IS NOT NULL`;
  }

  getTablesQuery(schema: string): string {
    return `
SELECT
    TABLE_SCHEMA as schema_name,
    TABLE_NAME as table_name,
    TABLE_TYPE as kind,
    ENGINE as engine,
    TABLE_ROWS as row_count,
    TABLE_COMMENT as comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME`;
  }

  getViewsQuery(schema: string): string {
    return `
SELECT
    TABLE_SCHEMA as schema_name,
    TABLE_NAME as view_name,
    VIEW_DEFINITION as definition,
    IS_UPDATABLE as is_updatable
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
ORDER BY TABLE_NAME`;
  }

  getFunctionsQuery(schema: string): string {
    return `
SELECT
    ROUTINE_SCHEMA as schema_name,
    ROUTINE_NAME as function_name,
    '' as arguments,
    CASE WHEN ROUTINE_TYPE = 'PROCEDURE' THEN 'void' ELSE COALESCE(DATA_TYPE, 'void') END as return_type,
    'SQL' as language,
    false as is_aggregate,
    false as is_window,
    false as is_trigger,
    ROUTINE_DEFINITION as source
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = '${this.escapeString(schema)}'
ORDER BY ROUTINE_NAME`;
  }

  getIndexesQuery(schema: string, table: string): string {
    return `
SELECT
    INDEX_NAME as index_name,
    TABLE_NAME as table_name,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns,
    NOT NON_UNIQUE as is_unique,
    INDEX_NAME = 'PRIMARY' as is_primary,
    INDEX_TYPE as index_type
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_NAME = '${this.escapeString(table)}'
GROUP BY INDEX_NAME, TABLE_NAME, NON_UNIQUE, INDEX_TYPE
ORDER BY INDEX_NAME`;
  }

  getIndexUsageStatsQuery(_schema: string, _table: string): string {
    // MySQL doesn't have built-in index usage stats in the same way as PostgreSQL
    return `SELECT 'Not supported' as message`;
  }

  getConstraintsQuery(schema: string, table: string): string {
    // MySQL stores foreign key info in KEY_COLUMN_USAGE, not TABLE_CONSTRAINTS
    return `
SELECT DISTINCT
    tc.CONSTRAINT_NAME as constraint_name,
    tc.TABLE_NAME as table_name,
    tc.CONSTRAINT_TYPE as constraint_type,
    kcu.REFERENCED_TABLE_SCHEMA as foreign_schema,
    kcu.REFERENCED_TABLE_NAME as foreign_table
FROM information_schema.TABLE_CONSTRAINTS tc
LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
    AND tc.TABLE_NAME = kcu.TABLE_NAME
WHERE tc.TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND tc.TABLE_NAME = '${this.escapeString(table)}'
ORDER BY tc.CONSTRAINT_NAME`;
  }

  getColumnsQuery(schema: string, table: string): string {
    return `
SELECT
    COLUMN_NAME as column_name,
    COLUMN_TYPE as formatted_type,
    DATA_TYPE as data_type,
    IS_NULLABLE = 'YES' as nullable,
    COLUMN_KEY = 'PRI' as is_primary_key,
    COLUMN_DEFAULT as default_value,
    COLUMN_COMMENT as comment,
    CHARACTER_MAXIMUM_LENGTH as char_length,
    NUMERIC_PRECISION as numeric_precision,
    NUMERIC_SCALE as numeric_scale
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_NAME = '${this.escapeString(table)}'
ORDER BY ORDINAL_POSITION`;
  }

  getTriggersQuery(schema: string, table: string): string {
    return `
SELECT
    TRIGGER_NAME as trigger_name,
    TRIGGER_SCHEMA as schema_name,
    EVENT_OBJECT_TABLE as table_name,
    ACTION_TIMING as timing,
    EVENT_MANIPULATION as event,
    ACTION_STATEMENT as definition
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = '${this.escapeString(schema)}'
    AND EVENT_OBJECT_TABLE = '${this.escapeString(table)}'
ORDER BY TRIGGER_NAME`;
  }

  getSupportedIndexTypesQuery(): string {
    return `SELECT 'BTREE' as name UNION SELECT 'HASH' UNION SELECT 'FULLTEXT' UNION SELECT 'SPATIAL'`;
  }

  getSupportedColumnTypesQuery(): string {
    return `
SELECT DISTINCT DATA_TYPE as type_name, 'mysql' as category
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
ORDER BY DATA_TYPE`;
  }

  getTableCountQuery(schema: string, table: string, exact?: boolean): string {
    if (exact) {
      return `SELECT COUNT(*) as count FROM ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
    }
    return `
SELECT TABLE_ROWS as count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_NAME = '${this.escapeString(table)}'`;
  }

  getTableStatsQuery(schema: string, table: string): string {
    return `
SELECT
    NULL as owner,
    CONCAT(ROUND(DATA_LENGTH / 1024 / 1024, 2), ' MB') as size,
    TABLE_ROWS as row_count,
    TABLE_COMMENT as comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_NAME = '${this.escapeString(table)}'`;
  }

  getForeignKeyTargetsQuery(schema: string): string {
    return `
SELECT DISTINCT
    TABLE_NAME as table_name,
    COLUMN_NAME as column_name,
    DATA_TYPE as data_type
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND CONSTRAINT_NAME IN (
        SELECT CONSTRAINT_NAME
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
            AND CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
    )
ORDER BY TABLE_NAME, COLUMN_NAME`;
  }

  getObjectDefinitionQuery(
    objectType: import('../types').ObjectDefinitionType,
    schema: string,
    name: string
  ): string {
    switch (objectType) {
      case 'view':
        return `SHOW CREATE VIEW ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;
      case 'function':
        return `SHOW CREATE FUNCTION ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;
      case 'procedure':
        return `SHOW CREATE PROCEDURE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;
      case 'index':
        // MySQL doesn't have CREATE INDEX syntax retrieval, construct from SHOW INDEX
        return `
SELECT CONCAT(
    'CREATE ',
    CASE WHEN Non_unique = 0 THEN 'UNIQUE ' ELSE '' END,
    'INDEX ',
    Index_name,
    ' ON ',
    Table_name,
    ' (',
    GROUP_CONCAT(Column_name ORDER BY Seq_in_index),
    ')',
    CASE WHEN Index_type != 'BTREE' THEN CONCAT(' USING ', Index_type) ELSE '' END,
    ';'
) as definition
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND Index_name = '${this.escapeString(name)}'
GROUP BY Index_name, Non_unique, Table_name, Index_type`;
      case 'sequence':
      case 'enum':
      case 'domain':
      case 'composite':
        // MySQL doesn't support these object types
        return `SELECT '-- ${objectType} is not supported in MySQL' as definition`;
      case 'table':
      case 'materialized_view':
      default:
        return `SHOW CREATE TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // View DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createView(schema: string, definition: import("@/types/crud").ViewDefinitionInput): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(definition.name)}`;
    
    if (definition.isMaterialized) {
      throw new Error('MySQL does not support materialized views');
    }
    
    return `CREATE VIEW ${qualifiedName} AS\n${definition.definition}`;
  }

  dropView(
    schema: string,
    viewName: string,
    ifExists?: boolean,
    cascade?: boolean,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('MySQL does not support materialized views');
    }
    
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(viewName)}`;
    const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
    
    if (cascade) {
      throw new Error('MySQL does not support CASCADE option for DROP VIEW');
    }
    
    return `DROP VIEW ${ifExistsClause}${qualifiedName}`;
  }

  replaceView(
    schema: string,
    viewName: string,
    definition: string,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('MySQL does not support materialized views');
    }
    
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(viewName)}`;
    return `CREATE OR REPLACE VIEW ${qualifiedName} AS\n${definition}`;
  }

  renameView(
    schema: string,
    oldName: string,
    newName: string,
    isMaterialized?: boolean
  ): string {
    if (isMaterialized) {
      throw new Error('MySQL does not support materialized views');
    }
    
    const qualifiedOldName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(oldName)}`;
    const qualifiedNewName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(newName)}`;
    return `RENAME TABLE ${qualifiedOldName} TO ${qualifiedNewName}`;
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
        constraintDef = `UNIQUE KEY (${definition.columns.map(c => this.quoteIdentifier(c)).join(', ')})`;
        break;
      
      case 'check':
        if (!definition.expression) {
          throw new Error('Check constraint requires expression');
        }
        // MySQL 8.0.16+ supports CHECK constraints
        constraintDef = `CHECK (${definition.expression})`;
        break;
      
      case 'exclusion':
        throw new Error('MySQL does not support exclusion constraints');
    }
    
    return `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${constraintDef}`;
  }

  dropConstraint(
    target: import('../types').TableRef,
    constraintName: string,
    cascade?: boolean,
    _ifExists?: boolean
  ): string {
    if (cascade) {
      throw new Error('MySQL does not support CASCADE option for DROP CONSTRAINT');
    }
    
    const tableName = this.formatTableRef(target);
    // MySQL uses DROP CHECK, DROP PRIMARY KEY, DROP FOREIGN KEY depending on type
    // For generic drop, we'll use DROP CHECK which works for CHECK constraints
    return `ALTER TABLE ${tableName} DROP CHECK ${this.quoteIdentifier(constraintName)}`;
  }

  renameConstraint(
    target: import('../types').TableRef,
    oldName: string,
    newName: string
  ): string {
    const tableName = this.formatTableRef(target);
    return `ALTER TABLE ${tableName} RENAME CONSTRAINT ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Sequence DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createSequence(
    _schema: string,
    _definition: import("@/types/crud").SequenceDefinitionInput
  ): string {
    throw new Error('MySQL does not support sequences. Use AUTO_INCREMENT instead.');
  }

  alterSequence(
    _schema: string,
    _sequenceName: string,
    _changes: Partial<import("@/types/crud").SequenceDefinitionInput>
  ): string {
    throw new Error('MySQL does not support sequences. Use AUTO_INCREMENT instead.');
  }

  dropSequence(
    _schema: string,
    _sequenceName: string,
    _ifExists?: boolean,
    _cascade?: boolean
  ): string {
    throw new Error('MySQL does not support sequences. Use AUTO_INCREMENT instead.');
  }

  renameSequence(
    _schema: string,
    _oldName: string,
    _newName: string
  ): string {
    throw new Error('MySQL does not support sequences. Use AUTO_INCREMENT instead.');
  }
}
