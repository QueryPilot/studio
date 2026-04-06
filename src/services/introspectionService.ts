/**
 * Introspection Service
 *
 * Provides database introspection using the adapter system.
 * Uses adapters for SQL generation and BackendAPI.query() for execution.
 */

import { logger } from "@/lib/logger";
import { DbType } from "@/types/connection";
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
  type Event,
  type Partition,
  type QueryColumnMeta,
  TableKind,
  ConstraintType,
  type RawCellValue,
} from "./backend";
import { getSqlAdapterForConnection } from "@/adapters";
import type { ObjectDefinitionType } from "@/adapters/types";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Helper to safely get a string value from a cell
 */
function getString(value: RawCellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Helper to safely get a boolean value from a cell
 */
function getBool(value: RawCellValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "t", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "f", "0", "no", "n", ""].includes(normalized)) return false;
  }
  return Boolean(value);
}

/**
 * Helper to safely get a number value from a cell
 */
function getNumber(value: RawCellValue | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Helper to safely get a string array from a cell
 */
function getStringArray(value: RawCellValue | undefined): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    // Handle JSON array format (e.g. from MSSQL or custom formatting)
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // Ignore parse error, treat as string
      }
    }
    // Handle PostgreSQL array format: {a,b,c}
    if (value.startsWith("{") && value.endsWith("}")) {
      return value.slice(1, -1).split(",").filter(Boolean);
    }
    // Handle comma-separated lists (fallback)
    if (value.includes(",")) {
      return value.split(",").map((s) => s.trim());
    }
    return [value];
  }
  return [];
}

function mapIndexUsageStatsRow(row: RawCellValue[]): IndexUsageStats {
  return {
    index_name: getString(row[0]),
    scan_count: getNumber(row[1]),
    rows_read: getNumber(row[2]),
    rows_returned: getNumber(row[3]),
    size_pretty: getString(row[4]) || undefined,
    size_bytes: getNumber(row[5]),
    is_unused: getBool(row[6]),
    cache_hit_ratio: getNumber(row[7]),
    last_used: getString(row[8]) || undefined,
  };
}

function parseMySqlEnumOrSet(
  formattedType: string,
): { kind: "enum" | "set"; values: string[] } | null {
  const trimmed = formattedType.trim();
  const lower = trimmed.toLowerCase();
  const kind = lower.startsWith("enum(")
    ? "enum"
    : lower.startsWith("set(")
    ? "set"
    : null;
  if (!kind) return null;

  const open = trimmed.indexOf("(");
  const close = trimmed.lastIndexOf(")");
  if (open < 0 || close <= open) {
    return { kind, values: [] };
  }

  const body = trimmed.slice(open + 1, close);
  const values: string[] = [];
  let i = 0;

  const decodeEscape = (next: string): string => {
    switch (next) {
      case "0":
        return "\0";
      case "b":
        return "\b";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "Z":
        return "\x1a";
      case "'":
        return "'";
      case '"':
        return '"';
      case "\\":
        return "\\";
      default:
        return next;
    }
  };

  while (i < body.length) {
    while (i < body.length && (body[i] === "," || /\s/.test(body[i]!))) {
      i++;
    }
    if (i >= body.length) break;

    if (body[i] === "'") {
      i++;
      let value = "";
      while (i < body.length) {
        const ch = body[i];
        if (ch === "\\") {
          const next = body[i + 1];
          if (next !== undefined) {
            value += decodeEscape(next);
            i += 2;
            continue;
          }
        }
        if (ch === "'") {
          if (body[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += ch;
        i++;
      }
      values.push(value);
    } else {
      const start = i;
      while (i < body.length && body[i] !== ",") {
        i++;
      }
      const raw = body.slice(start, i).trim();
      if (raw) values.push(raw);
    }

    while (i < body.length && body[i] !== ",") {
      i++;
    }
    if (body[i] === ",") {
      i++;
    }
  }

  return { kind, values };
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
 * Introspection Service - adapter-driven database metadata retrieval
 */
export const IntrospectionService = {
  async getDatabases(connectionId: string): Promise<Database[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) {
      return [];
    }
    const sql = adapter.getDatabasesQuery();
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      name: getString(row[0]),
      owner: getString(row[1]) || undefined,
      encoding: getString(row[2]) || undefined,
      collation: getString(row[3]) || undefined,
      size: getString(row[4]) || undefined,
    }));
  },

  async getSchemas(connectionId: string): Promise<Schema[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) {
      return [];
    }
    const sql = adapter.getSchemasQuery();
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      name: getString(row[0]),
      owner: getString(row[1]) || undefined,
    }));
  },

  async getTables(connectionId: string, schema: string): Promise<Table[]> {
    logger.info(`[IntrospectionService] getTables called for ${connectionId}, schema: ${schema}`);
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) {
      logger.warn(`[IntrospectionService] No adapter found for ${connectionId}`);
      return [];
    }
    const sql = adapter.getTablesQuery(schema);
    logger.info(`[IntrospectionService] Executing tables query for ${connectionId}`);
    const result = await BackendAPI.query(connectionId, sql);
    logger.info(`[IntrospectionService] Tables query returned ${result.rows.length} rows for ${connectionId}`);

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

  async getViews(connectionId: string, schema: string): Promise<View[]> {
    logger.info(`[IntrospectionService] getViews called for ${connectionId}, schema: ${schema}`);
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) {
      logger.warn(`[IntrospectionService] No adapter found for ${connectionId}`);
      return [];
    }
    const sql = adapter.getViewsQuery(schema);
    logger.info(`[IntrospectionService] Executing views query for ${connectionId}`);
    const result = await BackendAPI.query(connectionId, sql);
    logger.info(`[IntrospectionService] Views query returned ${result.rows.length} rows for ${connectionId}`);

    return result.rows.map((row) => ({
      schema: getString(row[0]),
      name: getString(row[1]),
      owner: getString(row[2]) || undefined,
      definition: getString(row[3]) || undefined,
      is_materialized: getBool(row[4]),
      comment: getString(row[5]) || undefined,
    }));
  },

  async getFunctions(
    connectionId: string,
    schema: string,
  ): Promise<Function[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) {
      return [];
    }
    const sql = adapter.getFunctionsQuery(schema);
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
      routine_type: (getString(row[9]) as "FUNCTION" | "PROCEDURE") || undefined,
      is_extension: row[10] != null ? getBool(row[10]) : undefined,
    }));
  },

  async getSequences(
    connectionId: string,
    schema: string,
  ): Promise<
    Array<{
      schema: string;
      name: string;
      increment_by?: number;
      min_value?: number;
      max_value?: number;
      last_number?: number;
      cache_size?: number;
      cycle?: boolean;
    }>
  > {
    const adapter = await getSqlAdapterForConnection(connectionId);
    const sql = adapter?.getSequencesQuery?.(schema);
    if (!sql) return [];

    const result = await BackendAPI.query(connectionId, sql);
    return result.rows.map((row) => ({
      schema: getString(row[0]),
      name: getString(row[1]),
      increment_by: getNumber(row[2]),
      min_value: getNumber(row[3]),
      max_value: getNumber(row[4]),
      last_number: getNumber(row[5]),
      cache_size: getNumber(row[6]),
      cycle: getString(row[7]).toUpperCase() === "Y",
    }));
  },

  async getPackages(
    connectionId: string,
    schema: string,
  ): Promise<Array<{ schema: string; name: string; has_body: boolean }>> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    const sql = adapter?.getPackagesQuery?.(schema);
    if (!sql) return [];

    const result = await BackendAPI.query(connectionId, sql);
    return result.rows.map((row) => ({
      schema: getString(row[0]),
      name: getString(row[1]),
      has_body: getBool(row[2]),
    }));
  },

  async getSynonyms(
    connectionId: string,
    schema: string,
  ): Promise<
    Array<{
      schema: string;
      name: string;
      target_schema?: string;
      target_name?: string;
      db_link?: string;
    }>
  > {
    const adapter = await getSqlAdapterForConnection(connectionId);
    const sql = adapter?.getSynonymsQuery?.(schema);
    if (!sql) return [];

    const result = await BackendAPI.query(connectionId, sql);
    return result.rows.map((row) => ({
      schema: getString(row[0]),
      name: getString(row[1]),
      target_schema: getString(row[2]) || undefined,
      target_name: getString(row[3]) || undefined,
      db_link: getString(row[4]) || undefined,
    }));
  },

  /**
   * Get indexes on a table
   */
  async getIndexes(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<Index[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return [];
    const sql = adapter.getIndexesQuery(schema, table);
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

  async getIndexUsageStats(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<IndexUsageStats[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return [];
    
    try {
      const sql = adapter.getIndexUsageStatsQuery(schema, table);
      const result = await BackendAPI.query(connectionId, sql);
      return result.rows.map((row) => mapIndexUsageStatsRow(row));
    } catch (error) {
      const fallbackSql = adapter.getIndexUsageStatsFallbackQuery(schema, table);
      if (!fallbackSql) {
        throw error;
      }

      logger.warn(
        `[IntrospectionService] Primary index stats query failed for ${connectionId}, attempting fallback`,
        error,
      );

      try {
        const result = await BackendAPI.query(connectionId, fallbackSql);
        return result.rows.map((row) => mapIndexUsageStatsRow(row));
      } catch (fallbackError) {
        logger.warn(
          `[IntrospectionService] Index stats fallback query failed for ${connectionId}`,
          fallbackError,
        );
        return [];
      }
    }
  },

  /**
   * Get constraints on a table
   */
  async getConstraints(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<Constraint[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return [];
    const sql = adapter.getConstraintsQuery(schema, table);
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
  async getColumns(
    connectionId: string,
    schema: string,
    table: string,
    catalog?: string,
  ): Promise<QueryColumnMeta[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return [];
    const sql = adapter.getColumnsQuery(schema, table, catalog);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => {
      const rawType = getString(row[1]);
      const enumSet = parseMySqlEnumOrSet(rawType);
      return {
        name: getString(row[0]),
        data_type: "Text" as const,
        db_type: rawType,
        type_oid: getNumber(row[2]),
        nullable: getBool(row[3]),
        primary_key: getBool(row[4]),
        default_value: getString(row[5]) || undefined,
        comment: getString(row[6]) || undefined,
        type_category: getString(row[7]) || undefined,
        enum_values:
          enumSet?.kind === "enum" ? enumSet.values : getStringArray(row[8]),
        set_values: enumSet?.kind === "set" ? enumSet.values : undefined,
        is_computed: getBool(row[9]),
        is_identity: getBool(row[10]),
        // MySQL/MariaDB specific fields
        character_set: getString(row[11]) || undefined,
        collation: getString(row[12]) || undefined,
        extra: getString(row[13]) || undefined,
      };
    });
  },

  /**
   * Get triggers on a table
   */
  async getTriggers(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<Trigger[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return [];
    const sql = adapter.getTriggersQuery(schema, table);
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
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return [];
    const sql = adapter.getSupportedIndexTypesQuery();
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => getString(row[0]));
  },

  /**
   * Get supported column types
   */
  async getSupportedColumnTypes(connectionId: string): Promise<string[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return [];
    const sql = adapter.getSupportedColumnTypesQuery();
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => getString(row[0]));
  },

  /**
   * Get statistics for a single table
   */
  async getTableStats(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<{
    owner?: string;
    size?: string;
    rowCount?: number;
    comment?: string;
  } | null> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return null;
    const sql = adapter.getTableStatsQuery(schema, table);
    const result = await BackendAPI.query(connectionId, sql);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      owner: getString(row[0]) || undefined,
      size: getString(row[1]) || undefined,
      rowCount: getNumber(row[2]),
      comment: getString(row[3]) || undefined,
    };
  },

  /**
   * Get all referenceable columns for foreign key targets
   */
  async getForeignKeyTargets(
    connectionId: string,
    schema: string,
  ): Promise<Array<{ table: string; column: string; type: string }>> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return [];
    const sql = adapter.getForeignKeyTargetsQuery(schema);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      table: getString(row[0]),
      column: getString(row[1]),
      type: getString(row[2]),
    }));
  },

  /**
   * Get table row count
   */
  async getTableCount(
    connectionId: string,
    schema: string,
    table: string,
    options?: { exact?: boolean; catalog?: string },
  ): Promise<{ count: number; isEstimated: boolean }> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return { count: 0, isEstimated: false };

    const catalog = options?.catalog;
    const exactSql = adapter.getTableCountQuery(schema, table, true, catalog);

    if (options?.exact) {
      const exactResult = await BackendAPI.query(connectionId, exactSql);
      if (exactResult.rows.length > 0) {
        return {
          count: getNumber(exactResult.rows[0]?.[0]) ?? 0,
          isEstimated: false,
        };
      }
      return { count: 0, isEstimated: false };
    }

    // Try estimated count first
    const estimatedSql = adapter.getTableCountQuery(schema, table, false, catalog);
    const estimatedResult = await BackendAPI.query(connectionId, estimatedSql);

    let estimatedCount: number | undefined;
    if (adapter.dbType === DbType.Trino) {
      const summaryRow = estimatedResult.rows.find(
        (row) => row[0] === null || row[0] === undefined,
      );
      estimatedCount = getNumber(summaryRow?.[4]);
    } else if (estimatedResult.rows.length > 0) {
      estimatedCount = getNumber(estimatedResult.rows[0]?.[0]);
    }

    if (estimatedCount != null) {
      const count = estimatedCount;
      if (count >= 0) {
        return {
          count,
          isEstimated: normalizeSql(estimatedSql) !== normalizeSql(exactSql),
        };
      }
    }

    // Fall back to exact count
    const exactResult = await BackendAPI.query(connectionId, exactSql);

    if (exactResult.rows.length > 0) {
      return {
        count: getNumber(exactResult.rows[0]?.[0]) ?? 0,
        isEstimated: false,
      };
    }
    return { count: 0, isEstimated: false };
  },

  /**
   * Get object definition (view, function, table DDL, sequence, type, index)
   */
  async getObjectDefinition(
    connectionId: string,
    objectType: ObjectDefinitionType,
    schema: string,
    name: string,
    catalog?: string,
  ): Promise<string> {
    const adapter = await getSqlAdapterForConnection(connectionId);
    if (!adapter) return "";
    const sql = adapter.getObjectDefinitionQuery(objectType, schema, name, catalog);
    const result = await BackendAPI.query(connectionId, sql);

    if (result.rows.length > 0) {
      // Some dialect/object combinations can return multiple rows (for example,
      // duplicate index names across tables). Collect all CREATE-like payloads.
      const extractedDefinitions: string[] = [];

      for (const row of result.rows) {
        if (Array.isArray(row)) {
          for (const cell of row) {
            const value = getString(cell);
            if (value && /^\s*(CREATE|--)/i.test(value)) {
              extractedDefinitions.push(value);
              break;
            }
          }
        } else {
          const value = getString(row);
          if (value && /^\s*(CREATE|--)/i.test(value)) {
            extractedDefinitions.push(value);
          }
        }
      }

      if (extractedDefinitions.length > 0) {
        return [...new Set(extractedDefinitions)].join("\n\n");
      }

      const firstRow = result.rows[0];
      if (Array.isArray(firstRow)) {
        const isNullOnly =
          firstRow.length > 0 &&
          firstRow.every((cell) => cell === null || getString(cell).trim() === "");
        if (isNullOnly) {
          return `-- Definition is unavailable for '${schema}.${name}'\n-- This can happen due missing privileges, encrypted modules, or database engine limitations`;
        }

        // MySQL: NULL in definition column indicates missing SHOW ROUTINE or SELECT privilege
        const objectName = getString(firstRow[0]);
        const hasNullDefinition = firstRow.some(
          (cell, index) => index > 0 && cell === null,
        );
        if (objectName && hasNullDefinition && firstRow.length > 1) {
          return `-- This user does not have permission to view the definition of '${objectName}'\n-- Required privilege: SHOW ROUTINE (for functions/procedures) or SELECT (for views)`;
        }

        // Fallback to column 0 if no CREATE-like content was found
        return getString(firstRow[0]);
      }

      const scalarFallback = getString(firstRow);
      return scalarFallback;
    }
    return "";
  },

  /**
   * Get events in a schema (MySQL/MariaDB only)
   * Returns empty array for databases that don't support events
   */
  async getEvents(connectionId: string, schema: string): Promise<Event[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);

    // Check if adapter supports events query
    if (!adapter?.getEventsQuery) {
      return [];
    }

    const sql = adapter.getEventsQuery(schema);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      schema: getString(row[0]),
      name: getString(row[1]),
      definer: getString(row[2]) || undefined,
      time_zone: getString(row[3]) || undefined,
      event_type: getString(row[4]) as "ONE TIME" | "RECURRING",
      execute_at: getString(row[5]) || undefined,
      interval_value: getNumber(row[6]),
      interval_field: getString(row[7]) || undefined,
      starts: getString(row[8]) || undefined,
      ends: getString(row[9]) || undefined,
      status: getString(row[10]) as "ENABLED" | "DISABLED" | "SLAVESIDE_DISABLED",
      on_completion: getString(row[11]) as "PRESERVE" | "NOT PRESERVE",
      created: getString(row[12]) || undefined,
      last_altered: getString(row[13]) || undefined,
      last_executed: getString(row[14]) || undefined,
      comment: getString(row[15]) || undefined,
    }));
  },

  /**
   * Get partitions for a table (MySQL/MariaDB only)
   * Returns empty array for databases that don't support partitions
   */
  async getPartitions(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<Partition[]> {
    const adapter = await getSqlAdapterForConnection(connectionId);

    // Check if adapter supports partitions query
    if (!adapter?.getPartitionsQuery) {
      return [];
    }

    const sql = adapter.getPartitionsQuery(schema, table);
    const result = await BackendAPI.query(connectionId, sql);

    return result.rows.map((row) => ({
      schema: getString(row[0]),
      table_name: getString(row[1]),
      partition_name: getString(row[2]),
      subpartition_name: getString(row[3]) || undefined,
      partition_ordinal_position: getNumber(row[4]) ?? 0,
      subpartition_ordinal_position: getNumber(row[5]),
      partition_method: getString(row[6]) || undefined,
      subpartition_method: getString(row[7]) || undefined,
      partition_expression: getString(row[8]) || undefined,
      subpartition_expression: getString(row[9]) || undefined,
      partition_description: getString(row[10]) || undefined,
      table_rows: getNumber(row[11]),
      avg_row_length: getNumber(row[12]),
      data_length: getNumber(row[13]),
      index_length: getNumber(row[14]),
      partition_comment: getString(row[15]) || undefined,
      partition_function_name: getString(row[16]) || undefined,
    }));
  },
};

export default IntrospectionService;
