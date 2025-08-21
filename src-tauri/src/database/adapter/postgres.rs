use async_trait::async_trait;
use sqlx::{postgres::PgPool, Row, Column};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::AppError;
use super::types::*;

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
    
    fn row_to_json_values(&self, row: &sqlx::postgres::PgRow) -> Vec<serde_json::Value> {
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
                table_schema AS schema,
                table_name AS name,
                table_type AS kind,
                COALESCE(n_live_tup, 0) AS row_estimate,
                0::BIGINT AS size_bytes
            FROM information_schema.tables t
            LEFT JOIN pg_stat_user_tables s ON s.schemaname = t.table_schema AND s.relname = t.table_name
            WHERE table_schema = $1
            AND table_type IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')
            ORDER BY table_type, table_name
        "#;
        
        let mut tables = Vec::new();
        let rows = sqlx::query(sql)
            .bind(schema)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        for row in rows {
            let table_type: String = row.get("kind");
            let kind = match table_type.as_str() {
                "BASE TABLE" => DbObjectKind::Table,
                "VIEW" => DbObjectKind::View,
                "MATERIALIZED VIEW" => DbObjectKind::View,
                _ => DbObjectKind::Table,
            };
            
            tables.push(TableMeta {
                schema: row.get("schema"),
                name: row.get("name"),
                kind,
                row_estimate: row.get::<Option<i64>, _>("row_estimate"),
                size_bytes: row.get::<Option<i64>, _>("size_bytes"),
            });
        }
        
        Ok(tables)
    }

    async fn list_functions(&self, _database: &str, schema: &str) 
        -> Result<Vec<FunctionMeta>, AppError> {
        let sql = r#"
            SELECT 
                n.nspname as schema,
                p.proname as name,
                pg_catalog.pg_get_function_result(p.oid) as return_type,
                pg_catalog.pg_get_function_arguments(p.oid) as arguments
            FROM pg_catalog.pg_proc p
            LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1
            AND pg_catalog.pg_function_is_visible(p.oid)
            ORDER BY n.nspname, p.proname
        "#;
        
        let mut functions = Vec::new();
        let rows = sqlx::query(sql)
            .bind(schema)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(AppError::from_sqlx)?;
        
        for row in rows {
            let args_str: Option<String> = row.get("arguments");
            let arguments = if let Some(args) = args_str {
                vec![args]
            } else {
                Vec::new()
            };
            
            functions.push(FunctionMeta {
                schema: row.get("schema"),
                name: row.get("name"),
                return_type: row.get::<Option<String>, _>("return_type").unwrap_or_else(|| "void".to_string()),
                arguments,
            });
        }
        
        Ok(functions)
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
        
        // Remove trailing semicolons and whitespace
        let clean_sql = sql.trim_end_matches(';').trim();
        
        println!("[PostgresAdapter::begin_query] Starting query execution");
        println!("[PostgresAdapter::begin_query] Original SQL: {}", sql);
        println!("[PostgresAdapter::begin_query] Cleaned SQL: {}", clean_sql);
        println!("[PostgresAdapter::begin_query] Options: page_size={}, max_rows={:?}", opts.page_size, opts.max_rows);
        
        // For simple queries, just execute directly
        let rows = sqlx::query(clean_sql)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                println!("[PostgresAdapter::begin_query] SQL execution error: {}", e);
                println!("[PostgresAdapter::begin_query] Failed SQL was: {}", clean_sql);
                AppError::from_sqlx(e)
            })?;
        
        let columns = if !rows.is_empty() {
            Self::extract_columns(&rows[0])
        } else {
            Vec::new()
        };
        
        let mut json_rows = Vec::new();
        for row in rows.iter().take(opts.page_size) {
            json_rows.push(self.row_to_json_values(&row));
        }
        
        let is_complete = rows.len() <= opts.page_size;
        
        Ok(QueryCursor {
            id: cursor_id,
            sql: clean_sql.to_string(),  // Store the cleaned SQL without semicolons
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
        println!("[PostgresAdapter::fetch_page] Original query: {}", cursor.sql);
        println!("[PostgresAdapter::fetch_page] Page: {}, Page size: {}", page, page_size);
        
        // Remove trailing semicolons and whitespace
        let clean_sql = cursor.sql.trim_end_matches(';').trim();
        println!("[PostgresAdapter::fetch_page] Cleaned query (semicolons removed): {}", clean_sql);
        
        // Check if the query already has LIMIT/OFFSET or is an aggregate query
        let sql_upper = clean_sql.to_uppercase();
        // Remove extra whitespace for better matching
        let sql_normalized = sql_upper.split_whitespace().collect::<Vec<_>>().join(" ");
        
        println!("[PostgresAdapter::fetch_page] Normalized query for checking: {}", sql_normalized);
        
        let needs_pagination = !sql_normalized.contains("LIMIT") && 
                               !sql_normalized.contains("COUNT(") &&
                               !sql_normalized.contains("SUM(") &&
                               !sql_normalized.contains("AVG(") &&
                               !sql_normalized.contains("MAX(") &&
                               !sql_normalized.contains("MIN(");
        
        println!("[PostgresAdapter::fetch_page] Needs pagination: {}", needs_pagination);
        
        let sql = if needs_pagination {
            // Simple pagination using LIMIT/OFFSET
            let offset = page * page_size;
            let paginated_sql = format!("{} LIMIT {} OFFSET {}", clean_sql, page_size, offset);
            println!("[PostgresAdapter::fetch_page] Adding pagination - Final SQL: {}", paginated_sql);
            paginated_sql
        } else {
            // Query already has pagination or is an aggregate, use as-is
            println!("[PostgresAdapter::fetch_page] Using query as-is (already has LIMIT or is aggregate)");
            clean_sql.to_string()
        };
        
        println!("[PostgresAdapter::fetch_page] Executing SQL: {}", sql);
        
        let rows = sqlx::query(&sql)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                println!("[PostgresAdapter::fetch_page] SQL execution error: {}", e);
                println!("[PostgresAdapter::fetch_page] Failed SQL was: {}", sql);
                AppError::from_sqlx(e)
            })?;
        
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
    
    async fn close_cursor(&self, cursor_id: &str) -> Result<(), AppError> {
        self.cursors.write().await.remove(cursor_id);
        Ok(())
    }
    
    async fn execute(&self, sql: &str, _params: Option<Vec<serde_json::Value>>) 
        -> Result<ExecuteResult, AppError> {
        let start = Instant::now();
        
        // Remove trailing semicolons and whitespace
        let clean_sql = sql.trim_end_matches(';').trim();
        
        println!("[PostgresAdapter::execute] Original SQL: {}", sql);
        println!("[PostgresAdapter::execute] Cleaned SQL: {}", clean_sql);
        
        let result = sqlx::query(clean_sql)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                println!("[PostgresAdapter::execute] SQL execution error: {}", e);
                println!("[PostgresAdapter::execute] Failed SQL was: {}", clean_sql);
                AppError::from_sqlx(e)
            })?;
        
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