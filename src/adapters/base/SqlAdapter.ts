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
  UpdateOptions,
  DeleteOptions,
  QueryPayload,
  QueryResult,
  ColumnInfo,
  EmbeddedFKConfig,
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
   * Execute SQL via backend execute_query command (Path 2: Streaming Query)
   *
   * This method uses the high-performance streaming path with DirectMsgPackEncoder
   * for all adapter operations (INSERT, UPDATE, DELETE, SELECT). Even for single-row
   * operations, streaming provides consistent API and handles RETURNING clauses that
   * may return multiple rows.
   *
   * ## Why Streaming for All Operations?
   * - Consistent API across all CRUD operations
   * - RETURNING clauses may return multiple rows
   * - Unknown result size for user-generated SQL
   * - Better performance for batch operations
   *
   * ## Architecture
   * Frontend → SqlAdapter.execute() → queryStreamClient → execute_query command
   * → DirectMsgPackEncoder → MessagePack batches
   *
   * See: `docs/query-execution-architecture.md` for detailed architecture documentation.
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
   * Look up column info by name from an optional array, falling back to name-only.
   */
  protected findColumnInfo(name: string, infos?: ColumnInfo[]): ColumnInfo {
    if (infos) {
      const found = infos.find((c) => c.name === name);
      if (found) return found;
    }
    return { name };
  }

  /**
   * Generate INSERT statement
   */
  insert(target: TableRef, data: RowData, options?: InsertOptions): string {
    const table = this.formatTableRef(target);
    const columns = Object.keys(data);
    const columnList = columns.map((c) => this.quoteIdentifier(c)).join(", ");
    const valueList = columns
      .map((c) => this.formatValue(data[c], this.findColumnInfo(c, options?.columnInfos)))
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
  update(target: TableRef, data: RowData, where: WhereClause, options?: UpdateOptions): string {
    const table = this.formatTableRef(target);

    const setClause = Object.entries(data)
      .map(
        ([col, val]) =>
          `${this.quoteIdentifier(col)} = ${this.formatValue(val, this.findColumnInfo(col, options?.columnInfos))}`,
      )
      .join(", ");

    const whereClause = this.buildWhereClause(where, options?.columnInfos);

    let sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;

    if (this.supportsReturning()) {
      sql += " RETURNING *";
    }

    return sql;
  }

  /**
   * Generate DELETE statement
   */
  delete(target: TableRef, where: WhereClause, options?: DeleteOptions): string {
    const table = this.formatTableRef(target);
    const whereClause = this.buildWhereClause(where, options?.columnInfos);

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

    const orderBy = options?.orderBy ? [...options.orderBy] : [];
    const hasOffset = options?.offset !== undefined && options.offset > 0;
    const needsDefaultOrder =
      orderBy.length === 0 && (hasOffset || options?.limit !== undefined);
    if (needsDefaultOrder) {
      const fallbackColumn = this.getFallbackOrderByColumn(options);
      if (fallbackColumn) {
        orderBy.push({
          column: fallbackColumn,
          direction: "ASC",
        });
      }
    }

    if (orderBy.length > 0) {
      const orderClauses = orderBy
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
   * Generate SELECT statement with LEFT JOINs for embedded FK values.
   *
   * Embeds referenced table columns directly in the query result for quick FK lookups.
   * Column alias convention: `__qp_fk__{fkColumn}__{refColumn}`
   *
   * @example
   * ```typescript
   * selectWithEmbeddedFK(
   *   { schema: 'public', table: 'todos' },
   *   {
   *     limit: 300,
   *     embeddedFKs: [
   *       { fkColumn: 'user_id', refSchema: 'public', refTable: 'users', refPkColumn: 'id', refDisplayColumns: ['email'] }
   *     ]
   *   }
   * )
   * // Returns:
   * // SELECT "public"."todos".*, "t1"."email" AS "__qp_fk__user_id__email"
   * // FROM "public"."todos"
   * // LEFT JOIN "public"."users" AS "t1" ON "public"."todos"."user_id" = "t1"."id"
   * // LIMIT 300
   * ```
   */
  selectWithEmbeddedFK(target: TableRef, options: SelectOptions): string {
    const embeddedFKs = options.embeddedFKs;

    if (!embeddedFKs || embeddedFKs.length === 0) {
      return this.select(target, options);
    }

    const mainTable = this.formatTableRef(target);
    const selectColumns = this.buildEmbeddedSelectColumns(mainTable, embeddedFKs);
    const joinClauses = this.buildEmbeddedJoinClauses(mainTable, target, embeddedFKs);

    let sql = `SELECT ${selectColumns} FROM ${mainTable}`;
    sql += joinClauses;

    if (options.rawWhere) {
      sql += ` WHERE ${options.rawWhere}`;
    } else if (options.where && Object.keys(options.where).length > 0) {
      sql += ` WHERE ${this.buildWhereClause(options.where)}`;
    }

    const orderBy = options.orderBy ? [...options.orderBy] : [];
    const hasOffset = options.offset !== undefined && options.offset > 0;
    const needsDefaultOrder =
      orderBy.length === 0 && (hasOffset || options.limit !== undefined);
    if (needsDefaultOrder) {
      const fallbackColumn = this.getFallbackOrderByColumn(options);
      if (fallbackColumn) {
        orderBy.push({
          column: fallbackColumn,
          direction: "ASC",
        });
      }
    }

    if (orderBy.length > 0) {
      const orderClauses = orderBy
        .map((o) => `${mainTable}.${this.quoteIdentifier(o.column)} ${o.direction}`)
        .join(", ");
      sql += ` ORDER BY ${orderClauses}`;
    }

    if (options.limit !== undefined) {
      sql += this.formatLimit(options.limit, options.offset);
    }

    return sql;
  }

  /**
   * Build SELECT column list with embedded FK columns.
   * Format: main_table.*, t1.col AS "__qp_fk__fk_col__ref_col", ...
   */
  private buildEmbeddedSelectColumns(
    mainTable: string,
    embeddedFKs: EmbeddedFKConfig[]
  ): string {
    const columns: string[] = [`${mainTable}.*`];

    embeddedFKs.forEach((fk, index) => {
      const alias = `t${index + 1}`;
      for (const displayCol of fk.refDisplayColumns) {
        const colAlias = `__qp_fk__${fk.fkColumn}__${displayCol}`;
        columns.push(
          `${this.quoteIdentifier(alias)}.${this.quoteIdentifier(displayCol)} AS ${this.quoteIdentifier(colAlias)}`
        );
      }
    });

    return columns.join(", ");
  }

  /**
   * Build LEFT JOIN clauses for embedded FKs.
   * Format: LEFT JOIN ref_schema.ref_table AS t1 ON main_table.fk_col = t1.pk_col
   */
  private buildEmbeddedJoinClauses(
    mainTable: string,
    _target: TableRef,
    embeddedFKs: EmbeddedFKConfig[]
  ): string {
    return embeddedFKs
      .map((fk, index) => {
        const alias = `t${index + 1}`;
        const refTable = this.formatTableRef({
          schema: fk.refSchema,
          table: fk.refTable,
        });
        const fkColumn = `${mainTable}.${this.quoteIdentifier(fk.fkColumn)}`;
        const pkColumn = `${this.quoteIdentifier(alias)}.${this.quoteIdentifier(fk.refPkColumn)}`;

        return ` LEFT JOIN ${refTable} AS ${this.quoteIdentifier(alias)} ON ${fkColumn} = ${pkColumn}`;
      })
      .join("");
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
  protected buildWhereClause(where: WhereClause, columnInfos?: ColumnInfo[]): string {
    const conditions = Object.entries(where).map(([col, val]) => {
      if (val === null) {
        return `${this.quoteIdentifier(col)} IS NULL`;
      }
      return `${this.quoteIdentifier(col)} = ${this.formatValue(val, this.findColumnInfo(col, columnInfos))}`;
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
   * Default ORDER BY column for stable pagination when no sort provided.
   * Returns undefined when no valid column can be determined (e.g., SELECT * without column info).
   * This prevents errors on views/tables that don't have an 'id' column.
   */
  protected getFallbackOrderByColumn(options?: SelectOptions): string | undefined {
    const firstColumn = options?.columns?.[0];
    if (firstColumn && /^[A-Za-z_][A-Za-z0-9_]*$/.test(firstColumn)) {
      return firstColumn;
    }
    return undefined;
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

    if (changes.dataType && this.dbType === "PostgreSQL") {
      // PostgreSQL: drop default before type change to avoid cast errors on the default value,
      // then change the type with USING for explicit casts, then restore the default.
      const hadDefault = changes.previousDefault != null && changes.previousDefault !== "";
      if (hadDefault) {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} DROP DEFAULT`,
        );
      }
      // Strip type parameters for the USING cast (e.g. varchar(255) → varchar, numeric(10,2) → numeric)
      // PostgreSQL's :: cast operator doesn't accept parameterized types
      const castType = changes.dataType.replace(/\(.*\)$/, "");
      statements.push(
        `ALTER TABLE ${table} ALTER COLUMN ${colName} TYPE ${changes.dataType} USING ${colName}::${castType}`,
      );
      // Restore: prefer user-specified new default, fall back to previous default cast to new type
      if (changes.defaultValue !== undefined && changes.defaultValue !== null) {
        // Default values from the structure editor are raw SQL expressions — use directly
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} SET DEFAULT ${changes.defaultValue}`,
        );
      } else if (hadDefault) {
        // Restore the original default expression as-is.
        // The value from pg is already a typed SQL expression (e.g. 'pending'::my_enum),
        // and after the TYPE change it should already be compatible with the new type.
        // If incompatible, PostgreSQL will report a clear error.
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} SET DEFAULT ${changes.previousDefault}`,
        );
      }
    } else if (changes.dataType) {
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

    // Handle default value changes (skip if already handled above for PostgreSQL type change)
    if (changes.defaultValue !== undefined && !(changes.dataType && this.dbType === "PostgreSQL")) {
      if (changes.defaultValue === null) {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} DROP DEFAULT`,
        );
      } else {
        // Default values from the structure editor are raw SQL expressions — use directly
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} SET DEFAULT ${changes.defaultValue}`,
        );
      }
    }

    // Handle comment changes (PostgreSQL syntax)
    if (changes.comment !== undefined) {
      const schema = target.schema ? `${this.quoteIdentifier(target.schema)}.` : '';
      const fullTable = `${schema}${this.quoteIdentifier(target.table)}`;
      if (changes.comment === null || changes.comment === '') {
        statements.push(
          `COMMENT ON COLUMN ${fullTable}.${colName} IS NULL`,
        );
      } else {
        statements.push(
          `COMMENT ON COLUMN ${fullTable}.${colName} IS ${this.quoteString(changes.comment)}`,
        );
      }
    }

    // Handle check constraint changes
    // Note: This adds a new check constraint - dropping existing ones requires constraint name
    if (changes.checkExpression !== undefined && changes.checkExpression !== null && changes.checkExpression !== '') {
      const constraintName = `${target.table}_${columnName}_check`;
      statements.push(
        `ALTER TABLE ${table} ADD CONSTRAINT ${this.quoteIdentifier(constraintName)} CHECK (${changes.checkExpression})`,
      );
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

    // EXECUTE FUNCTION (PostgreSQL style) — quote each part of potentially schema-qualified name
    const fnParts = definition.functionName.split('.');
    const quotedFnName = fnParts.map(p => this.quoteIdentifier(p)).join('.');
    sql += ` EXECUTE FUNCTION ${quotedFnName}()`;

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
   * Rename a trigger
   * PostgreSQL style - override for MySQL, SQLite, SQL Server
   */
  renameTrigger(
    target: TableRef,
    triggerName: string,
    newName: string,
  ): string {
    const table = this.formatTableRef(target);
    return `ALTER TRIGGER ${this.quoteIdentifier(triggerName)} ON ${table} RENAME TO ${this.quoteIdentifier(newName)}`;
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
      // Default values are raw SQL expressions (e.g. now(), 'value'::type) — use directly
      parts.push(`DEFAULT ${column.defaultValue}`);
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
  // Table Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate statements to duplicate a table
   * Base implementation creates a simple structure copy - dialects should override for full features
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
    const schemaPrefix = target.schema ? `${this.quoteIdentifier(target.schema)}.` : '';
    const sourceTable = `${schemaPrefix}${this.quoteIdentifier(options.sourceTableName)}`;
    const newTable = `${schemaPrefix}${this.quoteIdentifier(options.newTableName)}`;
    
    const statements: string[] = [];
    
    // 1. Create table structure (with or without data)
    let createSql = `CREATE TABLE ${newTable} AS SELECT * FROM ${sourceTable}`;
    if (!options.includeData) {
      createSql += ' WHERE 1=0'; // Structure only
    }
    statements.push(createSql);
    
    // Note: Base implementation only creates the table structure
    // Indexes, constraints, and triggers require dialect-specific queries
    // to introspect the source table's metadata.
    // Each dialect should override this method to provide full functionality.
    
    if (options.includeIndexes || options.includeConstraints || options.includeTriggers) {
      statements.push(
        `-- Note: Copying indexes, constraints, and triggers requires database-specific implementation`
      );
    }
    
    return statements.join(';\n') + ';';
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

  // ─────────────────────────────────────────────────────────────────
  // View Operations - must be implemented by each dialect
  // ─────────────────────────────────────────────────────────────────

  abstract createView(
    schema: string,
    definition: import("@/types/crud").ViewDefinitionInput
  ): string;

  abstract dropView(
    schema: string,
    viewName: string,
    ifExists?: boolean,
    cascade?: boolean,
    isMaterialized?: boolean
  ): string;

  abstract replaceView(
    schema: string,
    viewName: string,
    definition: string,
    isMaterialized?: boolean
  ): string;

  abstract renameView(
    schema: string,
    oldName: string,
    newName: string,
    isMaterialized?: boolean
  ): string;

  // ─────────────────────────────────────────────────────────────────
  // Constraint Operations - must be implemented by each dialect
  // ─────────────────────────────────────────────────────────────────

  abstract addConstraint(
    target: TableRef,
    definition: import("@/types/crud").ConstraintDefinitionInput
  ): string;

  abstract dropConstraint(
    target: TableRef,
    constraintName: string,
    cascade?: boolean,
    ifExists?: boolean,
    constraintType?: string
  ): string;

  abstract renameConstraint(
    target: TableRef,
    oldName: string,
    newName: string
  ): string;

  // ─────────────────────────────────────────────────────────────────
  // Sequence Operations - must be implemented by each dialect
  // ─────────────────────────────────────────────────────────────────

  abstract createSequence(
    schema: string,
    definition: import("@/types/crud").SequenceDefinitionInput
  ): string;

  abstract alterSequence(
    schema: string,
    sequenceName: string,
    changes: Partial<import("@/types/crud").SequenceDefinitionInput>
  ): string;

  abstract dropSequence(
    schema: string,
    sequenceName: string,
    ifExists?: boolean,
    cascade?: boolean
  ): string;

  abstract renameSequence(
    schema: string,
    oldName: string,
    newName: string
  ): string;

  // Abstract methods - must be implemented by each dialect
  abstract quoteIdentifier(name: string): string;
  abstract quoteString(value: string): string;
  abstract formatValue(value: unknown, column: ColumnInfo): string;

  /**
   * Optional fallback query for index usage stats when primary telemetry views
   * are unavailable due to permissions or engine limitations.
   * Return null when no fallback is defined for this dialect.
   */
  getIndexUsageStatsFallbackQuery(_schema: string, _table: string): string | null {
    return null;
  }

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
    catalog?: string,
  ): string;
  abstract getTableStatsQuery(schema: string, table: string): string;
  abstract getForeignKeyTargetsQuery(schema: string): string;
  abstract getObjectDefinitionQuery(
    objectType: import("../types").ObjectDefinitionType,
    schema: string,
    name: string,
  ): string;
}
