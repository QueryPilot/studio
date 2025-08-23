use async_trait::async_trait;
use sqlx::{sqlite::SqlitePool, Row, Column};
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::error::AppError;
use super::types::*;

use super::DbAdapter;

pub struct SqliteAdapter {
    pool: Arc<SqlitePool>,
}

impl SqliteAdapter {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool: Arc::new(pool),
        }
    }
    
    fn extract_columns(row: &sqlx::sqlite::SqliteRow) -> Vec<ColumnMeta> {
        let mut columns = Vec::new();
        
        for (i, column) in row.columns().iter().enumerate() {
            columns.push(ColumnMeta {
                name: column.name().to_string(),
                db_type: format!("{:?}", column.type_info()),
                nullable: true,
                default: None,
                is_pk: false,
                is_fk: false,
                ordinal: i as i32,
                precision: None,
                scale: None,
                // MSSQL specific - all None for SQLite
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                // MySQL/MariaDB specific - all None for SQLite
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
            });
        }
        
        columns
    }
    
    fn row_to_json_values(&self, row: &sqlx::sqlite::SqliteRow) -> Vec<serde_json::Value> {
        let mut values = Vec::new();
        
        for i in 0..row.columns().len() {
            // Try common types in order of likelihood
            let value = if let Ok(val) = row.try_get::<Option<String>, _>(i) {
                val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<i32>, _>(i) {
                val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<i64>, _>(i) {
                val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<f64>, _>(i) {
                val.and_then(|v| serde_json::Number::from_f64(v))
                   .map(serde_json::Value::Number)
                   .unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<bool>, _>(i) {
                val.map(serde_json::Value::Bool).unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<serde_json::Value>, _>(i) {
                val.unwrap_or(serde_json::Value::Null)
            } else {
                // Fallback to null for unsupported types
                serde_json::Value::Null
            };
            
            values.push(value);
        }
        
        values
    }
}

#[async_trait]
impl DbAdapter for SqliteAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    
    async fn ping(&self) -> Result<Duration, AppError> {
        let start = Instant::now();
        sqlx::query("SELECT 1")
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        Ok(start.elapsed())
    }
    
    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool.close().await;
        Ok(())
    }
    
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        // SQLite doesn't have multiple databases in the same connection
        Ok(vec!["main".to_string()])
    }
    
    async fn list_schemas(&self, _database: &str) -> Result<Vec<String>, AppError> {
        // SQLite doesn't have schemas
        Ok(vec!["main".to_string()])
    }
    
    async fn list_tables(&self, _database: &str, _schema: &str) 
        -> Result<Vec<TableMeta>, AppError> {
        let sql = r#"
            SELECT name, type 
            FROM sqlite_master 
            WHERE type IN ('table', 'view') 
            AND name NOT LIKE 'sqlite_%'
            ORDER BY type, name
        "#;
        
        let mut tables = Vec::new();
        let rows = sqlx::query(sql)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        for row in rows {
            let type_str: String = row.get("type");
            let kind = match type_str.as_str() {
                "table" => DbObjectKind::Table,
                "view" => DbObjectKind::View,
                _ => DbObjectKind::Table,
            };
            
            let name: String = row.get("name");
            
            // Get row count estimate
            let count_sql = format!("SELECT COUNT(*) FROM '{}'", name);
            let row_estimate: Option<i64> = sqlx::query_scalar(&count_sql)
                .fetch_one(self.pool.as_ref())
                .await
                .ok();
            
            tables.push(TableMeta {
                schema: "main".to_string(),
                name,
                kind,
                row_estimate,
                size_bytes: None,
            });
        }
        
        Ok(tables)
    }

    async fn list_functions(&self, _database: &str, _schema: &str) 
        -> Result<Vec<FunctionMeta>, AppError> {
        // SQLite doesn't have user-defined functions stored in the database
        // Return empty list
        Ok(Vec::new())
    }
    
    async fn table_columns(&self, _database: &str, _schema: &str, table: &str) 
        -> Result<Vec<ColumnMeta>, AppError> {
        let sql = format!("PRAGMA table_info('{}')", table);
        
        let mut columns = Vec::new();
        let rows = sqlx::query(&sql)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        for row in rows {
            columns.push(ColumnMeta {
                name: row.get("name"),
                db_type: row.get("type"),
                nullable: row.get::<i32, _>("notnull") == 0,
                default: row.get("dflt_value"),
                is_pk: row.get::<i32, _>("pk") > 0,
                is_fk: false,
                ordinal: row.get("cid"),
                precision: None,
                scale: None,
                // MSSQL specific - all None for SQLite
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                // MySQL/MariaDB specific - all None for SQLite
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
            });
        }
        
        Ok(columns)
    }
    
    async fn estimate_count(&self, _database: &str, _schema: &str, table: &str) 
        -> Result<i64, AppError> {
        let sql = format!("SELECT COUNT(*) FROM '{}'", table);
        
        let count: i64 = sqlx::query_scalar(&sql)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        Ok(count)
    }
    
    async fn begin_query(&self, sql: &str, _params: Option<Vec<serde_json::Value>>, 
                         opts: QueryOptions) -> Result<QueryCursor, AppError> {
        let cursor_id = Uuid::new_v4().to_string();
        
        // Execute query with limit
        let limited_sql = if opts.max_rows.is_some() || opts.page_size > 0 {
            format!("{} LIMIT {}", sql, opts.page_size)
        } else {
            sql.to_string()
        };
        
        let rows = sqlx::query(&limited_sql)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        let columns = if !rows.is_empty() {
            Self::extract_columns(&rows[0])
        } else {
            Vec::new()
        };
        
        let mut json_rows = Vec::new();
        for row in rows.iter() {
            json_rows.push(self.row_to_json_values(row));
        }
        
        let is_complete = rows.len() < opts.page_size;
        
        Ok(QueryCursor {
            id: cursor_id,
            sql: sql.to_string(),
            columns,
            rows: json_rows,
            page_size: opts.page_size,
            current_page: 0,
            total_rows: Some(rows.len()),
            is_complete,
            created_at: Some(Instant::now()),
        })
    }
    
    async fn fetch_page(&self, cursor: &mut QueryCursor, page: usize, 
                        page_size: usize) -> Result<QueryPage, AppError> {
        let offset = page * page_size;
        let sql = format!("{} LIMIT {} OFFSET {}", cursor.sql, page_size, offset);
        
        let rows = sqlx::query(&sql)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        let mut json_rows = Vec::new();
        for row in rows.iter() {
            json_rows.push(self.row_to_json_values(row));
        }
        
        let is_complete = rows.len() < page_size;
        
        Ok(QueryPage {
            rows: json_rows,
            page,
            is_complete,
        })
    }
    
    async fn close_cursor(&self, _cursor_id: &str) -> Result<(), AppError> {
        // No-op for SQLite as we're not using server-side cursors
        Ok(())
    }
    
    async fn execute(&self, sql: &str, _params: Option<Vec<serde_json::Value>>) 
        -> Result<ExecuteResult, AppError> {
        let start = Instant::now();
        
        let result = sqlx::query(sql)
            .execute(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        Ok(ExecuteResult {
            rows_affected: result.rows_affected(),
            last_insert_id: Some(result.last_insert_rowid().to_string()),
            execution_time_ms: start.elapsed().as_millis() as f64,
        })
    }
    
    async fn begin_transaction(&self) -> Result<TransactionId, AppError> {
        Err(AppError::Unsupported("Transactions not yet implemented".to_string()))
    }
    
    async fn commit(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        Err(AppError::Unsupported("Transactions not yet implemented".to_string()))
    }
    
    async fn rollback(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        Err(AppError::Unsupported("Transactions not yet implemented".to_string()))
    }
    
    async fn server_version(&self) -> Result<String, AppError> {
        let version: String = sqlx::query_scalar("SELECT sqlite_version()")
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        Ok(format!("SQLite {}", version))
    }
    
    async fn read_table_data(&self, request: TableReadRequest) 
        -> Result<(TableDataResponse, Option<String>), AppError> {
        use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
        
        // Build SQL query
        let mut sql = String::new();
        let mut params: Vec<serde_json::Value> = Vec::new();
        
        // SELECT clause
        sql.push_str("SELECT ");
        if let Some(ref columns) = request.select {
            let quoted_cols: Vec<String> = columns.iter()
                .map(|c| format!("\"{}\"", c))
                .collect();
            sql.push_str(&quoted_cols.join(", "));
        } else {
            sql.push_str("*");
        }
        
        // FROM clause  
        sql.push_str(" FROM ");
        // SQLite doesn't use schemas the same way
        sql.push_str(&format!("\"{}\"", request.table));
        
        // WHERE clause for filters
        let mut where_clauses = Vec::new();
        
        for filter in &request.filters {
            let column = format!("\"{}\"", filter.column);
            let clause = match filter.operator {
                FilterOperator::Equal => {
                    params.push(filter.value.clone());
                    format!("{} = ?", column)
                },
                FilterOperator::NotEqual => {
                    params.push(filter.value.clone());
                    format!("{} != ?", column)
                },
                FilterOperator::LessThan => {
                    params.push(filter.value.clone());
                    format!("{} < ?", column)
                },
                FilterOperator::LessThanOrEqual => {
                    params.push(filter.value.clone());
                    format!("{} <= ?", column)
                },
                FilterOperator::GreaterThan => {
                    params.push(filter.value.clone());
                    format!("{} > ?", column)
                },
                FilterOperator::GreaterThanOrEqual => {
                    params.push(filter.value.clone());
                    format!("{} >= ?", column)
                },
                FilterOperator::Like => {
                    params.push(filter.value.clone());
                    format!("{} LIKE ?", column)
                },
                FilterOperator::ILike => {
                    // SQLite LIKE is case-insensitive by default
                    params.push(filter.value.clone());
                    format!("{} LIKE ?", column)
                },
                FilterOperator::In => {
                    if let serde_json::Value::Array(values) = &filter.value {
                        let placeholders = vec!["?"; values.len()].join(", ");
                        for v in values {
                            params.push(v.clone());
                        }
                        format!("{} IN ({})", column, placeholders)
                    } else {
                        continue;
                    }
                },
                FilterOperator::IsNull => {
                    format!("{} IS NULL", column)
                },
                FilterOperator::IsNotNull => {
                    format!("{} IS NOT NULL", column)
                },
                FilterOperator::Between => {
                    if let serde_json::Value::Array(values) = &filter.value {
                        if values.len() == 2 {
                            params.push(values[0].clone());
                            params.push(values[1].clone());
                            format!("{} BETWEEN ? AND ?", column)
                        } else {
                            continue;
                        }
                    } else {
                        continue;
                    }
                },
            };
            
            where_clauses.push(clause);
        }
        
        // Add search conditions if provided
        if let Some(ref search_text) = request.search {
            // Get text-like columns for search
            let text_columns = self.get_text_columns(&request.table, &request.select).await?;
            
            if !text_columns.is_empty() {
                let search_clauses: Vec<String> = text_columns.iter()
                    .map(|col| {
                        params.push(serde_json::Value::String(format!("%{}%", search_text)));
                        format!("\"{}\" LIKE ?", col)
                    })
                    .collect();
                
                if !search_clauses.is_empty() {
                    where_clauses.push(format!("({})", search_clauses.join(" OR ")));
                }
            }
        }
        
        if !where_clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&where_clauses.join(" AND "));
        }
        
        // ORDER BY clause
        if !request.sorts.is_empty() {
            let order_clauses: Vec<String> = request.sorts.iter()
                .map(|sort| {
                    let dir = match sort.direction {
                        SortDirection::Asc => "ASC",
                        SortDirection::Desc => "DESC",
                    };
                    format!("\"{}\" {}", sort.column, dir)
                })
                .collect();
            sql.push_str(" ORDER BY ");
            sql.push_str(&order_clauses.join(", "));
        }
        
        // Pagination
        let (limit, offset) = match &request.pagination {
            PaginationMode::Offset { offset, limit } => (*limit, *offset),
            PaginationMode::Cursor { cursor } => {
                if let Some(cursor_str) = cursor {
                    // Decode cursor
                    if let Ok(decoded) = URL_SAFE_NO_PAD.decode(cursor_str) {
                        if let Ok(cursor_data) = serde_json::from_slice::<TableDataCursor>(&decoded) {
                            (100, cursor_data.offset)
                        } else {
                            (100, 0)
                        }
                    } else {
                        (100, 0)
                    }
                } else {
                    (100, 0)
                }
            }
        };
        
        sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));
        
        println!("[SQLite] Executing table read query: {}", sql);
        println!("[SQLite] Parameters: {:?}", params);
        
        // Execute query
        let mut query = sqlx::query(&sql);
        for param in &params {
            query = match param {
                serde_json::Value::String(s) => query.bind(s.clone()),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        query.bind(i)
                    } else if let Some(f) = n.as_f64() {
                        query.bind(f)
                    } else {
                        query
                    }
                },
                serde_json::Value::Bool(b) => query.bind(*b),
                serde_json::Value::Null => query.bind(Option::<String>::None),
                _ => query,
            };
        }
        
        let rows = query
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                println!("[SQLite] Query execution error: {}", e);
                AppError::from_sqlx(e)
            })?;
        
        // Convert rows to JSON objects
        let mut json_rows = Vec::new();
        for row in &rows {
            let mut json_row = serde_json::Map::new();
            
            if let Some(ref columns) = request.select {
                for (i, col_name) in columns.iter().enumerate() {
                    let value = self.extract_value_by_index(&row, i);
                    json_row.insert(col_name.clone(), value);
                }
            } else {
                // Extract all columns
                for (i, column) in row.columns().iter().enumerate() {
                    let col_name = column.name().to_string();
                    let value = self.extract_value_by_index(&row, i);
                    json_row.insert(col_name, value);
                }
            }
            
            json_rows.push(json_row);
        }
        
        // Generate next cursor if there might be more data
        let next_cursor = if rows.len() >= limit {
            let new_cursor = TableDataCursor {
                connection_id: String::new(),
                table: request.table.clone(),
                schema: request.schema.clone(),
                select: request.select.clone(),
                sorts: request.sorts.clone(),
                filters: request.filters.clone(),
                search: request.search.clone(),
                offset: offset + limit,
                keyset_values: None,
            };
            
            let cursor_json = serde_json::to_vec(&new_cursor)
                .map_err(|e| AppError::Serialization(e.to_string()))?;
            Some(URL_SAFE_NO_PAD.encode(&cursor_json))
        } else {
            None
        };
        
        let response = TableDataResponse::Rows {
            rows: json_rows,
            next_cursor: next_cursor.clone(),
        };
        
        Ok((response, next_cursor))
    }
}

impl SqliteAdapter {
    fn extract_value_by_index(&self, row: &sqlx::sqlite::SqliteRow, index: usize) -> serde_json::Value {
        use sqlx::Row;
        
        // SQLite has different type handling
        if let Ok(val) = row.try_get::<Option<String>, _>(index) {
            val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<i64>, _>(index) {
            val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<f64>, _>(index) {
            val.and_then(|v| serde_json::Number::from_f64(v))
               .map(serde_json::Value::Number)
               .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<bool>, _>(index) {
            val.map(serde_json::Value::Bool).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<Vec<u8>>, _>(index) {
            val.map(|bytes| {
                use base64::{Engine as _, engine::general_purpose::STANDARD};
                serde_json::Value::String(STANDARD.encode(bytes))
            }).unwrap_or(serde_json::Value::Null)
        } else {
            // Fallback to null for unsupported types
            serde_json::Value::Null
        }
    }
    
    async fn get_text_columns(&self, table: &str, select: &Option<Vec<String>>) 
        -> Result<Vec<String>, AppError> {
        // Query to find text-like columns
        let query = r#"
            SELECT name
            FROM pragma_table_info(?)
            WHERE type LIKE '%TEXT%' 
               OR type LIKE '%CHAR%'
               OR type LIKE '%CLOB%'
               OR type = ''
            ORDER BY cid
            LIMIT 8
        "#;
        
        let text_cols: Vec<String> = sqlx::query_scalar(query)
            .bind(table)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        // If select is specified, filter to only those columns
        if let Some(ref selected) = select {
            Ok(text_cols.into_iter()
                .filter(|col| selected.contains(col))
                .collect())
        } else {
            Ok(text_cols)
        }
    }
}