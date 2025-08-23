use async_trait::async_trait;
use sqlx::{mysql::MySqlPool, Row, Column};
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::error::AppError;
use super::types::*;

use super::DbAdapter;

pub struct MySqlAdapter {
    pool: Arc<MySqlPool>,
    is_mariadb: bool,
    server_version: Option<String>,
}

impl MySqlAdapter {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            pool: Arc::new(pool),
            is_mariadb: false,
            server_version: None,
        }
    }
    
    pub fn set_is_mariadb(&mut self, is_mariadb: bool) {
        self.is_mariadb = is_mariadb;
    }
    
    async fn detect_mariadb(&mut self) -> Result<bool, AppError> {
        let version = self.server_version().await?;
        self.server_version = Some(version.clone());
        let is_mariadb = version.to_lowercase().contains("mariadb");
        self.is_mariadb = is_mariadb;
        Ok(is_mariadb)
    }
    
    fn extract_columns(row: &sqlx::mysql::MySqlRow) -> Vec<ColumnMeta> {
        let mut columns = Vec::new();
        
        for (i, column) in row.columns().iter().enumerate() {
            let type_str = format!("{:?}", column.type_info());
            let is_json = type_str.to_lowercase().contains("json");
            
            columns.push(ColumnMeta {
                name: column.name().to_string(),
                db_type: type_str,
                nullable: true,
                default: None,
                is_pk: false,
                is_fk: false,
                ordinal: i as i32,
                precision: None,
                scale: None,
                // MSSQL specific - all None for MySQL
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                // MySQL/MariaDB specific
                is_json: Some(is_json),
                enum_values: None,
                set_values: None,
                is_virtual: None,
            });
        }
        
        columns
    }
    
    fn row_to_json_values(&self, row: &sqlx::mysql::MySqlRow) -> Vec<serde_json::Value> {
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
impl DbAdapter for MySqlAdapter {
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
        let rows = sqlx::query_scalar::<_, String>("SHOW DATABASES")
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        // Filter out system databases
        let filtered: Vec<String> = rows.into_iter()
            .filter(|db| !matches!(db.as_str(), 
                "information_schema" | "performance_schema" | "mysql" | "sys"))
            .collect();
        
        Ok(filtered)
    }
    
    async fn list_schemas(&self, database: &str) -> Result<Vec<String>, AppError> {
        // MySQL uses databases as schemas
        Ok(vec![database.to_string()])
    }
    
    async fn list_tables(&self, database: &str, _schema: &str) 
        -> Result<Vec<TableMeta>, AppError> {
        println!("[MySqlAdapter::list_tables] Called with database: '{}', schema: '{}'", database, _schema);
        
        // If database is empty, get the current database
        let db_name = if database.is_empty() {
            println!("[MySqlAdapter::list_tables] Database is empty, getting current database...");
            let current_db: Option<String> = sqlx::query_scalar("SELECT DATABASE()")
                .fetch_one(self.pool.as_ref())
                .await
                .map_err(|e| {
                    println!("[MySqlAdapter::list_tables] ERROR getting current database: {}", e);
                    AppError::from_sqlx(e)
                })?;
            
            let db = current_db.ok_or_else(|| {
                println!("[MySqlAdapter::list_tables] ERROR: No database selected");
                AppError::Database("No database selected".to_string())
            })?;
            println!("[MySqlAdapter::list_tables] Current database: {}", db);
            db
        } else {
            println!("[MySqlAdapter::list_tables] Using provided database: {}", database);
            database.to_string()
        };
        
        let sql = r#"
            SELECT 
                TABLE_NAME AS name,
                TABLE_TYPE AS kind,
                TABLE_ROWS AS row_estimate,
                DATA_LENGTH + INDEX_LENGTH AS size_bytes
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = ? 
            AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
            ORDER BY TABLE_TYPE, TABLE_NAME
        "#;
        
        println!("[MySqlAdapter::list_tables] Executing query with db_name: {}", db_name);
        let mut tables = Vec::new();
        let rows = sqlx::query(sql)
            .bind(&db_name)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                println!("[MySqlAdapter::list_tables] ERROR executing query: {}", e);
                AppError::from_sqlx(e)
            })?;
        
        println!("[MySqlAdapter::list_tables] Query returned {} rows", rows.len());
        
        for row in rows {
            // MySQL returns these as BINARY/VARBINARY, need to handle them properly
            let kind_bytes: Vec<u8> = row.get("kind");
            let kind_str = String::from_utf8_lossy(&kind_bytes);
            let kind = match kind_str.trim() {
                "BASE TABLE" => DbObjectKind::Table,
                "VIEW" => DbObjectKind::View,
                _ => DbObjectKind::Table,
            };
            
            // Handle name which might be VARBINARY
            let name = if let Ok(bytes) = row.try_get::<Vec<u8>, _>("name") {
                String::from_utf8_lossy(&bytes).trim().to_string()
            } else {
                row.get::<String, _>("name")
            };
            
            // Handle row_estimate which is BIGINT UNSIGNED
            let row_estimate = row.try_get::<Option<u64>, _>("row_estimate")
                .ok()
                .flatten()
                .map(|v| v as i64);
            
            // Handle size_bytes which might also be BIGINT UNSIGNED
            let size_bytes = row.try_get::<Option<u64>, _>("size_bytes")
                .ok()
                .flatten()
                .map(|v| v as i64);
            
            tables.push(TableMeta {
                schema: db_name.clone(),
                name,
                kind,
                row_estimate,
                size_bytes,
            });
        }
        
        Ok(tables)
    }

    async fn list_functions(&self, database: &str, _schema: &str) 
        -> Result<Vec<FunctionMeta>, AppError> {
        // If database is empty, get the current database
        let db_name = if database.is_empty() {
            let current_db: Option<String> = sqlx::query_scalar("SELECT DATABASE()")
                .fetch_one(self.pool.as_ref())
                .await
                .map_err(AppError::from_sqlx)?;
            
            current_db.ok_or_else(|| AppError::Database("No database selected".to_string()))?
        } else {
            database.to_string()
        };
        
        let sql = r#"
            SELECT 
                ROUTINE_NAME AS name,
                ROUTINE_TYPE AS type,
                DATA_TYPE AS return_type,
                ROUTINE_DEFINITION AS definition
            FROM information_schema.ROUTINES
            WHERE ROUTINE_SCHEMA = ?
            AND ROUTINE_TYPE IN ('FUNCTION', 'PROCEDURE')
            ORDER BY ROUTINE_NAME
        "#;
        
        let mut functions = Vec::new();
        let rows = sqlx::query(sql)
            .bind(&db_name)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        for row in rows {
            // Handle name which might be VARBINARY
            let name = if let Ok(bytes) = row.try_get::<Vec<u8>, _>("name") {
                String::from_utf8_lossy(&bytes).trim().to_string()
            } else {
                row.get::<String, _>("name")
            };
            
            // Handle return_type which might be BLOB or NULL
            let return_type = if let Ok(bytes) = row.try_get::<Vec<u8>, _>("return_type") {
                String::from_utf8_lossy(&bytes).trim().to_string()
            } else if let Ok(s) = row.try_get::<Option<String>, _>("return_type") {
                s.unwrap_or_else(|| "void".to_string())
            } else {
                "void".to_string()
            };
            
            functions.push(FunctionMeta {
                schema: db_name.clone(),
                name,
                return_type,
                arguments: Vec::new(), // MySQL doesn't easily expose arguments
            });
        }
        
        Ok(functions)
    }
    
    async fn table_columns(&self, database: &str, _schema: &str, table: &str) 
        -> Result<Vec<ColumnMeta>, AppError> {
        let sql = r#"
            SELECT 
                COLUMN_NAME AS name,
                DATA_TYPE AS db_type,
                COLUMN_TYPE AS full_type,
                IS_NULLABLE = 'YES' AS nullable,
                COLUMN_DEFAULT AS default_value,
                COLUMN_KEY = 'PRI' AS is_pk,
                ORDINAL_POSITION AS ordinal,
                NUMERIC_PRECISION AS `precision`,
                NUMERIC_SCALE AS `scale`,
                EXTRA AS extra,
                GENERATION_EXPRESSION AS generation_expr
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
        "#;
        
        let mut columns = Vec::new();
        let rows = sqlx::query(sql)
            .bind(database)
            .bind(table)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        for row in rows {
            // Handle potential BLOB columns by trying to get as String first, then as bytes
            let db_type: String = row.try_get::<String, _>("db_type")
                .or_else(|_| {
                    // If it's a BLOB, try to convert from bytes
                    row.try_get::<Option<Vec<u8>>, _>("db_type")
                        .map(|bytes_opt| {
                            bytes_opt.map(|b| String::from_utf8_lossy(&b).to_string())
                                .unwrap_or_else(|| "unknown".to_string())
                        })
                })
                .unwrap_or_else(|_| "unknown".to_string());
            
            let full_type: String = row.try_get::<String, _>("full_type")
                .or_else(|_| {
                    row.try_get::<Option<Vec<u8>>, _>("full_type")
                        .map(|bytes_opt| {
                            bytes_opt.map(|b| String::from_utf8_lossy(&b).to_string())
                                .unwrap_or_else(|| db_type.clone())
                        })
                })
                .unwrap_or_else(|_| db_type.clone());
            
            let extra: String = row.try_get::<String, _>("extra")
                .or_else(|_| {
                    row.try_get::<Option<String>, _>("extra")
                        .map(|opt| opt.unwrap_or_default())
                })
                .or_else(|_| {
                    row.try_get::<Option<Vec<u8>>, _>("extra")
                        .map(|bytes_opt| {
                            bytes_opt.map(|b| String::from_utf8_lossy(&b).to_string())
                                .unwrap_or_default()
                        })
                })
                .unwrap_or_default();
            
            // Parse enum/set values from full_type
            let (enum_values, set_values) = if full_type.starts_with("enum(") {
                let vals = full_type
                    .trim_start_matches("enum(")
                    .trim_end_matches(")")
                    .split(',')
                    .map(|s| s.trim().trim_matches('\'').to_string())
                    .collect();
                (Some(vals), None)
            } else if full_type.starts_with("set(") {
                let vals = full_type
                    .trim_start_matches("set(")
                    .trim_end_matches(")")
                    .split(',')
                    .map(|s| s.trim().trim_matches('\'').to_string())
                    .collect();
                (None, Some(vals))
            } else {
                (None, None)
            };
            
            columns.push(ColumnMeta {
                name: row.get("name"),
                db_type: db_type.clone(),
                nullable: row.get("nullable"),
                default: row.get("default_value"),
                is_pk: row.get("is_pk"),
                is_fk: false,
                ordinal: row.get::<i32, _>("ordinal"),
                precision: row.get("precision"),
                scale: row.get("scale"),
                // MSSQL specific - all None for MySQL
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                // MySQL/MariaDB specific
                is_json: Some(db_type.to_lowercase() == "json"),
                enum_values,
                set_values,
                is_virtual: Some(extra.contains("VIRTUAL") || extra.contains("STORED")),
            });
        }
        
        Ok(columns)
    }
    
    async fn estimate_count(&self, database: &str, _schema: &str, table: &str) 
        -> Result<i64, AppError> {
        let sql = format!("SELECT COUNT(*) FROM `{}`.`{}`", database, table);
        
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
            json_rows.push(self.row_to_json_values(&row));
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
            json_rows.push(self.row_to_json_values(&row));
        }
        
        let is_complete = rows.len() < page_size;
        
        Ok(QueryPage {
            rows: json_rows,
            page,
            is_complete,
        })
    }
    
    async fn close_cursor(&self, _cursor_id: &str) -> Result<(), AppError> {
        // No-op for MySQL as we're not using server-side cursors
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
            last_insert_id: Some(result.last_insert_id().to_string()),
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
        let version: String = sqlx::query_scalar("SELECT VERSION()")
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        Ok(version)
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
                .map(|c| format!("`{}`", c))
                .collect();
            sql.push_str(&quoted_cols.join(", "));
        } else {
            sql.push_str("*");
        }
        
        // FROM clause
        sql.push_str(" FROM ");
        if let Some(ref schema) = request.schema {
            sql.push_str(&format!("`{}`.`{}`", schema, request.table));
        } else {
            sql.push_str(&format!("`{}`", request.table));
        }
        
        // WHERE clause for filters
        let mut where_clauses = Vec::new();
        
        for filter in &request.filters {
            let column = format!("`{}`", filter.column);
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
                    // MySQL doesn't have ILIKE, use LOWER()
                    params.push(filter.value.clone());
                    format!("LOWER({}) LIKE LOWER(?)", column)
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
            let text_columns = self.get_text_columns(&request.schema, &request.table, &request.select).await?;
            
            if !text_columns.is_empty() {
                let search_clauses: Vec<String> = text_columns.iter()
                    .map(|col| {
                        params.push(serde_json::Value::String(format!("%{}%", search_text)));
                        format!("`{}` LIKE ?", col)
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
                    format!("`{}` {}", sort.column, dir)
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
        
        println!("[MySQL] Executing table read query: {}", sql);
        println!("[MySQL] Parameters: {:?}", params);
        
        // Execute query
        let mut query = sqlx::query(&sql);
        for param in &params {
            query = match param {
                serde_json::Value::String(s) => query.bind(s.clone()),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        query.bind(i as i32)
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
                println!("[MySQL] Query execution error: {}", e);
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

impl MySqlAdapter {
    fn extract_value_by_index(&self, row: &sqlx::mysql::MySqlRow, index: usize) -> serde_json::Value {
        use sqlx::Row;
        use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
        use sqlx::types::BigDecimal;
        
        // Try different types in order of likelihood
        if let Ok(val) = row.try_get::<Option<String>, _>(index) {
            val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<i32>, _>(index) {
            val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<i64>, _>(index) {
            val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<f64>, _>(index) {
            val.and_then(|v| serde_json::Number::from_f64(v))
               .map(serde_json::Value::Number)
               .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<bool>, _>(index) {
            val.map(serde_json::Value::Bool).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<DateTime<Utc>>, _>(index) {
            val.map(|dt| serde_json::Value::String(dt.to_rfc3339()))
               .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<NaiveDate>, _>(index) {
            val.map(|d| serde_json::Value::String(d.format("%Y-%m-%d").to_string()))
               .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<NaiveTime>, _>(index) {
            val.map(|t| serde_json::Value::String(t.format("%H:%M:%S%.f").to_string()))
               .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<BigDecimal>, _>(index) {
            val.map(|bd| serde_json::Value::String(bd.to_string()))
               .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<Vec<u8>>, _>(index) {
            val.map(|bytes| {
                use base64::{Engine as _, engine::general_purpose::STANDARD};
                serde_json::Value::String(STANDARD.encode(bytes))
            }).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<serde_json::Value>, _>(index) {
            val.unwrap_or(serde_json::Value::Null)
        } else {
            // Fallback to null for unsupported types
            serde_json::Value::Null
        }
    }
    
    async fn get_text_columns(&self, schema: &Option<String>, table: &str, select: &Option<Vec<String>>) 
        -> Result<Vec<String>, AppError> {
        // Query to find text-like columns
        let schema_name = schema.as_deref().unwrap_or("database()");
        let query = if schema.is_some() {
            r#"
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = ?
                  AND TABLE_NAME = ?
                  AND DATA_TYPE IN ('char', 'varchar', 'text', 'tinytext', 'mediumtext', 'longtext')
                ORDER BY ORDINAL_POSITION
                LIMIT 8
            "#
        } else {
            r#"
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = ?
                  AND DATA_TYPE IN ('char', 'varchar', 'text', 'tinytext', 'mediumtext', 'longtext')
                ORDER BY ORDINAL_POSITION
                LIMIT 8
            "#
        };
        
        let text_cols: Vec<String> = if let Some(schema) = schema {
            sqlx::query_scalar(query)
                .bind(schema)
                .bind(table)
                .fetch_all(self.pool.as_ref())
                .await
                .map_err(AppError::from_sqlx)?
        } else {
            sqlx::query_scalar(query)
                .bind(table)
                .fetch_all(self.pool.as_ref())
                .await
                .map_err(AppError::from_sqlx)?
        };
        
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