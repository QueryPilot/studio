import { DbType } from "@/types/connection";
import type { SelectOptions, TableRef } from "../types";
import type { ObjectDefinitionType } from "../types";
import { PostgreSQLAdapter } from "./PostgreSQLAdapter";

/**
 * Trino Database Adapter
 *
 * Extends PostgreSQLAdapter since Trino uses double-quote identifier quoting
 * and ANSI SQL syntax. Overrides introspection queries to use Trino's
 * SHOW commands and information_schema conventions.
 *
 * Trino data model: catalog → schema → table
 * Mapped to Query Pilot as: database → schema → table
 *
 * Key differences from PostgreSQL:
 * - No OFFSET support (use keyset pagination or client-side)
 * - No table_constraints in information_schema
 * - No indexes, triggers, or functions metadata
 * - SHOW CREATE TABLE for DDL definitions
 */
export class TrinoAdapter extends PostgreSQLAdapter {
  readonly dbType = DbType.Trino;

  getDatabasesQuery(): string {
    return `SHOW CATALOGS`;
  }

  getSchemasQuery(): string {
    return `
SELECT
  schema_name AS name,
  NULL AS owner
FROM information_schema.schemata
WHERE schema_name NOT IN ('information_schema')
ORDER BY schema_name`;
  }

  getTablesQuery(schema: string): string {
    return `
SELECT
  table_schema AS schema_name,
  table_name,
  CASE table_type
    WHEN 'BASE TABLE' THEN 'regular'
    WHEN 'VIEW' THEN 'view'
    ELSE 'regular'
  END AS kind,
  NULL AS owner,
  NULL AS size,
  NULL AS row_count,
  NULL AS comment
FROM information_schema.tables
WHERE table_schema = '${this.escapeString(schema)}'
  AND table_type = 'BASE TABLE'
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
ORDER BY table_name`;
  }

  getColumnsQuery(schema: string, table: string): string {
    return `
SELECT
  column_name AS name,
  data_type AS data_type,
  is_nullable = 'YES' AS nullable,
  column_default AS default_value,
  ordinal_position,
  NULL AS comment,
  NULL AS character_maximum_length,
  NULL AS numeric_precision,
  NULL AS numeric_scale
FROM information_schema.columns
WHERE table_schema = '${this.escapeString(schema)}'
  AND table_name = '${this.escapeString(table)}'
ORDER BY ordinal_position`;
  }

  getFunctionsQuery(_schema: string): string {
    return `SELECT NULL WHERE false`;
  }

  getIndexesQuery(_schema: string, _table: string): string {
    return `SELECT NULL WHERE false`;
  }

  getIndexUsageStatsQuery(_schema: string, _table: string): string {
    return `SELECT NULL WHERE false`;
  }

  getIndexUsageStatsFallbackQuery(
    _schema: string,
    _table: string,
  ): string | null {
    return null;
  }

  getConstraintsQuery(_schema: string, _table: string): string {
    return `SELECT NULL WHERE false`;
  }

  getTriggersQuery(_schema: string, _table: string): string {
    return `SELECT NULL WHERE false`;
  }

  getSupportedIndexTypesQuery(): string {
    return `SELECT NULL WHERE false`;
  }

  getSupportedColumnTypesQuery(): string {
    return `SELECT NULL WHERE false`;
  }

  getTableCountQuery(schema: string, table: string, _exact?: boolean): string {
    return `SELECT count(*) AS count FROM ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
  }

  getTableStatsQuery(schema: string, table: string): string {
    return `
SELECT
  NULL AS owner,
  NULL AS size,
  NULL AS row_count,
  NULL AS comment
FROM information_schema.tables
WHERE table_schema = '${this.escapeString(schema)}'
  AND table_name = '${this.escapeString(table)}'`;
  }

  getForeignKeyTargetsQuery(_schema: string): string {
    return `SELECT NULL WHERE false`;
  }

  getObjectDefinitionQuery(
    objectType: ObjectDefinitionType,
    schema: string,
    name: string,
  ): string {
    if (objectType === "view") {
      return `
SELECT view_definition AS definition
FROM information_schema.views
WHERE table_schema = '${this.escapeString(schema)}'
  AND table_name = '${this.escapeString(name)}'`;
    }
    if (objectType === "table") {
      return `SHOW CREATE TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;
    }
    return `SELECT '-- ${this.escapeString(objectType)} definition not available in Trino' AS definition`;
  }

  /**
   * Trino does not support OFFSET. Strip it and only emit LIMIT.
   */
  protected formatLimit(limit: number, _offset?: number): string {
    return ` LIMIT ${limit}`;
  }

  /**
   * Override select to wrap with row_number() for offset pagination.
   * Trino doesn't support OFFSET, so we use a subquery with ROW_NUMBER().
   */
  select(target: TableRef, options?: SelectOptions): string {
    if (options?.offset && options.offset > 0) {
      const innerSql = super.select(target, {
        ...options,
        offset: undefined,
        limit: undefined,
      });

      const limit = options.limit ?? 100;
      const start = options.offset + 1;
      const end = options.offset + limit;

      return `SELECT * FROM (SELECT *, ROW_NUMBER() OVER () AS __qp_rn FROM (${innerSql}) __qp_inner) __qp_outer WHERE __qp_rn BETWEEN ${start} AND ${end}`;
    }
    return super.select(target, options);
  }

  /**
   * Same row_number trick for selectWithEmbeddedFK.
   */
  selectWithEmbeddedFK(target: TableRef, options: SelectOptions): string {
    if (options.offset && options.offset > 0) {
      const innerSql = super.selectWithEmbeddedFK(target, {
        ...options,
        offset: undefined,
        limit: undefined,
      });

      const limit = options.limit ?? 100;
      const start = options.offset + 1;
      const end = options.offset + limit;

      return `SELECT * FROM (SELECT *, ROW_NUMBER() OVER () AS __qp_rn FROM (${innerSql}) __qp_inner) __qp_outer WHERE __qp_rn BETWEEN ${start} AND ${end}`;
    }
    return super.selectWithEmbeddedFK(target, options);
  }
}
