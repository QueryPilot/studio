/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/**
 * MySQL Database Adapter
 *
 * MySQL-specific SQL generation with:
 * - Backtick identifier quoting
 * - Standard SQL string escaping ('' doubling, safe with NO_BACKSLASH_ESCAPES)
 * - Boolean as 1/0
 * - No RETURNING clause support
 * - DateTime format without timezone
 * - Version-aware syntax (MySQL 5.7 vs 8.0, MariaDB 10.x)
 */

import { DbType } from "@/types/connection";
import type {
  ColumnDefinitionInput,
  ConstraintDefinitionInput,
  IndexDefinitionInput,
  SequenceDefinitionInput,
  TriggerDefinitionInput,
  ViewDefinitionInput,
} from "@/types/crud";
import { SqlAdapter } from "../base/SqlAdapter";
import type { ColumnInfo, ObjectDefinitionType, TableRef } from "../types";
import { quoteIdentifier as sharedQuoteIdentifier } from "../formatting";
import { getMySQLFeaturesForConnection } from "@/stores/versionStore";
import type { MySQLVersionFeatures } from "../utils/versionUtils";

export class MySQLAdapter extends SqlAdapter {
  readonly dbType = DbType.MySQL;

  /**
   * Get version features for this connection
   * Returns conservative defaults if version info not available
   */
  private getFeatures(): MySQLVersionFeatures {
    return getMySQLFeaturesForConnection(this.connectionId);
  }

  /**
   * Quote identifier with backticks (MySQL standard)
   * Escapes embedded backticks by doubling them
   */
  quoteIdentifier(name: string): string {
    return sharedQuoteIdentifier(name, DbType.MySQL);
  }

  /**
   * Quote and escape a string value for MySQL
   * Uses standard SQL '' doubling (works in all sql_modes)
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
      return "NULL";
    }

    // Boolean as 1/0 (MySQL uses TINYINT for booleans)
    if (typeof value === "boolean") {
      return value ? "1" : "0";
    }

    // Number validation and formatting
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number value: ${value}`);
      }
      return String(value);
    }

    // BigInt support
    if (typeof value === "bigint") {
      return String(value);
    }

    // Date formatting without timezone (MySQL DATETIME format)
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new Error("Invalid Date value");
      }
      // Format: 'YYYY-MM-DD HH:MM:SS'
      const formatted = value.toISOString().slice(0, 19).replace("T", " ");
      return `'${formatted}'`;
    }

    // Buffer/Uint8Array as hex literal
    if (
      value instanceof Uint8Array ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
    ) {
      const hex = Array.from(value)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `X'${hex}'`;
    }

    // Object/Array as JSON string
    if (typeof value === "object") {
      const json = JSON.stringify(value);
      return this.quoteString(json);
    }

    // Default: treat as string
    if (typeof value === "string") {
      return this.quoteString(value);
    }
    return this.quoteString(JSON.stringify(value));
  }

  /**
   * MySQL does not support RETURNING clause
   * Use LAST_INSERT_ID() separately after INSERT
   */
  protected supportsReturning(): boolean {
    return false;
  }

  // escapeString: inherits standard SQL '' doubling from base class
  // This works in all MySQL sql_modes including NO_BACKSLASH_ESCAPES

  // ─────────────────────────────────────────────────────────────────
  // DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL uses MODIFY COLUMN instead of ALTER COLUMN
   */
  modifyColumn(
    target: TableRef,
    columnName: string,
    changes: Partial<ColumnDefinitionInput>,
  ): string {
    const table = this.formatTableRef(target);
    const colName = this.quoteIdentifier(columnName);
    const statements: string[] = [];

    // Check if we have any column definition changes that require MODIFY COLUMN
    const hasColumnDefChanges =
      changes.dataType !== undefined ||
      changes.nullable !== undefined ||
      changes.defaultValue !== undefined ||
      changes.comment !== undefined;

    if (hasColumnDefChanges && !changes.dataType) {
      statements.push(
        `/* WARNING: MySQL MODIFY COLUMN requires the full column definition including data type. */\n` +
        `/* Please set the data type for column ${colName} before committing. */`
      );
    }

    if (hasColumnDefChanges && changes.dataType !== undefined) {
      // We have dataType, so we can generate a complete MODIFY COLUMN statement
      const parts: string[] = [colName];

      parts.push(changes.dataType);

      if (changes.nullable === false) {
        parts.push("NOT NULL");
      } else if (changes.nullable === true) {
        parts.push("NULL");
      }

      if (changes.defaultValue !== undefined) {
        if (changes.defaultValue === null) {
          parts.push("DEFAULT NULL");
        } else {
          parts.push(
            `DEFAULT ${this.formatValue(changes.defaultValue, {
              name: columnName,
            })}`,
          );
        }
      }

      // Add comment to MODIFY COLUMN if provided
      if (
        changes.comment !== undefined &&
        changes.comment !== null &&
        changes.comment !== ""
      ) {
        parts.push(`COMMENT ${this.quoteString(changes.comment)}`);
      }

      statements.push(`ALTER TABLE ${table} MODIFY COLUMN ${parts.join(" ")}`);
    }

    // Handle check constraint changes (MySQL 8.0.16+)
    if (
      changes.checkExpression !== undefined &&
      changes.checkExpression !== null &&
      changes.checkExpression !== ""
    ) {
      const features = this.getFeatures();
      if (features.supportsCheckConstraints) {
        const constraintName = `${target.table}_${columnName}_check`;
        statements.push(
          `ALTER TABLE ${table} ADD CONSTRAINT ${this.quoteIdentifier(
            constraintName,
          )} CHECK (${changes.checkExpression})`,
        );
      } else {
        statements.push(
          `-- CHECK constraints require MySQL 8.0.16+ or MariaDB 10.2.1+`,
        );
      }
    }

    return statements.join(";\n");
  }

  /**
   * MySQL column rename - version-aware syntax
   *
   * MySQL 8.0+ / MariaDB 10.5.2+: RENAME COLUMN
   * MySQL 5.7 / MariaDB < 10.5.2: CHANGE COLUMN (requires full definition)
   *
   * For older versions, we return a placeholder comment since we don't have
   * the current column definition. The user should use SHOW CREATE TABLE
   * to get the full definition and construct the CHANGE COLUMN manually.
   */
  renameColumn(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    const features = this.getFeatures();

    if (features.supportsRenameColumn) {
      // MySQL 8.0+ / MariaDB 10.5.2+
      return `ALTER TABLE ${table} RENAME COLUMN ${this.quoteIdentifier(
        oldName,
      )} TO ${this.quoteIdentifier(newName)}`;
    }

    // MySQL 5.7 / older MariaDB - CHANGE COLUMN requires full definition
    // Return a helpful comment since we can't safely rename without knowing the type
    return (
      `-- MySQL 5.7 requires full column definition for rename.\n` +
      `-- Run: SHOW CREATE TABLE ${table};\n` +
      `-- Then: ALTER TABLE ${table} CHANGE COLUMN ${this.quoteIdentifier(
        oldName,
      )} ${this.quoteIdentifier(newName)} <column_definition>;`
    );
  }

  /**
   * MySQL DROP COLUMN - CASCADE is not supported
   */
  dropColumn(target: TableRef, columnName: string, _cascade?: boolean): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} DROP COLUMN ${this.quoteIdentifier(columnName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Index DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL CREATE INDEX - USING clause goes after the column list
   *
   * MySQL syntax: CREATE [UNIQUE] INDEX name ON table (columns) [USING {BTREE | HASH}]
   * PostgreSQL syntax: CREATE INDEX name ON table USING method (columns)
   */
  createIndex(target: TableRef, definition: IndexDefinitionInput): string {
    const table = this.formatTableRef(target);
    const indexName = this.quoteIdentifier(definition.name);
    const uniqueClause = definition.unique ? "UNIQUE " : "";
    const columns = definition.columns
      .map((c) => this.quoteIdentifier(c))
      .join(", ");

    let sql = `CREATE ${uniqueClause}INDEX ${indexName} ON ${table} (${columns})`;

    // MySQL: USING clause comes after the column list
    if (definition.using) {
      sql += ` USING ${definition.using}`;
    }

    // MySQL/MariaDB does not support partial indexes (WHERE clause) — skip it.

    return sql;
  }

  /**
   * MySQL DROP INDEX - version-aware IF EXISTS support
   *
   * MySQL 8.0.29+ / MariaDB 10.1.4+: Supports IF EXISTS
   * Older versions: Must omit IF EXISTS or check existence first
   */
  dropIndex(target: TableRef, indexName: string, ifExists?: boolean): string {
    const table = this.formatTableRef(target);
    const features = this.getFeatures();

    // Only include IF EXISTS if the database supports it
    const ifExistsClause =
      ifExists && features.supportsDropIndexIfExists ? "IF EXISTS " : "";
    return `DROP INDEX ${ifExistsClause}${this.quoteIdentifier(
      indexName,
    )} ON ${table}`;
  }

  /**
   * MySQL uses ALTER TABLE ... RENAME INDEX
   */
  renameIndex(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} RENAME INDEX ${this.quoteIdentifier(
      oldName,
    )} TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations - MySQL syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * MySQL CREATE TRIGGER - uses BEGIN...END body instead of EXECUTE FUNCTION
   *
   * MySQL only supports FOR EACH ROW (no STATEMENT level).
   * The functionName field contains the trigger body SQL.
   */
  createTrigger(target: TableRef, definition: TriggerDefinitionInput): string {
    const table = this.formatTableRef(target);
    const triggerName = this.quoteIdentifier(definition.name);
    const timing = definition.timing;
    const events = definition.events.join(", ");

    let sql = `CREATE TRIGGER ${triggerName} ${timing} ${events} ON ${table}`;
    sql += ` FOR EACH ROW`;
    sql += `\nBEGIN\n  ${definition.functionName};\nEND`;

    return sql;
  }

  /**
   * MySQL DROP TRIGGER doesn't use ON table
   */
  dropTrigger(
    _target: TableRef,
    triggerName: string,
    ifExists?: boolean,
  ): string {
    const ifExistsClause = ifExists ? "IF EXISTS " : "";
    return `DROP TRIGGER ${ifExistsClause}${this.quoteIdentifier(triggerName)}`;
  }

  /**
   * MySQL doesn't support ENABLE/DISABLE TRIGGER
   * Returns empty string (no-op)
   */
  renameTrigger(
    _target: TableRef,
    _triggerName: string,
    _newName: string,
  ): string {
    // MySQL doesn't support ALTER TRIGGER RENAME - must drop and recreate
    return "-- MySQL does not support RENAME TRIGGER (drop and recreate instead)";
  }

  toggleTrigger(
    _target: TableRef,
    _triggerName: string,
    _enable: boolean,
  ): string {
    // MySQL doesn't have enable/disable trigger - must drop and recreate
    return "-- MySQL does not support ENABLE/DISABLE TRIGGER";
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
    // Column order must match IntrospectionService.getTables expectations:
    // [0] schema_name, [1] table_name, [2] kind, [3] owner, [4] size, [5] row_count, [6] comment
    return `
SELECT
    t.TABLE_SCHEMA as schema_name,
    t.TABLE_NAME as table_name,
    CASE
        WHEN p.partition_count > 0 THEN 'partitioned'
        ELSE 'regular'
    END as kind,
    NULL as owner,
    CONCAT(ROUND((t.DATA_LENGTH + t.INDEX_LENGTH) / 1024 / 1024, 2), ' MB') as size,
    t.TABLE_ROWS as row_count,
    t.TABLE_COMMENT as comment
FROM information_schema.TABLES t
LEFT JOIN (
    SELECT TABLE_SCHEMA, TABLE_NAME, COUNT(DISTINCT PARTITION_NAME) as partition_count
    FROM information_schema.PARTITIONS
    WHERE PARTITION_NAME IS NOT NULL
    GROUP BY TABLE_SCHEMA, TABLE_NAME
) p ON t.TABLE_SCHEMA = p.TABLE_SCHEMA AND t.TABLE_NAME = p.TABLE_NAME
WHERE t.TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND t.TABLE_TYPE = 'BASE TABLE'
ORDER BY t.TABLE_NAME`;
  }

  getViewsQuery(schema: string): string {
    // Column order must match IntrospectionService.getViews expectations:
    // [0] schema_name, [1] view_name, [2] owner, [3] definition, [4] is_materialized, [5] comment
    return `
SELECT
    TABLE_SCHEMA as schema_name,
    TABLE_NAME as view_name,
    NULL as owner,
    VIEW_DEFINITION as definition,
    FALSE as is_materialized,
    NULL as comment
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
    ROUTINE_DEFINITION as source,
    ROUTINE_TYPE as routine_type
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = '${this.escapeString(schema)}'
ORDER BY ROUTINE_NAME`;
  }

  getIndexesQuery(schema: string, table: string): string {
    return `
SELECT
    INDEX_NAME as index_name,
    TABLE_NAME as table_name,
    CONCAT('[', GROUP_CONCAT(CONCAT('"', REPLACE(COLUMN_NAME, '"', '\\\\"'), '"') ORDER BY SEQ_IN_INDEX SEPARATOR ','), ']') as columns,
    NOT NON_UNIQUE as is_unique,
    INDEX_NAME = 'PRIMARY' as is_primary,
    0 as is_partial,
    CONCAT('USING ', INDEX_TYPE) as definition,
    0 as is_foreign_key
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_NAME = '${this.escapeString(table)}'
GROUP BY INDEX_NAME, TABLE_NAME, NON_UNIQUE, INDEX_TYPE
ORDER BY INDEX_NAME`;
  }

  getIndexUsageStatsQuery(schema: string, table: string): string {
    const features = this.getFeatures();

    // MySQL 5.7+ and MariaDB 10.0+ expose index usage in performance_schema.
    // For older versions, we return an empty typed result.
    if (!features.supportsPerformanceSchemaIndexStats) {
      return `
SELECT 
    NULL as index_name,
    NULL as scan_count,
    NULL as rows_read,
    NULL as rows_returned,
    NULL as size_pretty,
    NULL as size_bytes,
    0 as is_unused,
    NULL as cache_hit_ratio,
    NULL as last_used
WHERE 0`;
    }

    // Primary query uses performance_schema; IntrospectionService can retry
    // with getIndexUsageStatsFallbackQuery() on permission errors.
    return `
SELECT 
    idx.INDEX_NAME as index_name,
    COALESCE(ps.COUNT_READ, 0) as scan_count,
    COALESCE(ps.COUNT_READ, 0) as rows_read,
    COALESCE(ps.COUNT_FETCH, 0) as rows_returned,
    NULL as size_pretty,
    NULL as size_bytes,
    CASE 
        WHEN COALESCE(ps.COUNT_READ, 0) = 0 THEN 1
        ELSE 0 
    END as is_unused,
    NULL as cache_hit_ratio,
    NULL as last_used
FROM (
    SELECT DISTINCT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
        AND TABLE_NAME = '${this.escapeString(table)}'
) idx
LEFT JOIN performance_schema.table_io_waits_summary_by_index_usage ps
    ON ps.OBJECT_SCHEMA = idx.TABLE_SCHEMA
    AND ps.OBJECT_NAME = idx.TABLE_NAME
    AND (ps.INDEX_NAME = idx.INDEX_NAME OR (ps.INDEX_NAME IS NULL AND idx.INDEX_NAME = 'PRIMARY'))
ORDER BY idx.INDEX_NAME`;
  }

  /**
   * Fallback index usage stats query that works without performance_schema access
   * Returns basic index information from information_schema only
   */
  getIndexUsageStatsFallbackQuery(schema: string, table: string): string {
    return `
SELECT DISTINCT
    INDEX_NAME as index_name,
    0 as scan_count,
    0 as rows_read,
    0 as rows_returned,
    NULL as size_pretty,
    NULL as size_bytes,
    0 as is_unused,
    NULL as cache_hit_ratio,
    NULL as last_used
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_NAME = '${this.escapeString(table)}'
ORDER BY INDEX_NAME`;
  }

  getConstraintsQuery(schema: string, table: string): string {
    // MySQL stores foreign key info in KEY_COLUMN_USAGE, not TABLE_CONSTRAINTS
    return `
SELECT
    tc.CONSTRAINT_NAME as constraint_name,
    tc.TABLE_NAME as table_name,
    tc.CONSTRAINT_TYPE as constraint_type,
    CASE
        WHEN tc.CONSTRAINT_TYPE = 'PRIMARY KEY' THEN
            CONCAT(
                'PRIMARY KEY (',
                GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ', '),
                ')'
            )
        WHEN tc.CONSTRAINT_TYPE = 'UNIQUE' THEN
            CONCAT(
                'UNIQUE (',
                GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ', '),
                ')'
            )
        WHEN tc.CONSTRAINT_TYPE = 'FOREIGN KEY' THEN
            CONCAT(
                'FOREIGN KEY (',
                GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ', '),
                ') REFERENCES ',
                kcu.REFERENCED_TABLE_SCHEMA,
                '.',
                kcu.REFERENCED_TABLE_NAME,
                ' (',
                GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ', '),
                ')',
                IF(rc.DELETE_RULE IS NULL, '', CONCAT(' ON DELETE ', rc.DELETE_RULE)),
                IF(rc.UPDATE_RULE IS NULL, '', CONCAT(' ON UPDATE ', rc.UPDATE_RULE))
            )
        ELSE NULL
    END as definition,
    CASE
        WHEN tc.CONSTRAINT_TYPE = 'FOREIGN KEY' THEN
            CONCAT(kcu.REFERENCED_TABLE_SCHEMA, '.', kcu.REFERENCED_TABLE_NAME)
        ELSE NULL
    END as foreign_table
FROM information_schema.TABLE_CONSTRAINTS tc
LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
    ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
    AND tc.TABLE_NAME = kcu.TABLE_NAME
    AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON tc.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
    AND tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
WHERE tc.TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND tc.TABLE_NAME = '${this.escapeString(table)}'
GROUP BY
    tc.CONSTRAINT_NAME,
    tc.TABLE_NAME,
    tc.CONSTRAINT_TYPE,
    kcu.REFERENCED_TABLE_SCHEMA,
    kcu.REFERENCED_TABLE_NAME,
    rc.UPDATE_RULE,
    rc.DELETE_RULE
ORDER BY tc.CONSTRAINT_NAME`;
  }

  getColumnsQuery(schema: string, table: string): string {
    // Column order must match IntrospectionService.getColumns expectations:
    // [0] column_name, [1] formatted_type, [2] type_oid, [3] nullable, [4] is_primary_key,
    // [5] default_value, [6] comment, [7] type_category, [8] enum_values,
    // [9] is_computed (EXTRA contains 'VIRTUAL' or 'STORED' for generated columns),
    // [10] is_identity (EXTRA contains 'auto_increment'),
    // [11] character_set, [12] collation, [13] extra
    return `
SELECT
    COLUMN_NAME as column_name,
    COLUMN_TYPE as formatted_type,
    NULL as type_oid,
    IS_NULLABLE = 'YES' as nullable,
    COLUMN_KEY = 'PRI' as is_primary_key,
    COLUMN_DEFAULT as default_value,
    COLUMN_COMMENT as comment,
    DATA_TYPE as type_category,
    NULL as enum_values,
    CASE WHEN EXTRA LIKE '%VIRTUAL%' OR EXTRA LIKE '%STORED%' THEN 1 ELSE 0 END as is_computed,
    CASE WHEN EXTRA LIKE '%auto_increment%' THEN 1 ELSE 0 END as is_identity,
    CHARACTER_SET_NAME as character_set,
    COLLATION_NAME as collation,
    EXTRA as extra
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_NAME = '${this.escapeString(table)}'
ORDER BY ORDINAL_POSITION`;
  }

  getTriggersQuery(schema: string, table: string): string {
    // Column order must match IntrospectionService.getTriggers expectations:
    // [0] name, [1] schema, [2] table_name, [3] timing, [4] event, [5] level,
    // [6] function, [7] enabled, [8] condition
    return `
SELECT
    TRIGGER_NAME as trigger_name,
    TRIGGER_SCHEMA as schema_name,
    EVENT_OBJECT_TABLE as table_name,
    ACTION_TIMING as timing,
    EVENT_MANIPULATION as event,
    ACTION_ORIENTATION as level,
    ACTION_STATEMENT as function_body,
    1 as enabled,
    NULL as \`condition\`
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
      return `SELECT COUNT(*) as count FROM ${this.quoteIdentifier(
        schema,
      )}.${this.quoteIdentifier(table)}`;
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
    // Join with COLUMNS table to get DATA_TYPE (KEY_COLUMN_USAGE doesn't have it)
    return `
SELECT DISTINCT
    kcu.TABLE_NAME as table_name,
    kcu.COLUMN_NAME as column_name,
    c.DATA_TYPE as data_type
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.COLUMNS c
    ON c.TABLE_SCHEMA = kcu.TABLE_SCHEMA
    AND c.TABLE_NAME = kcu.TABLE_NAME
    AND c.COLUMN_NAME = kcu.COLUMN_NAME
WHERE kcu.TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND kcu.CONSTRAINT_NAME IN (
        SELECT CONSTRAINT_NAME
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
            AND CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
    )
ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME`;
  }

  /**
   * Get events (MySQL Event Scheduler) in a schema
   */
  getEventsQuery(schema: string): string {
    return `
SELECT
    EVENT_SCHEMA as schema_name,
    EVENT_NAME as event_name,
    DEFINER as definer,
    TIME_ZONE as time_zone,
    EVENT_TYPE as event_type,
    EXECUTE_AT as execute_at,
    INTERVAL_VALUE as interval_value,
    INTERVAL_FIELD as interval_field,
    STARTS as starts,
    ENDS as ends,
    STATUS as status,
    ON_COMPLETION as on_completion,
    CREATED as created,
    LAST_ALTERED as last_altered,
    LAST_EXECUTED as last_executed,
    EVENT_COMMENT as comment
FROM information_schema.EVENTS
WHERE EVENT_SCHEMA = '${this.escapeString(schema)}'
ORDER BY EVENT_NAME`;
  }

  /**
   * Get partitions for a table (MySQL/MariaDB)
   */
  getPartitionsQuery(schema: string, table: string): string {
    return `
SELECT
    TABLE_SCHEMA as schema_name,
    TABLE_NAME as table_name,
    PARTITION_NAME as partition_name,
    SUBPARTITION_NAME as subpartition_name,
    PARTITION_ORDINAL_POSITION as partition_ordinal_position,
    SUBPARTITION_ORDINAL_POSITION as subpartition_ordinal_position,
    PARTITION_METHOD as partition_method,
    SUBPARTITION_METHOD as subpartition_method,
    PARTITION_EXPRESSION as partition_expression,
    SUBPARTITION_EXPRESSION as subpartition_expression,
    PARTITION_DESCRIPTION as partition_description,
    TABLE_ROWS as table_rows,
    AVG_ROW_LENGTH as avg_row_length,
    DATA_LENGTH as data_length,
    INDEX_LENGTH as index_length,
    PARTITION_COMMENT as partition_comment
FROM information_schema.PARTITIONS
WHERE TABLE_SCHEMA = '${this.escapeString(schema)}'
    AND TABLE_NAME = '${this.escapeString(table)}'
    AND PARTITION_NAME IS NOT NULL
ORDER BY PARTITION_ORDINAL_POSITION, SUBPARTITION_ORDINAL_POSITION`;
  }

  getObjectDefinitionQuery(
    objectType: ObjectDefinitionType,
    schema: string,
    name: string,
  ): string {
    switch (objectType) {
      case "view":
        return `SHOW CREATE VIEW ${this.quoteIdentifier(
          schema,
        )}.${this.quoteIdentifier(name)}`;
      case "function":
        return `SHOW CREATE FUNCTION ${this.quoteIdentifier(
          schema,
        )}.${this.quoteIdentifier(name)}`;
      case "procedure":
        return `SHOW CREATE PROCEDURE ${this.quoteIdentifier(
          schema,
        )}.${this.quoteIdentifier(name)}`;
      case "index":
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
      case "sequence":
      case "enum":
      case "domain":
      case "composite":
        // MySQL doesn't support these object types
        return `SELECT '-- ${objectType} is not supported in MySQL' as definition`;
      case "table":
      case "materialized_view":
      default:
        return `SHOW CREATE TABLE ${this.quoteIdentifier(
          schema,
        )}.${this.quoteIdentifier(name)}`;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // View DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createView(schema: string, definition: ViewDefinitionInput): string {
    const qualifiedName = `${this.quoteIdentifier(
      schema,
    )}.${this.quoteIdentifier(definition.name)}`;

    if (definition.isMaterialized) {
      throw new Error("MySQL does not support materialized views");
    }

    return `CREATE VIEW ${qualifiedName} AS\n${definition.definition}`;
  }

  dropView(
    schema: string,
    viewName: string,
    ifExists?: boolean,
    cascade?: boolean,
    isMaterialized?: boolean,
  ): string {
    if (isMaterialized) {
      throw new Error("MySQL does not support materialized views");
    }

    const qualifiedName = `${this.quoteIdentifier(
      schema,
    )}.${this.quoteIdentifier(viewName)}`;
    const ifExistsClause = ifExists ? "IF EXISTS " : "";

    if (cascade) {
      throw new Error("MySQL does not support CASCADE option for DROP VIEW");
    }

    return `DROP VIEW ${ifExistsClause}${qualifiedName}`;
  }

  replaceView(
    schema: string,
    viewName: string,
    definition: string,
    isMaterialized?: boolean,
  ): string {
    if (isMaterialized) {
      throw new Error("MySQL does not support materialized views");
    }

    const qualifiedName = `${this.quoteIdentifier(
      schema,
    )}.${this.quoteIdentifier(viewName)}`;
    return `CREATE OR REPLACE VIEW ${qualifiedName} AS\n${definition}`;
  }

  renameView(
    schema: string,
    oldName: string,
    newName: string,
    isMaterialized?: boolean,
  ): string {
    if (isMaterialized) {
      throw new Error("MySQL does not support materialized views");
    }

    const qualifiedOldName = `${this.quoteIdentifier(
      schema,
    )}.${this.quoteIdentifier(oldName)}`;
    const qualifiedNewName = `${this.quoteIdentifier(
      schema,
    )}.${this.quoteIdentifier(newName)}`;
    return `RENAME TABLE ${qualifiedOldName} TO ${qualifiedNewName}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Constraint DDL Operations
  // ─────────────────────────────────────────────────────────────────

  addConstraint(
    target: TableRef,
    definition: ConstraintDefinitionInput,
  ): string {
    const tableName = this.formatTableRef(target);
    const constraintName = this.quoteIdentifier(definition.name);

    let constraintDef = "";
    switch (definition.type) {
      case "primary_key":
        if (!definition.columns?.length) {
          throw new Error("Primary key constraint requires columns");
        }
        constraintDef = `PRIMARY KEY (${definition.columns
          .map((c) => this.quoteIdentifier(c))
          .join(", ")})`;
        break;

      case "unique":
        if (!definition.columns?.length) {
          throw new Error("Unique constraint requires columns");
        }
        constraintDef = `UNIQUE KEY (${definition.columns
          .map((c) => this.quoteIdentifier(c))
          .join(", ")})`;
        break;

      case "check": {
        if (!definition.expression) {
          throw new Error("Check constraint requires expression");
        }
        const features = this.getFeatures();
        if (!features.supportsCheckConstraints) {
          throw new Error(
            "CHECK constraints require MySQL 8.0.16+ or MariaDB 10.2.1+. " +
              "Older versions parse but ignore CHECK constraints.",
          );
        }
        constraintDef = `CHECK (${definition.expression})`;
        break;
      }

      case "exclusion":
        throw new Error("MySQL does not support exclusion constraints");
    }

    return `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${constraintDef}`;
  }

  dropConstraint(
    target: TableRef,
    constraintName: string,
    cascade?: boolean,
    _ifExists?: boolean,
    constraintType?: string,
  ): string {
    if (cascade) {
      throw new Error(
        "MySQL does not support CASCADE option for DROP CONSTRAINT",
      );
    }

    const tableName = this.formatTableRef(target);
    const quoted = this.quoteIdentifier(constraintName);

    switch (constraintType?.toUpperCase()) {
      case "PRIMARY KEY":
        return `ALTER TABLE ${tableName} DROP PRIMARY KEY`;
      case "FOREIGN KEY":
        return `ALTER TABLE ${tableName} DROP FOREIGN KEY ${quoted}`;
      case "UNIQUE":
        return `ALTER TABLE ${tableName} DROP INDEX ${quoted}`;
      case "CHECK":
      default:
        return `ALTER TABLE ${tableName} DROP CHECK ${quoted}`;
    }
  }

  renameConstraint(
    _target: TableRef,
    _oldName: string,
    _newName: string,
  ): string {
    throw new Error(
      "MySQL does not support RENAME CONSTRAINT. Drop and recreate the constraint instead.",
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Sequence DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createSequence(
    _schema: string,
    _definition: SequenceDefinitionInput,
  ): string {
    throw new Error(
      "MySQL does not support sequences. Use AUTO_INCREMENT instead.",
    );
  }

  alterSequence(
    _schema: string,
    _sequenceName: string,
    _changes: Partial<SequenceDefinitionInput>,
  ): string {
    throw new Error(
      "MySQL does not support sequences. Use AUTO_INCREMENT instead.",
    );
  }

  dropSequence(
    _schema: string,
    _sequenceName: string,
    _ifExists?: boolean,
    _cascade?: boolean,
  ): string {
    throw new Error(
      "MySQL does not support sequences. Use AUTO_INCREMENT instead.",
    );
  }

  renameSequence(_schema: string, _oldName: string, _newName: string): string {
    throw new Error(
      "MySQL does not support sequences. Use AUTO_INCREMENT instead.",
    );
  }
}
