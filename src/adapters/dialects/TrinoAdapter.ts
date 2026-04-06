import { DbType } from "@/types/connection";
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
 * - No table_constraints in information_schema
 * - No indexes, triggers, or functions metadata
 * - SHOW CREATE TABLE for DDL definitions
 */
export class TrinoAdapter extends PostgreSQLAdapter {
  readonly dbType = DbType.Trino;

  getDatabasesQuery(): string {
    return `SHOW CATALOGS`;
  }

  /** Query schemas in any catalog without reconnecting (cross-catalog information_schema) */
  getSchemasForCatalog(catalog: string): string {
    return `SELECT schema_name AS name, NULL AS owner FROM ${this.quoteIdentifier(catalog)}.information_schema.schemata WHERE schema_name NOT IN ('information_schema') ORDER BY schema_name`;
  }

  /** Query tables + views in any catalog.schema without reconnecting */
  getTablesForCatalogSchema(catalog: string, schema: string): string {
    return `SELECT table_schema AS schema_name, table_name, CASE table_type WHEN 'BASE TABLE' THEN 'regular' WHEN 'VIEW' THEN 'view' ELSE 'regular' END AS kind, NULL AS owner, NULL AS size, NULL AS row_count, NULL AS comment FROM ${this.quoteIdentifier(catalog)}.information_schema.tables WHERE table_schema = '${this.escapeString(schema)}' AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name`;
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
  NULL AS type_oid,
  is_nullable = 'YES' AS nullable,
  false AS is_primary_key,
  column_default AS default_value,
  NULL AS comment,
  NULL AS type_category,
  NULL AS enum_values,
  false AS is_computed,
  false AS is_identity,
  NULL AS character_set,
  NULL AS collation,
  NULL AS extra
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

  protected formatTableRef(target: import("../types").TableRef): string {
    const schemaPart = target.schema ? `${this.quoteIdentifier(target.schema)}.` : "";
    const tablePart = `${schemaPart}${this.quoteIdentifier(target.table)}`;
    if (target.catalog) {
      return `${this.quoteIdentifier(target.catalog)}.${tablePart}`;
    }
    return tablePart;
  }

  getTableCountQuery(schema: string, table: string, exact?: boolean, catalog?: string): string {
    const tableRef = catalog
      ? `${this.quoteIdentifier(catalog)}.${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`
      : `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
    if (!exact) {
      return `SHOW STATS FOR ${tableRef}`;
    }
    return `SELECT count(*) AS count FROM ${tableRef}`;
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

  protected formatLimit(limit: number, offset?: number): string {
    // Trino requires OFFSET before LIMIT (unlike PostgreSQL/MySQL)
    let clause = "";
    if (offset !== undefined && offset > 0) {
      clause += ` OFFSET ${offset}`;
    }
    clause += ` LIMIT ${limit}`;
    return clause;
  }
}
