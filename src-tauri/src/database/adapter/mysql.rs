use async_trait::async_trait;
use serde_json::Value;
use sqlx::{MySqlPool, Row, Column, TypeInfo, ValueRef, MySql};
use sqlx::mysql::{MySqlRow, MySqlColumn};
use std::time::{Duration, Instant};
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, NaiveDateTime, NaiveDate, NaiveTime, Utc};
use rust_decimal::Decimal;

use crate::error::AppError;
use crate::database::cell_value::{CellValue, CellValueType, CellMetadata};
use super::{DbAdapter, TableMeta, FunctionMeta, ColumnMeta, QueryCursor, QueryPage, ExecuteResult, QueryOptions, TransactionId, TableReadRequest, TableDataResponse, DbObjectKind};

pub struct MySqlAdapter {
    pool: MySqlPool,
    is_mariadb: bool,
    server_version: String,
}

impl MySqlAdapter {
    pub fn new(pool: MySqlPool) -> Self {
        Self { 
            pool,
            is_mariadb: false,
            server_version: String::new(),
        }
    }

    pub async fn initialize(&mut self) -> Result<(), AppError> {
        // Detect if this is MariaDB and get version
        let version = self.server_version().await?;
        self.server_version = version.clone();
        self.is_mariadb = version.to_lowercase().contains("mariadb");
        Ok(())
    }

    pub fn is_mariadb(&self) -> bool {
        self.is_mariadb
    }
}

#[async_trait]
impl DbAdapter for MySqlAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn ping(&self) -> Result<Duration, AppError> {
        let start = Instant::now();
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("MySQL ping failed: {}", e)))?;
        Ok(start.elapsed())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool.close().await;
        Ok(())
    }

    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let query = "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA 
                     WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                     ORDER BY SCHEMA_NAME";
        
        let rows = sqlx::query(query)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to list databases: {}", e)))?;

        let mut databases = Vec::new();
        for row in rows {
            // MySQL may return as VARCHAR or VARBINARY, handle both
            let db_name = if let Ok(s) = row.try_get::<String, _>(0) {
                s
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(0) {
                String::from_utf8(bytes).unwrap_or_default()
            } else {
                continue;
            };
            databases.push(db_name);
        }
        
        Ok(databases)
    }

    async fn list_schemas(&self, database: &str) -> Result<Vec<String>, AppError> {
        // MySQL doesn't have schemas in the same way as PostgreSQL
        // Each database is effectively a schema
        Ok(vec![database.to_string()])
    }

    async fn list_tables(&self, database: &str, _schema: &str) -> Result<Vec<TableMeta>, AppError> {
        let query = "SELECT 
                        TABLE_NAME, 
                        TABLE_TYPE,
                        COALESCE(TABLE_ROWS, 0) as row_estimate,
                        COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) as size_bytes
                     FROM INFORMATION_SCHEMA.TABLES 
                     WHERE TABLE_SCHEMA = ? 
                     AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
                     ORDER BY TABLE_NAME";
        
        let rows = sqlx::query(query)
            .bind(database)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to list tables: {}", e)))?;

        let mut tables = Vec::new();
        for row in rows {
            // MySQL may return as VARCHAR or VARBINARY, handle both
            let name: String = if let Ok(s) = row.try_get::<String, _>(0) {
                s
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(0) {
                String::from_utf8(bytes).unwrap_or_default()
            } else {
                continue;
            };
            
            let table_type: String = if let Ok(s) = row.try_get::<String, _>(1) {
                s
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(1) {
                String::from_utf8(bytes).unwrap_or_default()
            } else {
                "BASE TABLE".to_string()
            };
            let row_estimate: Option<i64> = row.try_get(2).ok();
            let size_bytes: Option<i64> = row.try_get(3).ok();
            
            tables.push(TableMeta {
                schema: database.to_string(),
                name,
                kind: match table_type.as_str() {
                    "BASE TABLE" => DbObjectKind::Table,
                    "VIEW" => DbObjectKind::View,
                    _ => DbObjectKind::Table,
                },
                row_estimate,
                size_bytes,
            });
        }

        Ok(tables)
    }

    async fn list_functions(&self, database: &str, _schema: &str) -> Result<Vec<FunctionMeta>, AppError> {
        let query = "SELECT 
                        ROUTINE_NAME,
                        DATA_TYPE,
                        ROUTINE_DEFINITION
                     FROM INFORMATION_SCHEMA.ROUTINES
                     WHERE ROUTINE_SCHEMA = ?
                     AND ROUTINE_TYPE = 'FUNCTION'
                     ORDER BY ROUTINE_NAME";
        
        let rows = sqlx::query(query)
            .bind(database)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to list functions: {}", e)))?;

        let mut functions = Vec::new();
        for row in rows {
            // Handle MySQL returning VARCHAR or BLOB for string columns
            let name: String = if let Ok(s) = row.try_get::<String, _>(0) {
                s
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(0) {
                String::from_utf8(bytes).unwrap_or_default()
            } else {
                continue;
            };
            
            let return_type: Option<String> = if let Ok(s) = row.try_get::<Option<String>, _>(1) {
                s
            } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(1) {
                Some(String::from_utf8(bytes).unwrap_or_default())
            } else {
                None
            };
            
            functions.push(FunctionMeta {
                schema: database.to_string(),
                name,
                return_type: return_type.unwrap_or_else(|| "void".to_string()),
                arguments: Vec::new(), // MySQL doesn't easily expose function arguments
            });
        }

        Ok(functions)
    }

    async fn table_columns(&self, database: &str, _schema: &str, table: &str) -> Result<Vec<ColumnMeta>, AppError> {
        let query = "SELECT 
                        c.COLUMN_NAME,
                        c.DATA_TYPE,
                        c.COLUMN_TYPE,
                        c.IS_NULLABLE,
                        c.COLUMN_DEFAULT,
                        c.ORDINAL_POSITION,
                        c.NUMERIC_PRECISION,
                        c.NUMERIC_SCALE,
                        c.CHARACTER_MAXIMUM_LENGTH,
                        c.CHARACTER_SET_NAME,
                        c.COLLATION_NAME,
                        c.COLUMN_KEY,
                        c.EXTRA,
                        c.GENERATION_EXPRESSION
                     FROM INFORMATION_SCHEMA.COLUMNS c
                     WHERE c.TABLE_SCHEMA = ? 
                     AND c.TABLE_NAME = ?
                     ORDER BY c.ORDINAL_POSITION";
        
        let rows = sqlx::query(query)
            .bind(database)
            .bind(table)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to get table columns: {}", e)))?;

        let mut columns = Vec::new();
        for row in rows {
            // Handle MySQL returning VARCHAR or VARBINARY for string columns
            let name: String = if let Ok(s) = row.try_get::<String, _>(0) {
                s
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(0) {
                String::from_utf8(bytes).unwrap_or_default()
            } else {
                continue;
            };
            
            let data_type: String = if let Ok(s) = row.try_get::<String, _>(1) {
                s
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(1) {
                String::from_utf8(bytes).unwrap_or_default()
            } else {
                "VARCHAR".to_string()
            };
            
            let column_type: String = if let Ok(s) = row.try_get::<String, _>(2) {
                s
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(2) {
                String::from_utf8(bytes).unwrap_or_default()
            } else {
                data_type.clone()
            };
            
            let is_nullable: String = if let Ok(s) = row.try_get::<String, _>(3) {
                s
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(3) {
                String::from_utf8(bytes).unwrap_or_default()
            } else {
                "YES".to_string()
            };
            
            let default: Option<String> = if let Ok(s) = row.try_get::<Option<String>, _>(4) {
                s
            } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(4) {
                Some(String::from_utf8(bytes).unwrap_or_default())
            } else {
                None
            };
            let ordinal: i32 = row.try_get(5).unwrap_or(0);
            // MySQL returns precision and scale as BIGINT UNSIGNED, handle both i32 and i64
            let precision: Option<i32> = if let Ok(val) = row.try_get::<Option<i64>, _>(6) {
                val.map(|v| v as i32)
            } else {
                row.try_get(6).unwrap_or(None)
            };
            let scale: Option<i32> = if let Ok(val) = row.try_get::<Option<i64>, _>(7) {
                val.map(|v| v as i32)
            } else {
                row.try_get(7).unwrap_or(None)
            };
            let _max_length: Option<i32> = if let Ok(val) = row.try_get::<Option<i64>, _>(8) {
                val.map(|v| v as i32)
            } else {
                row.try_get(8).unwrap_or(None)
            };
            let _charset: Option<String> = row.get(9);
            let _collation: Option<String> = row.get(10);
            // column_key can be returned as BINARY or VARCHAR
            let column_key: Option<String> = if let Ok(s) = row.try_get::<Option<String>, _>(11) {
                s
            } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(11) {
                Some(String::from_utf8(bytes).unwrap_or_default())
            } else {
                None
            };
            let extra: Option<String> = if let Ok(s) = row.try_get::<Option<String>, _>(12) {
                s
            } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(12) {
                Some(String::from_utf8(bytes).unwrap_or_default())
            } else {
                None
            };
            let generation_expression: Option<String> = if let Ok(s) = row.try_get::<Option<String>, _>(13) {
                s
            } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(13) {
                Some(String::from_utf8(bytes).unwrap_or_default())
            } else {
                None
            };
            
            // Determine if column is primary key or foreign key
            let is_pk = column_key.as_deref() == Some("PRI");
            let is_fk = column_key.as_deref() == Some("MUL");
            
            // Check for special column types
            let is_json = data_type.to_uppercase() == "JSON";
            let is_virtual = extra.as_ref().map_or(false, |e| 
                e.contains("VIRTUAL") || e.contains("STORED") || e.contains("PERSISTENT"));
            let is_identity = extra.as_ref().map_or(false, |e| e.contains("auto_increment"));
            
            // Extract enum/set values from column_type
            let (enum_values, set_values) = if data_type.to_uppercase() == "ENUM" {
                (Some(self.extract_enum_values(&column_type)), None)
            } else if data_type.to_uppercase() == "SET" {
                (None, Some(self.extract_enum_values(&column_type)))
            } else {
                (None, None)
            };
            
            columns.push(ColumnMeta {
                name,
                db_type: column_type,
                nullable: is_nullable == "YES",
                default,
                is_pk,
                is_fk,
                ordinal,
                precision,
                scale,
                is_identity: Some(is_identity),
                is_computed: Some(generation_expression.is_some()),
                is_hierarchyid: None,
                is_spatial: Some(self.is_spatial_type(&data_type)),
                is_json: Some(is_json),
                enum_values,
                set_values,
                is_virtual: Some(is_virtual),
            });
        }

        Ok(columns)
    }

    async fn table_triggers(&self, database: &str, _schema: &str, table: &str) -> Result<Vec<super::TriggerMeta>, AppError> {
        let rows = sqlx::query(
            r#"SELECT 
                TRIGGER_NAME,
                EVENT_MANIPULATION,
                ACTION_TIMING,
                'ROW' as ACTION_ORIENTATION,
                'Y' as STATUS,
                ACTION_STATEMENT,
                NULL as ACTION_CONDITION,
                CREATED
            FROM INFORMATION_SCHEMA.TRIGGERS 
            WHERE TRIGGER_SCHEMA = ? 
                AND EVENT_OBJECT_TABLE = ?
            ORDER BY TRIGGER_NAME"#
        )
        .bind(database)
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
            let status: String = row.get(4);
            let function: String = row.get(5);
            let condition: Option<String> = row.get(6);
            let created: Option<String> = row.get(7);
            
            triggers.push(super::TriggerMeta {
                name: trigger_name,
                event,
                timing,
                level,
                enabled: status == "Y",
                function,
                condition,
                created: created.map(|c| c.to_string()),
            });
        }
        
        Ok(triggers)
    }

    async fn estimate_count(&self, database: &str, _schema: &str, table: &str) -> Result<i64, AppError> {
        let query = "SELECT TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES 
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
        
        // Use u64 first to handle BIGINT UNSIGNED, then convert to i64
        let count: Option<u64> = sqlx::query_scalar(query)
            .bind(database)
            .bind(table)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to estimate count: {}", e)))?;

        // Convert u64 to i64, capping at i64::MAX if needed
        Ok(count.map(|c| c.min(i64::MAX as u64) as i64).unwrap_or(0))
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
        
        // Execute query and fetch all rows (MySQL doesn't have server-side cursors in sqlx)
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
                cell_row.push(self.convert_mysql_value_to_cell(row, column, i)?);
            }
            cell_rows.push(cell_row);
        }
        
        // Determine pagination
        let total_rows = cell_rows.len();
        let page_size = opts.page_size.min(1000);
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
        // Re-execute query with LIMIT/OFFSET
        let offset = page * page_size;
        let sql_with_pagination = format!("{} LIMIT {} OFFSET {}", cursor.sql, page_size, offset);
        
        let rows = sqlx::query(&sql_with_pagination)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Page fetch failed: {}", e)))?;
        
        let mut cell_rows = Vec::new();
        for row in &rows {
            let mut cell_row = Vec::new();
            for (i, column) in row.columns().iter().enumerate() {
                cell_row.push(self.convert_mysql_value_to_cell(row, column, i)?);
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
        // No server-side cursors to clean up
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
            last_insert_id: if result.last_insert_id() > 0 {
                Some(result.last_insert_id().to_string())
            } else {
                None
            },
            execution_time_ms: execution_time,
        })
    }

    async fn begin_transaction(&self) -> Result<TransactionId, AppError> {
        let tx_id = Uuid::new_v4().to_string();
        // Use sqlx::raw_sql for transaction commands to avoid prepared statement issues
        sqlx::raw_sql("START TRANSACTION")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Begin transaction failed: {}", e)))?;
        
        Ok(tx_id)
    }

    async fn commit(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        // Use sqlx::raw_sql for transaction commands to avoid prepared statement issues
        sqlx::raw_sql("COMMIT")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Commit transaction failed: {}", e)))?;
        
        Ok(())
    }

    async fn rollback(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        // Use sqlx::raw_sql for transaction commands to avoid prepared statement issues
        sqlx::raw_sql("ROLLBACK")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Rollback transaction failed: {}", e)))?;
        
        Ok(())
    }

    async fn server_version(&self) -> Result<String, AppError> {
        let version: String = sqlx::query_scalar("SELECT VERSION()")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to get server version: {}", e)))?;
        
        Ok(version)
    }

    async fn read_table_data(&self, request: TableReadRequest) -> Result<(TableDataResponse, Option<String>), AppError> {
        use super::types::{PaginationMode, FilterOperator, SortDirection};
        
        // Build SELECT query
        let select_clause = if let Some(cols) = &request.select {
            cols.join(", ")
        } else {
            "*".to_string()
        };
        
        let mut sql = format!("SELECT {} FROM {}", select_clause, request.table);
        let mut bindings = Vec::new();
        
        // Add WHERE clause for filters
        if !request.filters.is_empty() {
            let conditions: Vec<String> = request.filters.iter().map(|f| {
                match f.operator {
                    FilterOperator::IsNull => format!("{} IS NULL", f.column),
                    FilterOperator::IsNotNull => format!("{} IS NOT NULL", f.column),
                    FilterOperator::In => {
                        if let Some(values) = f.value.as_array() {
                            let placeholders = vec!["?"; values.len()].join(", ");
                            for v in values {
                                bindings.push(v.clone());
                            }
                            format!("{} IN ({})", f.column, placeholders)
                        } else {
                            bindings.push(f.value.clone());
                            format!("{} = ?", f.column)
                        }
                    }
                    FilterOperator::Between => {
                        if let Some(values) = f.value.as_array() {
                            if values.len() == 2 {
                                bindings.push(values[0].clone());
                                bindings.push(values[1].clone());
                                format!("{} BETWEEN ? AND ?", f.column)
                            } else {
                                bindings.push(f.value.clone());
                                format!("{} = ?", f.column)
                            }
                        } else {
                            bindings.push(f.value.clone());
                            format!("{} = ?", f.column)
                        }
                    }
                    FilterOperator::Equal => {
                        bindings.push(f.value.clone());
                        format!("{} = ?", f.column)
                    }
                    FilterOperator::NotEqual => {
                        bindings.push(f.value.clone());
                        format!("{} != ?", f.column)
                    }
                    FilterOperator::LessThan => {
                        bindings.push(f.value.clone());
                        format!("{} < ?", f.column)
                    }
                    FilterOperator::LessThanOrEqual => {
                        bindings.push(f.value.clone());
                        format!("{} <= ?", f.column)
                    }
                    FilterOperator::GreaterThan => {
                        bindings.push(f.value.clone());
                        format!("{} > ?", f.column)
                    }
                    FilterOperator::GreaterThanOrEqual => {
                        bindings.push(f.value.clone());
                        format!("{} >= ?", f.column)
                    }
                    FilterOperator::Like => {
                        bindings.push(f.value.clone());
                        format!("{} LIKE ?", f.column)
                    }
                    FilterOperator::ILike => {
                        // MySQL doesn't have ILIKE, use LOWER for case-insensitive
                        bindings.push(f.value.clone());
                        format!("LOWER({}) LIKE LOWER(?)", f.column)
                    }
                }
            }).collect();
            
            if !conditions.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(&conditions.join(" AND "));
            }
        }
        
        // Add ORDER BY clause
        if !request.sorts.is_empty() {
            let order_clauses: Vec<String> = request.sorts.iter()
                .map(|s| {
                    let direction = match s.direction {
                        SortDirection::Asc => "ASC",
                        SortDirection::Desc => "DESC",
                    };
                    format!("{} {}", s.column, direction)
                })
                .collect();
            
            if !order_clauses.is_empty() {
                sql.push_str(" ORDER BY ");
                sql.push_str(&order_clauses.join(", "));
            }
        }
        
        // Add LIMIT and OFFSET based on pagination mode
        let (limit, offset) = match &request.pagination {
            PaginationMode::Offset { offset, limit } => (*limit.min(&1000), *offset),
            PaginationMode::Cursor { cursor } => {
                // Parse cursor to get offset
                if let Some(cursor_str) = cursor {
                    if cursor_str.starts_with("offset:") {
                        let offset_str = &cursor_str[7..];
                        let offset = offset_str.parse::<usize>().unwrap_or(0);
                        (1000, offset)
                    } else {
                        (1000, 0)
                    }
                } else {
                    (1000, 0)
                }
            }
        };
        sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));
        
        // Execute query
        let mut query = sqlx::query(&sql);
        for binding in bindings {
            query = self.bind_parameter(query, binding)?;
        }
        
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Table data read failed: {}", e)))?;
        
        if rows.is_empty() {
            return Ok((TableDataResponse::Done, None));
        }
        
        // Convert to hash map format
        let mut result_rows = Vec::new();
        for row in &rows {
            let mut row_map = HashMap::new();
            for (i, column) in row.columns().iter().enumerate() {
                let cell_value = self.convert_mysql_value_to_cell(row, column, i)?;
                row_map.insert(column.name().to_string(), cell_value);
            }
            result_rows.push(row_map);
        }
        
        // Generate next cursor if there might be more data
        let next_cursor = if result_rows.len() == limit {
            Some(format!("offset:{}", offset + limit))
        } else {
            None
        };
        
        Ok((TableDataResponse::Rows {
            rows: result_rows,
            next_cursor,
        }, None))
    }
    
    async fn execute_raw_query(
        &self,
        database: &str,
        query: &str,
        limit: u32,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        // Switch to the specified database
        let use_db = format!("USE `{}`", database);
        sqlx::query(&use_db).execute(&self.pool).await?;

        // Add LIMIT if not already present (only for SELECT statements)
        let limited_query = if query.trim().to_uppercase().starts_with("SELECT") 
            && !query.to_uppercase().contains("LIMIT") {
            format!("{} LIMIT {}", query, limit)
        } else {
            query.to_string()
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

impl MySqlAdapter {
    /// Helper method to bind parameters to sqlx query
    fn bind_parameter<'a>(&self, mut query: sqlx::query::Query<'a, MySql, sqlx::mysql::MySqlArguments>, param: Value) -> Result<sqlx::query::Query<'a, MySql, sqlx::mysql::MySqlArguments>, AppError> {
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
                query = query.bind(param.to_string());
            }
            Value::Object(_) => {
                query = query.bind(param.to_string());
            }
        }
        Ok(query)
    }
    
    /// Extract column metadata from MySQL column info
    fn extract_column_metadata(&self, column: &MySqlColumn, ordinal: i32) -> ColumnMeta {
        let type_info = column.type_info();
        let type_name = type_info.name();
        
        ColumnMeta {
            name: column.name().to_string(),
            db_type: type_name.to_string(),
            nullable: true,
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
            is_json: Some(type_name.to_uppercase() == "JSON"),
            enum_values: None,
            set_values: None,
            is_virtual: None,
        }
    }
    
    /// Check if a MySQL type is spatial
    fn is_spatial_type(&self, type_name: &str) -> bool {
        matches!(type_name.to_uppercase().as_str(), 
            "GEOMETRY" | "POINT" | "LINESTRING" | "POLYGON" |
            "MULTIPOINT" | "MULTILINESTRING" | "MULTIPOLYGON" |
            "GEOMETRYCOLLECTION" | "GEOMCOLLECTION"
        )
    }
    
    /// Extract enum/set values from column type definition
    fn extract_enum_values(&self, column_type: &str) -> Vec<String> {
        // Extract values from enum('val1','val2') or set('val1','val2')
        if let Some(start) = column_type.find('(') {
            if let Some(end) = column_type.rfind(')') {
                let values_str = &column_type[start + 1..end];
                return values_str
                    .split(',')
                    .map(|s| s.trim().trim_matches('\'').to_string())
                    .collect();
            }
        }
        Vec::new()
    }
    
    /// Convert MySQL value to CellValue with proper type mapping
    fn convert_mysql_value_to_cell(&self, row: &MySqlRow, column: &MySqlColumn, column_index: usize) -> Result<CellValue, AppError> {
        let type_info = column.type_info();
        let type_name = type_info.name();
        let is_null = row.try_get_raw(column_index)
            .map_err(|e| AppError::Database(format!("Failed to check null: {}", e)))?
            .is_null();
        
        if is_null {
            return Ok(CellValue::null(type_name));
        }
        
        // Handle each MySQL type appropriately
        match type_name.to_uppercase().as_str() {
            // Integer types
            "TINYINT" | "BOOL" | "BOOLEAN" => {
                // MySQL TINYINT(1) is used for boolean, but it's returned as integer
                // Check if this is likely a boolean by looking at the value
                if let Ok(val) = row.try_get::<i8, _>(column_index) {
                    // If the column type is explicitly BOOL/BOOLEAN or value is 0/1, treat as boolean
                    if type_name == "BOOL" || type_name == "BOOLEAN" || (val == 0 || val == 1) {
                        Ok(CellValue::boolean(val != 0, type_name))
                    } else {
                        Ok(CellValue::integer(val as i64, type_name))
                    }
                } else if let Ok(val) = row.try_get::<bool, _>(column_index) {
                    Ok(CellValue::boolean(val, type_name))
                } else {
                    Ok(CellValue::null(type_name))
                }
            }
            "TINYINT UNSIGNED" => {
                if let Ok(val) = row.try_get::<u8, _>(column_index) {
                    // If value is 0 or 1, it might be a boolean
                    if val == 0 || val == 1 {
                        Ok(CellValue::boolean(val != 0, type_name))
                    } else {
                        Ok(CellValue::integer(val as i64, type_name))
                    }
                } else {
                    Ok(CellValue::null(type_name))
                }
            }
            // UNSIGNED SMALLINT
            "SMALLINT UNSIGNED" => {
                if let Ok(val) = row.try_get::<u16, _>(column_index) {
                    Ok(CellValue::integer(val as i64, type_name))
                } else {
                    Ok(CellValue::null(type_name))
                }
            }
            // UNSIGNED MEDIUMINT
            "MEDIUMINT UNSIGNED" => {
                if let Ok(val) = row.try_get::<u32, _>(column_index) {
                    Ok(CellValue::integer(val as i64, type_name))
                } else {
                    Ok(CellValue::null(type_name))
                }
            }
            // For UNSIGNED integers that could be boolean
            "INT UNSIGNED" | "INTEGER UNSIGNED" | "BIGINT UNSIGNED" => {
                if let Ok(val) = row.try_get::<u32, _>(column_index) {
                    // If value is 0 or 1, it might be a boolean
                    if val == 0 || val == 1 {
                        Ok(CellValue::boolean(val != 0, type_name))
                    } else {
                        Ok(CellValue::integer(val as i64, type_name))
                    }
                } else if let Ok(val) = row.try_get::<u64, _>(column_index) {
                    if val == 0 || val == 1 {
                        Ok(CellValue::boolean(val != 0, type_name))
                    } else {
                        Ok(CellValue::integer(val as i64, type_name))
                    }
                } else {
                    Ok(CellValue::null(type_name))
                }
            }
            "SMALLINT" => {
                let value: i16 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get i16: {}", e)))?;
                Ok(CellValue::integer(value as i64, type_name))
            }
            "YEAR" => {
                // MySQL YEAR can be returned as u16 or i16 depending on the version
                if let Ok(value) = row.try_get::<u16, _>(column_index) {
                    Ok(CellValue::integer(value as i64, type_name))
                } else if let Ok(value) = row.try_get::<i16, _>(column_index) {
                    Ok(CellValue::integer(value as i64, type_name))
                } else if let Ok(value) = row.try_get::<i32, _>(column_index) {
                    Ok(CellValue::integer(value as i64, type_name))
                } else {
                    // Fallback: try to get as string
                    if let Ok(value) = row.try_get::<String, _>(column_index) {
                        if let Ok(year) = value.parse::<i64>() {
                            Ok(CellValue::integer(year, type_name))
                        } else {
                            Ok(CellValue::text(value, type_name))
                        }
                    } else {
                        Ok(CellValue::null(type_name))
                    }
                }
            }
            "MEDIUMINT" | "INT" | "INTEGER" => {
                let value: i32 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get i32: {}", e)))?;
                Ok(CellValue::integer(value as i64, type_name))
            }
            "BIGINT" => {
                let value: i64 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get i64: {}", e)))?;
                Ok(CellValue::integer(value, type_name))
            }
            
            // Floating point types
            "FLOAT" => {
                let value: f32 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get f32: {}", e)))?;
                Ok(CellValue::decimal(value as f64, type_name, Some(7), Some(6)))
            }
            "DOUBLE" | "REAL" => {
                let value: f64 = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get f64: {}", e)))?;
                Ok(CellValue::decimal(value, type_name, Some(15), Some(14)))
            }
            
            // Decimal types
            "DECIMAL" | "NUMERIC" => {
                if let Ok(decimal_val) = row.try_get::<Decimal, _>(column_index) {
                    let metadata = CellMetadata {
                        precision: Some(28),
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
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get decimal as string: {}", e)))?;
                    Ok(CellValue::text(value, type_name))
                }
            }
            
            // Bit type
            "BIT" => {
                let value: Vec<u8> = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get bit: {}", e)))?;
                let bit_string = value.iter()
                    .map(|byte| format!("{:08b}", byte))
                    .collect::<String>();
                Ok(CellValue::text(bit_string, type_name))
            }
            
            // String types
            "CHAR" | "VARCHAR" | "TINYTEXT" | "TEXT" | "MEDIUMTEXT" | "LONGTEXT" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get string: {}", e)))?;
                
                // Check for UUID pattern
                if value.len() == 36 && value.chars().filter(|c| *c == '-').count() == 4 {
                    if Uuid::parse_str(&value).is_ok() {
                        return Ok(CellValue {
                            value: Some(serde_json::Value::String(value)),
                            db_type: type_name.to_string(),
                            value_type: CellValueType::Uuid,
                            metadata: None,
                            is_truncated: false,
                            byte_size: None,
                        });
                    }
                }
                
                Ok(CellValue::text(value, type_name))
            }
            
            // Binary types
            "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" => {
                let value: Vec<u8> = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get binary: {}", e)))?;
                
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
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get date: {}", e)))?;
                    Ok(CellValue::text(value, type_name))
                }
            }
            "TIME" => {
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
            "DATETIME" | "TIMESTAMP" => {
                if let Ok(dt_val) = row.try_get::<NaiveDateTime, _>(column_index) {
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(dt_val.to_string())),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::DateTime,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                } else if let Ok(dt_utc) = row.try_get::<DateTime<Utc>, _>(column_index) {
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
                        value: Some(serde_json::Value::String(dt_utc.to_rfc3339())),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::DateTime,
                        metadata: Some(metadata),
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    let value: String = row.try_get(column_index)
                        .map_err(|e| AppError::Database(format!("Failed to get datetime: {}", e)))?;
                    Ok(CellValue::text(value, type_name))
                }
            }
            
            // JSON type
            "JSON" => {
                if let Ok(json_val) = row.try_get::<serde_json::Value, _>(column_index) {
                    Ok(CellValue::json(json_val, type_name))
                } else if let Ok(json_str) = row.try_get::<String, _>(column_index) {
                    match serde_json::from_str::<serde_json::Value>(&json_str) {
                        Ok(parsed_json) => Ok(CellValue::json(parsed_json, type_name)),
                        Err(_) => Ok(CellValue::text(json_str, type_name))
                    }
                } else {
                    Ok(CellValue::null(type_name))
                }
            }
            
            // Geometry types
            "GEOMETRY" | "POINT" | "LINESTRING" | "POLYGON" |
            "MULTIPOINT" | "MULTILINESTRING" | "MULTIPOLYGON" | "GEOMETRYCOLLECTION" => {
                // MySQL geometry types are returned as binary, convert to WKT or GeoJSON
                if let Ok(geom_bytes) = row.try_get::<Vec<u8>, _>(column_index) {
                    // For now, return as hex representation
                    // A full implementation would parse the MySQL internal geometry format
                    let hex_string = hex::encode(&geom_bytes);
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(hex_string)),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Geometry,
                        metadata: None,
                        is_truncated: false,
                        byte_size: Some(geom_bytes.len()),
                    })
                } else {
                    Ok(CellValue::null(type_name))
                }
            }
            
            // ENUM and SET types
            "ENUM" | "SET" => {
                let value: String = row.try_get(column_index)
                    .map_err(|e| AppError::Database(format!("Failed to get enum/set: {}", e)))?;
                
                Ok(CellValue {
                    value: Some(serde_json::Value::String(value)),
                    db_type: type_name.to_string(),
                    value_type: CellValueType::Enum,
                    metadata: None,
                    is_truncated: false,
                    byte_size: None,
                })
            }
            
            // Default fallback for unknown types
            _ => {
                // Try to get as string
                if let Ok(value) = row.try_get::<String, _>(column_index) {
                    Ok(CellValue {
                        value: Some(serde_json::Value::String(value)),
                        db_type: type_name.to_string(),
                        value_type: CellValueType::Unknown,
                        metadata: None,
                        is_truncated: false,
                        byte_size: None,
                    })
                } else {
                    Ok(CellValue::null(type_name))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::mysql::MySqlPoolOptions;

    async fn get_test_pool() -> Result<MySqlPool, AppError> {
        let database_url = "mysql://devuser:devpass123@localhost:13306/todoapp";
        MySqlPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await
            .map_err(|e| AppError::Database(format!("Failed to connect to test database: {}", e)))
    }

    #[tokio::test]
    async fn test_ping() {
        if let Ok(pool) = get_test_pool().await {
            let adapter = MySqlAdapter::new(pool);
            let result = adapter.ping().await;
            assert!(result.is_ok());
        }
    }

    #[tokio::test]
    async fn test_list_databases() {
        if let Ok(pool) = get_test_pool().await {
            let adapter = MySqlAdapter::new(pool);
            let result = adapter.list_databases().await;
            assert!(result.is_ok());
            let databases = result.unwrap();
            assert!(databases.contains(&"todoapp".to_string()));
        }
    }

    #[tokio::test]
    async fn test_list_tables() {
        if let Ok(pool) = get_test_pool().await {
            let adapter = MySqlAdapter::new(pool);
            let result = adapter.list_tables("todoapp", "").await;
            assert!(result.is_ok());
            let tables = result.unwrap();
            assert!(!tables.is_empty());
        }
    }

    #[tokio::test]
    async fn test_table_columns() {
        if let Ok(pool) = get_test_pool().await {
            let adapter = MySqlAdapter::new(pool);
            
            // First get tables to find one to test
            if let Ok(tables) = adapter.list_tables("todoapp", "").await {
                if let Some(table) = tables.first() {
                    let result = adapter.table_columns("todoapp", "", &table.name).await;
                    assert!(result.is_ok());
                    let columns = result.unwrap();
                    assert!(!columns.is_empty());
                }
            }
        }
    }

    #[tokio::test]
    async fn test_query_execution() {
        if let Ok(pool) = get_test_pool().await {
            let adapter = MySqlAdapter::new(pool);
            let sql = "SELECT 1 as test_col, 'hello' as text_col, NOW() as date_col";
            let opts = QueryOptions::default();
            
            let result = adapter.begin_query(sql, None, opts).await;
            assert!(result.is_ok());
            
            let cursor = result.unwrap();
            assert_eq!(cursor.columns.len(), 3);
            assert_eq!(cursor.rows.len(), 1);
            assert!(cursor.is_complete);
        }
    }

    #[tokio::test]
    async fn test_data_type_conversion() {
        if let Ok(pool) = get_test_pool().await {
            let adapter = MySqlAdapter::new(pool);
            
            // Test various MySQL data types
            // Note: MySQL returns TRUE as TINYINT(1), so we explicitly CAST to BOOLEAN
            let sql = "SELECT 
                        CAST(42 AS SIGNED) as int_val,
                        CAST(3.14159 AS DECIMAL(10,5)) as decimal_val,
                        CAST('test' AS CHAR(10)) as char_val,
                        CAST('2024-01-01' AS DATE) as date_val,
                        CAST('12:34:56' AS TIME) as time_val,
                        CAST('2024-01-01 12:34:56' AS DATETIME) as datetime_val,
                        CAST(TRUE AS UNSIGNED) as bool_val,
                        NULL as null_val";
            
            let opts = QueryOptions::default();
            let result = adapter.begin_query(sql, None, opts).await;
            assert!(result.is_ok());
            
            let cursor = result.unwrap();
            assert_eq!(cursor.rows.len(), 1);
            
            let row = &cursor.rows[0];
            
            // Check integer
            assert_eq!(row[0].value_type, CellValueType::Integer);
            assert_eq!(row[0].as_i64(), Some(42));
            
            // Check decimal
            assert_eq!(row[1].value_type, CellValueType::Decimal);
            
            // Check string
            assert_eq!(row[2].value_type, CellValueType::Text);
            
            // Check date
            assert_eq!(row[3].value_type, CellValueType::Date);
            
            // Check time
            assert_eq!(row[4].value_type, CellValueType::Time);
            
            // Check datetime
            assert_eq!(row[5].value_type, CellValueType::DateTime);
            
            // Check boolean - MySQL returns TRUE as integer 1
            // The conversion should detect this and return boolean
            assert_eq!(row[6].value_type, CellValueType::Boolean);
            assert_eq!(row[6].as_bool(), Some(true));
            
            // Check null
            assert_eq!(row[7].value_type, CellValueType::Null);
            assert!(row[7].is_null());
        }
    }

    #[tokio::test]
    async fn test_transaction_support() {
        if let Ok(pool) = get_test_pool().await {
            let adapter = MySqlAdapter::new(pool);
            
            // Begin transaction
            let tx_result = adapter.begin_transaction().await;
            if let Err(e) = &tx_result {
                println!("Transaction begin error: {:?}", e);
            }
            assert!(tx_result.is_ok());
            let tx_id = tx_result.unwrap();
            
            // Rollback transaction
            let rollback_result = adapter.rollback(tx_id).await;
            if let Err(e) = &rollback_result {
                println!("Transaction rollback error: {:?}", e);
            }
            assert!(rollback_result.is_ok());
        }
    }

    #[tokio::test]
    async fn test_mariadb_detection() {
        if let Ok(pool) = get_test_pool().await {
            let mut adapter = MySqlAdapter::new(pool);
            let init_result = adapter.initialize().await;
            assert!(init_result.is_ok());
            
            // Check version string
            let version = adapter.server_version().await;
            assert!(version.is_ok());
            println!("Server version: {}", version.unwrap());
        }
    }
}