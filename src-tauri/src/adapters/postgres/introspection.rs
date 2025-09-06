use tokio_postgres::Client;
use std::sync::Arc;

use crate::error::{AppError, Result};
use crate::types::*;
use super::types::PostgresTypeConverter;
use super::parser::quote_index_definition;

pub struct PostgresIntrospector {
    client: Arc<Client>,
}

impl PostgresIntrospector {
    pub fn new(client: Arc<Client>) -> Self {
        Self { client }
    }
    
    /// Convert PostgreSQL type names to their shorthand forms
    fn format_type_shorthand(type_name: &str) -> String {
        // Replace common verbose type names with their shorthand equivalents
        let result = type_name
            .replace("character varying", "varchar")
            .replace("CHARACTER VARYING", "VARCHAR")
            .replace("character", "char")
            .replace("CHARACTER", "CHAR")
            .replace("integer", "int")
            .replace("INTEGER", "INT")
            .replace("boolean", "bool")
            .replace("BOOLEAN", "BOOL")
            .replace("double precision", "float8")
            .replace("DOUBLE PRECISION", "FLOAT8")
            .replace("real", "float4")
            .replace("REAL", "FLOAT4")
            .replace("time without time zone", "time")
            .replace("TIME WITHOUT TIME ZONE", "TIME")
            .replace("time with time zone", "timetz")
            .replace("TIME WITH TIME ZONE", "TIMETZ")
            .replace("timestamp without time zone", "timestamp")
            .replace("TIMESTAMP WITHOUT TIME ZONE", "TIMESTAMP")
            .replace("timestamp with time zone", "timestamptz")
            .replace("TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ");
        
        result
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
    
    pub async fn get_object_definition(&self, schema: &str, object_name: &str, object_type: &str) -> Result<String> {
        let definition = match object_type.to_lowercase().as_str() {
            "table" => {
                // Get table definition
                self.get_table_definition(schema, object_name).await?
            },
            "view" => {
                // Get view definition
                self.get_view_definition(schema, object_name).await?
            },
            "materialized_view" | "materializedview" => {
                // Get materialized view definition
                self.get_materialized_view_definition(schema, object_name).await?
            },
            "function" => {
                // Get function definition
                self.get_function_definition(schema, object_name).await?
            },
            "procedure" => {
                // Get procedure definition
                self.get_procedure_definition(schema, object_name).await?
            },
            _ => {
                return Err(AppError::Unsupported(format!("Unsupported object type: {}", object_type)));
            }
        };
        
        Ok(definition)
    }
    
    async fn get_table_definition(&self, schema: &str, table_name: &str) -> Result<String> {
        // Get table columns using pg_catalog for accurate type names
        let columns_sql = r#"
            SELECT 
                a.attname as column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
                NOT a.attnotnull as is_nullable,
                pg_get_expr(d.adbin, d.adrelid) as column_default,
                t.typname as base_type_name,
                CASE 
                    WHEN t.typtype = 'd' THEN 'domain'
                    WHEN t.typtype = 'e' THEN 'enum'
                    WHEN t.typtype = 'c' THEN 'composite'
                    ELSE NULL
                END as type_category
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
        "#;
        
        let columns = self.client.query(columns_sql, &[&schema, &table_name]).await?;
        
        let mut definition = format!("CREATE TABLE \"{}\".\"{}\" (\n", schema, table_name);
        
        for (i, row) in columns.iter().enumerate() {
            let col_name: String = row.get(0);
            let data_type: String = row.get(1);
            let is_nullable: bool = row.get(2);
            let column_default: Option<String> = row.get(3);
            let _base_type_name: String = row.get(4);
            let type_category: Option<String> = row.get(5);
            
            definition.push_str(&format!("    \"{}\" ", col_name));
            
            // Convert to shorthand and uppercase
            let formatted_type = Self::format_type_shorthand(&data_type);
            definition.push_str(&formatted_type.to_uppercase());
            
            // Add NOT NULL
            if !is_nullable {
                definition.push_str(" NOT NULL");
            }
            
            // Add default
            if let Some(default) = column_default {
                definition.push_str(&format!(" DEFAULT {}", default));
            }
            
            if i < columns.len() - 1 {
                definition.push_str(",\n");
            }
            
            // If this is a custom type (enum, domain, composite), we'll add its definition later
            if type_category.is_some() {
                // TODO: Add custom type definitions as comments or separate CREATE TYPE statements
            }
        }
        
        definition.push_str("\n);\n\n");
        
        // Get indexes
        let indexes_sql = "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2";
        let indexes = self.client.query(indexes_sql, &[&schema, &table_name]).await?;
        
        if !indexes.is_empty() {
            definition.push_str("-- Indexes\n");
            for row in indexes.iter() {
                let indexdef: String = row.get(0);
                let quoted_indexdef = quote_index_definition(&indexdef);
                definition.push_str(&format!("{};\n", quoted_indexdef));
            }
            definition.push_str("\n");
        }
        
        // Get constraints
        let constraints_sql = r#"
            SELECT 
                conname,
                pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = ('"' || $1 || '"."' || $2 || '"')::regclass
                AND contype IN ('f', 'c', 'u')
        "#;
        
        let constraints = self.client.query(constraints_sql, &[&schema, &table_name]).await?;
        
        if !constraints.is_empty() {
            definition.push_str("-- Constraints\n");
            for row in constraints.iter() {
                let conname: String = row.get(0);
                let condef: String = row.get(1);
                definition.push_str(&format!("ALTER TABLE \"{}\".\"{}\" ADD CONSTRAINT \"{}\" {};\n", 
                    schema, table_name, conname, condef));
            }
            definition.push_str("\n");
        }
        
        // Get custom type definitions used by this table
        let custom_types_sql = r#"
            SELECT DISTINCT 
                t.typname,
                t.typtype,
                n.nspname as type_schema,
                CASE 
                    WHEN t.typtype = 'e' THEN 
                        (SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
                         FROM pg_enum e 
                         WHERE e.enumtypid = t.oid)
                    WHEN t.typtype = 'd' THEN 
                        pg_catalog.format_type(t.typbasetype, t.typtypmod)
                    ELSE NULL
                END as type_definition
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace cn ON cn.oid = c.relnamespace
            JOIN pg_type t ON t.oid = a.atttypid
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE cn.nspname = $1 
                AND c.relname = $2
                AND a.attnum > 0
                AND NOT a.attisdropped
                AND t.typtype IN ('e', 'd')  -- enum or domain types
                AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        "#;
        
        let custom_types = self.client.query(custom_types_sql, &[&schema, &table_name]).await?;
        
        if !custom_types.is_empty() {
            definition.push_str("-- Custom Types Used\n");
            for row in custom_types.iter() {
                let type_name: String = row.get(0);
                let type_type: i8 = row.get(1);  // PostgreSQL char type maps to i8
                let type_type_char = (type_type as u8) as char;
                let type_schema: String = row.get(2);
                let type_def: Option<String> = row.get(3);
                
                if type_type_char == 'e' {
                    // Enum type
                    if let Some(values) = type_def {
                        definition.push_str(&format!("-- CREATE TYPE \"{}\".\"{}\" AS ENUM ({});\n", 
                            type_schema, type_name, 
                            values.split(", ").map(|v| format!("'{}'", v)).collect::<Vec<_>>().join(", ")));
                    }
                } else if type_type_char == 'd' {
                    // Domain type
                    if let Some(base_type) = type_def {
                        definition.push_str(&format!("-- CREATE DOMAIN \"{}\".\"{}\" AS {};\n", 
                            type_schema, type_name, base_type));
                    }
                }
            }
        }
        
        Ok(definition)
    }
    
    async fn get_view_definition(&self, schema: &str, view_name: &str) -> Result<String> {
        let sql = r#"
            SELECT pg_get_viewdef(c.oid, true)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'v'
        "#;
        
        let rows = self.client.query(sql, &[&schema, &view_name]).await?;
        
        if rows.is_empty() {
            return Err(AppError::NotFound(format!("View {}.{} not found", schema, view_name)));
        }
        
        let viewdef: String = rows[0].get(0);
        Ok(format!("CREATE VIEW \"{}\".\"{}\" AS\n{}", schema, view_name, viewdef))
    }
    
    async fn get_materialized_view_definition(&self, schema: &str, view_name: &str) -> Result<String> {
        let sql = r#"
            SELECT pg_get_viewdef(c.oid, true)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'm'
        "#;
        
        let rows = self.client.query(sql, &[&schema, &view_name]).await?;
        
        if rows.is_empty() {
            return Err(AppError::NotFound(format!("Materialized view {}.{} not found", schema, view_name)));
        }
        
        let viewdef: String = rows[0].get(0);
        let mut definition = format!("CREATE MATERIALIZED VIEW \"{}\".\"{}\" AS\n{}", schema, view_name, viewdef);
        
        // Get indexes on materialized view
        let indexes_sql = "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2";
        let indexes = self.client.query(indexes_sql, &[&schema, &view_name]).await?;
        
        if !indexes.is_empty() {
            definition.push_str("\n\n-- Indexes\n");
            for row in indexes.iter() {
                let indexdef: String = row.get(0);
                let quoted_indexdef = quote_index_definition(&indexdef);
                definition.push_str(&format!("{};\n", quoted_indexdef));
            }
        }
        
        Ok(definition)
    }
    
    async fn get_function_definition(&self, schema: &str, function_name: &str) -> Result<String> {
        // Get function definition including signature
        let sql = r#"
            SELECT 
                pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1 AND p.proname = $2
            LIMIT 1
        "#;
        
        let rows = self.client.query(sql, &[&schema, &function_name]).await?;
        
        if rows.is_empty() {
            return Err(AppError::NotFound(format!("Function {}.{} not found", schema, function_name)));
        }
        
        let funcdef: String = rows[0].get(0);
        Ok(funcdef)
    }
    
    async fn get_procedure_definition(&self, schema: &str, procedure_name: &str) -> Result<String> {
        // PostgreSQL 11+ procedures - same as functions but with different kind
        let sql = r#"
            SELECT 
                pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind = 'p'
            LIMIT 1
        "#;
        
        let rows = self.client.query(sql, &[&schema, &procedure_name]).await?;
        
        if rows.is_empty() {
            // Try as function if procedure not found (for older PostgreSQL versions)
            return self.get_function_definition(schema, procedure_name).await;
        }
        
        let procdef: String = rows[0].get(0);
        Ok(procdef)
    }
}