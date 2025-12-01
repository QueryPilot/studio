/**
 * PostgreSQL Introspection Queries
 *
 * System catalog queries for schema metadata retrieval.
 * Ported from src-tauri/src/adapters/postgres/introspection.rs
 */

/**
 * Query to list all databases
 */
export const GET_DATABASES_QUERY = `
SELECT
    datname as name,
    pg_catalog.pg_get_userbyid(datdba) as owner,
    pg_encoding_to_char(encoding) as encoding,
    datcollate as collation,
    pg_size_pretty(pg_database_size(datname)) as size
FROM pg_database
WHERE datistemplate = false
ORDER BY datname
`;

/**
 * Query to list schemas in the current database
 */
export const GET_SCHEMAS_QUERY = `
SELECT
    nspname as name,
    pg_catalog.pg_get_userbyid(nspowner) as owner
FROM pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND nspname NOT LIKE 'pg_temp_%'
    AND nspname NOT LIKE 'pg_toast_temp_%'
ORDER BY nspname
`;

/**
 * Query to list tables in a schema
 * Parameter $1: schema name
 */
export const GET_TABLES_QUERY = `
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
WHERE n.nspname = $1
    AND c.relkind IN ('r', 'p', 'f')
ORDER BY c.relname
`;

/**
 * Query to list views in a schema
 * Parameter $1: schema name
 */
export const GET_VIEWS_QUERY = `
SELECT
    n.nspname as schema_name,
    c.relname as view_name,
    pg_catalog.pg_get_userbyid(c.relowner) as owner,
    pg_get_viewdef(c.oid, true) as definition,
    c.relkind = 'm' as is_materialized,
    obj_description(c.oid) as comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
    AND c.relkind IN ('v', 'm')
ORDER BY c.relname
`;

/**
 * Query to list functions in a schema
 * Parameter $1: schema name
 */
export const GET_FUNCTIONS_QUERY = `
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
WHERE n.nspname = $1
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
`;

/**
 * Query to list indexes on a table
 * Parameter $1: table name
 * Note: Uses current_schema() - should be called after SET search_path
 */
export const GET_INDEXES_QUERY = `
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
WHERE n.nspname = $1
AND t.relname = $2
GROUP BY i.relname, t.relname, ix.indisunique, ix.indisprimary, ix.indpred, i.oid, t.oid, ix.indkey
ORDER BY i.relname
`;

/**
 * Query to get index usage statistics (PostgreSQL 16+)
 * Parameter $1: table name
 */
export const GET_INDEX_USAGE_STATS_QUERY_PG16 = `
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
    s.last_idx_scan AT TIME ZONE 'UTC' AS last_idx_scan
FROM
    pg_stat_all_indexes s
    LEFT JOIN pg_statio_all_indexes io
        ON s.indexrelid = io.indexrelid
WHERE
    s.relname = $1
    AND s.schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY
    s.idx_scan DESC
`;

/**
 * Query to get index usage statistics (PostgreSQL < 16)
 * Parameter $1: table name
 */
export const GET_INDEX_USAGE_STATS_QUERY_LEGACY = `
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
    s.relname = $1
    AND s.schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY
    s.idx_scan DESC
`;

/**
 * Query to list constraints on a table
 * Parameter $1: table name
 */
export const GET_CONSTRAINTS_QUERY = `
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
WHERE n.nspname = $1
AND t.relname = $2
ORDER BY con.conname
`;

/**
 * Query to list columns of a table
 * Parameters: $1 = schema, $2 = table
 */
export const GET_COLUMNS_QUERY = `
SELECT
    a.attname as column_name,
    t.typname as raw_type_name,
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
WHERE n.nspname = $1
    AND c.relname = $2
    AND a.attnum > 0
    AND NOT a.attisdropped
ORDER BY a.attnum
`;

/**
 * Query to list triggers on a table
 * Parameters: $1 = schema, $2 = table
 */
export const GET_TRIGGERS_QUERY = `
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
WHERE n.nspname = $1
    AND c.relname = $2
    AND NOT t.tgisinternal
ORDER BY t.tgname
`;

/**
 * Query to get supported index types
 */
export const GET_SUPPORTED_INDEX_TYPES_QUERY = `
SELECT amname FROM pg_am WHERE amtype = 'i' ORDER BY amname
`;

/**
 * Query to get supported column types
 */
export const GET_SUPPORTED_COLUMN_TYPES_QUERY = `
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
ORDER BY category, type_name
`;

/**
 * Query to get row count for a table
 * Parameters: $1 = schema, $2 = table
 */
export const GET_TABLE_COUNT_QUERY = `
SELECT COUNT(*) as count FROM $1.$2
`;

/**
 * Query to get estimated row count (faster, uses statistics)
 */
export const GET_TABLE_COUNT_ESTIMATED_QUERY = `
SELECT reltuples::bigint as count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
`;

/**
 * Query to get view definition
 */
export const GET_VIEW_DEFINITION_QUERY = `
SELECT pg_get_viewdef($1::regclass, true) as definition
`;

/**
 * Query to get function definition
 */
export const GET_FUNCTION_DEFINITION_QUERY = `
SELECT pg_get_functiondef($1::regprocedure) as definition
`;

/**
 * Query to get table DDL (comprehensive)
 * This generates CREATE TABLE statement
 */
export const GET_TABLE_DEFINITION_QUERY = `
WITH columns AS (
    SELECT
        a.attname as name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
        a.attnotnull as not_null,
        pg_get_expr(d.adbin, d.adrelid) as default_val,
        a.attnum
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = $1
        AND c.relname = $2
        AND a.attnum > 0
        AND NOT a.attisdropped
    ORDER BY a.attnum
),
pk AS (
    SELECT array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum)) as columns
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
    WHERE n.nspname = $1
        AND c.relname = $2
        AND con.contype = 'p'
)
SELECT
    'CREATE TABLE ' || quote_ident($1) || '.' || quote_ident($2) || ' (' || E'\\n' ||
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
`;
