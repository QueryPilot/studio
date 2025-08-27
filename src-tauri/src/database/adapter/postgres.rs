use async_trait::async_trait;
use serde_json::Value;
use sqlx::{PgPool, Row, Column, TypeInfo, ValueRef};
use sqlx::postgres::{PgRow, PgColumn};
use std::time::{Duration, Instant};
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, NaiveDateTime, NaiveDate, NaiveTime, Utc};
use sqlx::postgres::types::PgRange;
use rust_decimal::Decimal;

use crate::error::AppError;
use crate::database::cell_value::{CellValue, CellValueType, CellMetadata};
use super::{DbAdapter, TableMeta, FunctionMeta, ColumnMeta, QueryCursor, QueryPage, ExecuteResult, QueryOptions, TransactionId, TableReadRequest, TableDataResponse, DbObjectKind};

pub struct PostgresAdapter {
    pool: PgPool,
}

impl PostgresAdapter {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn get_pool(&self) -> &PgPool {
        &self.pool
    }
}

#[async_trait]
impl DbAdapter for PostgresAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn ping(&self) -> Result<Duration, AppError> {
        let start = Instant::now();
        sqlx::query("SELECT 1").fetch_one(&self.pool).await
            .map_err(|e| AppError::Database(format!("PostgreSQL ping failed: {}", e)))?;
        Ok(start.elapsed())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool.close().await;
        Ok(())
    }

    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(format!("Failed to list databases: {}", e)))?;
        
        Ok(rows)
    }

    async fn list_schemas(&self, _database: &str) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT schema_name FROM information_schema.schemata 
             WHERE schema_name NOT IN ('information_schema') 
             AND schema_name NOT LIKE 'pg_%'
             ORDER BY schema_name"
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(format!("Failed to list schemas: {}", e)))?;
        
        Ok(rows)
    }

    async fn list_tables(&self, _database: &str, schema: &str) -> Result<Vec<TableMeta>, AppError> {
        let rows = sqlx::query(
            r#"SELECT 
                t.table_name,
                t.table_type,
                coalesce(s.n_live_tup, 0) as row_estimate,
                coalesce(pg_total_relation_size(c.oid), 0) as size_bytes
            FROM information_schema.tables t
            LEFT JOIN pg_class c ON c.relname = t.table_name 
                AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.table_schema)
            LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema
            WHERE t.table_schema = $1
            ORDER BY t.table_name"#
        )
        .bind(schema)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(format!("Failed to list tables: {}", e)))?;
        
        let mut tables = Vec::new();
        for row in rows {
            let table_name: String = row.get(0);
            let table_type: String = row.get(1);
            let row_estimate: Option<i64> = row.get(2);
            let size_bytes: Option<i64> = row.get(3);
            
            let kind = match table_type.as_str() {
                "BASE TABLE" => DbObjectKind::Table,
                "VIEW" => DbObjectKind::View,
                "MATERIALIZED VIEW" => DbObjectKind::MaterializedView,
                _ => DbObjectKind::Table,
            };
            
            tables.push(TableMeta {
                schema: schema.to_string(),
                name: table_name,
                kind,
                row_estimate,
                size_bytes,
            });
        }
        
        Ok(tables)
    }

    async fn list_functions(&self, _database: &str, schema: &str) -> Result<Vec<FunctionMeta>, AppError> {
        let rows = sqlx::query(
            r#"SELECT 
                p.proname as function_name,
                pg_get_function_result(p.oid) as return_type,
                pg_get_function_arguments(p.oid) as arguments
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = $1
            AND p.prokind = 'f'
            ORDER BY p.proname"#
        )
        .bind(schema)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(format!("Failed to list functions: {}", e)))?;
        
        let mut functions = Vec::new();
        for row in rows {
            let function_name: String = row.get(0);
            let return_type: Option<String> = row.get(1);
            let arguments_str: Option<String> = row.get(2);
            
            // Parse arguments string into vector
            let arguments: Vec<String> = if let Some(args) = arguments_str {
                args.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            } else {
                Vec::new()
            };
            
            functions.push(FunctionMeta {
                schema: schema.to_string(),
                name: function_name,
                return_type: return_type.unwrap_or_else(|| "void".to_string()),
                arguments,
            });
        }
        
        Ok(functions)
    }

    async fn table_columns(&self, _database: &str, schema: &str, table: &str) -> Result<Vec<ColumnMeta>, AppError> {
        let rows = sqlx::query(
            r#"SELECT 
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.column_default,
                c.ordinal_position,
                c.numeric_precision,
                c.numeric_scale,
                c.character_maximum_length,
                c.udt_name,
                coalesce(pk.is_pk, false) as is_pk,
                coalesce(fk.is_fk, false) as is_fk,
                coalesce(t.typname, '') as pg_type_name
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT ku.column_name, true as is_pk
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku 
                    ON tc.constraint_name = ku.constraint_name
                    AND tc.table_schema = ku.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                    AND tc.table_schema = $1 
                    AND tc.table_name = $2
            ) pk ON c.column_name = pk.column_name
            LEFT JOIN (
                SELECT ku.column_name, true as is_fk
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku 
                    ON tc.constraint_name = ku.constraint_name
                    AND tc.table_schema = ku.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                    AND tc.table_schema = $1 
                    AND tc.table_name = $2
            ) fk ON c.column_name = fk.column_name
            LEFT JOIN pg_type t ON c.udt_name = t.typname
            WHERE c.table_schema = $1 AND c.table_name = $2
            ORDER BY c.ordinal_position"#
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(format!("Failed to get table columns: {}", e)))?;
        
        let mut columns = Vec::new();
        for row in rows {
            let column_name: String = row.get(0);
            let data_type: String = row.get(1);
            let is_nullable: String = row.get(2);
            let column_default: Option<String> = row.get(3);
            let ordinal_position: i32 = row.get(4);
            let numeric_precision: Option<i32> = row.get(5);
            let numeric_scale: Option<i32> = row.get(6);
            let _character_maximum_length: Option<i32> = row.get(7);
            let udt_name: String = row.get(8);
            let is_pk: bool = row.get(9);
            let is_fk: bool = row.get(10);
            let pg_type_name: String = row.get(11);
            
            columns.push(ColumnMeta {
                name: column_name,
                db_type: data_type,
                nullable: is_nullable.as_str() == "YES",
                default: column_default,
                is_pk,
                is_fk,
                ordinal: ordinal_position,
                precision: numeric_precision,
                scale: numeric_scale,
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: Some(pg_type_name.starts_with("geo")),
                is_json: Some(["json", "jsonb"].contains(&udt_name.as_str())),
                enum_values: None, // TODO: Get actual enum values for enum types
                set_values: None,
                is_virtual: None,
            });
        }
        
        Ok(columns)
    }

    async fn table_triggers(&self, _database: &str, schema: &str, table: &str) -> Result<Vec<super::TriggerMeta>, AppError> {
        let rows = sqlx::query(
            r#"SELECT 
                t.trigger_name,
                t.event_manipulation,
                t.action_timing,
                CASE WHEN t.action_orientation IS NULL THEN 'STATEMENT' ELSE t.action_orientation END as action_orientation,
                CASE WHEN pg_t.tgenabled = 'O' THEN true ELSE false END as enabled,
                t.action_statement,
                t.action_condition,
                NULL::text as created
            FROM information_schema.triggers t
            LEFT JOIN pg_trigger pg_t ON pg_t.tgname = t.trigger_name
            LEFT JOIN pg_class pc ON pc.oid = pg_t.tgrelid AND pc.relname = t.event_object_table
            LEFT JOIN pg_namespace n ON n.oid = pc.relnamespace AND n.nspname = t.event_object_schema
            WHERE t.event_object_schema = $1 
                AND t.event_object_table = $2
            ORDER BY t.trigger_name"#
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(format!("Failed to get table triggers: {}", e)))?;
        
        let mut triggers = Vec::new();
        for row in rows {
            let trigger_name: String = row.get(0);
            let event: String = row.get(1);
            let timing: String = row.get(2);
            let level: String = row.get(3);
            let enabled: bool = row.get(4);
            let function: String = row.get(5);
            let condition: Option<String> = row.get(6);
            let created: Option<String> = row.get(7);
            
            triggers.push(super::TriggerMeta {
                name: trigger_name,
                event,
                timing,
                level,
                enabled,
                function,
                condition,
                created,
            });
        }
        
        Ok(triggers)
    }

    async fn estimate_count(&self, _database: &str, schema: &str, table: &str) -> Result<i64, AppError> {
        // Try to get estimate from pg_stat_user_tables first (fast)
        if let Ok(count) = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT n_tup_ins + n_tup_upd + n_tup_del FROM pg_stat_user_tables WHERE schemaname = $1 AND relname = $2"
        )
        .bind(schema)
        .bind(table)
        .fetch_optional(&self.pool)
        .await {
            if let Some(Some(estimate)) = count {
                if estimate > 0 {
                    return Ok(estimate);
                }
            }
        }
        
        // Fall back to reltuples estimate from pg_class
        let estimate = sqlx::query_scalar::<_, Option<f32>>(
            r#"SELECT c.reltuples 
               FROM pg_class c 
               JOIN pg_namespace n ON c.relnamespace = n.oid 
               WHERE n.nspname = $1 AND c.relname = $2"#
        )
        .bind(schema)
        .bind(table)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AppError::Database(format!("Failed to estimate count: {}", e)))?;
        
        Ok(estimate.flatten().unwrap_or(0.0).round() as i64)
    }

    async fn begin_query(&self, sql: &str, params: Option<Vec<Value>>, opts: QueryOptions) -> Result<QueryCursor, AppError> {
        let cursor_id = Uuid::new_v4().to_string();
        
        // Build query with parameters
        let mut query = sqlx::query(sql);
        if let Some(param_values) = params {
            for param in param_values {
                query = self.bind_parameter(query, param)?;
            }
        }
        
        // Execute query and fetch first page
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Query execution failed: {}", e)))?;
        
        if rows.is_empty() {
            return Ok(QueryCursor {
                id: cursor_id,
                sql: sql.to_string(),
                columns: Vec::new(),
                rows: Vec::new(),
                page_size: opts.page_size,
                current_page: 0,
                total_rows: Some(0),
                is_complete: true,
                created_at: Some(Instant::now()),
            });
        }
        
        // Extract column metadata from first row
        let first_row = &rows[0];
        let mut columns = Vec::new();
        for (i, column) in first_row.columns().iter().enumerate() {
            columns.push(self.extract_column_metadata(column, i as i32));
        }
        
        // Convert all rows to CellValues
        let mut cell_rows = Vec::new();
        for row in &rows {
            let mut cell_row = Vec::new();
            for (i, column) in row.columns().iter().enumerate() {
                cell_row.push(self.convert_pg_value_to_cell(row, column, i)?);
            }
            cell_rows.push(cell_row);
        }
        
        // Determine pagination
        let total_rows = cell_rows.len();
        let page_size = opts.page_size.min(1000); // Cap page size
        let first_page_rows = if total_rows <= page_size {
            cell_rows
        } else {
            cell_rows.into_iter().take(page_size).collect()
        };
        
        Ok(QueryCursor {
            id: cursor_id,
            sql: sql.to_string(),
            columns,
            rows: first_page_rows,
            page_size,
            current_page: 0,
            total_rows: Some(total_rows),
            is_complete: total_rows <= page_size,
            created_at: Some(Instant::now()),
        })
    }

    async fn fetch_page(&self, cursor: &mut QueryCursor, page: usize, page_size: usize) -> Result<QueryPage, AppError> {
        // For simplicity, re-execute query with OFFSET/LIMIT
        // In production, you might want to use PostgreSQL cursors for very large results
        let offset = page * page_size;
        let sql_with_pagination = format!("{} OFFSET {} LIMIT {}", cursor.sql, offset, page_size);
        
        let query = sqlx::query(&sql_with_pagination);
        // Note: This simple implementation doesn't preserve original parameters
        // A more sophisticated implementation would store and reuse them
        
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Page fetch failed: {}", e)))?;
        
        let mut cell_rows = Vec::new();
        for row in &rows {
            let mut cell_row = Vec::new();
            for (i, column) in row.columns().iter().enumerate() {
                cell_row.push(self.convert_pg_value_to_cell(row, column, i)?);
            }
            cell_rows.push(cell_row);
        }
        
        cursor.current_page = page;
        let is_complete = cell_rows.len() < page_size;
        
        Ok(QueryPage {
            rows: cell_rows,
            page,
            is_complete,
        })
    }

    async fn close_cursor(&self, _cursor_id: &str) -> Result<(), AppError> {
        // In this implementation, we don't maintain server-side cursors
        // so there's nothing to clean up
        Ok(())
    }

    async fn execute(&self, sql: &str, params: Option<Vec<Value>>) -> Result<ExecuteResult, AppError> {
        let start = Instant::now();
        
        let mut query = sqlx::query(sql);
        if let Some(param_values) = params {
            for param in param_values {
                query = self.bind_parameter(query, param)?;
            }
        }
        
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Execute failed: {}", e)))?;
        
        let execution_time = start.elapsed().as_secs_f64() * 1000.0;
        
        Ok(ExecuteResult {
            rows_affected: result.rows_affected(),
            last_insert_id: None, // PostgreSQL doesn't have AUTO_INCREMENT like MySQL
            execution_time_ms: execution_time,
        })
    }

    async fn begin_transaction(&self) -> Result<TransactionId, AppError> {
        let tx_id = Uuid::new_v4().to_string();
        sqlx::query("BEGIN")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Begin transaction failed: {}", e)))?;
        
        Ok(tx_id)
    }

    async fn commit(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        sqlx::query("COMMIT")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Commit transaction failed: {}", e)))?;
        
        Ok(())
    }

    async fn rollback(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        sqlx::query("ROLLBACK")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Rollback transaction failed: {}", e)))?;
        
        Ok(())
    }

    async fn server_version(&self) -> Result<String, AppError> {
        let version = sqlx::query_scalar::<_, String>("SELECT version()")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to get server version: {}", e)))?;
        
        Ok(version)
    }

    async fn read_table_data(&self, request: TableReadRequest) -> Result<(TableDataResponse, Option<String>), AppError> {
        // This is a complex method - for now, return a basic implementation
        // A full implementation would handle all filtering, sorting, and pagination
        let schema_prefix = if let Some(schema) = &request.schema {
            format!("{}.", schema)
        } else {
            String::new()
        };
        
        let select_clause = if let Some(cols) = &request.select {
            cols.join(", ")
        } else {
            "*".to_string()
        };
        
        let sql = format!("SELECT {} FROM {}{}", select_clause, schema_prefix, request.table);
        
        // For now, just execute the basic query
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Table data read failed: {}", e)))?;
        
        if rows.is_empty() {
            return Ok((TableDataResponse::Done, None));
        }
        
        // Convert to hash map format expected by TableDataResponse
        let mut result_rows = Vec::new();
        for row in &rows {
            let mut row_map = HashMap::new();
            for (i, column) in row.columns().iter().enumerate() {
                let cell_value = self.convert_pg_value_to_cell(row, column, i)?;
                row_map.insert(column.name().to_string(), cell_value);
            }
            result_rows.push(row_map);
        }
        
        Ok((TableDataResponse::Rows {
            rows: result_rows,
            next_cursor: None,
        }, None))
    }

    async fn execute_raw_query(
        &self,
        database: &str,
        query: &str,
        limit: u32,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        // For PostgreSQL, we'll use the database as the schema name
        // since PostgreSQL connections are per-database
        let query_with_schema = if !database.is_empty() && database != "public" {
            format!("SET search_path TO {}; {}", database, query)
        } else {
            query.to_string()
        };

        // Add LIMIT if not already present (only for SELECT statements)
        let limited_query = if query.trim().to_uppercase().starts_with("SELECT") 
            && !query.to_uppercase().contains("LIMIT") {
            format!("{} LIMIT {}", query_with_schema, limit)
        } else {
            query_with_schema
        };

        let rows = sqlx::query(&limited_query)
            .fetch_all(&self.pool)
            .await?;

        let mut columns = Vec::new();
        let mut result_rows = Vec::new();

        if !rows.is_empty() {
            // Get column names from the first row
            let first_row = &rows[0];
            for column in first_row.columns() {
                columns.push(column.name().to_string());
            }

            // Extract data from all rows
            for row in rows {
                let mut row_data = Vec::new();
                for i in 0..columns.len() {
                    // Try to get value as different types
                    let value = if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                        serde_json::Value::from(v)
                    } else if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
                        serde_json::Value::from(v)
                    } else if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
                        serde_json::Value::from(v)
                    } else if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
                        serde_json::Value::from(v)
                    } else if let Ok(v) = row.try_get::<Option<serde_json::Value>, _>(i) {
                        v.unwrap_or(serde_json::Value::Null)
                    } else {
                        serde_json::Value::Null
                    };
                    row_data.push(value);
                }
                result_rows.push(row_data);
            }
        }

        Ok(serde_json::json!({
            "columns": columns,
            "rows": result_rows
        }))
    }
}

#[cfg(test)]
#[path = "postgres_test.rs"]
mod tests;

impl PostgresAdapter {
    /// Helper method to bind parameters to sqlx query
    fn bind_parameter<'a>(&self, mut query: sqlx::query::Query<'a, sqlx::Postgres, sqlx::postgres::PgArguments>, param: Value) -> Result<sqlx::query::Query<'a, sqlx::Postgres, sqlx::postgres::PgArguments>, AppError> {
        match param {
            Value::Null => query = query.bind(Option::<String>::None),
            Value::Bool(b) => query = query.bind(b),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    query = query.bind(i);
                } else if let Some(f) = n.as_f64() {
                    query = query.bind(f);
                } else {
                    return Err(AppError::Database("Invalid number parameter".to_string()));
                }
            }
            Value::String(s) => query = query.bind(s),
            Value::Array(_) => {
                // For arrays, convert to JSON string as a simple approach
                query = query.bind(param.to_string());
            }
            Value::Object(_) => {
                // For objects, convert to JSON string
                query = query.bind(param.to_string());
            }
        }
        Ok(query)
    }
    
    /// Extract column metadata from PostgreSQL column info
    fn extract_column_metadata(&self, column: &PgColumn, ordinal: i32) -> ColumnMeta {
        let type_info = column.type_info();
        let type_name = type_info.name();
        
        ColumnMeta {
            name: column.name().to_string(),
            db_type: type_name.to_string(),
            nullable: true, // We don't have this info from the column directly
            default: None,
            is_pk: false,
            is_fk: false,
            ordinal,
            precision: None,
            scale: None,
            is_identity: None,
            is_computed: None,
            is_hierarchyid: None,
            is_spatial: Some(self.is_spatial_type(type_name)),
            is_json: Some(["JSON", "JSONB"].contains(&type_name)),
            enum_values: None,
            set_values: None,
            is_virtual: None,
        }
    }
    
    /// Check if a PostgreSQL type is spatial
    fn is_spatial_type(&self, type_name: &str) -> bool {
        matches!(type_name.to_uppercase().as_str(), 
            "POINT" | "LINE" | "LSEG" | "BOX" | "PATH" | "POLYGON" | "CIRCLE" |
            "GEOMETRY" | "GEOGRAPHY" | "GEOMCOLLECTION" | "LINESTRING" |
            "MULTILINESTRING" | "MULTIPOINT" | "MULTIPOLYGON"
        )
    }
    
    /// Convert PostgreSQL value to CellValue with proper type mapping
    fn convert_pg_value_to_cell(&self, row: &PgRow, column: &PgColumn, column_index: usize) -> Result<CellValue, AppError> {
        let type_info = column.type_info();
        let type_name = type_info.name();
        let is_null = row.try_get_raw(column_index)
            .map_err(|e| AppError::Database(format!("Failed to check null: {}", e)))?
            .is_null();
        
        if is_null {
            return Ok(CellValue::null(type_name));
        }
        
        // Handle each PostgreSQL type appropriately
        match type_name {
            // Integer types
            "INT2" | "SMALLINT" => {
                let value: i16 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get i16: {}", e)))?;
                Ok(CellValue::integer(value as i64, type_name))
            }
            "INT4" | "INTEGER" | "SERIAL" => {
                let value: i32 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get i32: {}", e)))?;
                Ok(CellValue::integer(value as i64, type_name))
            }
            "INT8" | "BIGINT" | "BIGSERIAL" => {
                let value: i64 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get i64: {}", e)))?;
                Ok(CellValue::integer(value, type_name))
            }
            
            // Floating point types
            "REAL" | "FLOAT4" => {
                let value: f32 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get f32: {}", e)))?;
                Ok(CellValue::decimal(value as f64, type_name, Some(7), Some(6)))
            }
            "DOUBLE PRECISION" | "FLOAT8" => {
                let value: f64 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get f64: {}", e)))?;
                Ok(CellValue::decimal(value, type_name, Some(15), Some(14)))
            }
            
            // Decimal/Numeric types with precision
            "NUMERIC" | "DECIMAL" => {
                if let Ok(decimal_val) = row.try_get::<Decimal, _>(column_index) {
                    let metadata = CellMetadata {
                        precision: Some(28), // Rust decimal default precision
                        scale: Some(decimal_val.scale()),
                        max_length: None,
                        charset: None,
                        timezone: None,
                        element_type: None,
                        srid: None,
                        enum_values: None,
                        attributes: None,
                    };
                    
                    let value = decimal_val.to_string().parse::<f64>()
                        .unwrap_or(0.0);
                    
                    Ok(CellValue {
                        value: serde_json::Number::from_f64(value).map(serde_json::Value::Number),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Decimal,
                        metadata: Some(metadata),
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    // Fallback to string representation
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get numeric as string: {}", e)))?;
                    Ok(CellValue::text(value, type_name))
                }
            }
            
            // Boolean type
            "BOOL" | "BOOLEAN" => {
                let value: bool = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get bool: {}", e)))?;
                Ok(CellValue::boolean(value, type_name))
            }
            
            // String types
            "VARCHAR" | "CHAR" | "TEXT" | "NAME" | "BPCHAR" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get string: {}", e)))?;
                Ok(CellValue::text(value, type_name))
            }
            
            // Date and time types
            "DATE" => {
                if let Ok(date_val) = row.try_get::<NaiveDate, _>(column_index) {
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(date_val.to_string())),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Date,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    // Fallback to string
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get date: {}", e)))?;
                    Ok(CellValue::text(value, type_name))
                }
            }
            "TIME" | "TIMETZ" => {
                if let Ok(time_val) = row.try_get::<NaiveTime, _>(column_index) {
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(time_val.to_string())),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Time,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get time: {}", e)))?;
                    Ok(CellValue::text(value, type_name))
                }
            }
            "TIMESTAMP" | "TIMESTAMPTZ" => {
                if let Ok(ts_val) = row.try_get::<NaiveDateTime, _>(column_index) {
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(ts_val.to_string())),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::DateTime,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                } else if let Ok(ts_tz_val) = row.try_get::<DateTime<Utc>, _>(column_index) {
                    let metadata = CellMetadata {
                        precision: None,
                        scale: None,
                        max_length: None,
                        charset: None,
                        timezone: Some("UTC".to_string()),
                        element_type: None,
                        srid: None,
                        enum_values: None,
                        attributes: None,
                    };
                    
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(ts_tz_val.to_rfc3339())),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::DateTime,
                        metadata: Some(metadata),
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get timestamp: {}", e)))?;
                    Ok(CellValue::text(value, type_name))
                }
            }
            
            // UUID type
            "UUID" => {
                if let Ok(uuid_val) = row.try_get::<Uuid, _>(column_index) {
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(uuid_val.to_string())),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Uuid,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get UUID: {}", e)))?;
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(value)),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Uuid,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                }
            }
            
            // JSON types
            "JSON" | "JSONB" => {
                // Try to get as serde_json::Value first
                if let Ok(json_val) = row.try_get::<serde_json::Value, _>(column_index) {
                    Ok(CellValue::json(json_val, type_name))
                } else {
                    // Fallback to string and try to parse
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get JSON: {}", e)))?;
                    
                    match serde_json::from_str::<serde_json::Value>(&value) {
                        Ok(parsed_json) => Ok(CellValue::json(parsed_json, type_name)),
                        Err(_) => Ok(CellValue::text(value, type_name)) // Invalid JSON, treat as text
                    }
                }
            }
            
            // Binary data types
            "BYTEA" => {
                let value: Vec<u8> = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get bytea: {}", e)))?;
                
                let hex_string = hex::encode(&value);
                Ok(CellValue {
                    value: Some(serde_json::Value::String(hex_string)),
                    db_type: type_name.to_string(),
                    value_type: CellValueType::Binary,
                    metadata: None,
                    is_truncated: false,
                    byte_size: Some(value.len()),
                })
            }
            
            // Network address types
            "INET" | "CIDR" => {
                use std::net::IpAddr;
                
                // Try to get as IpAddr first (for INET type)
                if let Ok(ip_addr) = row.try_get::<IpAddr, _>(column_index) {
                    Ok(CellValue::text(ip_addr.to_string(), type_name))
                } else if let Ok(value) = row.try_get::<String, _>(column_index) {
                    // Most commonly this works - PostgreSQL can cast INET/CIDR to text
                    Ok(CellValue::text(value, type_name))
                } else {
                    // Last resort: check if NULL
                    let value_ref = row.try_get_raw(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get raw {}: {}", type_name, e)))?;
                    
                    if value_ref.is_null() {
                        return Ok(CellValue::null(type_name));
                    }
                    
                    // For INET/CIDR that can't be converted, return a placeholder
                    Ok(CellValue::text(format!("<{} data>", type_name), type_name))
                }
            }

            // Range types
            "TSTZRANGE" => {
                // Handle TSTZRANGE with proper PgRange type
                if let Ok(range) = row.try_get::<PgRange<DateTime<Utc>>, _>(column_index) {
                    use std::ops::Bound;
                    
                    // PgRange has start and end fields, not enum variants
                    let start_str = match &range.start {
                        Bound::Included(dt) => dt.format("%Y-%m-%d %H:%M:%S %Z").to_string(),
                        Bound::Excluded(dt) => format!("({}", dt.format("%Y-%m-%d %H:%M:%S %Z")),
                        Bound::Unbounded => "-∞".to_string(),
                    };
                    let end_str = match &range.end {
                        Bound::Included(dt) => dt.format("%Y-%m-%d %H:%M:%S %Z").to_string(),
                        Bound::Excluded(dt) => format!("{})", dt.format("%Y-%m-%d %H:%M:%S %Z")),
                        Bound::Unbounded => "+∞".to_string(),
                    };
                    let range_str = format!("{} → {}", start_str, end_str);
                    
                    Ok(CellValue::text(range_str, type_name))
                } else {
                    // Fallback if PgRange doesn't work
                    let value_ref = row.try_get_raw(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get raw TSTZRANGE: {}", e)))?;
                    
                    if value_ref.is_null() {
                        return Ok(CellValue::null(type_name));
                    }
                    
                    Ok(CellValue::text("<TSTZRANGE - unable to parse>".to_string(), type_name))
                }
            }
            
            "TSRANGE" => {
                // Handle TSRANGE with PgRange<NaiveDateTime>
                if let Ok(range) = row.try_get::<PgRange<NaiveDateTime>, _>(column_index) {
                    use std::ops::Bound;
                    
                    // PgRange has start and end fields
                    let start_str = match &range.start {
                        Bound::Included(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
                        Bound::Excluded(dt) => format!("({}", dt.format("%Y-%m-%d %H:%M:%S")),
                        Bound::Unbounded => "-∞".to_string(),
                    };
                    let end_str = match &range.end {
                        Bound::Included(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
                        Bound::Excluded(dt) => format!("{})", dt.format("%Y-%m-%d %H:%M:%S")),
                        Bound::Unbounded => "+∞".to_string(),
                    };
                    let range_str = format!("{} → {}", start_str, end_str);
                    Ok(CellValue::text(range_str, type_name))
                } else {
                    let value_ref = row.try_get_raw(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get raw TSRANGE: {}", e)))?;
                    
                    if value_ref.is_null() {
                        return Ok(CellValue::null(type_name));
                    }
                    
                    Ok(CellValue::text("<TSRANGE - unable to parse>".to_string(), type_name))
                }
            }
            
            "DATERANGE" => {
                // Handle DATERANGE with PgRange<NaiveDate>
                if let Ok(range) = row.try_get::<PgRange<NaiveDate>, _>(column_index) {
                    use std::ops::Bound;
                    
                    // PgRange has start and end fields
                    let start_str = match &range.start {
                        Bound::Included(d) => d.format("%Y-%m-%d").to_string(),
                        Bound::Excluded(d) => format!("({}", d.format("%Y-%m-%d")),
                        Bound::Unbounded => "-∞".to_string(),
                    };
                    let end_str = match &range.end {
                        Bound::Included(d) => d.format("%Y-%m-%d").to_string(),
                        Bound::Excluded(d) => format!("{})", d.format("%Y-%m-%d")),
                        Bound::Unbounded => "+∞".to_string(),
                    };
                    let range_str = format!("{} → {}", start_str, end_str);
                    Ok(CellValue::text(range_str, type_name))
                } else {
                    let value_ref = row.try_get_raw(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get raw DATERANGE: {}", e)))?;
                    
                    if value_ref.is_null() {
                        return Ok(CellValue::null(type_name));
                    }
                    
                    Ok(CellValue::text("<DATERANGE - unable to parse>".to_string(), type_name))
                }
            }
            
            "INT4RANGE" | "INT8RANGE" | "NUMRANGE" => {
                // For numeric ranges, try string conversion first
                // First check if NULL
                let value_ref = row.try_get_raw(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get raw {}: {}", type_name, e)))?;
                
                if value_ref.is_null() {
                    return Ok(CellValue::null(type_name));
                }
                
                // Try to decode the raw bytes as UTF-8 string
                // PostgreSQL might return the text representation in raw bytes
                let value_string = if let Ok(value) = row.try_get::<String, _>(column_index) {
                    value
                } else {
                    // Try to get raw bytes and decode as UTF-8
                    match value_ref.as_bytes() {
                        Ok(bytes) => {
                            match std::str::from_utf8(bytes) {
                                Ok(s) => s.to_string(),
                                Err(_) => {
                                    // If we can't decode, return informative message
                                    return Ok(CellValue::text(
                                        format!("<{} - cast to ::text in query for proper display>", type_name), 
                                        type_name
                                    ));
                                }
                            }
                        },
                        Err(_) => {
                            return Ok(CellValue::text(
                                format!("<{} - cast to ::text in query for proper display>", type_name), 
                                type_name
                            ));
                        }
                    }
                };
                
                // Now parse the range format with the extracted string
                {
                    let value = value_string;
                    // Parse the range format and convert to a more readable format
                    let formatted_value = if value == "empty" {
                        "empty".to_string()
                    } else if value.starts_with('[') || value.starts_with('(') {
                        // Parse PostgreSQL range format: [start,end) or (start,end] etc.
                        let mut chars = value.chars();
                        let start_bracket = chars.next().unwrap_or('[');
                        let content = chars.as_str();
                        
                        if let Some(comma_pos) = content.find(',') {
                            let start = &content[..comma_pos];
                            let end_part = &content[comma_pos + 1..];
                            let end = end_part.trim_end_matches(')').trim_end_matches(']');
                            
                            // Format based on type
                            match type_name {
                                "TSTZRANGE" | "TSRANGE" => {
                                    // For timestamp ranges, format as "start → end"
                                    if start.is_empty() || start == "\"\"" {
                                        if end.is_empty() || end == "\"\"" {
                                            "unbounded".to_string()
                                        } else {
                                            format!("... → {}", end.trim_matches('"'))
                                        }
                                    } else if end.is_empty() || end == "\"\"" {
                                        format!("{} → ...", start.trim_matches('"'))
                                    } else {
                                        format!("{} → {}", start.trim_matches('"'), end.trim_matches('"'))
                                    }
                                },
                                "DATERANGE" => {
                                    // For date ranges, format similarly
                                    if start.is_empty() {
                                        if end.is_empty() {
                                            "unbounded".to_string()
                                        } else {
                                            format!("... → {}", end)
                                        }
                                    } else if end.is_empty() {
                                        format!("{} → ...", start)
                                    } else {
                                        format!("{} → {}", start, end)
                                    }
                                },
                                _ => {
                                    // For numeric ranges, keep bracket notation but simplify
                                    format!("{}{},{}{}", 
                                        start_bracket,
                                        if start.is_empty() { "∞" } else { start },
                                        if end.is_empty() { "∞" } else { end },
                                        content.chars().last().unwrap_or(')')
                                    )
                                }
                            }
                        } else {
                            value // If we can't parse, return original
                        }
                    } else {
                        value // Return original if not in expected format
                    };
                    
                    Ok(CellValue::text(formatted_value, type_name))
                }
            }
            
            // MAC address type
            "MACADDR" | "MACADDR8" => {
                // Check if NULL first
                let value_ref = row.try_get_raw(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get raw MAC address: {}", e)))?;
                
                if value_ref.is_null() {
                    return Ok(CellValue::null(type_name));
                }
                
                // Try to decode as string, if that fails use raw bytes
                if let Ok(value) = row.try_get::<String, _>(column_index) {
                    Ok(CellValue::text(value, type_name))
                } else {
                    // Get raw bytes and convert to UTF-8
                    let bytes = value_ref.as_bytes()
                        .map_err(|e| AppError::Database(format!("Failed to get bytes for {}: {}", type_name, e)))?;
                    
                    let value_str = std::str::from_utf8(bytes)
                        .map_err(|e| AppError::Database(format!("Failed to decode {} as UTF-8: {}", type_name, e)))?
                        .to_string();
                    
                    Ok(CellValue::text(value_str, type_name))
                }
            }
            
            // Bit types
            "BIT" | "VARBIT" => {
                // Check if NULL first
                let value_ref = row.try_get_raw(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get raw bit string: {}", e)))?;
                
                if value_ref.is_null() {
                    return Ok(CellValue::null(type_name));
                }
                
                // Try to decode as string, if that fails use raw bytes
                if let Ok(value) = row.try_get::<String, _>(column_index) {
                    Ok(CellValue::text(value, type_name))
                } else {
                    // Get raw bytes and convert to UTF-8
                    let bytes = value_ref.as_bytes()
                        .map_err(|e| AppError::Database(format!("Failed to get bytes for {}: {}", type_name, e)))?;
                    
                    let value_str = std::str::from_utf8(bytes)
                        .map_err(|e| AppError::Database(format!("Failed to decode {} as UTF-8: {}", type_name, e)))?
                        .to_string();
                    
                    Ok(CellValue::text(value_str, type_name))
                }
            }
            
            // Geometric types
            "POINT" | "LINE" | "LSEG" | "BOX" | "PATH" | "POLYGON" | "CIRCLE" => {
                // Check if NULL first
                let value_ref = row.try_get_raw(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get raw geometry: {}", e)))?;
                
                if value_ref.is_null() {
                    return Ok(CellValue::null(type_name));
                }
                
                // Try to decode as string, if that fails use raw bytes
                let value = if let Ok(val) = row.try_get::<String, _>(column_index) {
                    val
                } else {
                    // Get raw bytes and convert to UTF-8
                    let bytes = value_ref.as_bytes()
                        .map_err(|e| AppError::Database(format!("Failed to get bytes for {}: {}", type_name, e)))?;
                    
                    std::str::from_utf8(bytes)
                        .map_err(|e| AppError::Database(format!("Failed to decode {} as UTF-8: {}", type_name, e)))?
                        .to_string()
                };
                
                Ok(CellValue {
                    value: Some(serde_json::Value::String(value)),
                    db_type: type_name.to_string(),
                    value_type: CellValueType::Geometry,
                    metadata: None,
                    is_truncated: false,
                    byte_size: None,
                })
            }
            
            // XML type
            "XML" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get XML: {}", e)))?;
                
                Ok(CellValue {
                    value: Some(serde_json::Value::String(value)),
                    db_type: type_name.to_string(),
                    value_type: CellValueType::Xml,
                    metadata: None,
                    is_truncated: false,
                    byte_size: None,
                })
            }
            
            // Array types (PostgreSQL arrays)
            type_name if type_name.starts_with('_') || type_name.ends_with("[]") => {
                // PostgreSQL array types start with underscore or end with []
                let element_type = if type_name.starts_with('_') {
                    &type_name[1..] // Remove the underscore
                } else {
                    &type_name[..type_name.len()-2] // Remove the []
                };
                
                // Handle different array types
                match element_type.to_uppercase().as_str() {
                    "INT4" | "INTEGER" => {
                        if let Ok(array) = row.try_get::<Vec<i32>, _>(column_index) {
                            Ok(CellValue {
                                value: Some(serde_json::json!(array)),
                                db_type: type_name.to_string(),
                                value_type: CellValueType::Array,
                                metadata: Some(CellMetadata {
                                    element_type: Some(element_type.to_string()),
                                    ..Default::default()
                                }),
                                is_truncated: false,
                                byte_size: None,
                            })
                        } else if let Ok(value) = row.try_get::<String, _>(column_index) {
                            // Fallback to string representation
                            Ok(CellValue::text(value, type_name))
                        } else {
                            Ok(CellValue::text(format!("<{} array>", element_type), type_name))
                        }
                    },
                    "INT8" | "BIGINT" => {
                        if let Ok(array) = row.try_get::<Vec<i64>, _>(column_index) {
                            Ok(CellValue {
                                value: Some(serde_json::json!(array)),
                                db_type: type_name.to_string(),
                                value_type: CellValueType::Array,
                                metadata: Some(CellMetadata {
                                    element_type: Some(element_type.to_string()),
                                    ..Default::default()
                                }),
                                is_truncated: false,
                                byte_size: None,
                            })
                        } else if let Ok(value) = row.try_get::<String, _>(column_index) {
                            Ok(CellValue::text(value, type_name))
                        } else {
                            Ok(CellValue::text(format!("<{} array>", element_type), type_name))
                        }
                    },
                    "TEXT" | "VARCHAR" => {
                        if let Ok(array) = row.try_get::<Vec<String>, _>(column_index) {
                            Ok(CellValue {
                                value: Some(serde_json::json!(array)),
                                db_type: type_name.to_string(),
                                value_type: CellValueType::Array,
                                metadata: Some(CellMetadata {
                                    element_type: Some(element_type.to_string()),
                                    ..Default::default()
                                }),
                                is_truncated: false,
                                byte_size: None,
                            })
                        } else if let Ok(value) = row.try_get::<String, _>(column_index) {
                            Ok(CellValue::text(value, type_name))
                        } else {
                            Ok(CellValue::text(format!("<{} array>", element_type), type_name))
                        }
                    },
                    "FLOAT4" | "REAL" => {
                        if let Ok(array) = row.try_get::<Vec<f32>, _>(column_index) {
                            Ok(CellValue {
                                value: Some(serde_json::json!(array)),
                                db_type: type_name.to_string(),
                                value_type: CellValueType::Array,
                                metadata: Some(CellMetadata {
                                    element_type: Some(element_type.to_string()),
                                    ..Default::default()
                                }),
                                is_truncated: false,
                                byte_size: None,
                            })
                        } else if let Ok(value) = row.try_get::<String, _>(column_index) {
                            Ok(CellValue::text(value, type_name))
                        } else {
                            Ok(CellValue::text(format!("<{} array>", element_type), type_name))
                        }
                    },
                    "FLOAT8" | "DOUBLE PRECISION" => {
                        if let Ok(array) = row.try_get::<Vec<f64>, _>(column_index) {
                            Ok(CellValue {
                                value: Some(serde_json::json!(array)),
                                db_type: type_name.to_string(),
                                value_type: CellValueType::Array,
                                metadata: Some(CellMetadata {
                                    element_type: Some(element_type.to_string()),
                                    ..Default::default()
                                }),
                                is_truncated: false,
                                byte_size: None,
                            })
                        } else if let Ok(value) = row.try_get::<String, _>(column_index) {
                            Ok(CellValue::text(value, type_name))
                        } else {
                            Ok(CellValue::text(format!("<{} array>", element_type), type_name))
                        }
                    },
                    "BOOL" | "BOOLEAN" => {
                        if let Ok(array) = row.try_get::<Vec<bool>, _>(column_index) {
                            Ok(CellValue {
                                value: Some(serde_json::json!(array)),
                                db_type: type_name.to_string(),
                                value_type: CellValueType::Array,
                                metadata: Some(CellMetadata {
                                    element_type: Some(element_type.to_string()),
                                    ..Default::default()
                                }),
                                is_truncated: false,
                                byte_size: None,
                            })
                        } else if let Ok(value) = row.try_get::<String, _>(column_index) {
                            Ok(CellValue::text(value, type_name))
                        } else {
                            Ok(CellValue::text(format!("<{} array>", element_type), type_name))
                        }
                    },
                    _ => {
                        // Generic fallback for other array types
                        if let Ok(value) = row.try_get::<String, _>(column_index) {
                            // Try to parse PostgreSQL array format into JSON
                            let json_value = if value.starts_with('{') && value.ends_with('}') {
                                let inner = value.trim_matches(&['{', '}']);
                                if inner.is_empty() {
                                    serde_json::json!([])
                                } else {
                                    // Split by comma but handle quoted values
                                    let elements: Vec<_> = inner.split(',').map(|s| s.trim().to_string()).collect();
                                    serde_json::json!(elements)
                                }
                            } else {
                                serde_json::Value::String(value)
                            };
                            
                            Ok(CellValue {
                                value: Some(json_value),
                                db_type: type_name.to_string(),
                                value_type: CellValueType::Array,
                                metadata: Some(CellMetadata {
                                    element_type: Some(element_type.to_string()),
                                    ..Default::default()
                                }),
                                is_truncated: false,
                                byte_size: None,
                            })
                        } else {
                            Ok(CellValue::text(format!("<{} array>", element_type), type_name))
                        }
                    }
                }
            }
            
            // Money type
            "MONEY" => {
                // PostgreSQL MONEY type needs special handling
                // sqlx doesn't directly support MONEY to String conversion
                // We need to use Decimal for proper handling
                
                // First check if NULL
                let value_ref = row.try_get_raw(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get raw money value: {}", e)))?;
                
                if value_ref.is_null() {
                    return Ok(CellValue::null(type_name));
                }
                
                // Try to decode as Decimal (which sqlx supports for MONEY type)
                if let Ok(decimal_val) = row.try_get::<Decimal, _>(column_index) {
                    // Convert Decimal to f64 for our CellValue
                    let value = decimal_val.to_string().parse::<f64>()
                        .unwrap_or(0.0);
                    
                    Ok(CellValue::decimal(value, type_name, Some(19), Some(2)))
                } else {
                    // Fallback: If Decimal doesn't work, return a default representation
                    // This shouldn't happen with properly configured sqlx
                    Ok(CellValue::decimal(0.0, type_name, Some(19), Some(2)))
                }
            }
            
            // Interval type
            "INTERVAL" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get interval: {}", e)))?;
                Ok(CellValue::text(value, type_name))
            }
            
            // Full-text search vector types
            "TSVECTOR" | "TSQUERY" | "tsvector" | "tsquery" => {
                // PostgreSQL text search types
                // SQLx cannot decode these directly to String, they need ::text cast
                // We'll try to get raw bytes first, then fall back to error handling
                let value_ref = row.try_get_raw(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get raw {}: {}", type_name, e)))?;
                
                if value_ref.is_null() {
                    return Ok(CellValue::null(type_name));
                }
                
                // For tsvector/tsquery, we need to inform the user to cast to text in their query
                // since SQLx doesn't support direct decoding of these types
                if let Ok(value) = row.try_get::<String, _>(column_index) {
                    // Check if this is binary format (starts with null bytes or contains them)
                    let cleaned_value = if value.starts_with("\0") || value.contains("\0\0\0") {
                        // This is binary format, extract words from it
                        // Binary format has structure: count(4 bytes) then for each word: length(4 bytes) + text
                        let mut words = Vec::new();
                        let bytes = value.as_bytes();
                        let mut pos = 0;
                        
                        // Skip initial count bytes if present
                        if bytes.len() > 4 && bytes[0..4] == [0, 0, 0, 2] {
                            pos = 4; // Skip count
                            
                            while pos < bytes.len() {
                                // Find the next null-terminated word
                                if let Some(end) = bytes[pos..].iter().position(|&b| b == 0) {
                                    let word_bytes = &bytes[pos..pos + end];
                                    if !word_bytes.is_empty() && word_bytes.iter().all(|&b| b >= 32 || b == 9) {
                                        if let Ok(word) = std::str::from_utf8(word_bytes) {
                                            words.push(word.to_string());
                                        }
                                    }
                                    pos += end + 1;
                                    // Skip additional null bytes
                                    while pos < bytes.len() && bytes[pos] == 0 {
                                        pos += 1;
                                    }
                                } else {
                                    break;
                                }
                            }
                        }
                        
                        if words.is_empty() {
                            // Fallback: extract readable ASCII text
                            let readable: String = value.chars()
                                .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '\'' || *c == '-')
                                .collect();
                            readable.trim().to_string()
                        } else {
                            words.join(", ")
                        }
                    } else if (type_name == "TSVECTOR" || type_name == "tsvector") && value.contains(':') {
                        // Text format: 'word1':1,2 'word2':3
                        let words: Vec<String> = value
                            .split_whitespace()
                            .filter_map(|token| {
                                if let Some(colon_pos) = token.find(':') {
                                    let word = &token[..colon_pos];
                                    Some(word.trim_matches('\'').to_string())
                                } else {
                                    None
                                }
                            })
                            .collect();
                        
                        if words.is_empty() {
                            value
                        } else {
                            words.join(", ")
                        }
                    } else {
                        value
                    };
                    
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(cleaned_value)),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Text,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    // SQLx cannot decode tsvector/tsquery directly
                    // Inform user to use ::text cast in their query
                    Ok(CellValue::text(format!("<{} - use ::text cast>", type_name), type_name))
                }
            }
            
            // HStore type - key-value store
            "HSTORE" | "hstore" => {
                // PostgreSQL hstore type stores key-value pairs
                // SQLx cannot decode hstore directly to String, needs ::text cast
                let value_ref = row.try_get_raw(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get raw hstore: {}", e)))?;
                
                if value_ref.is_null() {
                    return Ok(CellValue::null(type_name));
                }
                
                // Try to get as string (only works if cast to text in query)
                if let Ok(value) = row.try_get::<String, _>(column_index) {
                    // Check if this is binary format (starts with null bytes)
                    let json_value = if value.starts_with("\0") || value.contains("\0\0\0") {
                        // This is binary hstore format
                        // Format: count(4 bytes) then for each pair: key_len(4 bytes) key val_len(4 bytes) val
                        let mut map = serde_json::Map::new();
                        let bytes = value.as_bytes();
                        let mut pos = 0;
                        
                        // Read the count of pairs (first 4 bytes, big-endian)
                        if bytes.len() > 4 {
                            // Skip count bytes
                            pos = 4;
                            
                            while pos < bytes.len() {
                                // Read key length (4 bytes)
                                if pos + 4 > bytes.len() { break; }
                                let key_len_bytes = &bytes[pos..pos + 4];
                                pos += 4;
                                
                                // Parse key length (skip if it's all zeros or invalid)
                                let key_len = if key_len_bytes == [0, 0, 0, 0] {
                                    0
                                } else {
                                    // Try to parse as length
                                    let len = u32::from_be_bytes([key_len_bytes[0], key_len_bytes[1], key_len_bytes[2], key_len_bytes[3]]) as usize;
                                    if len > 1000 { // Sanity check
                                        break;
                                    }
                                    len
                                };
                                
                                if key_len == 0 || pos + key_len > bytes.len() { break; }
                                
                                // Read key
                                let key_bytes = &bytes[pos..pos + key_len];
                                if let Ok(key) = std::str::from_utf8(key_bytes) {
                                    pos += key_len;
                                    
                                    // Read value length (4 bytes)
                                    if pos + 4 > bytes.len() { break; }
                                    let val_len_bytes = &bytes[pos..pos + 4];
                                    pos += 4;
                                    
                                    let val_len = if val_len_bytes == [0, 0, 0, 0] {
                                        0
                                    } else {
                                        let len = u32::from_be_bytes([val_len_bytes[0], val_len_bytes[1], val_len_bytes[2], val_len_bytes[3]]) as usize;
                                        if len > 1000 { // Sanity check
                                            break;
                                        }
                                        len
                                    };
                                    
                                    if val_len == 0 || pos + val_len > bytes.len() { break; }
                                    
                                    // Read value
                                    let val_bytes = &bytes[pos..pos + val_len];
                                    if let Ok(val) = std::str::from_utf8(val_bytes) {
                                        map.insert(key.to_string(), serde_json::Value::String(val.to_string()));
                                    }
                                    pos += val_len;
                                } else {
                                    break;
                                }
                            }
                        }
                        
                        // If we couldn't parse anything, try extracting readable text
                        if map.is_empty() {
                            // Extract any key=>value patterns from the readable text
                            let readable: String = value.chars()
                                .filter(|c| c.is_alphanumeric() || c.is_whitespace() || 
                                        *c == '"' || *c == '=' || *c == '>' || *c == ',' || *c == '_' || *c == '-')
                                .collect();
                            
                            // Try to parse text format
                            if readable.contains("=>") {
                                for pair in readable.split(',') {
                                    if let Some(arrow_pos) = pair.find("=>") {
                                        let key = pair[..arrow_pos].trim().trim_matches('"');
                                        let val = pair[arrow_pos + 2..].trim().trim_matches('"');
                                        if !key.is_empty() {
                                            map.insert(key.to_string(), serde_json::Value::String(val.to_string()));
                                        }
                                    }
                                }
                            }
                        }
                        
                        serde_json::Value::Object(map)
                    } else if !value.is_empty() {
                        // Text format: "key"=>"value", "key2"=>"value2"
                        let mut map = serde_json::Map::new();
                        
                        // Split by commas that are not inside quotes
                        let pairs: Vec<&str> = value.split("\", \"")
                            .map(|s| s.trim_matches('"'))
                            .collect();
                        
                        for pair in pairs {
                            if let Some(arrow_pos) = pair.find("=>") {
                                let key = pair[..arrow_pos].trim().trim_matches('"');
                                let val = pair[arrow_pos + 2..].trim().trim_matches('"');
                                map.insert(key.to_string(), serde_json::Value::String(val.to_string()));
                            } else if pair.contains("=>") {
                                // Handle pairs that might have quotes in different positions
                                let parts: Vec<&str> = pair.split("=>").collect();
                                if parts.len() == 2 {
                                    let key = parts[0].trim().trim_matches('"');
                                    let val = parts[1].trim().trim_matches('"');
                                    map.insert(key.to_string(), serde_json::Value::String(val.to_string()));
                                }
                            }
                        }
                        
                        serde_json::Value::Object(map)
                    } else {
                        serde_json::Value::Object(serde_json::Map::new())
                    };
                    
                    Ok(CellValue {
                        value: Some(json_value),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Json,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    // SQLx cannot decode hstore directly
                    // Inform user to use ::text cast in their query
                    Ok(CellValue::text(format!("<hstore - use ::text cast>"), type_name))
                }
            }
            
            // Default case for unknown or custom types (including enums)
            _ => {
                // PostgreSQL enums and custom types need special handling
                // They're not directly supported by sqlx's type system
                
                // First check if it's likely an enum type
                let is_enum = type_name.chars().all(|c| c.is_alphanumeric() || c == '_') 
                    && !type_name.chars().next().unwrap_or('0').is_numeric()
                    && !type_name.contains("ARRAY")
                    && !type_name.contains("[]");
                
                // For enums and custom types, we need to cast to text in the query
                // But since we're already in the conversion phase, we'll handle it here
                
                // Try to get the raw value
                let value_ref = row.try_get_raw(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get raw value for {}: {}", type_name, e)))?;
                
                if value_ref.is_null() {
                    return Ok(CellValue::null(type_name));
                }
                
                // For unknown types, try direct string conversion first
                // Only use raw bytes for enum types that are known to be text-based
                if let Ok(string_value) = row.try_get::<String, _>(column_index) {
                    return Ok(CellValue {
                        value: Some(serde_json::Value::String(string_value)),
                        db_type: type_name.to_string(),
                        value_type: if is_enum { CellValueType::Enum } else { CellValueType::Unknown },
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    });
                }

                // Only try raw byte decoding for enum types
                if !is_enum {
                    // For non-enum unknown types, return a placeholder
                    return Ok(CellValue::text(format!("<{} data>", type_name), type_name));
                }

                // For enum types, try raw byte decoding as they should be text-based
                let bytes = value_ref.as_bytes()
                    .map_err(|e| AppError::Database(format!("Failed to get bytes for {}: {}", type_name, e)))?;

                // Try to decode as UTF-8, but handle failure gracefully
                let value_str = match std::str::from_utf8(bytes) {
                    Ok(s) => s.to_string(),
                    Err(_) => {
                        // If UTF-8 decoding fails, return a placeholder
                        return Ok(CellValue::text(format!("<{} enum data>", type_name), type_name));
                    }
                };
                
                let value_type = if is_enum {
                    CellValueType::Enum
                } else {
                    CellValueType::Unknown
                };
                
                Ok(CellValue {
                    value: Some(serde_json::Value::String(value_str)),
                    db_type: type_name.to_string(),
                    value_type,
                    metadata: None,
                    is_truncated: false,
                    byte_size: None,
                })
            }
        }
    }
}