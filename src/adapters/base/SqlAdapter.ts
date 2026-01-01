/**
 * Base SQL Adapter
 *
 * Provides shared SQL generation logic for relational databases.
 * Dialect-specific adapters extend this class and override formatting methods.
 */

import { queryStreamClient } from "@/services/queryStreamClient";
import type { DbType } from "@/types/connection";
import type {
  ColumnDefinitionInput,
  IndexDefinitionInput,
  TriggerDefinitionInput,
} from "@/types/crud";
import type {
  DatabaseAdapter,
  DatabaseParadigm,
  TableRef,
  RowData,
  WhereClause,
  SelectOptions,
  InsertOptions,
  QueryPayload,
  QueryResult,
  ColumnInfo,
} from "../types";

/**
 * Abstract base class for SQL database adapters
 */
export abstract class SqlAdapter implements DatabaseAdapter {
  readonly paradigm: DatabaseParadigm = "sql";
  readonly connectionId: string;
  abstract readonly dbType: DbType;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  /**
   * Execute SQL via backend execute_query command
   */
  async execute(sql: QueryPayload): Promise<QueryResult> {
    if (typeof sql !== "string") {
      throw new Error("SQL adapter expects string query");
    }

    const rows: unknown[][] = [];

    const result = await queryStreamClient.streamWithCallbacks(
      {
        connId: this.connectionId,
        tabId: "system",
        sql,
      },
      {
        onBatch: (batch) => {
          rows.push(...batch.rows);
        },
      },
    );

    return {
      columns: result.columns.map((c, index) => ({
        name: c.name,
        db_type: c.db_type,
        nullable: c.nullable,
        default: c.default_value ?? null,
        is_pk: c.primary_key,
        is_fk: false,
        ordinal: index,
        precision: c.precision ?? null,
        scale: c.scale ?? null,
        comment: c.comment ?? null,
        type_oid: c.type_oid,
        type_category: c.type_category,
        enum_values: c.enum_values,
      })),
      rows,
      rowCount: result.totalRows,
    };
  }

  /**
   * Generate INSERT statement
   */
  insert(target: TableRef, data: RowData, options?: InsertOptions): string {
    const table = this.formatTableRef(target);
    const columns = Object.keys(data);
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
   * Generate UPDATE statement
   */
  update(target: TableRef, data: RowData, where: WhereClause): string {
    const table = this.formatTableRef(target);

    const setClause = Object.entries(data)
      .map(
        ([col, val]) =>
          `${this.quoteIdentifier(col)} = ${this.formatValue(val, {
            name: col,
          })}`,
      )
      .join(", ");

    const whereClause = this.buildWhereClause(where);

    let sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;

    if (this.supportsReturning()) {
      sql += " RETURNING *";
    }

    return sql;
  }

  /**
   * Generate DELETE statement
   */
  delete(target: TableRef, where: WhereClause): string {
    const table = this.formatTableRef(target);
    const whereClause = this.buildWhereClause(where);

    return `DELETE FROM ${table} WHERE ${whereClause}`;
  }

  /**
   * Generate SELECT statement
   */
  select(target: TableRef, options?: SelectOptions): string {
    const table = this.formatTableRef(target);
    const columns =
      options?.columns?.map((c) => this.quoteIdentifier(c)).join(", ") || "*";

    let sql = `SELECT ${columns} FROM ${table}`;

    // rawWhere takes precedence over structured where
    if (options?.rawWhere) {
      sql += ` WHERE ${options.rawWhere}`;
    } else if (options?.where && Object.keys(options.where).length > 0) {
      sql += ` WHERE ${this.buildWhereClause(options.where)}`;
    }

    if (options?.orderBy && options.orderBy.length > 0) {
      const orderClauses = options.orderBy
        .map((o) => `${this.quoteIdentifier(o.column)} ${o.direction}`)
        .join(", ");
      sql += ` ORDER BY ${orderClauses}`;
    }

    if (options?.limit !== undefined) {
      sql += this.formatLimit(options.limit, options.offset);
    }

    return sql;
  }

  /**
   * Wrap statements in a transaction
   */
  transaction(operations: QueryPayload[]): string {
    const statements = operations.filter(
      (op): op is string => typeof op === "string",
    );

    if (statements.length === 0) {
      return "";
    }

    return `BEGIN;\n${statements.join(";\n")};\nCOMMIT;`;
  }

  /**
   * Format a table reference with optional schema
   */
  protected formatTableRef(target: TableRef): string {
    if (target.schema) {
      return `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(
        target.table,
      )}`;
    }
    return this.quoteIdentifier(target.table);
  }

  /**
   * Build WHERE clause from conditions
   */
  protected buildWhereClause(where: WhereClause): string {
    const conditions = Object.entries(where).map(([col, val]) => {
      if (val === null) {
        return `${this.quoteIdentifier(col)} IS NULL`;
      }
      return `${this.quoteIdentifier(col)} = ${this.formatValue(val, {
        name: col,
      })}`;
    });

    return conditions.join(" AND ");
  }

  /**
   * Format LIMIT clause (dialect-specific, override if needed)
   */
  protected formatLimit(limit: number, offset?: number): string {
    let clause = ` LIMIT ${limit}`;
    if (offset !== undefined && offset > 0) {
      clause += ` OFFSET ${offset}`;
    }
    return clause;
  }

  /**
   * Whether this dialect supports RETURNING clause
   */
  protected supportsReturning(): boolean {
    return true; // Override in dialects that don't support it
  }

  /**
   * Escape a string by doubling single quotes (standard SQL)
   */
  protected escapeString(value: string): string {
    return value.replace(/'/g, "''");
  }

  // ─────────────────────────────────────────────────────────────────
  // DDL Operations (can be overridden by specific dialects)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate ADD COLUMN statement
   */
  addColumn(target: TableRef, column: ColumnDefinitionInput): string {
    const table = this.formatTableRef(target);
    const columnDef = this.formatColumnDefinition(column);
    return `ALTER TABLE ${table} ADD COLUMN ${columnDef}`;
  }

  /**
   * Generate ALTER COLUMN statements for modifications
   * Default implementation for PostgreSQL-style ALTER statements
   * Override for MySQL, SQLite, etc.
   */
  modifyColumn(
    target: TableRef,
    columnName: string,
    changes: Partial<ColumnDefinitionInput>,
  ): string {
    const table = this.formatTableRef(target);
    const colName = this.quoteIdentifier(columnName);
    const statements: string[] = [];

    if (changes.dataType) {
      statements.push(
        `ALTER TABLE ${table} ALTER COLUMN ${colName} TYPE ${changes.dataType}`,
      );
    }

    if (changes.nullable !== undefined) {
      if (changes.nullable) {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} DROP NOT NULL`,
        );
      } else {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} SET NOT NULL`,
        );
      }
    }

    if (changes.defaultValue !== undefined) {
      if (changes.defaultValue === null) {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} DROP DEFAULT`,
        );
      } else {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} SET DEFAULT ${this.formatValue(
            changes.defaultValue,
            { name: columnName },
          )}`,
        );
      }
    }

    return statements.join(";\n");
  }

  /**
   * Generate DROP COLUMN statement
   */
  dropColumn(target: TableRef, columnName: string, cascade?: boolean): string {
    const table = this.formatTableRef(target);
    const cascadeClause = cascade ? " CASCADE" : "";
    return `ALTER TABLE ${table} DROP COLUMN ${this.quoteIdentifier(
      columnName,
    )}${cascadeClause}`;
  }

  /**
   * Generate RENAME COLUMN statement
   */
  renameColumn(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} RENAME COLUMN ${this.quoteIdentifier(
      oldName,
    )} TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Index DDL Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate CREATE INDEX statement
   * Default implementation for PostgreSQL-style syntax
   * Override for MySQL, SQLite, etc. if needed
   */
  createIndex(target: TableRef, definition: IndexDefinitionInput): string {
    const table = this.formatTableRef(target);
    const indexName = this.quoteIdentifier(definition.name);
    const uniqueClause = definition.unique ? "UNIQUE " : "";
    const columns = definition.columns
      .map((c) => this.quoteIdentifier(c))
      .join(", ");

    let sql = `CREATE ${uniqueClause}INDEX ${indexName} ON ${table}`;

    // Index method (USING btree, hash, gin, gist, etc.)
    if (definition.using) {
      sql += ` USING ${definition.using}`;
    }

    sql += ` (${columns})`;

    // INCLUDE columns (PostgreSQL 11+, SQL Server)
    if (definition.includeColumns && definition.includeColumns.length > 0) {
      const includes = definition.includeColumns
        .map((c) => this.quoteIdentifier(c))
        .join(", ");
      sql += ` INCLUDE (${includes})`;
    }

    // Partial index (WHERE clause)
    if (definition.where) {
      sql += ` WHERE ${definition.where}`;
    }

    return sql;
  }

  /**
   * Generate DROP INDEX statement
   * Default implementation - may need override for MySQL (requires ON table)
   */
  dropIndex(_target: TableRef, indexName: string, ifExists?: boolean): string {
    const ifExistsClause = ifExists ? "IF EXISTS " : "";
    // PostgreSQL/SQLite style - index name only
    // MySQL requires: DROP INDEX name ON table
    return `DROP INDEX ${ifExistsClause}${this.quoteIdentifier(indexName)}`;
  }

  /**
   * Generate RENAME INDEX statement
   * PostgreSQL style - override for other dialects
   */
  renameIndex(_target: TableRef, oldName: string, newName: string): string {
    return `ALTER INDEX ${this.quoteIdentifier(
      oldName,
    )} RENAME TO ${this.quoteIdentifier(newName)}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate CREATE TRIGGER statement
   * Default implementation for PostgreSQL-style syntax
   * Override for MySQL, SQLite, SQL Server (very different syntax)
   */
  createTrigger(target: TableRef, definition: TriggerDefinitionInput): string {
    const table = this.formatTableRef(target);
    const triggerName = this.quoteIdentifier(definition.name);
    const timing = definition.timing;
    const events = definition.events.join(" OR ");
    const level = definition.level || "STATEMENT";

    let sql = `CREATE TRIGGER ${triggerName} ${timing} ${events} ON ${table}`;

    // FOR EACH ROW or FOR EACH STATEMENT
    sql += ` FOR EACH ${level}`;

    // WHEN condition (PostgreSQL)
    if (definition.condition) {
      sql += ` WHEN (${definition.condition})`;
    }

    // EXECUTE FUNCTION (PostgreSQL style)
    sql += ` EXECUTE FUNCTION ${definition.functionName}()`;

    return sql;
  }

  /**
   * Generate DROP TRIGGER statement
   * PostgreSQL style - override for MySQL (no ON table), SQL Server
   */
  dropTrigger(
    target: TableRef,
    triggerName: string,
    ifExists?: boolean,
  ): string {
    const table = this.formatTableRef(target);
    const ifExistsClause = ifExists ? "IF EXISTS " : "";
    // PostgreSQL requires ON table
    return `DROP TRIGGER ${ifExistsClause}${this.quoteIdentifier(
      triggerName,
    )} ON ${table}`;
  }

  /**
   * Generate ENABLE/DISABLE TRIGGER statement
   * PostgreSQL style - override for SQL Server, not supported in MySQL/SQLite
   */
  toggleTrigger(
    target: TableRef,
    triggerName: string,
    enable: boolean,
  ): string {
    const table = this.formatTableRef(target);
    const action = enable ? "ENABLE" : "DISABLE";
    return `ALTER TABLE ${table} ${action} TRIGGER ${this.quoteIdentifier(
      triggerName,
    )}`;
  }

  /**
   * Format a column definition for DDL statements
   */
  protected formatColumnDefinition(column: ColumnDefinitionInput): string {
    const parts: string[] = [
      this.quoteIdentifier(column.name),
      column.dataType || "text",
    ];

    if (!column.nullable) {
      parts.push("NOT NULL");
    }

    if (column.defaultValue !== undefined && column.defaultValue !== null) {
      parts.push(
        `DEFAULT ${this.formatValue(column.defaultValue, {
          name: column.name,
        })}`,
      );
    }

    if (column.isPrimaryKey) {
      parts.push("PRIMARY KEY");
    }

    if (column.isUnique && !column.isPrimaryKey) {
      parts.push("UNIQUE");
    }

    if (column.checkExpression) {
      parts.push(`CHECK (${column.checkExpression})`);
    }

    return parts.join(" ");
  }

  // ─────────────────────────────────────────────────────────────────
  // Materialized View Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate REFRESH MATERIALIZED VIEW statement
   * Default implementation throws - only PostgreSQL supports materialized views
   */
  refreshMaterializedView(
    _schema: string,
    _viewName: string,
    _concurrently?: boolean,
  ): string {
    throw new Error("Materialized views are not supported by this database");
  }

  // Abstract methods - must be implemented by each dialect
  abstract quoteIdentifier(name: string): string;
  abstract quoteString(value: string): string;
  abstract formatValue(value: unknown, column: ColumnInfo): string;

  // ─────────────────────────────────────────────────────────────────
  // Introspection Queries - must be implemented by each dialect
  // ─────────────────────────────────────────────────────────────────

  abstract getDatabasesQuery(): string;
  abstract getSchemasQuery(): string;
  abstract getTablesQuery(schema: string): string;
  abstract getViewsQuery(schema: string): string;
  abstract getFunctionsQuery(schema: string): string;
  abstract getIndexesQuery(schema: string, table: string): string;
  abstract getIndexUsageStatsQuery(schema: string, table: string): string;
  abstract getConstraintsQuery(schema: string, table: string): string;
  abstract getColumnsQuery(schema: string, table: string): string;
  abstract getTriggersQuery(schema: string, table: string): string;
  abstract getSupportedIndexTypesQuery(): string;
  abstract getSupportedColumnTypesQuery(): string;
  abstract getTableCountQuery(
    schema: string,
    table: string,
    exact?: boolean,
  ): string;
  abstract getTableStatsQuery(schema: string, table: string): string;
  abstract getForeignKeyTargetsQuery(schema: string): string;
  abstract getObjectDefinitionQuery(
    objectType: import("../types").ObjectDefinitionType,
    schema: string,
    name: string,
  ): string;
}
