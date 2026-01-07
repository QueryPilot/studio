//! Schema query helpers for different database dialects.

use super::dialect::SqlDialect;

/// Get query to list tables in a schema.
pub fn get_tables_query(dialect: SqlDialect, schema: &str) -> String {
    match dialect {
        SqlDialect::PostgreSQL => format!(
            r#"SELECT
                table_name as name,
                table_schema as schema,
                table_type,
                obj_description((quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass) as comment
            FROM information_schema.tables
            WHERE table_schema = '{}'
            ORDER BY table_name"#,
            schema
        ),
        SqlDialect::MySQL => format!(
            r#"SELECT
                table_name as name,
                table_schema as `schema`,
                table_type,
                table_comment as comment
            FROM information_schema.tables
            WHERE table_schema = '{}'
            ORDER BY table_name"#,
            schema
        ),
        SqlDialect::SQLite => r#"SELECT
            name,
            'main' as schema,
            type as table_type,
            NULL as comment
        FROM sqlite_master
        WHERE type IN ('table', 'view')
        ORDER BY name"#.to_string(),
        SqlDialect::MsSQL => format!(
            r#"SELECT
                t.name,
                s.name as [schema],
                CASE WHEN t.type = 'U' THEN 'BASE TABLE' ELSE 'VIEW' END as table_type,
                ep.value as comment
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0
            WHERE s.name = '{}'
            ORDER BY t.name"#,
            schema
        ),
        SqlDialect::PlSQL => format!(
            r#"SELECT
                table_name as name,
                owner as schema,
                'BASE TABLE' as table_type,
                comments as comment
            FROM all_tab_comments
            WHERE owner = '{}'
            ORDER BY table_name"#,
            schema.to_uppercase()
        ),
    }
}

/// Get query to list columns for a table.
pub fn get_columns_query(dialect: SqlDialect, schema: &str, table: &str) -> String {
    match dialect {
        SqlDialect::PostgreSQL => format!(
            r#"SELECT
                c.column_name as name,
                c.data_type,
                c.is_nullable = 'YES' as nullable,
                c.column_default as default_value,
                COALESCE(tc.constraint_type = 'PRIMARY KEY', false) as is_primary_key,
                pgd.description as comment
            FROM information_schema.columns c
            LEFT JOIN information_schema.key_column_usage kcu
                ON c.table_schema = kcu.table_schema
                AND c.table_name = kcu.table_name
                AND c.column_name = kcu.column_name
            LEFT JOIN information_schema.table_constraints tc
                ON kcu.constraint_name = tc.constraint_name
                AND tc.constraint_type = 'PRIMARY KEY'
            LEFT JOIN pg_catalog.pg_statio_all_tables st
                ON c.table_schema = st.schemaname
                AND c.table_name = st.relname
            LEFT JOIN pg_catalog.pg_description pgd
                ON pgd.objoid = st.relid
                AND pgd.objsubid = c.ordinal_position
            WHERE c.table_schema = '{}' AND c.table_name = '{}'
            ORDER BY c.ordinal_position"#,
            schema, table
        ),
        SqlDialect::MySQL => format!(
            r#"SELECT
                column_name as name,
                data_type,
                is_nullable = 'YES' as nullable,
                column_default as default_value,
                column_key = 'PRI' as is_primary_key,
                column_comment as comment
            FROM information_schema.columns
            WHERE table_schema = '{}' AND table_name = '{}'
            ORDER BY ordinal_position"#,
            schema, table
        ),
        SqlDialect::SQLite => format!(
            r#"SELECT
                name,
                type as data_type,
                NOT "notnull" as nullable,
                dflt_value as default_value,
                pk > 0 as is_primary_key,
                NULL as comment
            FROM pragma_table_info('{}')"#,
            table
        ),
        SqlDialect::MsSQL => format!(
            r#"SELECT
                c.name,
                t.name as data_type,
                c.is_nullable as nullable,
                dc.definition as default_value,
                CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END as is_primary_key,
                ep.value as comment
            FROM sys.columns c
            JOIN sys.types t ON c.user_type_id = t.user_type_id
            JOIN sys.tables tbl ON c.object_id = tbl.object_id
            JOIN sys.schemas s ON tbl.schema_id = s.schema_id
            LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
            LEFT JOIN (
                SELECT ic.object_id, ic.column_id
                FROM sys.index_columns ic
                JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                WHERE i.is_primary_key = 1
            ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
            LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id
            WHERE s.name = '{}' AND tbl.name = '{}'
            ORDER BY c.column_id"#,
            schema, table
        ),
        SqlDialect::PlSQL => format!(
            r#"SELECT
                column_name as name,
                data_type,
                CASE WHEN nullable = 'Y' THEN 1 ELSE 0 END as nullable,
                data_default as default_value,
                0 as is_primary_key,
                NULL as comment
            FROM all_tab_columns
            WHERE owner = '{}' AND table_name = '{}'
            ORDER BY column_id"#,
            schema.to_uppercase(), table.to_uppercase()
        ),
    }
}

/// Get query to list foreign keys.
pub fn get_foreign_keys_query(dialect: SqlDialect, schema: &str) -> String {
    match dialect {
        SqlDialect::PostgreSQL => format!(
            r#"SELECT
                tc.constraint_name as name,
                kcu.table_name as source_table,
                kcu.column_name as source_column,
                ccu.table_name as target_table,
                ccu.column_name as target_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = '{}'"#,
            schema
        ),
        SqlDialect::MySQL => format!(
            r#"SELECT
                constraint_name as name,
                table_name as source_table,
                column_name as source_column,
                referenced_table_name as target_table,
                referenced_column_name as target_column
            FROM information_schema.key_column_usage
            WHERE referenced_table_name IS NOT NULL
            AND table_schema = '{}'"#,
            schema
        ),
        _ => String::new(), // Other dialects need custom handling
    }
}

/// Get query to list enums (PostgreSQL specific).
pub fn get_enums_query(dialect: SqlDialect, schema: &str) -> String {
    match dialect {
        SqlDialect::PostgreSQL => format!(
            r#"SELECT
                t.typname as name,
                array_agg(e.enumlabel ORDER BY e.enumsortorder) as values
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE n.nspname = '{}'
            GROUP BY t.typname"#,
            schema
        ),
        _ => String::new(), // MySQL uses ENUM inline, others don't have enums
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tables_query_postgres() {
        let query = get_tables_query(SqlDialect::PostgreSQL, "public");
        assert!(query.contains("information_schema.tables"));
        assert!(query.contains("public"));
    }

    #[test]
    fn test_columns_query_mysql() {
        let query = get_columns_query(SqlDialect::MySQL, "mydb", "users");
        assert!(query.contains("information_schema.columns"));
        assert!(query.contains("mydb"));
        assert!(query.contains("users"));
    }
}
