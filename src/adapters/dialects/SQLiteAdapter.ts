/**
 * SQLite Database Adapter
 *
 * SQLite-specific SQL generation with:
 * - Double-quoted identifiers: "column_name"
 * - No schema support (SQLite doesn't have schemas)
 * - Booleans as 1/0
 * - Dates as ISO strings
 * - Version-aware syntax (RETURNING, DROP COLUMN, RENAME COLUMN)
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
import type {
  ColumnInfo,
  TableRef,
  InsertOptions,
  RowData,
  WhereClause,
  ObjectDefinitionType,
} from "../types";
import { quoteIdentifier as sharedQuoteIdentifier } from "../formatting";
import { getSQLiteFeaturesForConnection } from "@/stores/versionStore";
import type { SQLiteVersionFeatures } from "../utils/versionUtils";

export class SQLiteAdapter extends SqlAdapter {
  readonly dbType = DbType.SQLite;

  /**
   * Get version features for this connection
   * Returns conservative defaults (all features enabled) if version info not available
   * SQLite is typically bundled with modern versions, so defaults assume latest
   */
  private getFeatures(): SQLiteVersionFeatures {
    return getSQLiteFeaturesForConnection(this.connectionId);
  }

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
      return "NULL";
    }

    if (typeof value === "boolean") {
      return value ? "1" : "0";
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(
          `Invalid number value for column "${column.name}": ${value}`,
        );
      }
      return String(value);
    }

    if (value instanceof Date) {
      // SQLite stores dates as ISO 8601 strings
      return `'${value.toISOString()}'`;
    }

    // Handle Buffer/Uint8Array as hex blob
    if (
      value instanceof Uint8Array ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
    ) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `X'${hex}'`;
    }

    if (typeof value === "object") {
      // JSON values stored as text
      return this.quoteString(JSON.stringify(value));
    }

    return this.quoteString(String(value as any));
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
    return this.getFeatures().supportsReturning;
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
        sql += " RETURNING *";
      }
      return sql;
    }

    const columnList = columns.map((c) => this.quoteIdentifier(c)).join(", ");
    const valueList = columns
      .map((c) => this.formatValue(data[c], { name: c }))
      .join(", ");

    let sql = `INSERT INTO ${table} (${columnList}) VALUES (${valueList})`;

    if (options?.returning && this.supportsReturning()) {
      sql += " RETURNING *";
    }

    return sql;
  }

  /**
   * Generate UPDATE statement with conditional RETURNING
   */
  update(target: TableRef, data: RowData, where: WhereClause): string {
    const table = this.formatTableRef(target);

    const setClause = Object.entries(data)
      .map(
        ([col, val]) =>
          `${this.quoteIdentifier(col)} = ${this.formatValue(val, { name: col })}`,
      )
      .join(", ");

    const whereClause = this.buildWhereClause(where);

    let sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;

    // SQLite 3.35+ supports RETURNING
    if (this.supportsReturning()) {
      sql += " RETURNING *";
    }

    return sql;
  }

  /**
   * Generate DELETE statement with conditional RETURNING
   */
  delete(target: TableRef, where: WhereClause): string {
    const table = this.formatTableRef(target);
    const whereClause = this.buildWhereClause(where);

    let sql = `DELETE FROM ${table} WHERE ${whereClause}`;

    // SQLite 3.35+ supports RETURNING
    if (this.supportsReturning()) {
      sql += " RETURNING *";
    }

    return sql;
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
   * Filters out comment-only statements to avoid empty transactions
   */
  transaction(operations: string[]): string {
    if (operations.length === 0) {
      return "";
    }

    // Filter out non-string operations and comment-only statements
    const statements = operations.filter((op): op is string => {
      if (typeof op !== "string") return false;
      const trimmed = op.trim();
      if (trimmed.length === 0) return false;
      // Skip comment-only statements (lines starting with --)
      if (trimmed.startsWith("--") && !trimmed.includes("\n")) return false;
      return true;
    });

    if (statements.length === 0) {
      // Return only the comments without transaction wrapper
      return operations
        .filter(
          (op): op is string => typeof op === "string" && op.trim().length > 0,
        )
        .join(";\n");
    }

    return `BEGIN TRANSACTION;\n${statements.join(";\n")};\nCOMMIT;`;
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
      column.dataType || "TEXT",
    ];

    // SQLite ADD COLUMN has restrictions on what can be specified
    if (column.defaultValue !== undefined && column.defaultValue !== null) {
      parts.push(
        `DEFAULT ${this.formatValue(column.defaultValue, { name: column.name })}`,
      );
    }

    // NOT NULL requires a default value in SQLite ADD COLUMN
    if (!column.nullable && column.defaultValue !== undefined) {
      parts.push("NOT NULL");
    }

    return `ALTER TABLE ${table} ADD COLUMN ${parts.join(" ")}`;
  }

  /**
   * SQLite doesn't support MODIFY COLUMN - requires table recreation
   * Return a comment explaining this limitation
   */
  modifyColumn(
    _target: TableRef,
    columnName: string,
    _changes: Partial<ColumnDefinitionInput>,
  ): string {
    // SQLite doesn't support modifying column definitions
    // This would require recreating the table
    return `-- SQLite does not support ALTER COLUMN for "${columnName}". Table recreation required.`;
  }

  /**
   * SQLite 3.35+ supports DROP COLUMN
   * Older versions require table recreation
   */
  dropColumn(target: TableRef, columnName: string, _cascade?: boolean): string {
    const features = this.getFeatures();
    const table = this.formatTableRef(target);

    if (features.supportsDropColumn) {
      // SQLite 3.35+ - SQLite doesn't support CASCADE
      return `ALTER TABLE ${table} DROP COLUMN ${this.quoteIdentifier(columnName)}`;
    }

    // SQLite < 3.35 - doesn't support DROP COLUMN
    return `-- SQLite < 3.35 does not support DROP COLUMN for "${columnName}". Table recreation required.`;
  }

  /**
   * SQLite 3.25+ supports RENAME COLUMN
   * Older versions require table recreation
   */
  renameColumn(target: TableRef, oldName: string, newName: string): string {
    const features = this.getFeatures();
    const table = this.formatTableRef(target);

    if (features.supportsRenameColumn) {
      // SQLite 3.25+
      return `ALTER TABLE ${table} RENAME COLUMN ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
    }

    // SQLite < 3.25 - doesn't support RENAME COLUMN
    return `-- SQLite < 3.25 does not support RENAME COLUMN. Table recreation required to rename "${oldName}" to "${newName}".`;
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

  /**
   * SQLite CREATE INDEX - no USING clause, no INCLUDE columns
   * SQLite only supports B-tree indexes. Partial indexes (WHERE) are supported.
   */
  createIndex(target: TableRef, definition: IndexDefinitionInput): string {
    const table = this.formatTableRef(target);
    const indexName = this.quoteIdentifier(definition.name);
    const uniqueClause = definition.unique ? "UNIQUE " : "";
    const columns = definition.columns
      .map((c) => this.quoteIdentifier(c))
      .join(", ");

    let sql = `CREATE ${uniqueClause}INDEX ${indexName} ON ${table} (${columns})`;

    // SQLite supports partial indexes (WHERE clause)
    if (definition.where) {
      sql += ` WHERE ${definition.where}`;
    }

    return sql;
  }

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations - SQLite syntax
  // ─────────────────────────────────────────────────────────────────

  /**
   * SQLite CREATE TRIGGER - uses BEGIN...END body instead of EXECUTE FUNCTION
   */
  createTrigger(target: TableRef, definition: TriggerDefinitionInput): string {
    const table = this.formatTableRef(target);
    const triggerName = this.quoteIdentifier(definition.name);
    const timing = definition.timing;
    const events = definition.events.join(", ");

    let sql = `CREATE TRIGGER ${triggerName} ${timing} ${events} ON ${table}`;
    sql += ` FOR EACH ROW`;

    if (definition.condition) {
      sql += ` WHEN (${definition.condition})`;
    }

    sql += `\nBEGIN\n  ${definition.functionName};\nEND`;

    return sql;
  }

  /**
   * SQLite DROP TRIGGER doesn't use ON table
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
   * SQLite doesn't support ENABLE/DISABLE TRIGGER
   */
  renameTrigger(
    _target: TableRef,
    _triggerName: string,
    _newName: string,
  ): string {
    return "-- SQLite does not support RENAME TRIGGER (drop and recreate instead)";
  }

  toggleTrigger(
    _target: TableRef,
    _triggerName: string,
    _enable: boolean,
  ): string {
    return "-- SQLite does not support ENABLE/DISABLE TRIGGER";
  }

  // ─────────────────────────────────────────────────────────────────
  // Introspection Queries - SQLite
  // ─────────────────────────────────────────────────────────────────

  getDatabasesQuery(): string {
    // SQLite uses attached databases, show main and attached
    return `SELECT 'main' as name UNION SELECT name FROM pragma_database_list WHERE name != 'main'`;
  }

  getSchemasQuery(): string {
    // SQLite doesn't have schemas - return the database file name as schema
    // This allows the UI to show the database name in the schema selector
    // Note: For SQLite, the "database" concept is the file itself, so we use a placeholder
    return `SELECT 'main' as name`;
  }

  getTablesQuery(_schema: string): string {
    // Column order must match IntrospectionService.getTables expectations:
    // [0] schema_name, [1] table_name, [2] kind, [3] owner, [4] size, [5] row_count, [6] comment
    return `
SELECT
    'main' as schema_name,
    name as table_name,
    'regular' as kind,
    NULL as owner,
    NULL as size,
    NULL as row_count,
    NULL as comment
FROM sqlite_master
WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
ORDER BY name`;
  }

  getViewsQuery(_schema: string): string {
    // Column order must match IntrospectionService.getViews expectations:
    // [0] schema_name, [1] view_name, [2] owner, [3] definition, [4] is_materialized, [5] comment
    return `
SELECT
    'main' as schema_name,
    name as view_name,
    NULL as owner,
    sql as definition,
    0 as is_materialized,
    NULL as comment
FROM sqlite_master
WHERE type = 'view'
ORDER BY name`;
  }

  getFunctionsQuery(_schema: string): string {
    // SQLite doesn't have stored functions in the same way
    return `SELECT 'Not supported' as message WHERE 0`;
  }

  getIndexesQuery(_schema: string, table: string): string {
    // Note: pragma_index_list doesn't have a 'sql' column - get definition from sqlite_master
    // Also, pragma_index_info may return NULL for some index types (FTS, etc.) so we handle that
    return `
SELECT
    il.name as index_name,
    '${this.escapeString(table)}' as table_name,
    COALESCE('[' || GROUP_CONCAT('"' || REPLACE(ii.name, '"', '\\"') || '"') || ']', '[]') as columns,
    il."unique" as is_unique,
    il.origin = 'pk' as is_primary,
    il.partial as is_partial,
    sm.sql as definition,
    0 as is_foreign_key
FROM pragma_index_list('${this.escapeString(table)}') il
LEFT JOIN pragma_index_info(il.name) ii ON 1=1
LEFT JOIN sqlite_master sm ON sm.type = 'index' AND sm.name = il.name
GROUP BY il.name, il."unique", il.origin, il.partial, sm.sql
ORDER BY il.name`;
  }

  getIndexUsageStatsQuery(_schema: string, _table: string): string {
    // SQLite doesn't track runtime index usage stats
    // Return empty result set matching the expected schema
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

  getConstraintsQuery(_schema: string, table: string): string {
    // For SQLite, we need to build FK definitions from pragma_foreign_key_list
    // The definition must match the format: FOREIGN KEY (col) REFERENCES table(col) ON DELETE/UPDATE action
    return `
SELECT
    name as constraint_name,
    '${this.escapeString(table)}' as table_name,
    'PRIMARY KEY' as constraint_type,
    NULL as definition,
    NULL as foreign_table
FROM pragma_table_info('${this.escapeString(table)}')
WHERE pk > 0
UNION ALL
SELECT
    'fk_' || id as constraint_name,
    '${this.escapeString(table)}' as table_name,
    'FOREIGN KEY' as constraint_type,
    'FOREIGN KEY (' || "from" || ') REFERENCES ' || "table" || '(' || "to" || ')' ||
        CASE WHEN on_delete != 'NO ACTION' THEN ' ON DELETE ' || on_delete ELSE '' END ||
        CASE WHEN on_update != 'NO ACTION' THEN ' ON UPDATE ' || on_update ELSE '' END
    as definition,
    "table" as foreign_table
FROM pragma_foreign_key_list('${this.escapeString(table)}')`;
  }

  getColumnsQuery(_schema: string, table: string): string {
    return `
SELECT
    name as column_name,
    type as formatted_type,
    NULL as type_oid,
    NOT \`notnull\` as nullable,
    pk > 0 as is_primary_key,
    dflt_value as default_value,
    NULL as comment,
    NULL as type_category,
    NULL as enum_values
FROM pragma_table_info('${this.escapeString(table)}')
ORDER BY cid`;
  }

  getTriggersQuery(_schema: string, table: string): string {
    // Column order must match IntrospectionService.getTriggers expectations:
    // [0] name, [1] schema, [2] table_name, [3] timing, [4] event, [5] level,
    // [6] function, [7] enabled, [8] condition
    return `
SELECT
    name as trigger_name,
    'main' as schema_name,
    '${this.escapeString(table)}' as table_name,
    NULL as timing,
    NULL as event,
    NULL as level,
    NULL as function_name,
    1 as enabled,
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
UNION SELECT 'NUMERIC', 'numeric'
UNION SELECT 'BLOB', 'binary'`;
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
    objectType: ObjectDefinitionType,
    _schema: string,
    name: string,
  ): string {
    switch (objectType) {
      case "table":
      case "view":
      case "index":
        // SQLite stores all DDL in sqlite_master
        return `SELECT sql || ';' as definition FROM sqlite_master WHERE name = '${this.escapeString(name)}'`;
      case "sequence":
      case "enum":
      case "domain":
      case "composite":
      case "function":
      case "procedure":
      case "materialized_view":
        // SQLite doesn't support these object types
        return `SELECT '-- ${objectType} is not supported in SQLite' as definition`;
      default:
        return `SELECT sql || ';' as definition FROM sqlite_master WHERE name = '${this.escapeString(name)}'`;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // View DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createView(_schema: string, definition: ViewDefinitionInput): string {
    if (definition.isMaterialized) {
      throw new Error("SQLite does not support materialized views");
    }

    const viewName = this.quoteIdentifier(definition.name);
    return `CREATE VIEW ${viewName} AS\n${definition.definition}`;
  }

  dropView(
    _schema: string,
    viewName: string,
    ifExists?: boolean,
    _cascade?: boolean,
    isMaterialized?: boolean,
  ): string {
    if (isMaterialized) {
      throw new Error("SQLite does not support materialized views");
    }

    const quotedName = this.quoteIdentifier(viewName);
    const ifExistsClause = ifExists ? "IF EXISTS " : "";
    return `DROP VIEW ${ifExistsClause}${quotedName}`;
  }

  replaceView(
    _schema: string,
    viewName: string,
    definition: string,
    isMaterialized?: boolean,
  ): string {
    if (isMaterialized) {
      throw new Error("SQLite does not support materialized views");
    }

    // SQLite doesn't support CREATE OR REPLACE VIEW, so we drop and recreate
    const quotedName = this.quoteIdentifier(viewName);
    return `DROP VIEW IF EXISTS ${quotedName};\nCREATE VIEW ${quotedName} AS\n${definition}`;
  }

  renameView(
    _schema: string,
    oldName: string,
    newName: string,
    isMaterialized?: boolean,
  ): string {
    if (isMaterialized) {
      throw new Error("SQLite does not support materialized views");
    }

    const quotedOld = this.quoteIdentifier(oldName);
    const quotedNew = this.quoteIdentifier(newName);
    return `ALTER TABLE ${quotedOld} RENAME TO ${quotedNew}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Constraint DDL Operations
  // ─────────────────────────────────────────────────────────────────

  addConstraint(
    _target: TableRef,
    _definition: ConstraintDefinitionInput,
  ): string {
    throw new Error(
      "SQLite does not support ALTER TABLE ADD CONSTRAINT. Constraints must be defined when creating the table.",
    );
  }

  dropConstraint(
    _target: TableRef,
    _constraintName: string,
    _cascade?: boolean,
    _ifExists?: boolean,
  ): string {
    throw new Error(
      "SQLite does not support ALTER TABLE DROP CONSTRAINT. You must recreate the table without the constraint.",
    );
  }

  renameConstraint(
    _target: TableRef,
    _oldName: string,
    _newName: string,
  ): string {
    throw new Error("SQLite does not support renaming constraints.");
  }

  // ─────────────────────────────────────────────────────────────────
  // Sequence DDL Operations
  // ─────────────────────────────────────────────────────────────────

  createSequence(
    _schema: string,
    _definition: SequenceDefinitionInput,
  ): string {
    throw new Error(
      "SQLite does not support sequences. Use AUTOINCREMENT instead.",
    );
  }

  alterSequence(
    _schema: string,
    _sequenceName: string,
    _changes: Partial<SequenceDefinitionInput>,
  ): string {
    throw new Error(
      "SQLite does not support sequences. Use AUTOINCREMENT instead.",
    );
  }

  dropSequence(
    _schema: string,
    _sequenceName: string,
    _ifExists?: boolean,
    _cascade?: boolean,
  ): string {
    throw new Error(
      "SQLite does not support sequences. Use AUTOINCREMENT instead.",
    );
  }

  renameSequence(_schema: string, _oldName: string, _newName: string): string {
    throw new Error(
      "SQLite does not support sequences. Use AUTOINCREMENT instead.",
    );
  }
}
