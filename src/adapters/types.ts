/**
 * Frontend Database Adapter Types
 *
 * Multi-paradigm adapter pattern for SQL, NoSQL, and Graph databases.
 * Each adapter generates appropriate queries for its database type.
 */

import type { DbType } from '@/types/connection';
import type { ColumnMeta } from '@/types/database';
import type {
  ColumnDefinitionInput,
  IndexDefinitionInput,
  TriggerDefinitionInput,
  ViewDefinitionInput,
  ConstraintDefinitionInput,
  SequenceDefinitionInput,
} from '@/types/crud';

// ============================================================================
// DDL Parameter Types
// ============================================================================

export interface CreateIndexParams {
  schema?: string;
  table: string;
  indexName: string;
  columns: Array<{
    name: string;
    order?: 'ASC' | 'DESC';
    nullsPosition?: 'FIRST' | 'LAST';
    opclass?: string;
  }>;
  unique?: boolean;
  using?: string;
  where?: string;
  includeColumns?: string[];
  tablespace?: string;
  concurrent?: boolean;
}

export interface AddColumnParams {
  schema?: string;
  table: string;
  column: {
    name: string;
    dataType: string;
    length?: number;
    precision?: number;
    scale?: number;
    nullable?: boolean;
    defaultValue?: unknown;
    isUnique?: boolean;
    isPrimaryKey?: boolean;
    checkExpression?: string;
    comment?: string;
  };
  position?: 'FIRST' | { after: string };
}

export interface ModifyColumnParams {
  schema?: string;
  table: string;
  columnName: string;
  changes: {
    dataType?: string;
    length?: number;
    precision?: number;
    scale?: number;
    nullable?: boolean;
    defaultValue?: unknown;
    dropDefault?: boolean;
    comment?: string;
  };
}

export interface AddForeignKeyParams {
  schema?: string;
  table: string;
  constraintName: string;
  columns: string[];
  referenceSchema?: string;
  referenceTable: string;
  referenceColumns: string[];
  onUpdate?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
  onDelete?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
  deferrable?: boolean;
  initiallyDeferred?: boolean;
}

export interface CreateTriggerParams {
  schema?: string;
  table: string;
  triggerName: string;
  timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  events: Array<'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'>;
  level: 'ROW' | 'STATEMENT';
  functionName: string;
  functionSchema?: string;
  condition?: string;
  updateColumns?: string[];
}

/**
 * Query payload - SQL string for relational DBs, object for document/graph DBs
 */
export type QueryPayload = string | object;

/**
 * Database paradigm type
 */
export type DatabaseParadigm = 'sql' | 'document' | 'graph' | 'keyvalue';

/**
 * Table reference with optional schema
 */
export interface TableRef {
  schema?: string;
  table: string;
}

/**
 * Simple WHERE clause - column to value mapping
 * For complex queries, use raw SQL via select()
 */
export interface WhereClause {
  [column: string]: unknown;
}

/**
 * Row data for INSERT/UPDATE operations
 */
export type RowData = Record<string, unknown>;

/**
 * Configuration for embedding FK referenced column values in query results.
 * Used by SqlAdapter.selectWithEmbeddedFK() to build LEFT JOINs.
 * Column alias convention: `__qp_fk__{fkColumn}__{refColumn}`
 */
export interface EmbeddedFKConfig {
  /** The FK column name in the source table (e.g., "user_id") */
  fkColumn: string;
  /** Schema of the referenced table */
  refSchema: string;
  /** Name of the referenced table (e.g., "users") */
  refTable: string;
  /** Primary key column in referenced table (e.g., "id") */
  refPkColumn: string;
  /** Column(s) to embed from referenced table (e.g., ["email", "name"]) */
  refDisplayColumns: string[];
}

/**
 * Options for SELECT queries
 */
export interface SelectOptions {
  columns?: string[];
  where?: WhereClause;
  /** Raw WHERE clause string - takes precedence over `where` if provided */
  rawWhere?: string;
  orderBy?: { column: string; direction: 'ASC' | 'DESC' }[];
  limit?: number;
  offset?: number;
  /** FK columns to embed with their referenced display values */
  embeddedFKs?: EmbeddedFKConfig[];
}

/**
 * Options for INSERT operations
 */
export interface InsertOptions {
  returning?: boolean;
  /** Column type metadata for type-aware formatting (e.g., PostgreSQL casts) */
  columnInfos?: ColumnInfo[];
}

/**
 * Options for UPDATE operations
 */
export interface UpdateOptions {
  /** Column type metadata for type-aware formatting (e.g., PostgreSQL casts) */
  columnInfos?: ColumnInfo[];
}

/**
 * Options for DELETE operations
 */
export interface DeleteOptions {
  /** Column type metadata for type-aware formatting (e.g., PostgreSQL casts) */
  columnInfos?: ColumnInfo[];
}

/**
 * Query result from database
 */
export interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  rowCount?: number;
}

/**
 * Column metadata for value formatting
 */
export interface ColumnInfo {
  name: string;
  dbType?: string;
}

/**
 * Core database adapter interface
 *
 * Implementations generate appropriate queries for their database type
 * and execute them via the backend.
 */
export interface DatabaseAdapter {
  /** Database type (PostgreSQL, MySQL, etc.) */
  readonly dbType: DbType;

  /** Database paradigm (sql, document, graph, keyvalue) */
  readonly paradigm: DatabaseParadigm;

  /** Connection ID for this adapter */
  readonly connectionId: string;

  /**
   * Execute a query via the backend
   * @param query - SQL string or query object
   * @returns Query result with rows and columns
   */
  execute(query: QueryPayload): Promise<QueryResult>;

  /**
   * Generate INSERT query
   * @param target - Table reference
   * @param data - Row data to insert
   * @param options - Insert options (returning, etc.)
   */
  insert(target: TableRef, data: RowData, options?: InsertOptions): QueryPayload;

  /**
   * Generate UPDATE query
   * @param target - Table reference
   * @param data - Columns to update
   * @param where - WHERE clause conditions
   */
  update(target: TableRef, data: RowData, where: WhereClause, options?: UpdateOptions): QueryPayload;

  /**
   * Generate DELETE query
   * @param target - Table reference
   * @param where - WHERE clause conditions
   */
  delete(target: TableRef, where: WhereClause, options?: DeleteOptions): QueryPayload;

  /**
   * Generate SELECT query
   * @param target - Table reference
   * @param options - Select options (columns, where, limit, etc.)
   */
  select(target: TableRef, options?: SelectOptions): QueryPayload;

  /**
   * Generate SELECT query with LEFT JOINs for embedded FK values.
   * Embeds referenced table columns directly in the query result for quick FK lookups.
   * @param target - Table reference
   * @param options - Select options including embeddedFKs configuration
   */
  selectWithEmbeddedFK(target: TableRef, options: SelectOptions): QueryPayload;

  /**
   * Wrap multiple operations in a transaction
   * @param operations - Array of query payloads
   */
  transaction(operations: QueryPayload[]): QueryPayload;

  /**
   * Format a value for SQL (handles escaping, type casting)
   * @param value - Value to format
   * @param column - Column metadata for type-aware formatting
   */
  formatValue(value: unknown, column: ColumnInfo): string;

  /**
   * Quote an identifier (table/column name)
   * @param name - Identifier to quote
   */
  quoteIdentifier(name: string): string;

  /**
   * Quote/escape a string value
   * @param value - String to quote
   */
  quoteString(value: string): string;

  // ─────────────────────────────────────────────────────────────────
  // DDL Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate ADD COLUMN statement
   * @param target - Table reference
   * @param column - Column definition
   */
  addColumn(target: TableRef, column: ColumnDefinitionInput): QueryPayload;

  /**
   * Generate ALTER COLUMN statements for modifications
   * @param target - Table reference
   * @param columnName - Existing column name
   * @param changes - Changed properties
   */
  modifyColumn(
    target: TableRef,
    columnName: string,
    changes: Partial<ColumnDefinitionInput>
  ): QueryPayload;

  /**
   * Generate DROP COLUMN statement
   * @param target - Table reference
   * @param columnName - Column to drop
   * @param cascade - Whether to cascade
   */
  dropColumn(target: TableRef, columnName: string, cascade?: boolean): QueryPayload;

  /**
   * Generate RENAME COLUMN statement
   * @param target - Table reference
   * @param oldName - Current column name
   * @param newName - New column name
   */
  renameColumn(target: TableRef, oldName: string, newName: string): QueryPayload;

  // ─────────────────────────────────────────────────────────────────
  // Index DDL Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate CREATE INDEX statement
   * @param target - Table reference
   * @param definition - Index definition
   */
  createIndex(target: TableRef, definition: IndexDefinitionInput): QueryPayload;

  /**
   * Generate DROP INDEX statement
   * @param target - Table reference
   * @param indexName - Index name to drop
   * @param ifExists - Whether to use IF EXISTS
   */
  dropIndex(target: TableRef, indexName: string, ifExists?: boolean): QueryPayload;

  /**
   * Generate RENAME INDEX statement
   * @param target - Table reference
   * @param oldName - Current index name
   * @param newName - New index name
   */
  renameIndex(target: TableRef, oldName: string, newName: string): QueryPayload;

  // ─────────────────────────────────────────────────────────────────
  // Trigger DDL Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate CREATE TRIGGER statement
   * @param target - Table reference
   * @param definition - Trigger definition
   */
  createTrigger(target: TableRef, definition: TriggerDefinitionInput): QueryPayload;

  /**
   * Generate DROP TRIGGER statement
   * @param target - Table reference
   * @param triggerName - Trigger name to drop
   * @param ifExists - Whether to use IF EXISTS
   */
  dropTrigger(target: TableRef, triggerName: string, ifExists?: boolean): QueryPayload;

  /**
   * Rename a trigger
   */
  renameTrigger(target: TableRef, triggerName: string, newName: string): QueryPayload;

  /**
   * Generate ENABLE/DISABLE TRIGGER statement
   * @param target - Table reference
   * @param triggerName - Trigger name
   * @param enable - true to enable, false to disable
   */
  toggleTrigger(target: TableRef, triggerName: string, enable: boolean): QueryPayload;

  // ─────────────────────────────────────────────────────────────────
  // View DDL Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate CREATE VIEW statement
   * @param schema - Schema name
   * @param definition - View definition
   */
  createView(schema: string, definition: ViewDefinitionInput): QueryPayload;

  /**
   * Generate DROP VIEW statement
   * @param schema - Schema name
   * @param viewName - View name to drop
   * @param ifExists - Whether to use IF EXISTS
   * @param cascade - Whether to cascade
   * @param isMaterialized - Whether it's a materialized view
   */
  dropView(
    schema: string,
    viewName: string,
    ifExists?: boolean,
    cascade?: boolean,
    isMaterialized?: boolean
  ): QueryPayload;

  /**
   * Generate CREATE OR REPLACE VIEW statement
   * @param schema - Schema name
   * @param viewName - View name
   * @param definition - New view definition SQL
   * @param isMaterialized - Whether it's a materialized view
   */
  replaceView(
    schema: string,
    viewName: string,
    definition: string,
    isMaterialized?: boolean
  ): QueryPayload;

  /**
   * Generate RENAME VIEW statement
   * @param schema - Schema name
   * @param oldName - Current view name
   * @param newName - New view name
   * @param isMaterialized - Whether it's a materialized view
   */
  renameView(
    schema: string,
    oldName: string,
    newName: string,
    isMaterialized?: boolean
  ): QueryPayload;

  // ─────────────────────────────────────────────────────────────────
  // Constraint DDL Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate ADD CONSTRAINT statement
   * @param target - Table reference
   * @param definition - Constraint definition
   */
  addConstraint(target: TableRef, definition: ConstraintDefinitionInput): QueryPayload;

  /**
   * Generate DROP CONSTRAINT statement
   * @param target - Table reference
   * @param constraintName - Constraint name to drop
   * @param cascade - Whether to cascade
   * @param ifExists - Whether to use IF EXISTS
   */
  dropConstraint(
    target: TableRef,
    constraintName: string,
    cascade?: boolean,
    ifExists?: boolean,
    constraintType?: string
  ): QueryPayload;

  /**
   * Generate RENAME CONSTRAINT statement
   * @param target - Table reference
   * @param oldName - Current constraint name
   * @param newName - New constraint name
   */
  renameConstraint(target: TableRef, oldName: string, newName: string): QueryPayload;

  // ─────────────────────────────────────────────────────────────────
  // Sequence DDL Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate CREATE SEQUENCE statement
   * @param schema - Schema name
   * @param definition - Sequence definition
   */
  createSequence(schema: string, definition: SequenceDefinitionInput): QueryPayload;

  /**
   * Generate ALTER SEQUENCE statement
   * @param schema - Schema name
   * @param sequenceName - Sequence name
   * @param changes - Properties to change
   */
  alterSequence(
    schema: string,
    sequenceName: string,
    changes: Partial<SequenceDefinitionInput>
  ): QueryPayload;

  /**
   * Generate DROP SEQUENCE statement
   * @param schema - Schema name
   * @param sequenceName - Sequence name to drop
   * @param ifExists - Whether to use IF EXISTS
   * @param cascade - Whether to cascade
   */
  dropSequence(
    schema: string,
    sequenceName: string,
    ifExists?: boolean,
    cascade?: boolean
  ): QueryPayload;

  /**
   * Generate RENAME SEQUENCE statement
   * @param schema - Schema name
   * @param oldName - Current sequence name
   * @param newName - New sequence name
   */
  renameSequence(schema: string, oldName: string, newName: string): QueryPayload;

  // ─────────────────────────────────────────────────────────────────
  // Table Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate statements to duplicate a table with optional data, indexes, constraints, and triggers
   * @param target - Source table reference
   * @param options - Duplication options (new name, what to include)
   * @returns SQL statements to create the duplicate table
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
  ): QueryPayload;

  // ─────────────────────────────────────────────────────────────────
  // Introspection Queries
  // ─────────────────────────────────────────────────────────────────

  /** Query to list all databases */
  getDatabasesQuery(): string;

  /** Query to list schemas in the current database */
  getSchemasQuery(): string;

  /** Query to list tables in a schema */
  getTablesQuery(schema: string): string;

  /** Query to list views in a schema */
  getViewsQuery(schema: string): string;

  /** Query to list functions/procedures in a schema */
  getFunctionsQuery(schema: string): string;

  /** Query to list indexes on a table */
  getIndexesQuery(schema: string, table: string): string;

  /** Query to get index usage statistics */
  getIndexUsageStatsQuery(schema: string, table: string): string;

  /**
   * Optional fallback query for index usage statistics.
   * Return null when no fallback is available.
   */
  getIndexUsageStatsFallbackQuery(schema: string, table: string): string | null;

  /** Query to list constraints on a table */
  getConstraintsQuery(schema: string, table: string): string;

  /** Query to list columns of a table */
  getColumnsQuery(schema: string, table: string): string;

  /** Query to list triggers on a table */
  getTriggersQuery(schema: string, table: string): string;

  /** Query to get supported index types */
  getSupportedIndexTypesQuery(): string;

  /** Query to get supported column types */
  getSupportedColumnTypesQuery(): string;

  /** Query to count rows in a table (estimated or exact) */
  getTableCountQuery(schema: string, table: string, exact?: boolean): string;

  /** Query to get stats for a single table (owner, size, row_count, comment) */
  getTableStatsQuery(schema: string, table: string): string;

  /** Query to get all referenceable columns (PK + unique) for foreign key targets */
  getForeignKeyTargetsQuery(schema: string): string;

  /** Query to get object definition (view, function, etc.) */
  getObjectDefinitionQuery(
    objectType: ObjectDefinitionType,
    schema: string,
    name: string
  ): string;

  // ─────────────────────────────────────────────────────────────────
  // MySQL/MariaDB-specific Introspection (optional)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Query to list events in a schema (MySQL/MariaDB only)
   * Returns empty result for databases that don't support events
   */
  getEventsQuery?(schema: string): string;

  /**
   * Query to list partitions for a table (MySQL/MariaDB only)
   * Returns empty result for databases that don't support partitions
   */
  getPartitionsQuery?(schema: string, table: string): string;

  // ─────────────────────────────────────────────────────────────────
  // Materialized View Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate REFRESH MATERIALIZED VIEW statement
   * @param schema - Schema name
   * @param viewName - Materialized view name
   * @param concurrently - Whether to refresh concurrently (PostgreSQL only)
   */
  refreshMaterializedView(schema: string, viewName: string, concurrently?: boolean): QueryPayload;
}

/**
 * Supported object types for DDL definition retrieval.
 * Not all databases support all types - adapters return appropriate errors for unsupported types.
 */
export type ObjectDefinitionType =
  | 'table'
  | 'view'
  | 'materialized_view'
  | 'function'
  | 'procedure'
  | 'sequence'
  | 'enum'
  | 'domain'
  | 'composite'
  | 'index';

// ============================================================================
// Base Adapter Types for Multi-Paradigm Support
// ============================================================================

/**
 * Base adapter interface - all adapters implement this
 */
export interface BaseAdapter {
  /** Connection ID for this adapter */
  readonly connectionId: string;
  /** Database type (PostgreSQL, MySQL, MongoDB, Redis, etc.) */
  readonly dbType: DbType;
  /** Database paradigm (sql, document, keyvalue) */
  readonly paradigm: DatabaseParadigm;
}

/**
 * MongoDB adapter interface (document paradigm)
 */
export interface MongoDBAdapter extends BaseAdapter {
  readonly paradigm: 'document';
}

/**
 * Redis adapter interface (keyvalue paradigm)
 */
export interface RedisAdapter extends BaseAdapter {
  readonly paradigm: 'keyvalue';
}

// ============================================================================
// Type Guards for Paradigm-Specific Adapters
// ============================================================================

/**
 * Check if an adapter is a SQL adapter
 */
export function isSqlAdapter(adapter: BaseAdapter): adapter is DatabaseAdapter {
  return adapter.paradigm === 'sql';
}

/**
 * Check if an adapter is a Document adapter (MongoDB)
 */
export function isDocumentAdapter(
  adapter: BaseAdapter
): adapter is MongoDBAdapter {
  return adapter.paradigm === 'document';
}

/**
 * Check if an adapter is a KeyValue adapter (Redis)
 */
export function isKeyValueAdapter(
  adapter: BaseAdapter
): adapter is RedisAdapter {
  return adapter.paradigm === 'keyvalue';
}
