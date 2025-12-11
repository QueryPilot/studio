/**
 * Dialect Service
 *
 * Provides dialect-aware SQL generation and execution for DDL operations.
 * This service bridges the frontend dialect system with the backend execution.
 */

import { DbType, BackendAPI } from "./backend";
import { getDialect, type SqlDialect } from "@/dialects";
import type {
  CreateIndexParams,
  AddColumnParams,
  ModifyColumnParams,
  AddForeignKeyParams,
  CreateTriggerParams,
} from "@/dialects/types";
import { useConnectionStore } from "@/stores/connectionStoreNew";

// Re-export types for convenience
export type {
  CreateIndexParams,
  AddColumnParams,
  ModifyColumnParams,
  AddForeignKeyParams,
  CreateTriggerParams,
};

/**
 * Get the database type for a connection
 */
export function getConnectionDbType(connectionId: string): DbType {
  const store = useConnectionStore.getState();
  const connection = store.connections.find((c) => c.profile.id === connectionId);
  if (!connection) {
    // Default to PostgreSQL if connection not found
    return DbType.PostgreSQL;
  }
  return connection.profile.db_type || DbType.PostgreSQL;
}

/**
 * Get the dialect for a specific database type
 */
export function getDialectForType(dbType: DbType): SqlDialect {
  return getDialect(dbType);
}

/**
 * Get the dialect for a connection
 */
export function getDialectForConnection(connectionId: string): SqlDialect {
  const dbType = getConnectionDbType(connectionId);
  return getDialect(dbType);
}

/**
 * Dialect Service - provides DDL operations with dialect-aware SQL generation
 */
export const DialectService = {
  /**
   * Get the dialect for a connection
   */
  getDialect(connectionId: string): SqlDialect {
    return getDialectForConnection(connectionId);
  },

  /**
   * Get the dialect for a database type
   */
  getDialectForType(dbType: DbType): SqlDialect {
    return getDialect(dbType);
  },

  // ============================================================================
  // Index Operations
  // ============================================================================

  /**
   * Create an index
   */
  async createIndex(
    connectionId: string,
    params: CreateIndexParams
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.createIndex(params);
    await BackendAPI.executeSql(connectionId, sql);
  },

  /**
   * Drop an index
   */
  async dropIndex(
    connectionId: string,
    schema: string | undefined,
    indexName: string,
    options?: { ifExists?: boolean; cascade?: boolean }
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.dropIndex(schema, indexName, options);
    await BackendAPI.executeSql(connectionId, sql);
  },

  /**
   * Rename an index
   */
  async renameIndex(
    connectionId: string,
    schema: string | undefined,
    oldName: string,
    newName: string
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.renameIndex(schema, oldName, newName);
    await BackendAPI.executeSql(connectionId, sql);
  },

  // ============================================================================
  // Column Operations
  // ============================================================================

  /**
   * Add a column to a table
   */
  async addColumn(
    connectionId: string,
    params: AddColumnParams
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.addColumn(params);
    await BackendAPI.executeSql(connectionId, sql);
  },

  /**
   * Drop a column from a table
   */
  async dropColumn(
    connectionId: string,
    schema: string | undefined,
    table: string,
    column: string,
    options?: { ifExists?: boolean; cascade?: boolean }
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.dropColumn(schema, table, column, options);
    await BackendAPI.executeSql(connectionId, sql);
  },

  /**
   * Modify a column (may generate multiple statements)
   */
  async modifyColumn(
    connectionId: string,
    params: ModifyColumnParams
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const statements = dialect.modifyColumn(params);
    if (statements.length === 1 && statements[0]) {
      await BackendAPI.executeSql(connectionId, statements[0]);
    } else if (statements.length > 1 && statements.every(s => s)) {
      await BackendAPI.executeSqlBatch(connectionId, statements);
    }
  },

  /**
   * Rename a column
   */
  async renameColumn(
    connectionId: string,
    schema: string | undefined,
    table: string,
    oldName: string,
    newName: string
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.renameColumn(schema, table, oldName, newName);
    await BackendAPI.executeSql(connectionId, sql);
  },

  // ============================================================================
  // Foreign Key Operations
  // ============================================================================

  /**
   * Add a foreign key constraint
   */
  async addForeignKey(
    connectionId: string,
    params: AddForeignKeyParams
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.addForeignKey(params);
    await BackendAPI.executeSql(connectionId, sql);
  },

  /**
   * Drop a foreign key constraint
   */
  async dropForeignKey(
    connectionId: string,
    schema: string | undefined,
    table: string,
    constraintName: string,
    options?: { cascade?: boolean }
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.dropForeignKey(schema, table, constraintName, options);
    await BackendAPI.executeSql(connectionId, sql);
  },

  // ============================================================================
  // Trigger Operations
  // ============================================================================

  /**
   * Create a trigger
   */
  async createTrigger(
    connectionId: string,
    params: CreateTriggerParams
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.createTrigger(params);
    await BackendAPI.executeSql(connectionId, sql);
  },

  /**
   * Drop a trigger
   */
  async dropTrigger(
    connectionId: string,
    schema: string | undefined,
    table: string,
    triggerName: string,
    options?: { ifExists?: boolean; cascade?: boolean }
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.dropTrigger(schema, table, triggerName, options);
    await BackendAPI.executeSql(connectionId, sql);
  },

  /**
   * Enable or disable a trigger
   */
  async toggleTrigger(
    connectionId: string,
    schema: string | undefined,
    table: string,
    triggerName: string,
    enabled: boolean
  ): Promise<void> {
    const dialect = getDialectForConnection(connectionId);
    const sql = dialect.toggleTrigger(schema, table, triggerName, enabled);
    await BackendAPI.executeSql(connectionId, sql);
  },

  // ============================================================================
  // Query Building
  // ============================================================================

  /**
   * Build a SELECT query using the dialect
   */
  buildSelectQuery(
    connectionId: string,
    params: Parameters<SqlDialect["buildSelectQuery"]>[0]
  ): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.buildSelectQuery(params);
  },

  /**
   * Build a WHERE clause using the dialect
   */
  buildWhereClause(
    connectionId: string,
    filters: Parameters<SqlDialect["buildWhereClause"]>[0]
  ): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.buildWhereClause(filters);
  },

  /**
   * Quote an identifier using the dialect
   */
  quoteIdentifier(connectionId: string, name: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.quoteIdentifier(name);
  },

  /**
   * Qualify a name (schema.table) using the dialect
   */
  qualifyName(connectionId: string, ...segments: (string | undefined)[]): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.qualifyName(...segments);
  },

  /**
   * Format a literal value using the dialect
   */
  formatLiteral(connectionId: string, value: unknown): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.formatLiteral(value);
  },

  // ============================================================================
  // Introspection Queries
  // ============================================================================

  /**
   * Get the SQL query for listing databases
   */
  getDatabasesQuery(connectionId: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getDatabasesQuery();
  },

  /**
   * Get the SQL query for listing schemas
   */
  getSchemasQuery(connectionId: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getSchemasQuery();
  },

  /**
   * Get the SQL query for listing tables
   */
  getTablesQuery(connectionId: string, schema: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getTablesQuery(schema);
  },

  /**
   * Get the SQL query for listing views
   */
  getViewsQuery(connectionId: string, schema: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getViewsQuery(schema);
  },

  /**
   * Get the SQL query for listing functions
   */
  getFunctionsQuery(connectionId: string, schema: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getFunctionsQuery(schema);
  },

  /**
   * Get the SQL query for listing indexes
   */
  getIndexesQuery(connectionId: string, schema: string, table: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getIndexesQuery(schema, table);
  },

  /**
   * Get the SQL query for index usage statistics
   */
  getIndexUsageStatsQuery(connectionId: string, schema: string, table: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getIndexUsageStatsQuery(schema, table);
  },

  /**
   * Get the SQL query for listing constraints
   */
  getConstraintsQuery(connectionId: string, schema: string, table: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getConstraintsQuery(schema, table);
  },

  /**
   * Get the SQL query for listing columns
   */
  getColumnsQuery(connectionId: string, schema: string, table: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getColumnsQuery(schema, table);
  },

  /**
   * Get the SQL query for listing triggers
   */
  getTriggersQuery(connectionId: string, schema: string, table: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getTriggersQuery(schema, table);
  },

  /**
   * Get the SQL query for supported index types
   */
  getSupportedIndexTypesQuery(connectionId: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getSupportedIndexTypesQuery();
  },

  /**
   * Get the SQL query for supported column types
   */
  getSupportedColumnTypesQuery(connectionId: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getSupportedColumnTypesQuery();
  },

  /**
   * Get the SQL query for table row count
   */
  getTableCountQuery(connectionId: string, schema: string, table: string, exact?: boolean): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getTableCountQuery(schema, table, exact);
  },

  /**
   * Get the SQL query for single table statistics (owner, size, row_count, comment)
   */
  getTableStatsQuery(connectionId: string, schema: string, table: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getTableStatsQuery(schema, table);
  },

  /**
   * Get the SQL query for all referenceable columns (PK + unique) for foreign key targets
   */
  getForeignKeyTargetsQuery(connectionId: string, schema: string): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getForeignKeyTargetsQuery(schema);
  },

  /**
   * Get the SQL query for object definition
   */
  getObjectDefinitionQuery(
    connectionId: string,
    objectType: "table" | "view" | "materialized_view" | "function" | "procedure",
    schema: string,
    name: string
  ): string {
    const dialect = getDialectForConnection(connectionId);
    return dialect.getObjectDefinitionQuery(objectType, schema, name);
  },
};

export default DialectService;
