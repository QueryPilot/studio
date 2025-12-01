/**
 * SQL Dialect System Types
 *
 * This module defines the interfaces for database-specific SQL generation.
 * The goal is to separate SQL generation (frontend) from execution (backend).
 */

import type { DbType } from "@/services/backend";
import type { FilterConfig, SortConfig } from "@/types/filter";

// ============================================================================
// Identifier & Literal Handling
// ============================================================================

export interface DialectIdentifiers {
  /**
   * Quote an identifier (table name, column name, etc.) for safe use in SQL.
   * Handles escaping of special characters within the identifier.
   */
  quoteIdentifier(name: string): string;

  /**
   * Build a fully qualified name (schema.table or database.schema.table)
   */
  qualifyName(...segments: (string | undefined)[]): string;

  /**
   * Escape a string literal value for safe inclusion in SQL.
   * Does NOT add surrounding quotes - just escapes internal characters.
   */
  escapeStringLiteral(value: string): string;

  /**
   * Format a value as a SQL literal (with quotes for strings, etc.)
   */
  formatLiteral(value: unknown): string;
}

// ============================================================================
// Introspection Queries
// ============================================================================

export interface DialectIntrospection {
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

  /** Query to get object definition (view, function, etc.) */
  getObjectDefinitionQuery(
    objectType: "table" | "view" | "materialized_view" | "function" | "procedure",
    schema: string,
    name: string,
  ): string;
}

// ============================================================================
// DDL Generation
// ============================================================================

export interface CreateIndexParams {
  schema?: string;
  table: string;
  indexName: string;
  columns: Array<{
    name: string;
    order?: "ASC" | "DESC";
    nullsPosition?: "FIRST" | "LAST";
    opclass?: string; // PostgreSQL operator class
  }>;
  unique?: boolean;
  using?: string; // btree, hash, gin, gist, etc.
  where?: string; // Partial index condition
  includeColumns?: string[]; // INCLUDE columns (covering index)
  tablespace?: string;
  concurrent?: boolean; // PostgreSQL CONCURRENTLY
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
  position?: "FIRST" | { after: string }; // MySQL-specific
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
  onUpdate?: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION";
  onDelete?: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION";
  deferrable?: boolean;
  initiallyDeferred?: boolean;
}

export interface CreateTriggerParams {
  schema?: string;
  table: string;
  triggerName: string;
  timing: "BEFORE" | "AFTER" | "INSTEAD OF";
  events: Array<"INSERT" | "UPDATE" | "DELETE" | "TRUNCATE">;
  level: "ROW" | "STATEMENT";
  functionName: string;
  functionSchema?: string;
  condition?: string; // WHEN clause
  updateColumns?: string[]; // FOR UPDATE OF columns
}

export interface DialectDDL {
  // Index operations
  createIndex(params: CreateIndexParams): string;
  dropIndex(schema: string | undefined, indexName: string, options?: { ifExists?: boolean; cascade?: boolean }): string;
  renameIndex(schema: string | undefined, oldName: string, newName: string): string;

  // Column operations
  addColumn(params: AddColumnParams): string;
  dropColumn(schema: string | undefined, table: string, column: string, options?: { ifExists?: boolean; cascade?: boolean }): string;
  modifyColumn(params: ModifyColumnParams): string[];
  renameColumn(schema: string | undefined, table: string, oldName: string, newName: string): string;

  // Foreign key operations
  addForeignKey(params: AddForeignKeyParams): string;
  dropForeignKey(schema: string | undefined, table: string, constraintName: string, options?: { cascade?: boolean }): string;

  // Trigger operations
  createTrigger(params: CreateTriggerParams): string;
  dropTrigger(schema: string | undefined, table: string, triggerName: string, options?: { ifExists?: boolean; cascade?: boolean }): string;
  toggleTrigger(schema: string | undefined, table: string, triggerName: string, enabled: boolean): string;
}

// ============================================================================
// Data Query Building
// ============================================================================

export interface SelectQueryParams {
  schema?: string;
  table: string;
  columns?: string[];
  filters?: FilterConfig;
  sorts?: SortConfig[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
}

export interface DialectDataQuery {
  /** Build a SELECT query with optional filters, sorts, pagination */
  buildSelectQuery(params: SelectQueryParams): string;

  /** Build a WHERE clause from filter configuration */
  buildWhereClause(filters: FilterConfig): string;

  /** Build an ORDER BY clause from sort configuration */
  buildOrderByClause(sorts: SortConfig[]): string;
}

// ============================================================================
// Main Dialect Interface
// ============================================================================

export interface SqlDialect extends DialectIdentifiers, DialectIntrospection, DialectDDL, DialectDataQuery {
  /** Dialect name (e.g., "PostgreSQL", "MySQL") */
  readonly name: string;

  /** Database type enum value */
  readonly dbType: DbType;

  /** SQL boolean literals */
  readonly booleanLiterals: { true: string; false: string };

  /** Whether this dialect supports schemas */
  readonly supportsSchemas: boolean;

  /** Whether this dialect supports streaming/cursors */
  readonly supportsStreaming: boolean;
}

// ============================================================================
// Dialect Registry
// ============================================================================

export type DialectFactory = () => SqlDialect;

export interface DialectRegistry {
  register(dbType: DbType, factory: DialectFactory): void;
  get(dbType: DbType): SqlDialect;
  has(dbType: DbType): boolean;
}
