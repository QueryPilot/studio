use async_trait::async_trait;
use sqlx::{postgres::PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::database::types::*;
use crate::error::AppError;

use super::DbAdapter;

pub struct PostgresCursor {
    pub cursor_name: String,
    pub page_size: usize,
    pub rows_fetched: usize,
}

pub struct PostgresAdapter {
    pool: Arc<PgPool>,
    cursors: Arc<RwLock<HashMap<String, PostgresCursor>>>,
}

impl PostgresAdapter {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool: Arc::new(pool),
            cursors: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    fn extract_columns(row: &sqlx::postgres::PgRow) -> Vec<ColumnMeta> {
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
    
    fn row_to_json_values(row: sqlx::postgres::PgRow) -> Vec<serde_json::Value> {
        let mut values = Vec::new();
        
        for (i, _column) in row.columns().iter().enumerate() {
            let value = if let Ok(val) = row.try_get::<Option<String>, _>(i) {
                val.map(serde_json::Value::String)
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<i32>, _>(i) {
                val.map(|v| serde_json::Value::Number(v.into()))
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<i64>, _>(i) {
                val.map(|v| serde_json::Value::Number(v.into()))
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<f64>, _>(i) {
                val.and_then(|v| serde_json::Number::from_f64(v))
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(val) = row.try_get::<Option<bool>, _>(i) {
                val.map(serde_json::Value::Bool)
                    .unwrap_or(serde_json::Value::Null)
            } else {
                // Fallback to string representation
                if let Ok(val) = row.try_get_raw(i) {
                    if val.is_null() {
                        serde_json::Value::Null
                    } else {
                        serde_json::Value::String(format!("{:?}", val))
                    }
                } else {
                    serde_json::Value::Null
                }
            };
            
            values.push(value);
        }
        
        values
    }
}

#[async_trait]
impl DbAdapter for PostgresAdapter {
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
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname"
        )
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(AppError::from_sqlx)?;
        
        Ok(rows)
    }
    
    async fn list_schemas(&self, _database: &str) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT schema_name FROM information_schema.schemata 
             WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
             ORDER BY schema_name"
        )
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(AppError::from_sqlx)?;
        
        Ok(rows)
    }
    
    async fn list_tables(&self, _database: &str, schema: &str) 
        -> Result<Vec<TableMeta>, AppError> {
        let sql = r#"
            SELECT 
                schemaname AS schema,
                tablename AS name,
                'table' AS kind,
                n_live_tup AS row_estimate,
                pg_relation_size(schemaname||'.'||tablename) as size_bytes
            FROM pg_stat_user_tables
            WHERE schemaname = $1
            UNION ALL
            SELECT 
                schemaname, viewname, 'view', NULL, 0
            FROM pg_views
            WHERE schemaname = $1
            ORDER BY kind, name
        "#;
        
        let mut tables = Vec::new();
        let rows = sqlx::query(sql)
            .bind(schema)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        for row in rows {
            let kind = match row.get::<String, _>("kind").as_str() {
                "table" => DbObjectKind::Table,
                "view" => DbObjectKind::View,
                _ => DbObjectKind::Table,
            };
            
            tables.push(TableMeta {
                schema: row.get("schema"),
                name: row.get("name"),
                kind,
                row_estimate: row.get("row_estimate"),
                size_bytes: row.get("size_bytes"),
            });
        }
        
        Ok(tables)
    }
    
    async fn table_columns(&self, _database: &str, schema: &str, table: &str) 
        -> Result<Vec<ColumnMeta>, AppError> {
        let sql = r#"
            SELECT 
                c.column_name,
                c.data_type,
                c.is_nullable = 'YES' AS nullable,
                c.column_default AS default_value,
                EXISTS(
                    SELECT 1 FROM information_schema.key_column_usage k
                    JOIN information_schema.table_constraints tc 
                    ON k.constraint_name = tc.constraint_name
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                    AND k.table_schema = c.table_schema
                    AND k.table_name = c.table_name
                    AND k.column_name = c.column_name
                ) AS is_pk,
                c.ordinal_position
            FROM information_schema.columns c
            WHERE c.table_schema = $1 AND c.table_name = $2
            ORDER BY c.ordinal_position
        "#;
        
        let mut columns = Vec::new();
        let rows = sqlx::query(sql)
            .bind(schema)
            .bind(table)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        for row in rows {
            columns.push(ColumnMeta {
                name: row.get("column_name"),
                db_type: row.get("data_type"),
                nullable: row.get("nullable"),
                default: row.get("default_value"),
                is_pk: row.get("is_pk"),
                is_fk: false,
                ordinal: row.get::<i32, _>("ordinal_position"),
                precision: None,
                scale: None,
            });
        }
        
        Ok(columns)
    }
    
    async fn estimate_count(&self, _database: &str, schema: &str, table: &str) 
        -> Result<i64, AppError> {
        let sql = "SELECT reltuples::BIGINT AS estimate FROM pg_class WHERE oid = ($1||'.'||$2)::regclass";
        
        let count: i64 = sqlx::query_scalar(sql)
            .bind(schema)
            .bind(table)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        Ok(count)
    }
    
    async fn begin_query(&self, sql: &str, _params: Option<Vec<serde_json::Value>>, 
                         opts: QueryOptions) -> Result<QueryCursor, AppError> {
        let cursor_id = Uuid::new_v4().to_string();
        
        // For simple queries, just execute directly
        let rows = sqlx::query(sql)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        let columns = if !rows.is_empty() {
            Self::extract_columns(&rows[0])
        } else {
            Vec::new()
        };
        
        let mut json_rows = Vec::new();
        for row in rows.iter().take(opts.page_size) {
            json_rows.push(Self::row_to_json_values(row.clone()));
        }
        
        let is_complete = rows.len() <= opts.page_size;
        
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
        // Simple pagination using LIMIT/OFFSET
        let offset = page * page_size;
        let sql = format!("{} LIMIT {} OFFSET {}", cursor.sql, page_size, offset);
        
        let rows = sqlx::query(&sql)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        let mut json_rows = Vec::new();
        for row in rows.iter() {
            json_rows.push(Self::row_to_json_values(row.clone()));
        }
        
        let is_complete = rows.len() < page_size;
        
        Ok(QueryPage {
            rows: json_rows,
            page,
            is_complete,
        })
    }
    
    async fn close_cursor(&self, cursor_id: &str) -> Result<(), AppError> {
        self.cursors.write().await.remove(cursor_id);
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
            last_insert_id: None,
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
        let version: String = sqlx::query_scalar("SELECT version()")
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        Ok(version)
    }
}