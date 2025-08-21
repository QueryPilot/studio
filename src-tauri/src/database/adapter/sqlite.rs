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
}