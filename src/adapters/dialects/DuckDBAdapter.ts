import { DbType } from "@/types/connection";
import type { ObjectDefinitionType } from "../types";
import { PostgreSQLAdapter } from "./PostgreSQLAdapter";

export class DuckDBAdapter extends PostgreSQLAdapter {
  readonly dbType = DbType.DuckDB;

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
SELECT
  schema_name AS name,
  NULL AS owner
FROM duckdb_schemas()
WHERE NOT internal
  AND schema_name <> 'querypilot_meta'
ORDER BY schema_name`;
  }

  getTablesQuery(schema: string): string {
    return `
SELECT
  schema_name,
  table_name,
  'regular' AS kind,
  NULL AS owner,
  estimated_size AS size,
  NULL AS row_count,
  NULL AS comment
FROM duckdb_tables()
WHERE schema_name = '${this.escapeString(schema)}'
ORDER BY table_name`;
  }

  getViewsQuery(schema: string): string {
    return `
SELECT
  table_schema AS schema_name,
  table_name AS view_name,
  NULL AS owner,
  view_definition AS definition,
  0 AS is_materialized,
  NULL AS comment
FROM information_schema.views
WHERE table_schema = '${this.escapeString(schema)}'
  AND table_name NOT IN (
    SELECT function_name FROM duckdb_functions() WHERE function_type = 'table'
  )
  AND table_name NOT LIKE 'sqlite_%'
  AND table_name NOT LIKE 'pragma_%'
ORDER BY table_name`;
  }

  getFunctionsQuery(schema: string): string {
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
WHERE schema_name = '${this.escapeString(schema)}'
  AND NOT internal
ORDER BY function_name
LIMIT 500`;
  }

  getIndexesQuery(schema: string, table: string): string {
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
WHERE schema_name = '${this.escapeString(schema)}'
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
    return `SELECT COUNT(*) AS count FROM ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
  }

  getTableStatsQuery(schema: string, table: string): string {
    return `
SELECT
  NULL AS owner,
  t.estimated_size AS size,
  (SELECT COUNT(*) FROM ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}) AS row_count,
  NULL AS comment
FROM duckdb_tables() t
WHERE t.schema_name = '${this.escapeString(schema)}'
  AND t.table_name = '${this.escapeString(table)}'`;
  }

  getForeignKeyTargetsQuery(schema: string): string {
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
    if (objectType === "view" || objectType === "materialized_view") {
      return `
SELECT view_definition AS definition
FROM information_schema.views
WHERE table_schema = '${this.escapeString(schema)}'
  AND table_name = '${this.escapeString(name)}'`;
    }

    if (objectType === "table") {
      return `
SELECT sql AS definition
FROM duckdb_tables()
WHERE schema_name = '${this.escapeString(schema)}'
  AND table_name = '${this.escapeString(name)}'`;
    }

    return `
SELECT 'Definition is unavailable for this DuckDB object type in Query Pilot.' AS definition`;
  }
}
