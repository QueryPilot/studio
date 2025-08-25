use async_trait::async_trait;
use serde_json::Value;
use sqlx::{SqlitePool, Row, Column, TypeInfo, ValueRef, Decode, Sqlite};
use sqlx::sqlite::{SqliteRow, SqliteColumn, SqliteValueRef, SqliteTypeInfo};
use std::time::{Duration, Instant};
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::AppError;
use crate::database::cell_value::{CellValue, CellValueType};
use super::{DbAdapter, TableMeta, FunctionMeta, ColumnMeta, QueryCursor, QueryPage, ExecuteResult, QueryOptions, TransactionId, TableReadRequest, TableDataResponse, DbObjectKind, FilterSpec, FilterOperator, SortDirection, PaginationMode};

pub struct SqliteAdapter {
    pool: SqlitePool,
    transactions: std::sync::Arc<tokio::sync::Mutex<HashMap<TransactionId, sqlx::Transaction<'static, sqlx::Sqlite>>>>,
}

impl SqliteAdapter {
    pub fn new(pool: SqlitePool) -> Self {
        Self { 
            pool,
            transactions: std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }

    fn convert_sqlite_value(
        value_ref: SqliteValueRef<'_>,
        type_info: &SqliteTypeInfo,
        column: &SqliteColumn,
    ) -> CellValue {
        let db_type = column.type_info().name().to_string();
        
        if value_ref.is_null() {
            return CellValue {
                value: None,
                db_type,
                value_type: CellValueType::Null,
                metadata: None,
                is_truncated: false,
                byte_size: None,
            };
        }

        let type_name = type_info.name().to_uppercase();
        
        let (value, value_type) = match type_name.as_str() {
            "INTEGER" | "INT" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "BIGINT" => {
                let val = <Option<i64> as Decode<Sqlite>>::decode(value_ref).ok().flatten();
                (
                    val.map(|v| serde_json::json!(v)),
                    CellValueType::Integer
                )
            },
            "REAL" | "DOUBLE" | "FLOAT" | "NUMERIC" | "DECIMAL" => {
                let val = <Option<f64> as Decode<Sqlite>>::decode(value_ref).ok().flatten();
                (
                    val.map(|v| serde_json::json!(v)),
                    CellValueType::Decimal
                )
            },
            "BOOLEAN" | "BOOL" => {
                // SQLite stores booleans as integers
                let val = <Option<i64> as Decode<Sqlite>>::decode(value_ref).ok().flatten().map(|v| v != 0);
                (
                    val.map(|v| serde_json::json!(v)),
                    CellValueType::Boolean
                )
            },
            "DATE" => {
                let val = <Option<String> as Decode<Sqlite>>::decode(value_ref).ok().flatten();
                (
                    val.map(|v| serde_json::json!(v)),
                    CellValueType::Date
                )
            },
            "DATETIME" | "TIMESTAMP" => {
                let val = <Option<String> as Decode<Sqlite>>::decode(value_ref).ok().flatten();
                (
                    val.map(|v| serde_json::json!(v)),
                    CellValueType::DateTime
                )
            },
            "TIME" => {
                let val = <Option<String> as Decode<Sqlite>>::decode(value_ref).ok().flatten();
                (
                    val.map(|v| serde_json::json!(v)),
                    CellValueType::Time
                )
            },
            "BLOB" => {
                let val = <Option<Vec<u8>> as Decode<Sqlite>>::decode(value_ref).ok().flatten();
                let _byte_size = val.as_ref().map(|v| v.len());
                (
                    val.map(|v| serde_json::json!(hex::encode(v))),
                    CellValueType::Binary
                )
            },
            "JSON" => {
                let val = <Option<String> as Decode<Sqlite>>::decode(value_ref).ok().flatten();
                let json_val = val.and_then(|s| serde_json::from_str::<Value>(&s).ok());
                (
                    json_val,
                    CellValueType::Json
                )
            },
            _ => {
                // Default to TEXT for any other type
                let val = <Option<String> as Decode<Sqlite>>::decode(value_ref).ok().flatten();
                let byte_size = val.as_ref().map(|v| v.len());
                
                // Check if it's a UUID pattern
                if let Some(ref s) = val {
                    if s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4 {
                        return CellValue {
                            value: Some(serde_json::json!(s)),
                            db_type,
                            value_type: CellValueType::Uuid,
                            metadata: None,
                            is_truncated: false,
                            byte_size,
                        };
                    }
                }
                
                (
                    val.map(|v| serde_json::json!(v)),
                    CellValueType::Text
                )
            }
        };

        CellValue {
            value,
            db_type,
            value_type,
            metadata: None,
            is_truncated: false,
            byte_size: None,
        }
    }

    fn row_to_cell_values(row: &SqliteRow) -> Vec<CellValue> {
        let mut cells = Vec::new();
        for i in 0..row.columns().len() {
            let column = &row.columns()[i];
            let value_ref = row.try_get_raw(i).unwrap();
            let type_info = column.type_info();
            cells.push(Self::convert_sqlite_value(value_ref, type_info, column));
        }
        cells
    }

    async fn get_sqlite_version(&self) -> Result<String, AppError> {
        let row = sqlx::query("SELECT sqlite_version()")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to get SQLite version: {}", e)))?;
        
        let version: String = row.get(0);
        Ok(format!("SQLite {}", version))
    }
}

#[async_trait]
impl DbAdapter for SqliteAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn ping(&self) -> Result<Duration, AppError> {
        let start = Instant::now();
        sqlx::query("SELECT 1").fetch_one(&self.pool).await
            .map_err(|e| AppError::Database(format!("SQLite ping failed: {}", e)))?;
        Ok(start.elapsed())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool.close().await;
        Ok(())
    }

    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        // SQLite doesn't have multiple databases in the traditional sense
        // Return the main database and any attached databases
        let rows = sqlx::query("PRAGMA database_list")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to list databases: {}", e)))?;
        
        let mut databases = Vec::new();
        for row in rows {
            let name: String = row.get(1); // Column 1 is the database name
            databases.push(name);
        }
        
        Ok(databases)
    }

    async fn list_schemas(&self, _database: &str) -> Result<Vec<String>, AppError> {
        // SQLite doesn't have schemas, return a single "main" schema
        Ok(vec!["main".to_string()])
    }

    async fn list_tables(&self, _database: &str, _schema: &str) -> Result<Vec<TableMeta>, AppError> {
        let rows = sqlx::query(
            r#"SELECT 
                name,
                type,
                CASE 
                    WHEN type = 'table' THEN (SELECT COUNT(*) FROM pragma_table_info(name))
                    ELSE NULL
                END as col_count
            FROM sqlite_master 
            WHERE type IN ('table', 'view') 
            AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE '%_fts%'
            ORDER BY name"#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(format!("Failed to list tables: {}", e)))?;
        
        let mut tables = Vec::new();
        for row in rows {
            let table_name: String = row.get(0);
            let table_type: String = row.get(1);
            
            // Get row count for tables
            let row_estimate = if table_type == "table" {
                let count_query = format!("SELECT COUNT(*) FROM \"{}\"", table_name);
                let count_row = sqlx::query(&count_query)
                    .fetch_one(&self.pool)
                    .await
                    .ok();
                count_row.and_then(|r| r.try_get::<i64, _>(0).ok())
            } else {
                None
            };
            
            let kind = match table_type.as_str() {
                "table" => DbObjectKind::Table,
                "view" => DbObjectKind::View,
                _ => DbObjectKind::Table,
            };
            
            tables.push(TableMeta {
                schema: "main".to_string(),
                name: table_name,
                kind,
                row_estimate,
                size_bytes: None, // SQLite doesn't easily provide table size
            });
        }
        
        Ok(tables)
    }

    async fn list_functions(&self, _database: &str, _schema: &str) -> Result<Vec<FunctionMeta>, AppError> {
        // SQLite doesn't expose user-defined functions through SQL
        // Return empty list
        Ok(Vec::new())
    }

    async fn table_columns(&self, _database: &str, _schema: &str, table: &str) -> Result<Vec<ColumnMeta>, AppError> {
        let query = format!("PRAGMA table_info(\"{}\")", table);
        let rows = sqlx::query(&query)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to get table columns: {}", e)))?;
        
        // Get foreign key information
        let fk_query = format!("PRAGMA foreign_key_list(\"{}\")", table);
        let fk_rows = sqlx::query(&fk_query)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();
        
        let mut fk_columns = std::collections::HashSet::new();
        for row in fk_rows {
            let col: String = row.get(3); // Column 3 is 'from' column
            fk_columns.insert(col);
        }
        
        let mut columns = Vec::new();
        for row in rows {
            let cid: i32 = row.get(0);
            let name: String = row.get(1);
            let data_type: String = row.get(2);
            let not_null: i32 = row.get(3);
            let default_value: Option<String> = row.get(4);
            let pk: i32 = row.get(5);
            
            columns.push(ColumnMeta {
                name: name.clone(),
                db_type: data_type.clone(),
                nullable: not_null == 0,
                default: default_value,
                is_pk: pk > 0,
                is_fk: fk_columns.contains(&name),
                ordinal: cid,
                precision: None,
                scale: None,
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                is_json: Some(data_type.to_uppercase() == "JSON"),
                enum_values: None,
                set_values: None,
                is_virtual: None,
            });
        }
        
        Ok(columns)
    }

    async fn estimate_count(&self, _database: &str, _schema: &str, table: &str) -> Result<i64, AppError> {
        let query = format!("SELECT COUNT(*) FROM \"{}\"", table);
        let row = sqlx::query(&query)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to estimate count: {}", e)))?;
        
        let count: i64 = row.get(0);
        Ok(count)
    }

    async fn begin_query(&self, sql: &str, params: Option<Vec<Value>>, opts: QueryOptions) -> Result<QueryCursor, AppError> {
        let start = Instant::now();
        
        // Build query with parameters
        let mut query = sqlx::query(sql);
        if let Some(params) = params {
            for param in params {
                match param {
                    Value::Null => query = query.bind(None::<String>),
                    Value::Bool(b) => query = query.bind(b),
                    Value::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            query = query.bind(i);
                        } else if let Some(f) = n.as_f64() {
                            query = query.bind(f);
                        }
                    }
                    Value::String(s) => query = query.bind(s),
                    _ => query = query.bind(param.to_string()),
                }
            }
        }
        
        // Execute query
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Query execution failed: {}", e)))?;
        
        let _elapsed = start.elapsed();
        
        if rows.is_empty() {
            return Ok(QueryCursor {
                id: Uuid::new_v4().to_string(),
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
        
        // Get column metadata from first row
        let first_row = &rows[0];
        let columns: Vec<ColumnMeta> = first_row.columns()
            .iter()
            .enumerate()
            .map(|(i, col)| ColumnMeta {
                name: col.name().to_string(),
                db_type: col.type_info().name().to_string(),
                nullable: true, // SQLite columns are nullable by default
                default: None,
                is_pk: false,
                is_fk: false,
                ordinal: i as i32,
                precision: None,
                scale: None,
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
            })
            .collect();
        
        // Convert rows to CellValues
        let mut all_rows = Vec::new();
        for row in &rows {
            all_rows.push(Self::row_to_cell_values(row));
        }
        
        // Apply max_rows limit if specified
        if let Some(max) = opts.max_rows {
            all_rows.truncate(max);
        }
        
        let total_rows = all_rows.len();
        let page_size = opts.page_size;
        let is_complete = total_rows <= page_size;
        
        // Take only first page for initial response
        let _first_page_rows = if all_rows.len() > page_size {
            all_rows[..page_size].to_vec()
        } else {
            all_rows.clone()
        };
        
        Ok(QueryCursor {
            id: Uuid::new_v4().to_string(),
            sql: sql.to_string(),
            columns,
            rows: all_rows,
            page_size,
            current_page: 0,
            total_rows: Some(total_rows),
            is_complete,
            created_at: Some(Instant::now()),
        })
    }

    async fn fetch_page(&self, cursor: &mut QueryCursor, page: usize, page_size: usize) -> Result<QueryPage, AppError> {
        let start = page * page_size;
        let end = std::cmp::min(start + page_size, cursor.rows.len());
        
        if start >= cursor.rows.len() {
            return Ok(QueryPage {
                rows: Vec::new(),
                page,
                is_complete: true,
            });
        }
        
        let page_rows = cursor.rows[start..end].to_vec();
        let is_complete = end >= cursor.rows.len();
        
        cursor.current_page = page;
        
        Ok(QueryPage {
            rows: page_rows,
            page,
            is_complete,
        })
    }

    async fn close_cursor(&self, _cursor_id: &str) -> Result<(), AppError> {
        // No special cleanup needed for SQLite cursors
        Ok(())
    }

    async fn execute(&self, sql: &str, params: Option<Vec<Value>>) -> Result<ExecuteResult, AppError> {
        let start = Instant::now();
        
        // Build query with parameters
        let mut query = sqlx::query(sql);
        if let Some(params) = params {
            for param in params {
                match param {
                    Value::Null => query = query.bind(None::<String>),
                    Value::Bool(b) => query = query.bind(b),
                    Value::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            query = query.bind(i);
                        } else if let Some(f) = n.as_f64() {
                            query = query.bind(f);
                        }
                    }
                    Value::String(s) => query = query.bind(s),
                    _ => query = query.bind(param.to_string()),
                }
            }
        }
        
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Execute failed: {}", e)))?;
        
        let _elapsed = start.elapsed();
        
        Ok(ExecuteResult {
            rows_affected: result.rows_affected(),
            last_insert_id: Some(result.last_insert_rowid().to_string()),
            execution_time_ms: _elapsed.as_secs_f64() * 1000.0,
        })
    }

    async fn begin_transaction(&self) -> Result<TransactionId, AppError> {
        let tx = self.pool.begin().await
            .map_err(|e| AppError::Database(format!("Failed to begin transaction: {}", e)))?;
        
        let tx_id = Uuid::new_v4().to_string();
        
        // Store transaction in static lifetime by leaking it
        let static_tx = unsafe {
            std::mem::transmute::<
                sqlx::Transaction<'_, sqlx::Sqlite>,
                sqlx::Transaction<'static, sqlx::Sqlite>
            >(tx)
        };
        
        self.transactions.lock().await.insert(tx_id.clone(), static_tx);
        
        Ok(tx_id)
    }

    async fn commit(&self, tx_id: TransactionId) -> Result<(), AppError> {
        let tx = self.transactions.lock().await.remove(&tx_id)
            .ok_or_else(|| AppError::Database("Transaction not found".to_string()))?;
        
        tx.commit().await
            .map_err(|e| AppError::Database(format!("Failed to commit transaction: {}", e)))?;
        
        Ok(())
    }

    async fn rollback(&self, tx_id: TransactionId) -> Result<(), AppError> {
        let tx = self.transactions.lock().await.remove(&tx_id)
            .ok_or_else(|| AppError::Database("Transaction not found".to_string()))?;
        
        tx.rollback().await
            .map_err(|e| AppError::Database(format!("Failed to rollback transaction: {}", e)))?;
        
        Ok(())
    }

    async fn server_version(&self) -> Result<String, AppError> {
        self.get_sqlite_version().await
    }

    async fn read_table_data(&self, request: TableReadRequest) -> Result<(TableDataResponse, Option<String>), AppError> {
        let table = &request.table;
        
        // Build SELECT clause
        let select_clause = if let Some(ref cols) = request.select {
            cols.iter()
                .map(|c| format!("\"{}\"", c))
                .collect::<Vec<_>>()
                .join(", ")
        } else {
            "*".to_string()
        };
        
        // Build WHERE clause from filters
        let mut where_conditions = Vec::new();
        let mut bind_values: Vec<Value> = Vec::new();
        
        for filter in &request.filters {
            let col = format!("\"{}\"", filter.column);
            match filter.operator {
                FilterOperator::Equal => {
                    where_conditions.push(format!("{} = ?", col));
                    bind_values.push(filter.value.clone());
                }
                FilterOperator::NotEqual => {
                    where_conditions.push(format!("{} != ?", col));
                    bind_values.push(filter.value.clone());
                }
                FilterOperator::LessThan => {
                    where_conditions.push(format!("{} < ?", col));
                    bind_values.push(filter.value.clone());
                }
                FilterOperator::LessThanOrEqual => {
                    where_conditions.push(format!("{} <= ?", col));
                    bind_values.push(filter.value.clone());
                }
                FilterOperator::GreaterThan => {
                    where_conditions.push(format!("{} > ?", col));
                    bind_values.push(filter.value.clone());
                }
                FilterOperator::GreaterThanOrEqual => {
                    where_conditions.push(format!("{} >= ?", col));
                    bind_values.push(filter.value.clone());
                }
                FilterOperator::Like => {
                    where_conditions.push(format!("{} LIKE ?", col));
                    bind_values.push(filter.value.clone());
                }
                FilterOperator::ILike => {
                    // SQLite LIKE is case-insensitive by default
                    where_conditions.push(format!("{} LIKE ?", col));
                    bind_values.push(filter.value.clone());
                }
                FilterOperator::In => {
                    if let Value::Array(arr) = &filter.value {
                        let placeholders = vec!["?"; arr.len()].join(", ");
                        where_conditions.push(format!("{} IN ({})", col, placeholders));
                        for v in arr {
                            bind_values.push(v.clone());
                        }
                    }
                }
                FilterOperator::IsNull => {
                    where_conditions.push(format!("{} IS NULL", col));
                }
                FilterOperator::IsNotNull => {
                    where_conditions.push(format!("{} IS NOT NULL", col));
                }
                FilterOperator::Between => {
                    if let Value::Array(arr) = &filter.value {
                        if arr.len() == 2 {
                            where_conditions.push(format!("{} BETWEEN ? AND ?", col));
                            bind_values.push(arr[0].clone());
                            bind_values.push(arr[1].clone());
                        }
                    }
                }
            }
        }
        
        // Add search condition if provided
        if let Some(ref search) = request.search {
            // Get all text columns for search
            let columns = self.table_columns("", "", table).await?;
            let text_columns: Vec<String> = columns
                .iter()
                .filter(|c| {
                    let upper_type = c.db_type.to_uppercase();
                    upper_type.contains("TEXT") || upper_type.contains("VARCHAR") || upper_type.contains("CHAR")
                })
                .map(|c| format!("\"{}\" LIKE ?", c.name))
                .collect();
            
            if !text_columns.is_empty() {
                let search_condition = format!("({})", text_columns.join(" OR "));
                where_conditions.push(search_condition);
                for _ in 0..text_columns.len() {
                    bind_values.push(Value::String(format!("%{}%", search)));
                }
            }
        }
        
        let where_clause = if where_conditions.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", where_conditions.join(" AND "))
        };
        
        // Build ORDER BY clause
        let order_clause = if request.sorts.is_empty() {
            String::new()
        } else {
            let sorts: Vec<String> = request.sorts
                .iter()
                .map(|s| format!("\"{}\" {}", s.column, match s.direction {
                    SortDirection::Asc => "ASC",
                    SortDirection::Desc => "DESC",
                }))
                .collect();
            format!(" ORDER BY {}", sorts.join(", "))
        };
        
        // Handle pagination
        let (limit_clause, offset) = match request.pagination {
            PaginationMode::Offset { offset, limit } => {
                (format!(" LIMIT {}", limit), offset)
            }
            PaginationMode::Cursor { cursor: _ } => {
                // For simplicity, use offset pagination
                (" LIMIT 100".to_string(), 0)
            }
        };
        
        let offset_clause = if offset > 0 {
            format!(" OFFSET {}", offset)
        } else {
            String::new()
        };
        
        // Build final query
        let query_sql = format!(
            "SELECT {} FROM \"{}\"{}{}{}{}",
            select_clause, table, where_clause, order_clause, limit_clause, offset_clause
        );
        
        // Execute query
        let mut query = sqlx::query(&query_sql);
        for value in bind_values {
            match value {
                Value::Null => query = query.bind(None::<String>),
                Value::Bool(b) => query = query.bind(b),
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        query = query.bind(i);
                    } else if let Some(f) = n.as_f64() {
                        query = query.bind(f);
                    }
                }
                Value::String(s) => query = query.bind(s),
                _ => query = query.bind(value.to_string()),
            }
        }
        
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("Failed to read table data: {}", e)))?;
        
        if rows.is_empty() {
            // Return metadata only
            let columns = self.table_columns("", "", table).await?;
            let selected = request.select.clone().unwrap_or_else(|| {
                columns.iter().map(|c| c.name.clone()).collect()
            });
            
            return Ok((
                TableDataResponse::Meta {
                    table: table.clone(),
                    schema: Some("main".to_string()),
                    columns,
                    selected,
                    page_size: 100,
                    cursor_key_columns: Vec::new(),
                },
                None
            ));
        }
        
        // Convert rows to HashMap format
        let first_row = &rows[0];
        let column_names: Vec<String> = first_row.columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect();
        
        let mut result_rows = Vec::new();
        for row in rows {
            let mut row_map = HashMap::new();
            let cells = Self::row_to_cell_values(&row);
            for (i, cell) in cells.into_iter().enumerate() {
                row_map.insert(column_names[i].clone(), cell);
            }
            result_rows.push(row_map);
        }
        
        Ok((
            TableDataResponse::Rows {
                rows: result_rows,
                next_cursor: None,
            },
            None
        ))
    }
}

#[cfg(test)]
#[path = "sqlite_test.rs"]
mod tests;