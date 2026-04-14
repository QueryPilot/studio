import { DbType } from "@/types/connection";
import type { ObjectDefinitionType, TableRef } from "../types";
import { PostgreSQLAdapter } from "./PostgreSQLAdapter";

export class DuckDBAdapter extends PostgreSQLAdapter {
  readonly dbType = DbType.DuckDB;

  /**
   * Override so attached-database schemas (`database.schema`) are emitted as
   * three-part identifiers (`"database"."schema"."table"`) instead of being
   * quoted as a single identifier.
   */
  protected formatTableRef(target: TableRef): string {
    if (target.schema) {
      const parts = this.splitDbSchema(target.schema);
      if (parts) {
        return `${this.quoteIdentifier(parts[0])}.${this.quoteIdentifier(parts[1])}.${this.quoteIdentifier(target.table)}`;
      }
      return `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(target.table)}`;
    }
    return this.quoteIdentifier(target.table);
  }

  /**
   * Splits a schema string that may be "database.schema" (for attached databases)
   * into [databaseName, schemaName]. Returns null if no dot separator is present.
   */
  private splitDbSchema(schema: string): [string, string] | null {
    const dotIdx = schema.indexOf(".");
    if (dotIdx === -1) return null;
    return [schema.substring(0, dotIdx), schema.substring(dotIdx + 1)];
  }

  getDatabasesQuery(): string {
    return `
SELECT
  database_name AS name,
  NULL AS owner,
  NULL AS encoding,
  NULL AS collation,
  NULL AS size,
  CASE WHEN database_name != 'memory' AND path IS NOT NULL AND path != '' THEN true ELSE false END AS is_attached
FROM duckdb_databases()
WHERE NOT internal
ORDER BY database_name`;
  }

  getSchemasQuery(): string {
    return `
SELECT DISTINCT
  CASE
    WHEN database_name = current_database() THEN schema_name
    ELSE database_name || '.' || schema_name
  END AS name,
  NULL AS owner
FROM duckdb_schemas()
WHERE NOT internal
  AND schema_name <> 'querypilot_meta'
  AND database_name NOT IN ('system', 'temp')
ORDER BY name`;
  }

  getTablesQuery(schema: string): string {
    const escaped = this.escapeString(schema);
    return `
SELECT
  CASE
    WHEN database_name = current_database() THEN schema_name
    ELSE database_name || '.' || schema_name
  END AS schema_name,
  table_name,
  'regular' AS kind,
  NULL AS owner,
  estimated_size AS size,
  NULL AS row_count,
  NULL AS comment
FROM duckdb_tables()
WHERE (
  (database_name = current_database() AND schema_name = '${escaped}')
  OR (database_name || '.' || schema_name = '${escaped}')
)
ORDER BY table_name`;
  }

  getViewsQuery(schema: string): string {
    const escaped = this.escapeString(schema);
    const parts = this.splitDbSchema(schema);
    if (parts) {
      const [dbName, schemaName] = parts;
      return `
SELECT
  '${this.escapeString(dbName)}' || '.' || schema_name AS schema_name,
  view_name,
  NULL AS owner,
  sql AS definition,
  0 AS is_materialized,
  NULL AS comment
FROM duckdb_views()
WHERE database_name = '${this.escapeString(dbName)}'
  AND schema_name = '${this.escapeString(schemaName)}'
ORDER BY view_name`;
    }
    return `
SELECT
  schema_name,
  view_name,
  NULL AS owner,
  sql AS definition,
  0 AS is_materialized,
  NULL AS comment
FROM duckdb_views()
WHERE database_name = current_database()
  AND schema_name = '${escaped}'
  AND NOT internal
ORDER BY view_name`;
  }

  getFunctionsQuery(schema: string): string {
    const fnParts = this.splitDbSchema(schema);
    if (fnParts) {
      const [dbName, schemaName] = fnParts;
      return `
SELECT
  '${this.escapeString(dbName)}' || '.' || schema_name AS schema_name,
  function_name,
  parameters AS arguments,
  return_type,
  NULL AS language,
  function_type = 'aggregate' AS is_aggregate,
  0 AS is_window,
  0 AS is_trigger,
  NULL AS source,
  'FUNCTION' AS routine_type,
  NOT internal AS is_extension
FROM duckdb_functions()
WHERE database_name = '${this.escapeString(dbName)}'
  AND schema_name = '${this.escapeString(schemaName)}'
  AND NOT internal
ORDER BY function_name
LIMIT 500`;
    }
    return `
SELECT
  schema_name,
  function_name,
  parameters AS arguments,
  return_type,
  NULL AS language,
  function_type = 'aggregate' AS is_aggregate,
  0 AS is_window,
  0 AS is_trigger,
  NULL AS source,
  'FUNCTION' AS routine_type,
  NOT internal AS is_extension
FROM duckdb_functions()
WHERE database_name = current_database()
  AND schema_name = '${this.escapeString(schema)}'
  AND NOT internal
ORDER BY function_name
LIMIT 500`;
  }

  getIndexesQuery(schema: string, table: string): string {
    const idxParts = this.splitDbSchema(schema);
    if (idxParts) {
      const [dbName, schemaName] = idxParts;
      return `
SELECT
  index_name,
  table_name,
  '[]' AS columns,
  is_unique,
  is_primary,
  0 AS is_partial,
  sql AS definition,
  0 AS is_foreign_key
FROM duckdb_indexes()
WHERE database_name = '${this.escapeString(dbName)}'
  AND schema_name = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(table)}'
ORDER BY index_name`;
    }
    return `
SELECT
  index_name,
  table_name,
  '[]' AS columns,
  is_unique,
  is_primary,
  0 AS is_partial,
  sql AS definition,
  0 AS is_foreign_key
FROM duckdb_indexes()
WHERE database_name = current_database()
  AND schema_name = '${this.escapeString(schema)}'
  AND table_name = '${this.escapeString(table)}'
ORDER BY index_name`;
  }

  getIndexUsageStatsQuery(_schema: string, _table: string): string {
    return `
SELECT
  NULL AS index_name,
  NULL AS scan_count,
  NULL AS rows_read,
  NULL AS rows_returned,
  NULL AS size_pretty,
  NULL AS size_bytes,
  0 AS is_unused,
  NULL AS cache_hit_ratio,
  NULL AS last_used
WHERE 0`;
  }

  getConstraintsQuery(schema: string, table: string): string {
    const conParts = this.splitDbSchema(schema);
    if (conParts) {
      const [dbName, schemaName] = conParts;
      return `
SELECT
  constraint_text AS constraint_name,
  '${this.escapeString(table)}' AS table_name,
  constraint_type,
  constraint_text AS definition,
  NULL AS foreign_table
FROM duckdb_constraints()
WHERE database_name = '${this.escapeString(dbName)}'
  AND schema_name = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(table)}'
ORDER BY constraint_type`;
    }
    return `
SELECT
  tc.constraint_name,
  tc.table_name,
  tc.constraint_type,
  CASE tc.constraint_type
    WHEN 'PRIMARY KEY' THEN 'PRIMARY KEY (' || (
      SELECT string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position)
      FROM information_schema.key_column_usage kcu
      WHERE kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
    ) || ')'
    ELSE NULL
  END AS definition,
  NULL AS foreign_table
FROM information_schema.table_constraints tc
WHERE tc.table_schema = '${this.escapeString(schema)}'
  AND tc.table_name = '${this.escapeString(table)}'
ORDER BY tc.constraint_name`;
  }

  getColumnsQuery(schema: string, table: string): string {
    const colParts = this.splitDbSchema(schema);
    if (colParts) {
      const [dbName, schemaName] = colParts;
      return `
SELECT
  column_name,
  data_type AS formatted_type,
  NULL AS type_oid,
  is_nullable = 'YES' AS nullable,
  column_index = 0 AS is_primary_key,
  column_default AS default_value,
  NULL AS comment,
  NULL AS type_category,
  NULL AS enum_values
FROM duckdb_columns()
WHERE database_name = '${this.escapeString(dbName)}'
  AND schema_name = '${this.escapeString(schemaName)}'
  AND table_name = '${this.escapeString(table)}'
ORDER BY column_index`;
    }
    return `
SELECT
  c.column_name,
  c.data_type AS formatted_type,
  NULL AS type_oid,
  c.is_nullable = 'YES' AS nullable,
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
     AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = c.table_schema
      AND tc.table_name = c.table_name
      AND kcu.column_name = c.column_name
  ) AS is_primary_key,
  c.column_default AS default_value,
  NULL AS comment,
  NULL AS type_category,
  NULL AS enum_values
FROM information_schema.columns c
WHERE c.table_schema = '${this.escapeString(schema)}'
  AND c.table_name = '${this.escapeString(table)}'
ORDER BY c.ordinal_position`;
  }

  getTriggersQuery(_schema: string, _table: string): string {
    return `
SELECT
  NULL AS trigger_name,
  NULL AS schema_name,
  NULL AS table_name,
  NULL AS timing,
  NULL AS event,
  NULL AS level,
  NULL AS function_name,
  0 AS enabled,
  NULL AS definition
WHERE 0`;
  }

  getSupportedIndexTypesQuery(): string {
    return `SELECT 'art' AS amname`;
  }

  getSupportedColumnTypesQuery(): string {
    return `
SELECT type_name, category, NULL AS type_length
FROM (
  VALUES
    ('bigint', 'numeric'),
    ('bit', 'binary'),
    ('blob', 'binary'),
    ('boolean', 'boolean'),
    ('date', 'datetime'),
    ('decimal', 'numeric'),
    ('double', 'numeric'),
    ('float', 'numeric'),
    ('hugeint', 'numeric'),
    ('integer', 'numeric'),
    ('interval', 'datetime'),
    ('json', 'other'),
    ('smallint', 'numeric'),
    ('text', 'string'),
    ('time', 'datetime'),
    ('timestamp', 'datetime'),
    ('timestamptz', 'datetime'),
    ('tinyint', 'numeric'),
    ('ubigint', 'numeric'),
    ('uhugeint', 'numeric'),
    ('uinteger', 'numeric'),
    ('usmallint', 'numeric'),
    ('utinyint', 'numeric'),
    ('uuid', 'other'),
    ('variant', 'other'),
    ('varchar', 'string'),
    ('list', 'composite'),
    ('map', 'composite'),
    ('struct', 'composite'),
    ('union', 'composite'),
    ('array', 'composite')
) AS duckdb_types(type_name, category)
ORDER BY category, type_name`;
  }

  getTableCountQuery(schema: string, table: string, _exact?: boolean): string {
    const qualifiedTable = this.qualifyDuckDbIdentifier(schema, table);
    return `SELECT COUNT(*) AS count FROM ${qualifiedTable}`;
  }

  getTableStatsQuery(schema: string, table: string): string {
    const qualifiedTable = this.qualifyDuckDbIdentifier(schema, table);
    const statsParts = this.splitDbSchema(schema);
    if (statsParts) {
      const [dbName, schemaName] = statsParts;
      return `
SELECT
  NULL AS owner,
  t.estimated_size AS size,
  (SELECT COUNT(*) FROM ${qualifiedTable}) AS row_count,
  NULL AS comment
FROM duckdb_tables()  t
WHERE t.database_name = '${this.escapeString(dbName)}'
  AND t.schema_name = '${this.escapeString(schemaName)}'
  AND t.table_name = '${this.escapeString(table)}'`;
    }
    return `
SELECT
  NULL AS owner,
  t.estimated_size AS size,
  (SELECT COUNT(*) FROM ${qualifiedTable}) AS row_count,
  NULL AS comment
FROM duckdb_tables() t
WHERE t.database_name = current_database()
  AND t.schema_name = '${this.escapeString(schema)}'
  AND t.table_name = '${this.escapeString(table)}'`;
  }

  /**
   * Builds a fully qualified DuckDB identifier from a schema (which may contain
   * "database.schema" for attached databases) and an object name.
   */
  private qualifyDuckDbIdentifier(schema: string, name: string): string {
    const qParts = this.splitDbSchema(schema);
    if (qParts) {
      return `${this.quoteIdentifier(qParts[0])}.${this.quoteIdentifier(qParts[1])}.${this.quoteIdentifier(name)}`;
    }
    return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;
  }

  getForeignKeyTargetsQuery(schema: string): string {
    if (this.splitDbSchema(schema)) {
      return `SELECT NULL AS table_name, NULL AS column_name, NULL AS data_type WHERE 0`;
    }
    return `
SELECT DISTINCT
  kcu.table_name,
  kcu.column_name,
  c.data_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
 AND tc.table_name = kcu.table_name
JOIN information_schema.columns c
  ON c.table_schema = kcu.table_schema
 AND c.table_name = kcu.table_name
 AND c.column_name = kcu.column_name
WHERE tc.table_schema = '${this.escapeString(schema)}'
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY kcu.table_name, kcu.column_name`;
  }

  getObjectDefinitionQuery(
    objectType: ObjectDefinitionType,
    schema: string,
    name: string,
  ): string {
    const defParts = this.splitDbSchema(schema);

    if (objectType === "view" || objectType === "materialized_view") {
      if (defParts) {
        return `
SELECT sql AS definition
FROM duckdb_views()
WHERE database_name = '${this.escapeString(defParts[0])}'
  AND schema_name = '${this.escapeString(defParts[1])}'
  AND view_name = '${this.escapeString(name)}'`;
      }
      return `
SELECT sql AS definition
FROM duckdb_views()
WHERE database_name = current_database()
  AND schema_name = '${this.escapeString(schema)}'
  AND view_name = '${this.escapeString(name)}'`;
    }

    if (objectType === "table") {
      if (defParts) {
        return `
SELECT sql AS definition
FROM duckdb_tables()
WHERE database_name = '${this.escapeString(defParts[0])}'
  AND schema_name = '${this.escapeString(defParts[1])}'
  AND table_name = '${this.escapeString(name)}'`;
      }
      return `
SELECT sql AS definition
FROM duckdb_tables()
WHERE database_name = current_database()
  AND schema_name = '${this.escapeString(schema)}'
  AND table_name = '${this.escapeString(name)}'`;
    }

    return `
SELECT 'Definition is unavailable for this DuckDB object type in Query Pilot.' AS definition`;
  }
}
