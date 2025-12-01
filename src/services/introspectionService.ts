/**
 * Introspection Service
 *
 * Provides database introspection using the frontend dialect system.
 * Uses DialectService for SQL generation and BackendAPI.query() for execution.
 *
 * This replaces the database-specific Rust adapter introspection with a
 * unified frontend-driven approach that supports multiple database types.
 */

import {
  BackendAPI,
  type Database,
  type Schema,
  type Table,
  type View,
  type Function,
  type Index,
  type IndexUsageStats,
  type Constraint,
  type Trigger,
  type ColumnMeta,
  type CellValue,
  TableKind,
  ConstraintType,
} from "./backend";
import { DialectService } from "./dialectService";

/**
 * Helper to safely get a string value from a cell
 */
function getString(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Helper to safely get a boolean value from a cell
 */
function getBool(value: CellValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" || value === "t";
  return Boolean(value);
}

/**
 * Helper to safely get a number value from a cell
 */
function getNumber(value: CellValue | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Helper to safely get a string array from a cell
 */
function getStringArray(value: CellValue | undefined): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    // Handle PostgreSQL array format: {a,b,c}
    if (value.startsWith("{") && value.endsWith("}")) {
      return value.slice(1, -1).split(",").filter(Boolean);
    }
    return [value];
  }
  return [];
}

/**
 * Map table kind string to enum
 */
function mapTableKind(kind: string | null | undefined): TableKind {
  switch (kind?.toLowerCase()) {
    case "partitioned":
      return TableKind.Partitioned;
    case "foreign":
      return TableKind.Foreign;
    case "temporary":
      return TableKind.Temporary;
    default:
      return TableKind.Regular;
  }
}

/**
 * Map constraint type string to enum
 */
function mapConstraintType(type: string | null | undefined): ConstraintType {
  const normalized = type?.toUpperCase().replace(/\s+/g, "");
  switch (normalized) {
    case "PRIMARYKEY":
      return ConstraintType.PrimaryKey;
    case "FOREIGNKEY":
      return ConstraintType.ForeignKey;
    case "UNIQUE":
      return ConstraintType.Unique;
    case "CHECK":
      return ConstraintType.Check;
    case "EXCLUSION":
      return ConstraintType.Exclusion;
    default:
      return ConstraintType.Check;
  }
}

/**
 * Introspection Service - dialect-aware database metadata retrieval
 */
export const IntrospectionService = {
  /**
   * Get all databases
   */
  async getDatabases(connectionId: string): Promise<Database[]> {
    const sql = DialectService.getDatabasesQuery(connectionId);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      name: getString(row[0]),
      owner: getString(row[1]) || undefined,
      encoding: getString(row[2]) || undefined,
      collation: getString(row[3]) || undefined,
      size: getString(row[4]) || undefined,
    }));
  },

  /**
   * Get schemas in the current database
   */
  async getSchemas(connectionId: string): Promise<Schema[]> {
    const sql = DialectService.getSchemasQuery(connectionId);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      name: getString(row[0]),
      owner: getString(row[1]) || undefined,
    }));
  },

  /**
   * Get tables in a schema
   */
  async getTables(connectionId: string, schema: string): Promise<Table[]> {
    const sql = DialectService.getTablesQuery(connectionId, schema);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      schema: getString(row[0]),
      name: getString(row[1]),
      kind: mapTableKind(getString(row[2])),
      owner: getString(row[3]) || undefined,
      size: getString(row[4]) || undefined,
      row_count: getNumber(row[5]),
      comment: getString(row[6]) || undefined,
    }));
  },

  /**
   * Get views in a schema
   */
  async getViews(connectionId: string, schema: string): Promise<View[]> {
    const sql = DialectService.getViewsQuery(connectionId, schema);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      schema: getString(row[0]),
      name: getString(row[1]),
      owner: getString(row[2]) || undefined,
      definition: getString(row[3]) || undefined,
      is_materialized: getBool(row[4]),
      comment: getString(row[5]) || undefined,
    }));
  },

  /**
   * Get functions in a schema
   */
  async getFunctions(connectionId: string, schema: string): Promise<Function[]> {
    const sql = DialectService.getFunctionsQuery(connectionId, schema);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      schema: getString(row[0]),
      name: getString(row[1]),
      arguments: getString(row[2]),
      return_type: getString(row[3]),
      language: getString(row[4]),
      is_aggregate: getBool(row[5]),
      is_window: getBool(row[6]),
      is_trigger: getBool(row[7]),
      source: getString(row[8]) || undefined,
    }));
  },

  /**
   * Get indexes on a table
   */
  async getIndexes(connectionId: string, schema: string, table: string): Promise<Index[]> {
    const sql = DialectService.getIndexesQuery(connectionId, schema, table);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      name: getString(row[0]),
      table_name: getString(row[1]),
      columns: getStringArray(row[2]),
      is_unique: getBool(row[3]),
      is_primary: getBool(row[4]),
      is_partial: getBool(row[5]),
      definition: getString(row[6]),
      is_foreign_key: getBool(row[7]),
    }));
  },

  /**
   * Get index usage statistics
   */
  async getIndexUsageStats(
    connectionId: string,
    schema: string,
    table: string
  ): Promise<IndexUsageStats[]> {
    const sql = DialectService.getIndexUsageStatsQuery(connectionId, schema, table);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      index_name: getString(row[0]),
      scan_count: getNumber(row[1]),
      rows_read: getNumber(row[2]),
      rows_returned: getNumber(row[3]),
      size_pretty: getString(row[4]) || undefined,
      size_bytes: getNumber(row[5]),
      is_unused: getBool(row[6]),
      cache_hit_ratio: getNumber(row[7]),
      last_used: getString(row[8]) || undefined,
    }));
  },

  /**
   * Get constraints on a table
   */
  async getConstraints(connectionId: string, schema: string, table: string): Promise<Constraint[]> {
    const sql = DialectService.getConstraintsQuery(connectionId, schema, table);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      name: getString(row[0]),
      table_name: getString(row[1]),
      constraint_type: mapConstraintType(getString(row[2])),
      definition: getString(row[3]),
      foreign_table: getString(row[4]) || undefined,
    }));
  },

  /**
   * Get columns of a table
   */
  async getColumns(connectionId: string, schema: string, table: string): Promise<ColumnMeta[]> {
    const sql = DialectService.getColumnsQuery(connectionId, schema, table);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => {
      const rawType = getString(row[1]);
      return {
        name: getString(row[0]),
        data_type: "Text" as const, // Will be mapped properly based on type
        db_type: rawType,
        type_oid: getNumber(row[2]),
        nullable: getBool(row[3]),
        primary_key: getBool(row[4]),
        default_value: getString(row[5]) || undefined,
        comment: getString(row[6]) || undefined,
        type_category: getString(row[7]) || undefined,
        enum_values: getStringArray(row[8]),
      };
    });
  },

  /**
   * Get triggers on a table
   */
  async getTriggers(connectionId: string, schema: string, table: string): Promise<Trigger[]> {
    const sql = DialectService.getTriggersQuery(connectionId, schema, table);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      name: getString(row[0]),
      schema: getString(row[1]),
      table_name: getString(row[2]),
      timing: getString(row[3]),
      event: getStringArray(row[4]).join(", "),
      level: getString(row[5]),
      function: getString(row[6]),
      enabled: getBool(row[7]),
      condition: getString(row[8]) || undefined,
    }));
  },

  /**
   * Get supported index types
   */
  async getSupportedIndexTypes(connectionId: string): Promise<string[]> {
    const sql = DialectService.getSupportedIndexTypesQuery(connectionId);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => getString(row[0]));
  },

  /**
   * Get supported column types
   */
  async getSupportedColumnTypes(connectionId: string): Promise<string[]> {
    const sql = DialectService.getSupportedColumnTypesQuery(connectionId);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => getString(row[0]));
  },

  /**
   * Get table row count
   * First tries estimated count (faster), falls back to exact count if estimation returns -1
   */
  async getTableCount(connectionId: string, schema: string, table: string): Promise<number> {
    // Try estimated count first (uses pg_class statistics)
    const estimatedSql = DialectService.getTableCountQuery(connectionId, schema, table, false);
    const estimatedResult = await BackendAPI.query(connectionId, estimatedSql);

    if (estimatedResult.rows.length > 0) {
      const count = getNumber(estimatedResult.rows[0]?.[0]) ?? -1;
      // If estimated count is valid (>= 0), return it
      if (count >= 0) {
        return count;
      }
    }

    // Fall back to exact count if estimation returned -1 or failed
    const exactSql = DialectService.getTableCountQuery(connectionId, schema, table, true);
    const exactResult = await BackendAPI.query(connectionId, exactSql);

    if (exactResult.rows.length > 0) {
      return getNumber(exactResult.rows[0]?.[0]) ?? 0;
    }
    return 0;
  },

  /**
   * Get object definition (view, function, table DDL)
   */
  async getObjectDefinition(
    connectionId: string,
    objectType: "table" | "view" | "materialized_view" | "function" | "procedure",
    schema: string,
    name: string
  ): Promise<string> {
    const sql = DialectService.getObjectDefinitionQuery(connectionId, objectType, schema, name);
    const result = await BackendAPI.query(connectionId, sql);

    if (result.rows.length > 0) {
      return getString(result.rows[0]?.[0]);
    }
    return "";
  },
};

export default IntrospectionService;
