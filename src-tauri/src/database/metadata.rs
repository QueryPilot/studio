use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use sqlx::{Row, postgres::PgRow};
use crate::error::AppError;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EnhancedColumnMeta {
    pub name: String,
    pub db_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_pk: bool,
    pub is_fk: bool,
    pub fk_reference: Option<ForeignKeyRef>,
    pub check_constraint: Option<String>,
    pub ordinal: i32,
    pub precision: Option<i32>,
    pub scale: Option<i32>,
    pub character_maximum_length: Option<i32>,
    pub is_unique: bool,
    pub is_indexed: bool,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ForeignKeyRef {
    pub constraint_name: String,
    pub referenced_schema: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_delete: String,
    pub on_update: String,
}

pub async fn fetch_enhanced_columns_postgres(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<EnhancedColumnMeta>, AppError> {
    // Fetch basic column information
    let basic_sql = r#"
        SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default,
            ordinal_position,
            numeric_precision,
            numeric_scale,
            character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
    "#;
    
    let basic_rows = sqlx::query(basic_sql)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
    
    // Initialize columns map
    let mut columns_map: HashMap<String, EnhancedColumnMeta> = HashMap::new();
    
    for row in basic_rows {
        let col = EnhancedColumnMeta {
            name: row.get("column_name"),
            db_type: row.get("data_type"),
            nullable: row.get::<String, _>("is_nullable") == "YES",
            default: row.get("column_default"),
            is_pk: false,
            is_fk: false,
            fk_reference: None,
            check_constraint: None,
            ordinal: row.get("ordinal_position"),
            precision: row.get("numeric_precision"),
            scale: row.get("numeric_scale"),
            character_maximum_length: row.get("character_maximum_length"),
            is_unique: false,
            is_indexed: false,
            comment: None,
        };
        columns_map.insert(col.name.clone(), col);
    }
    
    // Fetch primary key columns
    let pk_sql = r#"
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = $1
            AND tc.table_name = $2
    "#;
    
    let pk_rows = sqlx::query(pk_sql)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
    
    for row in pk_rows {
        let col_name: String = row.get("column_name");
        if let Some(col) = columns_map.get_mut(&col_name) {
            col.is_pk = true;
            col.is_unique = true;
        }
    }
    
    // Fetch foreign key references
    let fk_sql = r#"
        SELECT 
            kcu.column_name,
            kcu.constraint_name,
            ccu.table_schema AS referenced_schema,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column,
            rc.delete_rule,
            rc.update_rule
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.table_constraints tc
            ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc
            ON rc.constraint_name = tc.constraint_name
            AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
            AND kcu.table_schema = $1
            AND kcu.table_name = $2
    "#;
    
    let fk_rows = sqlx::query(fk_sql)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
    
    for row in fk_rows {
        let col_name: String = row.get("column_name");
        if let Some(col) = columns_map.get_mut(&col_name) {
            col.is_fk = true;
            col.fk_reference = Some(ForeignKeyRef {
                constraint_name: row.get("constraint_name"),
                referenced_schema: row.get("referenced_schema"),
                referenced_table: row.get("referenced_table"),
                referenced_column: row.get("referenced_column"),
                on_delete: row.get("delete_rule"),
                on_update: row.get("update_rule"),
            });
        }
    }
    
    // Fetch unique constraints
    let unique_sql = r#"
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'UNIQUE'
            AND tc.table_schema = $1
            AND tc.table_name = $2
    "#;
    
    let unique_rows = sqlx::query(unique_sql)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
    
    for row in unique_rows {
        let col_name: String = row.get("column_name");
        if let Some(col) = columns_map.get_mut(&col_name) {
            col.is_unique = true;
        }
    }
    
    // Fetch indexed columns
    let index_sql = r#"
        SELECT DISTINCT a.attname AS column_name
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
    "#;
    
    let index_rows = sqlx::query(index_sql)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
    
    for row in index_rows {
        let col_name: String = row.get("column_name");
        if let Some(col) = columns_map.get_mut(&col_name) {
            col.is_indexed = true;
        }
    }
    
    // Fetch check constraints
    let check_sql = r#"
        SELECT 
            a.attname AS column_name,
            pg_get_constraintdef(con.oid) AS check_clause
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attnum = ANY(con.conkey)
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'c'
            AND n.nspname = $1
            AND c.relname = $2
    "#;
    
    let check_rows = sqlx::query(check_sql)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
    
    for row in check_rows {
        let col_name: String = row.get("column_name");
        if let Some(col) = columns_map.get_mut(&col_name) {
            let check_clause: String = row.get("check_clause");
            col.check_constraint = Some(check_clause);
        }
    }
    
    // Fetch column comments
    let comment_sql = r#"
        SELECT 
            a.attname AS column_name,
            d.description AS comment
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
        WHERE n.nspname = $1 
            AND c.relname = $2
            AND a.attnum > 0
            AND NOT a.attisdropped
            AND d.description IS NOT NULL
    "#;
    
    let comment_rows = sqlx::query(comment_sql)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
    
    for row in comment_rows {
        let col_name: String = row.get("column_name");
        if let Some(col) = columns_map.get_mut(&col_name) {
            let comment: String = row.get("comment");
            col.comment = Some(comment);
        }
    }
    
    // Sort by ordinal and return
    let mut columns: Vec<_> = columns_map.into_values().collect();
    columns.sort_by_key(|c| c.ordinal);
    
    Ok(columns)
}

pub async fn fetch_enhanced_columns_mysql(
    pool: &sqlx::MySqlPool,
    schema: &str,
    table: &str,
) -> Result<Vec<EnhancedColumnMeta>, AppError> {
    // MySQL implementation
    let sql = r#"
        SELECT 
            COLUMN_NAME as column_name,
            DATA_TYPE as data_type,
            IS_NULLABLE as is_nullable,
            COLUMN_DEFAULT as column_default,
            ORDINAL_POSITION as ordinal_position,
            NUMERIC_PRECISION as numeric_precision,
            NUMERIC_SCALE as numeric_scale,
            CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
            COLUMN_KEY as column_key,
            EXTRA as extra,
            COLUMN_COMMENT as comment
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
    "#;
    
    let rows = sqlx::query(sql)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
    
    let mut columns = Vec::new();
    
    for row in rows {
        let column_key: String = row.get("column_key");
        let extra: String = row.get("extra");
        
        let col = EnhancedColumnMeta {
            name: row.get("column_name"),
            db_type: row.get("data_type"),
            nullable: row.get::<String, _>("is_nullable") == "YES",
            default: row.get("column_default"),
            is_pk: column_key == "PRI",
            is_fk: column_key == "MUL",
            fk_reference: None, // Would need additional query for MySQL FK details
            check_constraint: None,
            ordinal: row.get("ordinal_position"),
            precision: row.get("numeric_precision"),
            scale: row.get("numeric_scale"),
            character_maximum_length: row.get("character_maximum_length"),
            is_unique: column_key == "UNI",
            is_indexed: !column_key.is_empty(),
            comment: row.get("comment"),
        };
        columns.push(col);
    }
    
    Ok(columns)
}

pub async fn fetch_enhanced_columns_sqlite(
    pool: &sqlx::SqlitePool,
    table: &str,
) -> Result<Vec<EnhancedColumnMeta>, AppError> {
    // SQLite pragma table_info
    let sql = format!("PRAGMA table_info({})", table);
    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await?;
    
    let mut columns = Vec::new();
    
    for (idx, row) in rows.iter().enumerate() {
        let col = EnhancedColumnMeta {
            name: row.get("name"),
            db_type: row.get("type"),
            nullable: row.get::<i32, _>("notnull") == 0,
            default: row.get("dflt_value"),
            is_pk: row.get::<i32, _>("pk") > 0,
            is_fk: false, // Would need additional query
            fk_reference: None,
            check_constraint: None,
            ordinal: idx as i32 + 1,
            precision: None,
            scale: None,
            character_maximum_length: None,
            is_unique: false,
            is_indexed: false,
            comment: None,
        };
        columns.push(col);
    }
    
    Ok(columns)
}