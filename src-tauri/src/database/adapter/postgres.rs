use async_trait::async_trait;
use serde_json::Value;
use sqlx::{PgPool, Row, Column, TypeInfo, ValueRef};
use sqlx::postgres::{PgRow, PgColumn};
use std::time::{Duration, Instant};
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, NaiveDateTime, NaiveDate, NaiveTime, Utc};
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
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get network address: {}", e)))?;
                Ok(CellValue::text(value, type_name))
            }
            
            // MAC address type
            "MACADDR" | "MACADDR8" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get MAC address: {}", e)))?;
                Ok(CellValue::text(value, type_name))
            }
            
            // Bit types
            "BIT" | "VARBIT" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get bit string: {}", e)))?;
                Ok(CellValue::text(value, type_name))
            }
            
            // Geometric types
            "POINT" | "LINE" | "LSEG" | "BOX" | "PATH" | "POLYGON" | "CIRCLE" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get geometry: {}", e)))?;
                
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
            type_name if type_name.starts_with('_') => {
                // PostgreSQL array types start with underscore
                let element_type = &type_name[1..]; // Remove the underscore
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get array: {}", e)))?;
                
                let metadata = CellMetadata {
                    precision: None,
                    scale: None,
                    max_length: None,
                    charset: None,
                    timezone: None,
                    element_type: Some(element_type.to_string()),
                    srid: None,
                    enum_values: None,
                    attributes: None,
                };
                
                // Try to parse array as JSON if possible
                let array_value = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&format!("[{}]", value.trim_matches(&['{', '}']))) {
                    parsed
                } else {
                    serde_json::Value::String(value)
                };
                
                Ok(CellValue {
                    value: Some(array_value),
                    db_type: type_name.to_string(),
                    value_type: CellValueType::Array,
                    metadata: Some(metadata),
                    is_truncated: false,
                    byte_size: None,
                })
            }
            
            // Money type
            "MONEY" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get money: {}", e)))?;
                
                // Parse money value (remove currency symbol)
                let cleaned = value.trim_start_matches('$').replace(',', "");
                if let Ok(decimal_val) = cleaned.parse::<f64>() {
                    Ok(CellValue::decimal(decimal_val, type_name, Some(19), Some(2)))
                } else {
                    Ok(CellValue::text(value, type_name))
                }
            }
            
            // Interval type
            "INTERVAL" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get interval: {}", e)))?;
                Ok(CellValue::text(value, type_name))
            }
            
            // Default case for unknown or custom types
            _ => {
                // Try to get as string for any unknown type
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get unknown type as string: {}", e)))?;
                
                // Check if it might be an enum by checking if it's a custom type
                let value_type = if type_name.chars().all(|c| c.is_alphanumeric() || c == '_') 
                    && !type_name.chars().next().unwrap_or('0').is_numeric() {
                    CellValueType::Enum
                } else {
                    CellValueType::Unknown
                };
                
                Ok(CellValue {
                    value: Some(serde_json::Value::String(value)),
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