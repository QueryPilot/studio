/**
 * PostgreSQL Database Adapter
 *
 * Implements PostgreSQL-specific SQL generation including:
 * - Double-quote identifier quoting: "column_name"
 * - Single-quote string escaping with doubling: 'it''s'
 * - Type casts for UUID, JSONB, timestamps: 'value'::type
 * - Array literals: ARRAY[1, 2, 3]
 * - RETURNING clause support
 * - Boolean TRUE/FALSE literals
 */

import { DbType } from '@/types/connection';
import { SqlAdapter } from '../base/SqlAdapter';
import type { ColumnInfo } from '../types';
import { quoteIdentifier as sharedQuoteIdentifier } from '../formatting';

// UUID v4 pattern for detection
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgreSQL UUID type names
const UUID_TYPE_NAMES = ['uuid'];

// PostgreSQL JSON/JSONB type names
const JSON_TYPE_NAMES = ['json', 'jsonb'];

// PostgreSQL timestamp type names
const TIMESTAMP_TYPE_NAMES = [
  'timestamp',
  'timestamptz',
  'timestamp with time zone',
  'timestamp without time zone',
];

// PostgreSQL date type names
const DATE_TYPE_NAMES = ['date'];

// PostgreSQL time type names
const TIME_TYPE_NAMES = ['time', 'timetz', 'time with time zone', 'time without time zone'];

// PostgreSQL array type suffix
const ARRAY_TYPE_SUFFIX = '[]';

// PostgreSQL bytea type
const BYTEA_TYPE_NAMES = ['bytea'];

export class PostgreSQLAdapter extends SqlAdapter {
  readonly dbType = DbType.PostgreSQL;

  /**
   * Quote an identifier with double quotes (PostgreSQL standard)
   * Escapes embedded double quotes by doubling them
   */
  quoteIdentifier(name: string): string {
    return sharedQuoteIdentifier(name, DbType.PostgreSQL);
  }

  /**
   * Quote a string value with single quotes
   */
  quoteString(value: string): string {
    return `'${this.escapeString(value)}'`;
  }

  /**
   * Format a value for PostgreSQL SQL
   * Handles type-specific formatting including:
   * - NULL values
   * - Booleans (TRUE/FALSE)
   * - Numbers (with validation)
   * - Dates/timestamps (with timezone cast)
   * - UUIDs (with ::uuid cast)
   * - JSON/JSONB (with ::jsonb cast)
   * - Arrays (ARRAY[...] syntax)
   * - Binary data (bytea hex format)
   * - Plain strings
   */
  formatValue(value: unknown, column: ColumnInfo): string {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return 'NULL';
    }

    // Handle booleans - PostgreSQL uses TRUE/FALSE
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }

    // Handle numbers
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number value: ${value}`);
      }
      return String(value);
    }

    // Handle BigInt
    if (typeof value === 'bigint') {
      return String(value);
    }

    // Handle Date objects
    if (value instanceof Date) {
      return this.formatDate(value, column);
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return this.formatArray(value, column);
    }

    // Handle Uint8Array/Buffer (binary data)
    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
      return this.formatBytea(value);
    }

    // Handle objects (JSON/JSONB)
    if (typeof value === 'object') {
      return this.formatJsonb(value);
    }

    // Handle strings with type detection
    const strValue = String(value);
    return this.formatString(strValue, column);
  }

  /**
   * Format a Date value with appropriate PostgreSQL type cast
   */
  private formatDate(value: Date, column: ColumnInfo): string {
    const dbType = column.dbType?.toLowerCase() || '';

    // Check if it's a date-only type
    if (DATE_TYPE_NAMES.some((t) => dbType.includes(t)) && !dbType.includes('timestamp')) {
      // Format as date only: YYYY-MM-DD
      const dateStr = value.toISOString().split('T')[0];
      return `'${dateStr}'::date`;
    }

    // Check if it's a time-only type
    if (TIME_TYPE_NAMES.some((t) => dbType.includes(t))) {
      // Format as time only: HH:MM:SS.mmm
      const timePart = value.toISOString().split('T')[1];
      const timeStr = timePart ? timePart.replace('Z', '') : '00:00:00.000';
      const typeCast = dbType.includes('tz') ? '::timetz' : '::time';
      return `'${timeStr}'${typeCast}`;
    }

    // Default: timestamp with timezone
    return `'${value.toISOString()}'::timestamptz`;
  }

  /**
   * Format an array value using PostgreSQL ARRAY[] syntax
   */
  private formatArray(value: unknown[], column: ColumnInfo): string {
    if (value.length === 0) {
      // Empty array - need to determine type from column info
      const elementType = this.getArrayElementType(column);
      if (elementType) {
        return `ARRAY[]::${elementType}[]`;
      }
      return 'ARRAY[]::text[]'; // Default to text array
    }

    // Determine element column info for recursive formatting
    const elementColumn: ColumnInfo = {
      name: column.name,
      dbType: this.getArrayElementType(column),
    };

    const elements = value.map((v) => this.formatValue(v, elementColumn)).join(', ');
    return `ARRAY[${elements}]`;
  }

  /**
   * Get the element type for an array column
   */
  private getArrayElementType(column: ColumnInfo): string | undefined {
    const dbType = column.dbType?.toLowerCase() || '';
    if (dbType.endsWith(ARRAY_TYPE_SUFFIX)) {
      return dbType.slice(0, -2); // Remove '[]' suffix
    }
    if (dbType.startsWith('_')) {
      // PostgreSQL internal array type notation (_int4, _text, etc.)
      return dbType.slice(1);
    }
    return undefined;
  }

  /**
   * Format binary data as PostgreSQL bytea hex format
   */
  private formatBytea(value: Uint8Array): string {
    const hex = Array.from(value)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `'\\x${hex}'::bytea`;
  }

  /**
   * Format an object as JSONB
   */
  private formatJsonb(value: object): string {
    const jsonStr = JSON.stringify(value);
    return `'${this.escapeString(jsonStr)}'::jsonb`;
  }

  /**
   * Format a string value with type detection and appropriate casting
   */
  private formatString(value: string, column: ColumnInfo): string {
    const dbType = column.dbType?.toLowerCase() || '';

    // Check for UUID type from column metadata
    if (UUID_TYPE_NAMES.some((t) => dbType === t)) {
      return `'${this.escapeString(value)}'::uuid`;
    }

    // Detect UUID by pattern if no column type info
    if (!dbType && UUID_PATTERN.test(value)) {
      return `'${this.escapeString(value)}'::uuid`;
    }

    // Check for JSON/JSONB type
    if (JSON_TYPE_NAMES.some((t) => dbType === t)) {
      // Try to validate JSON
      try {
        JSON.parse(value);
        const typeCast = dbType === 'json' ? '::json' : '::jsonb';
        return `'${this.escapeString(value)}'${typeCast}`;
      } catch {
        // If not valid JSON, just treat as string
        return this.quoteString(value);
      }
    }

    // Check for timestamp types
    if (TIMESTAMP_TYPE_NAMES.some((t) => dbType.includes(t))) {
      const typeCast = dbType.includes('tz') ? '::timestamptz' : '::timestamp';
      return `'${this.escapeString(value)}'${typeCast}`;
    }

    // Check for date type
    if (DATE_TYPE_NAMES.some((t) => dbType === t)) {
      return `'${this.escapeString(value)}'::date`;
    }

    // Check for time types
    if (TIME_TYPE_NAMES.some((t) => dbType.includes(t))) {
      const typeCast = dbType.includes('tz') ? '::timetz' : '::time';
      return `'${this.escapeString(value)}'${typeCast}`;
    }

    // Check for bytea type (hex string input)
    if (BYTEA_TYPE_NAMES.some((t) => dbType === t)) {
      // If it's already in hex format, use as-is
      if (value.startsWith('\\x') || value.startsWith('0x')) {
        const hexPart = value.startsWith('0x') ? value.slice(2) : value.slice(2);
        return `'\\x${hexPart}'::bytea`;
      }
      // Otherwise, encode the string to bytea using TextEncoder (browser-compatible)
      const bytes = new TextEncoder().encode(value);
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `'\\x${hex}'::bytea`;
    }

    // Default: plain string
    return this.quoteString(value);
  }

  /**
   * PostgreSQL supports RETURNING clause
   */
  protected supportsReturning(): boolean {
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // Introspection Queries
  // ─────────────────────────────────────────────────────────────────

  getDatabasesQuery(): string {
    return `
SELECT
    datname as name,
    pg_catalog.pg_get_userbyid(datdba) as owner,
    pg_encoding_to_char(encoding) as encoding,
    datcollate as collation,
    pg_size_pretty(pg_database_size(datname)) as size
FROM pg_database
WHERE datistemplate = false
ORDER BY datname`;
  }

  getSchemasQuery(): string {
    return `
SELECT
    nspname as name,
    pg_catalog.pg_get_userbyid(nspowner) as owner
FROM pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND nspname NOT LIKE 'pg_temp_%'
    AND nspname NOT LIKE 'pg_toast_temp_%'
ORDER BY nspname`;
  }

  getTablesQuery(schema: string): string {
    return `
SELECT
    n.nspname as schema_name,
    c.relname as table_name,
    CASE c.relkind
        WHEN 'r' THEN 'regular'
        WHEN 'p' THEN 'partitioned'
        WHEN 'f' THEN 'foreign'
        ELSE 'regular'
    END as kind,
    pg_catalog.pg_get_userbyid(c.relowner) as owner,
    pg_size_pretty(pg_total_relation_size(c.oid)) as size,
    c.reltuples::bigint as row_count,
    obj_description(c.oid) as comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${this.escapeString(schema)}'
    AND c.relkind IN ('r', 'p', 'f')
ORDER BY c.relname`;
  }

  getViewsQuery(schema: string): string {
    return `
SELECT
    n.nspname as schema_name,
    c.relname as view_name,
    pg_catalog.pg_get_userbyid(c.relowner) as owner,
    pg_get_viewdef(c.oid, true) as definition,
    c.relkind = 'm' as is_materialized,
    obj_description(c.oid) as comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${this.escapeString(schema)}'
    AND c.relkind IN ('v', 'm')
ORDER BY c.relname`;
  }

  getFunctionsQuery(schema: string): string {
    return `
SELECT DISTINCT ON (n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as return_type,
    l.lanname as language,
    p.prokind = 'a' as is_aggregate,
    p.prokind = 'w' as is_window,
    p.proisstrict as is_trigger,
    p.prosrc as source
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = '${this.escapeString(schema)}'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)`;
  }

  getIndexesQuery(schema: string, table: string): string {
    return `
SELECT
    i.relname as index_name,
    t.relname as table_name,
    array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
    ix.indisunique as is_unique,
    ix.indisprimary as is_primary,
    ix.indpred IS NOT NULL as is_partial,
    pg_get_indexdef(i.oid) as definition,
    EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.contype = 'f'
        AND con.conrelid = t.oid
        AND array_to_string(
            ARRAY(
                SELECT a2.attname
                FROM pg_attribute a2
                WHERE a2.attrelid = t.oid
                AND a2.attnum = ANY(con.conkey)
                ORDER BY array_position(con.conkey, a2.attnum)
            ),
            ','
        ) = array_to_string(
            ARRAY(
                SELECT a3.attname
                FROM pg_attribute a3
                WHERE a3.attrelid = t.oid
                AND a3.attnum = ANY(ix.indkey)
                ORDER BY array_position(ix.indkey, a3.attnum)
            ),
            ','
        )
    ) as is_foreign_key
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
WHERE n.nspname = '${this.escapeString(schema)}'
AND t.relname = '${this.escapeString(table)}'
GROUP BY i.relname, t.relname, ix.indisunique, ix.indisprimary, ix.indpred, i.oid, t.oid, ix.indkey
ORDER BY i.relname`;
  }

  getIndexUsageStatsQuery(schema: string, table: string): string {
    return `
SELECT
    s.indexrelname AS index_name,
    s.idx_scan AS scan_count,
    s.idx_tup_read AS rows_read,
    s.idx_tup_fetch AS rows_returned,
    pg_size_pretty(pg_relation_size(s.indexrelid)) AS size_pretty,
    pg_relation_size(s.indexrelid) AS size_bytes,
    CASE
        WHEN s.idx_scan = 0 THEN true
        ELSE false
    END AS is_unused,
    CASE
        WHEN io.idx_blks_read + io.idx_blks_hit = 0 THEN NULL
        ELSE (io.idx_blks_hit::float / (io.idx_blks_read + io.idx_blks_hit)) * 100
    END AS cache_hit_ratio,
    NULL::timestamp AS last_idx_scan
FROM
    pg_stat_all_indexes s
    LEFT JOIN pg_statio_all_indexes io
        ON s.indexrelid = io.indexrelid
WHERE
    s.schemaname = '${this.escapeString(schema)}'
    AND s.relname = '${this.escapeString(table)}'
ORDER BY
    s.idx_scan DESC`;
  }

  getConstraintsQuery(schema: string, table: string): string {
    return `
SELECT
    con.conname as constraint_name,
    t.relname as table_name,
    CASE con.contype
        WHEN 'p' THEN 'PRIMARY KEY'
        WHEN 'f' THEN 'FOREIGN KEY'
        WHEN 'u' THEN 'UNIQUE'
        WHEN 'c' THEN 'CHECK'
        WHEN 'x' THEN 'EXCLUSION'
        ELSE con.contype::text
    END as constraint_type,
    pg_get_constraintdef(con.oid) as definition,
    CASE con.contype
        WHEN 'f' THEN (
            SELECT nf.nspname || '.' || cf.relname
            FROM pg_class cf
            JOIN pg_namespace nf ON nf.oid = cf.relnamespace
            WHERE cf.oid = con.confrelid
        )
        ELSE NULL
    END as foreign_table
FROM pg_constraint con
JOIN pg_class t ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = '${this.escapeString(schema)}'
AND t.relname = '${this.escapeString(table)}'
ORDER BY con.conname`;
  }

  getColumnsQuery(schema: string, table: string): string {
    return `
SELECT
    a.attname as column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as formatted_type,
    a.atttypid as type_oid,
    NOT a.attnotnull as nullable,
    EXISTS (
        SELECT 1 FROM pg_constraint con
        WHERE con.conrelid = c.oid
            AND con.contype = 'p'
            AND a.attnum = ANY(con.conkey)
    ) as is_primary_key,
    pg_get_expr(d.adbin, d.adrelid) as default_value,
    col_description(c.oid, a.attnum) as comment,
    t.typtype as type_category,
    CASE
        WHEN t.typtype = 'e' THEN (
            SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
            FROM pg_enum e
            WHERE e.enumtypid = t.oid
        )
        ELSE NULL
    END as enum_values,
    CASE
        WHEN t.typtype = 'd' THEN
            pg_catalog.format_type(t.typbasetype, t.typtypmod)
        ELSE NULL
    END as base_type,
    CASE
        WHEN t.typname IN ('numeric', 'decimal') AND a.atttypmod > 0 THEN
            ((a.atttypmod - 4) >> 16) & 65535
        ELSE NULL
    END as numeric_precision,
    CASE
        WHEN t.typname IN ('numeric', 'decimal') AND a.atttypmod > 0 THEN
            (a.atttypmod - 4) & 65535
        ELSE NULL
    END as numeric_scale
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type t ON t.oid = a.atttypid
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = '${this.escapeString(schema)}'
    AND c.relname = '${this.escapeString(table)}'
    AND a.attnum > 0
    AND NOT a.attisdropped
ORDER BY a.attnum`;
  }

  getTriggersQuery(schema: string, table: string): string {
    return `
SELECT
    t.tgname as trigger_name,
    n.nspname as schema_name,
    c.relname as table_name,
    CASE (t.tgtype::int & 2)
        WHEN 2 THEN 'BEFORE'
        ELSE 'AFTER'
    END as timing,
    ARRAY_REMOVE(ARRAY[
        CASE WHEN (t.tgtype::int & 4) = 4 THEN 'INSERT' END,
        CASE WHEN (t.tgtype::int & 8) = 8 THEN 'DELETE' END,
        CASE WHEN (t.tgtype::int & 16) = 16 THEN 'UPDATE' END,
        CASE WHEN (t.tgtype::int & 32) = 32 THEN 'TRUNCATE' END
    ], NULL) as events,
    CASE (t.tgtype::int & 1)
        WHEN 1 THEN 'ROW'
        ELSE 'STATEMENT'
    END as level,
    pn.nspname || '.' || p.proname as function_name,
    t.tgenabled != 'D' as is_enabled,
    pg_get_triggerdef(t.oid) as definition,
    obj_description(t.oid) as comment
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
WHERE n.nspname = '${this.escapeString(schema)}'
    AND c.relname = '${this.escapeString(table)}'
    AND NOT t.tgisinternal
ORDER BY t.tgname`;
  }

  getSupportedIndexTypesQuery(): string {
    return `SELECT amname FROM pg_am WHERE amtype = 'i' ORDER BY amname`;
  }

  getSupportedColumnTypesQuery(): string {
    return `
WITH base_types AS (
    SELECT DISTINCT
        t.typname as type_name,
        CASE t.typcategory
            WHEN 'N' THEN 'numeric'
            WHEN 'S' THEN 'string'
            WHEN 'B' THEN 'boolean'
            WHEN 'D' THEN 'datetime'
            WHEN 'G' THEN 'geometry'
            WHEN 'V' THEN 'bit'
            WHEN 'A' THEN 'array'
            WHEN 'R' THEN 'range'
            WHEN 'U' THEN 'user-defined'
            ELSE 'other'
        END as category,
        t.typlen as type_length
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype IN ('b', 'e', 'r')
        AND n.nspname IN ('pg_catalog', 'public')
        AND t.typname NOT LIKE '\\_%'
        AND t.typname NOT LIKE 'pg_%'
)
SELECT type_name, category, type_length
FROM base_types
ORDER BY category, type_name`;
  }

  getTableCountQuery(schema: string, table: string, exact?: boolean): string {
    if (exact) {
      return `SELECT COUNT(*) as count FROM ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
    }
    return `
SELECT reltuples::bigint as count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${this.escapeString(schema)}' AND c.relname = '${this.escapeString(table)}'`;
  }

  getTableStatsQuery(schema: string, table: string): string {
    return `
SELECT
    pg_catalog.pg_get_userbyid(c.relowner) as owner,
    pg_size_pretty(pg_total_relation_size(c.oid)) as size,
    c.reltuples::bigint as row_count,
    obj_description(c.oid) as comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${this.escapeString(schema)}'
    AND c.relname = '${this.escapeString(table)}'
    AND c.relkind IN ('r', 'p', 'f')`;
  }

  getForeignKeyTargetsQuery(schema: string): string {
    return `
WITH pk_columns AS (
    SELECT
        c.relname AS table_name,
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
    WHERE n.nspname = '${this.escapeString(schema)}'
        AND con.contype = 'p'
        AND c.relkind IN ('r', 'p')
),
unique_columns AS (
    SELECT
        c.relname AS table_name,
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
    WHERE n.nspname = '${this.escapeString(schema)}'
        AND con.contype = 'u'
        AND c.relkind IN ('r', 'p')
),
unique_index_columns AS (
    SELECT
        t.relname AS table_name,
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE n.nspname = '${this.escapeString(schema)}'
        AND ix.indisunique = true
        AND ix.indisprimary = false
        AND t.relkind IN ('r', 'p')
        AND NOT EXISTS (
            SELECT 1 FROM pg_constraint con
            WHERE con.conrelid = t.oid
                AND con.conindid = i.oid
        )
)
SELECT DISTINCT table_name, column_name, data_type
FROM (
    SELECT * FROM pk_columns
    UNION
    SELECT * FROM unique_columns
    UNION
    SELECT * FROM unique_index_columns
) combined
ORDER BY table_name, column_name`;
  }

  getObjectDefinitionQuery(
    objectType: import('../types').ObjectDefinitionType,
    schema: string,
    name: string
  ): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;

    switch (objectType) {
      case 'view':
      case 'materialized_view':
        return `SELECT pg_get_viewdef('${this.escapeString(qualifiedName)}'::regclass, true) as definition`;
      case 'function':
      case 'procedure':
        return `SELECT pg_get_functiondef('${this.escapeString(qualifiedName)}'::regprocedure) as definition`;
      case 'sequence':
        return `
SELECT
    'CREATE SEQUENCE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) ||
    ' AS ' || pg_catalog.format_type(s.seqtypid, NULL) ||
    ' INCREMENT BY ' || s.seqincrement ||
    ' MINVALUE ' || s.seqmin ||
    ' MAXVALUE ' || s.seqmax ||
    ' START WITH ' || s.seqstart ||
    CASE WHEN s.seqcycle THEN ' CYCLE' ELSE ' NO CYCLE' END ||
    CASE WHEN s.seqcache > 1 THEN ' CACHE ' || s.seqcache ELSE '' END ||
    ';' as definition
FROM pg_sequence s
JOIN pg_class c ON c.oid = s.seqrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${this.escapeString(schema)}'
    AND c.relname = '${this.escapeString(name)}'`;
      case 'enum':
        return `
SELECT
    'CREATE TYPE ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) || ' AS ENUM (' || E'\\n' ||
    string_agg('    ' || quote_literal(e.enumlabel), ',' || E'\\n' ORDER BY e.enumsortorder) ||
    E'\\n);' as definition
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname = '${this.escapeString(schema)}'
    AND t.typname = '${this.escapeString(name)}'
GROUP BY n.nspname, t.typname`;
      case 'domain':
        return `
SELECT
    'CREATE DOMAIN ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) ||
    ' AS ' || pg_catalog.format_type(t.typbasetype, t.typtypmod) ||
    CASE WHEN t.typnotnull THEN ' NOT NULL' ELSE '' END ||
    COALESCE(' DEFAULT ' || t.typdefault, '') ||
    COALESCE(E'\\n    ' || string_agg(pg_get_constraintdef(con.oid, true), E'\\n    '), '') ||
    ';' as definition
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_constraint con ON con.contypid = t.oid
WHERE n.nspname = '${this.escapeString(schema)}'
    AND t.typname = '${this.escapeString(name)}'
    AND t.typtype = 'd'
GROUP BY n.nspname, t.typname, t.typbasetype, t.typtypmod, t.typnotnull, t.typdefault`;
      case 'composite':
        return `
SELECT
    'CREATE TYPE ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) || ' AS (' || E'\\n' ||
    string_agg(
        '    ' || quote_ident(a.attname) || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod),
        ',' || E'\\n'
        ORDER BY a.attnum
    ) ||
    E'\\n);' as definition
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_class c ON c.oid = t.typrelid
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = '${this.escapeString(schema)}'
    AND t.typname = '${this.escapeString(name)}'
    AND t.typtype = 'c'
GROUP BY n.nspname, t.typname`;
      case 'index':
        return `
SELECT pg_get_indexdef(i.indexrelid) || ';' as definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${this.escapeString(schema)}'
    AND c.relname = '${this.escapeString(name)}'`;
      case 'table':
      default:
        // For tables, generate comprehensive DDL including sequences, constraints, indexes, and comments
        return `
WITH table_oid AS (
    SELECT c.oid, c.relname, n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${this.escapeString(schema)}'
        AND c.relname = '${this.escapeString(name)}'
),
-- Extract sequences from nextval() defaults
sequences AS (
    SELECT DISTINCT
        substring(pg_get_expr(d.adbin, d.adrelid) FROM 'nextval\\(''([^'']+)''') as seq_name
    FROM pg_attrdef d
    JOIN table_oid t ON d.adrelid = t.oid
    WHERE pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval%'
),
sequence_defs AS (
    SELECT
        '-- Sequences' || E'\\n' ||
        string_agg(
            'CREATE SEQUENCE IF NOT EXISTS ' || seq_name || ';',
            E'\\n'
        ) || E'\\n\\n' as definition
    FROM sequences
    WHERE seq_name IS NOT NULL
),
-- Extract custom types used by columns (enums, domains, composites)
custom_types AS (
    SELECT DISTINCT
        n.nspname || '.' || t.typname as type_name,
        t.typtype,
        t.oid as type_oid,
        n.nspname as type_schema,
        t.typname as type_simple_name
    FROM pg_attribute a
    JOIN table_oid tbl ON a.attrelid = tbl.oid
    JOIN pg_type t ON a.atttypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE a.attnum > 0
        AND NOT a.attisdropped
        AND t.typtype IN ('e', 'd', 'c')  -- enum, domain, composite
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')  -- exclude built-in types
),
enum_defs AS (
    SELECT
        ct.type_name,
        'CREATE TYPE ' || quote_ident(ct.type_schema) || '.' || quote_ident(ct.type_simple_name) || ' AS ENUM (' || E'\\n' ||
        string_agg('    ' || quote_literal(e.enumlabel), ',' || E'\\n' ORDER BY e.enumsortorder) ||
        E'\\n);' as definition
    FROM custom_types ct
    JOIN pg_enum e ON e.enumtypid = ct.type_oid
    WHERE ct.typtype = 'e'
    GROUP BY ct.type_name, ct.type_schema, ct.type_simple_name
),
domain_defs AS (
    SELECT
        ct.type_name,
        'CREATE DOMAIN ' || quote_ident(ct.type_schema) || '.' || quote_ident(ct.type_simple_name) ||
        ' AS ' || pg_catalog.format_type(t.typbasetype, t.typtypmod) ||
        CASE WHEN t.typnotnull THEN ' NOT NULL' ELSE '' END ||
        COALESCE(' DEFAULT ' || t.typdefault, '') ||
        COALESCE(' ' || (
            SELECT string_agg(pg_get_constraintdef(con.oid, true), ' ')
            FROM pg_constraint con WHERE con.contypid = t.oid
        ), '') ||
        ';' as definition
    FROM custom_types ct
    JOIN pg_type t ON t.oid = ct.type_oid
    WHERE ct.typtype = 'd'
),
composite_defs AS (
    SELECT
        ct.type_name,
        'CREATE TYPE ' || quote_ident(ct.type_schema) || '.' || quote_ident(ct.type_simple_name) || ' AS (' || E'\\n' ||
        string_agg(
            '    ' || quote_ident(a.attname) || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod),
            ',' || E'\\n'
            ORDER BY a.attnum
        ) ||
        E'\\n);' as definition
    FROM custom_types ct
    JOIN pg_type t ON t.oid = ct.type_oid
    JOIN pg_class c ON c.oid = t.typrelid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE ct.typtype = 'c'
    GROUP BY ct.type_name, ct.type_schema, ct.type_simple_name
),
all_type_defs AS (
    SELECT type_name, definition FROM enum_defs
    UNION ALL
    SELECT type_name, definition FROM domain_defs
    UNION ALL
    SELECT type_name, definition FROM composite_defs
),
type_defs AS (
    SELECT
        CASE WHEN COUNT(*) > 0 THEN
            '-- Custom Types' || E'\\n' ||
            string_agg(definition, E'\\n\\n' ORDER BY type_name) || E'\\n\\n'
        ELSE NULL END as definition
    FROM all_type_defs
    WHERE definition IS NOT NULL
),
columns AS (
    SELECT
        a.attname as name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
        a.attnotnull as not_null,
        pg_get_expr(d.adbin, d.adrelid) as default_val,
        a.attnum
    FROM pg_attribute a
    JOIN table_oid t ON a.attrelid = t.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attnum > 0
        AND NOT a.attisdropped
    ORDER BY a.attnum
),
pk AS (
    SELECT array_agg(quote_ident(a.attname) ORDER BY array_position(con.conkey, a.attnum)) as columns
    FROM pg_constraint con
    JOIN table_oid t ON con.conrelid = t.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'p'
),
table_def AS (
    SELECT
        '-- Table Definition' || E'\\n' ||
        'CREATE TABLE ' || quote_ident('${this.escapeString(schema)}') || '.' || quote_ident('${this.escapeString(name)}') || ' (' || E'\\n' ||
        string_agg(
            '    ' || quote_ident(c.name) || ' ' || c.type ||
            CASE WHEN c.not_null THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN c.default_val IS NOT NULL THEN ' DEFAULT ' || c.default_val ELSE '' END,
            ',' || E'\\n'
            ORDER BY c.attnum
        ) ||
        CASE WHEN pk.columns IS NOT NULL
            THEN ',' || E'\\n' || '    PRIMARY KEY (' || array_to_string(pk.columns, ', ') || ')'
            ELSE ''
        END ||
        E'\\n);' as definition
    FROM columns c
    CROSS JOIN pk
    GROUP BY pk.columns
),
-- UNIQUE constraints (not covered by unique indexes)
unique_constraints AS (
    SELECT
        'ALTER TABLE ' || quote_ident('${this.escapeString(schema)}') || '.' || quote_ident('${this.escapeString(name)}') ||
        ' ADD CONSTRAINT ' || quote_ident(con.conname) ||
        ' UNIQUE (' ||
        string_agg(quote_ident(a.attname), ', ' ORDER BY array_position(con.conkey, a.attnum)) ||
        ');' as constraint_def
    FROM pg_constraint con
    JOIN table_oid t ON con.conrelid = t.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'u'
    GROUP BY con.conname, con.conkey
),
-- CHECK constraints
check_constraints AS (
    SELECT
        'ALTER TABLE ' || quote_ident('${this.escapeString(schema)}') || '.' || quote_ident('${this.escapeString(name)}') ||
        ' ADD CONSTRAINT ' || quote_ident(con.conname) ||
        ' CHECK ' || pg_get_constraintdef(con.oid, true) || ';' as constraint_def
    FROM pg_constraint con
    JOIN table_oid t ON con.conrelid = t.oid
    WHERE con.contype = 'c'
),
-- FOREIGN KEY constraints
fk_constraints AS (
    SELECT
        'ALTER TABLE ' || quote_ident('${this.escapeString(schema)}') || '.' || quote_ident('${this.escapeString(name)}') ||
        ' ADD CONSTRAINT ' || quote_ident(con.conname) ||
        ' ' || pg_get_constraintdef(con.oid, true) || ';' as constraint_def
    FROM pg_constraint con
    JOIN table_oid t ON con.conrelid = t.oid
    WHERE con.contype = 'f'
),
all_constraints AS (
    SELECT constraint_def FROM unique_constraints
    UNION ALL
    SELECT constraint_def FROM check_constraints
    UNION ALL
    SELECT constraint_def FROM fk_constraints
),
constraint_defs AS (
    SELECT
        E'\\n\\n-- Constraints\\n' ||
        string_agg(constraint_def, E'\\n') as definition
    FROM all_constraints
    WHERE constraint_def IS NOT NULL
),
-- Get all non-primary-key indexes (excluding those backing unique constraints)
indexes AS (
    SELECT
        pg_get_indexdef(i.indexrelid) || ';' as idx_def
    FROM pg_index i
    JOIN table_oid t ON i.indrelid = t.oid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE NOT i.indisprimary
        AND NOT EXISTS (
            SELECT 1 FROM pg_constraint con
            WHERE con.conindid = i.indexrelid AND con.contype = 'u'
        )
    ORDER BY ic.relname
),
index_defs AS (
    SELECT
        E'\\n\\n-- Indexes\\n' ||
        string_agg(idx_def, E'\\n') as definition
    FROM indexes
    WHERE idx_def IS NOT NULL
),
-- Table comment
table_comment AS (
    SELECT
        E'\\n\\n-- Table Comment\\n' ||
        'COMMENT ON TABLE ' || quote_ident(t.nspname) || '.' || quote_ident(t.relname) ||
        ' IS ' || quote_literal(d.description) || ';' as definition
    FROM table_oid t
    JOIN pg_description d ON d.objoid = t.oid AND d.objsubid = 0
),
-- Column comments
column_comments AS (
    SELECT
        'COMMENT ON COLUMN ' || quote_ident('${this.escapeString(schema)}') || '.' || quote_ident('${this.escapeString(name)}') ||
        '.' || quote_ident(a.attname) ||
        ' IS ' || quote_literal(d.description) || ';' as comment_def
    FROM pg_attribute a
    JOIN table_oid t ON a.attrelid = t.oid
    JOIN pg_description d ON d.objoid = t.oid AND d.objsubid = a.attnum
    WHERE a.attnum > 0
        AND NOT a.attisdropped
    ORDER BY a.attnum
),
comment_defs AS (
    SELECT
        E'\\n\\n-- Column Comments\\n' ||
        string_agg(comment_def, E'\\n') as definition
    FROM column_comments
    WHERE comment_def IS NOT NULL
)
SELECT
    COALESCE((SELECT definition FROM sequence_defs), '') ||
    COALESCE((SELECT definition FROM type_defs), '') ||
    (SELECT definition FROM table_def) ||
    COALESCE((SELECT definition FROM constraint_defs), '') ||
    COALESCE((SELECT definition FROM index_defs), '') ||
    COALESCE((SELECT definition FROM table_comment), '') ||
    COALESCE((SELECT definition FROM comment_defs), '') as definition`;
    }
  }
}
