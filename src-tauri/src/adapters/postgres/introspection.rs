use tokio_postgres::Client;
use std::sync::Arc;

use crate::error::{AppError, Result};
use crate::types::*;
use super::types::PostgresTypeConverter;

pub struct PostgresIntrospector {
    client: Arc<Client>,
}

impl PostgresIntrospector {
    pub fn new(client: Arc<Client>) -> Self {
        Self { client }
    }
    
    pub async fn get_databases(&self) -> Result<Vec<Database>> {
        let sql = r#"
            SELECT 
                datname as name,
                pg_catalog.pg_get_userbyid(datdba) as owner,
                pg_encoding_to_char(encoding) as encoding,
                datcollate as collation,
                pg_size_pretty(pg_database_size(datname)) as size
            FROM pg_database
            WHERE datistemplate = false
            ORDER BY datname
        "#;
        
        let rows = self.client.query(sql, &[]).await?;
        
        let databases = rows.iter().map(|row| {
            Database {
                name: row.get(0),
                owner: row.get(1),
                encoding: row.get(2),
                collation: row.get(3),
                size: row.get(4),
            }
        }).collect();
        
        Ok(databases)
    }
    
    pub async fn get_schemas(&self) -> Result<Vec<Schema>> {
        let sql = r#"
            SELECT 
                nspname as name,
                pg_catalog.pg_get_userbyid(nspowner) as owner
            FROM pg_namespace
            WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                AND nspname NOT LIKE 'pg_temp_%'
                AND nspname NOT LIKE 'pg_toast_temp_%'
            ORDER BY nspname
        "#;
        
        let rows = self.client.query(sql, &[]).await?;
        
        let schemas = rows.iter().map(|row| {
            Schema {
                name: row.get(0),
                owner: row.get(1),
            }
        }).collect();
        
        Ok(schemas)
    }
    
    pub async fn get_tables(&self, schema: &str) -> Result<Vec<Table>> {
        let sql = r#"
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
        "#;
        
        let rows = self.client.query(sql, &[&schema]).await?;
        
        let tables = rows.iter().map(|row| {
            let kind_str: String = row.get(2);
            let kind = match kind_str.as_str() {
                "partitioned" => TableKind::Partitioned,
                "foreign" => TableKind::Foreign,
                _ => TableKind::Regular,
            };
            
            Table {
                schema: row.get(0),
                name: row.get(1),
                kind,
                owner: row.get(3),
                size: row.get(4),
                row_count: Some(row.get::<_, i64>(5)),
                comment: row.get(6),
            }
        }).collect();
        
        Ok(tables)
    }
    
    pub async fn get_views(&self, schema: &str) -> Result<Vec<View>> {
        let sql = r#"
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
        "#;
        
        let rows = self.client.query(sql, &[&schema]).await?;
        
        let views = rows.iter().map(|row| {
            View {
                schema: row.get(0),
                name: row.get(1),
                owner: row.get(2),
                definition: row.get(3),
                is_materialized: row.get(4),
                comment: row.get(5),
            }
        }).collect();
        
        Ok(views)
    }
    
    pub async fn get_functions(&self, schema: &str) -> Result<Vec<Function>> {
        let sql = r#"
            SELECT 
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
            ORDER BY p.proname
        "#;
        
        let rows = self.client.query(sql, &[&schema]).await?;
        
        let functions = rows.iter().map(|row| {
            Function {
                schema: row.get(0),
                name: row.get(1),
                arguments: row.get(2),
                return_type: row.try_get::<_, String>(3).unwrap_or_else(|_| "void".to_string()),
                language: row.get(4),
                is_aggregate: row.get(5),
                is_window: row.get(6),
                is_trigger: row.get(7),
                source: row.get(8),
            }
        }).collect();
        
        Ok(functions)
    }
    
    pub async fn get_indexes(&self, table: &str) -> Result<Vec<Index>> {
        let sql = r#"
            SELECT 
                i.relname as index_name,
                t.relname as table_name,
                array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
                ix.indisunique as is_unique,
                ix.indisprimary as is_primary,
                ix.indpred IS NOT NULL as is_partial,
                pg_get_indexdef(i.oid) as definition
            FROM pg_index ix
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE t.relname = $1
            GROUP BY i.relname, t.relname, ix.indisunique, ix.indisprimary, ix.indpred, i.oid
            ORDER BY i.relname
        "#;
        
        let rows = self.client.query(sql, &[&table]).await?;
        
        let indexes = rows.iter().map(|row| {
            let columns: Vec<String> = row.get(2);
            
            Index {
                name: row.get(0),
                table_name: row.get(1),
                columns,
                is_unique: row.get(3),
                is_primary: row.get(4),
                is_partial: row.get(5),
                definition: row.get(6),
            }
        }).collect();
        
        Ok(indexes)
    }
    
    pub async fn get_constraints(&self, table: &str) -> Result<Vec<Constraint>> {
        let sql = r#"
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
            WHERE t.relname = $1
            ORDER BY con.conname
        "#;
        
        let rows = self.client.query(sql, &[&table]).await?;
        
        let constraints = rows.iter().map(|row| {
            let type_str: String = row.get(2);
            let constraint_type = match type_str.as_str() {
                "PRIMARY KEY" => ConstraintType::PrimaryKey,
                "FOREIGN KEY" => ConstraintType::ForeignKey,
                "UNIQUE" => ConstraintType::Unique,
                "CHECK" => ConstraintType::Check,
                "EXCLUSION" => ConstraintType::Exclusion,
                _ => ConstraintType::Check,
            };
            
            Constraint {
                name: row.get(0),
                table_name: row.get(1),
                constraint_type,
                definition: row.get(3),
                foreign_table: row.get(4),
            }
        }).collect();
        
        Ok(constraints)
    }
    
    pub async fn get_table_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnMeta>> {
        let sql = r#"
            SELECT 
                a.attname as column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
                a.atttypid as type_oid,
                NOT a.attnotnull as nullable,
                EXISTS (
                    SELECT 1 FROM pg_constraint con
                    WHERE con.conrelid = c.oid
                        AND con.contype = 'p'
                        AND a.attnum = ANY(con.conkey)
                ) as is_primary_key,
                pg_get_expr(d.adbin, d.adrelid) as default_value,
                col_description(c.oid, a.attnum) as comment
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE n.nspname = $1
                AND c.relname = $2
                AND a.attnum > 0
                AND NOT a.attisdropped
            ORDER BY a.attnum
        "#;
        
        let rows = self.client.query(sql, &[&schema, &table]).await?;
        
        let columns = rows.iter().map(|row| {
            let type_oid: u32 = row.get(2);
            
            ColumnMeta {
                name: row.get(0),
                data_type: PostgresTypeConverter::oid_to_cell_type(type_oid),
                nullable: row.get(3),
                primary_key: row.get(4),
                db_type: row.get(1),
                type_oid: Some(type_oid),
            }
        }).collect();
        
        Ok(columns)
    }
    
    pub async fn get_triggers(&self, schema: &str, table: &str) -> Result<Vec<Trigger>> {
        let sql = r#"
            SELECT 
                t.tgname as trigger_name,
                n.nspname as schema_name,
                c.relname as table_name,
                STRING_AGG(
                    CASE em.evttype
                        WHEN '1' THEN 'INSERT'
                        WHEN '2' THEN 'DELETE'
                        WHEN '3' THEN 'UPDATE'
                        WHEN '4' THEN 'TRUNCATE'
                    END, ' OR ' ORDER BY em.evttype
                ) as event,
                CASE t.tgtype & 2
                    WHEN 2 THEN 'BEFORE'
                    WHEN 0 THEN 'AFTER'
                END || CASE t.tgtype & 64
                    WHEN 64 THEN ' INSTEAD OF'
                    ELSE ''
                END as timing,
                CASE t.tgtype & 1
                    WHEN 1 THEN 'ROW'
                    ELSE 'STATEMENT'
                END as level,
                t.tgenabled != 'D' as enabled,
                p.proname || '()' as function_name,
                pg_get_triggerdef(t.oid) as definition
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_proc p ON p.oid = t.tgfoid
            JOIN LATERAL (
                SELECT *
                FROM unnest(ARRAY[
                    CASE WHEN t.tgtype & 4 = 4 THEN '1' END,
                    CASE WHEN t.tgtype & 8 = 8 THEN '2' END,
                    CASE WHEN t.tgtype & 16 = 16 THEN '3' END,
                    CASE WHEN t.tgtype & 32 = 32 THEN '4' END
                ]) AS evttype
                WHERE evttype IS NOT NULL
            ) em ON true
            WHERE n.nspname = $1
                AND c.relname = $2
                AND NOT t.tgisinternal
            GROUP BY t.tgname, n.nspname, c.relname, t.tgtype, t.tgenabled, p.proname, t.oid
            ORDER BY t.tgname
        "#;
        
        let rows = self.client.query(sql, &[&schema, &table]).await?;
        
        let triggers = rows.iter().map(|row| {
            let definition: String = row.get(8);  // definition is at index 8, not 9
            let condition = if definition.contains("WHEN") {
                definition.split("WHEN").nth(1).map(|s| s.trim().to_string())
            } else {
                None
            };
            
            Trigger {
                name: row.get(0),
                schema: row.get(1),
                table_name: row.get(2),
                event: row.get(3),
                timing: row.get(4),
                level: row.get(5),
                enabled: row.get(6),
                function: row.get(7),
                condition,
            }
        }).collect();
        
        Ok(triggers)
    }
}