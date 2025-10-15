use dashmap::DashMap;
use deadpool_postgres::Pool;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;
use tokio_postgres::{Client, Statement};
use uuid::Uuid;

use super::fast_converter::FastPostgresConverter;
use super::types::PostgresTypeConverter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct FastPostgresQueryExecutor {
    pool: Pool,
    client: Option<Arc<Client>>, // Keep for backwards compatibility during migration
    active_queries: DashMap<String, QueryState>,
    /// DEPRECATED: Statement cache disabled for connection pooling compatibility
    /// Prepared statements are per-connection, so caching them globally causes
    /// "prepared statement does not exist" errors when different pool connections are used.
    #[allow(dead_code)]
    statement_cache: DashMap<String, Arc<Statement>>,
    /// Track concurrent pre-warming operations (rate limiting)
    prewarm_in_progress: AtomicUsize,
}

struct QueryState {
    #[allow(dead_code)]
    columns: Vec<ColumnMeta>,
    created_at: Instant,  // Used to track total execution time
    rows_fetched: usize,
    original_sql: String,
    cursor_name: String,
    execution_time_ms: Option<u64>,  // Track real DB execution time
}

impl FastPostgresQueryExecutor {
    #[allow(dead_code)]
    pub fn new(client: Arc<Client>) -> Self {
        // Legacy constructor - will be removed after full migration
        Self {
            pool: Pool::builder(deadpool_postgres::Manager::new(
                tokio_postgres::Config::new(),
                tokio_postgres::NoTls,
            )).max_size(1).build().unwrap(),
            client: Some(client),
            active_queries: DashMap::new(),
            statement_cache: DashMap::new(),
            prewarm_in_progress: AtomicUsize::new(0),
        }
    }

    pub fn new_with_pool(pool: Pool) -> Self {
        Self {
            pool,
            client: None,
            active_queries: DashMap::new(),
            statement_cache: DashMap::new(),
            prewarm_in_progress: AtomicUsize::new(0),
        }
    }

    /// Get connection from pool for each operation
    async fn get_connection(&self) -> Result<deadpool_postgres::Object> {
        self.pool.get().await
            .map_err(|e| AppError::Internal(format!("Failed to get connection from pool: {}", e)))
    }

    /// Clear the prepared statement cache (call after DDL operations)
    pub fn clear_statement_cache(&self) {
        self.statement_cache.clear();
    }

    /// Fast path: Execute query with single fetch (no cursor)
    /// Best for small result sets (<50k rows) - avoids cursor overhead
    pub async fn execute_single_fetch(&self, sql: &str) -> Result<(Vec<Vec<serde_json::Value>>, Vec<ColumnMeta>, u64)> {
        let query_start = Instant::now();

        // Get connection from pool
        let conn = self.get_connection().await?;
        
        // STEP 1: Prepare statement
        // NOTE: We can't cache statements with connection pooling because prepared
        // statements are per-connection. Each pool connection needs its own preparation.
        let stmt = Arc::new(conn.prepare(sql).await?);

        let columns = stmt
            .columns()
            .iter()
            .map(|col| ColumnMeta {
                name: col.name().to_string(),
                data_type: PostgresTypeConverter::type_to_cell_type(col.type_()),
                nullable: true,
                primary_key: false,
                db_type: col.type_().name().to_string(),
                type_oid: Some(col.type_().oid()),
                default_value: None,
                comment: None,
                enum_values: None,
                type_category: None,
            })
            .collect::<Vec<_>>();

        // STEP 2: Execute query with single fetch (no cursor, no transaction)
        let db_start = Instant::now();
        let conn = self.get_connection().await?;
        let rows = conn.query(stmt.as_ref(), &[]).await?;
        let db_time_ms = db_start.elapsed().as_millis() as u64;

        // STEP 3: Convert rows to JSON (direct, no CellValue overhead)
        let convert_start = Instant::now();
        let json_rows = FastPostgresConverter::rows_to_json(&rows)?;
        let convert_time_ms = convert_start.elapsed().as_millis() as u64;

        tracing::info!("  Postgres Query: {}ms", db_time_ms);
        tracing::info!("  Row→JSON Conversion: {}ms ({} rows × {} cols)", convert_time_ms, rows.len(), columns.len());

        // Measure total time including conversion (matches TablePlus measurement)
        let fetch_time_ms = query_start.elapsed().as_millis() as u64;

        Ok((json_rows, columns, fetch_time_ms))
    }

    /// TRUE streaming: Execute query and stream rows as they arrive (like TablePlus)
    /// Returns statement and columns, caller can then stream rows
    pub async fn prepare_streaming_query(&self, sql: &str) -> Result<(Arc<tokio_postgres::Statement>, Vec<ColumnMeta>)> {
        // Rate limiting: Limit concurrent preparations to 5
        let in_progress = self.prewarm_in_progress.fetch_add(1, Ordering::Relaxed);
        if in_progress >= 5 {
            self.prewarm_in_progress.fetch_sub(1, Ordering::Relaxed);
            tracing::warn!("Too many concurrent preparations ({}), skipping: {}", in_progress, sql);
            return Err(AppError::Internal("Too many concurrent statement preparations".to_string()));
        }

        // Prepare statement (no caching with connection pooling - statements are per-connection)
        let result = async {
            let conn = self.get_connection().await?;
            let stmt = Arc::new(conn.prepare(sql).await?);

            let columns = stmt
                .columns()
                .iter()
                .map(|col| ColumnMeta {
                    name: col.name().to_string(),
                    data_type: PostgresTypeConverter::type_to_cell_type(col.type_()),
                    nullable: true,
                    primary_key: false,
                    db_type: col.type_().name().to_string(),
                    type_oid: Some(col.type_().oid()),
                    default_value: None,
                    comment: None,
                    enum_values: None,
                    type_category: None,
                })
                .collect::<Vec<_>>();

            tracing::debug!("Prepared statement for streaming: {}", sql);
            Ok((stmt, columns))
        }.await;

        // Decrement counter
        self.prewarm_in_progress.fetch_sub(1, Ordering::Relaxed);
        result
    }

    /// Get the underlying pool for streaming queries
    pub fn get_pool(&self) -> Pool {
        self.pool.clone()
    }

    pub async fn open_query(&self, sql: &str) -> Result<QueryHandle> {
        let handle_id = Uuid::new_v4().to_string();
        let cursor_name = format!("cursor_{}", handle_id.replace("-", "_"));

        // Get connection from pool
        let conn = self.get_connection().await?;
        
        // STEP 1: Prepare statement (no caching with connection pooling)
        let stmt = Arc::new(conn.prepare(sql).await?);

        let columns = stmt
            .columns()
            .iter()
            .map(|col| ColumnMeta {
                name: col.name().to_string(),
                data_type: PostgresTypeConverter::type_to_cell_type(col.type_()),
                nullable: true,
                primary_key: false,
                db_type: col.type_().name().to_string(),
                type_oid: Some(col.type_().oid()),
                default_value: None,
                comment: None,
                enum_values: None,
                type_category: None,
            })
            .collect::<Vec<_>>();

        // STEP 2+3: BEGIN + DECLARE CURSOR in single batch (saves 1 round-trip = 400-700ms)
        let sql_trimmed = sql.trim().trim_end_matches(';');
        let batch_sql = format!(
            "BEGIN;\nDECLARE {} NO SCROLL CURSOR FOR {}",
            cursor_name, sql_trimmed
        );
        
        // If batch fails, try to rollback to clean up any partial transaction state
        let conn = self.get_connection().await?;
        if let Err(e) = conn.batch_execute(&batch_sql).await {
            // Attempt rollback to recover connection (ignore errors - connection might already be bad)
            let _ = conn.batch_execute("ROLLBACK").await;
            return Err(e.into());
        }

        let query_state = QueryState {
            columns: columns.clone(),
            created_at: Instant::now(),
            rows_fetched: 0,
            original_sql: sql.to_string(),
            cursor_name: cursor_name.clone(),
            execution_time_ms: None,  // Will be set on first fetch
        };

        self.active_queries.insert(handle_id.clone(), query_state);

        Ok(QueryHandle {
            id: handle_id,
            columns,
            estimated_rows: None,
        })
    }

    pub async fn fetch_page(&self, handle: &QueryHandle, max_rows: usize) -> Result<PageChunk> {
        let fetch_start = Instant::now();

        let mut state = self
            .active_queries
            .get_mut(&handle.id)
            .ok_or_else(|| AppError::not_found("Query handle not found"))?;

        // Use FETCH from cursor (single query execution, multiple fetches)
        let fetch_sql = format!("FETCH {} FROM {}", max_rows, state.cursor_name);

        // Execute FETCH - retrieves next batch from cursor
        let conn = self.get_connection().await?;
        let rows = conn.query(&fetch_sql, &[]).await?;

        // Track execution time ONLY on first fetch (comparable to TablePlus)
        // Measures: BEGIN + DECLARE CURSOR + first FETCH (true database execution time)
        let is_first_fetch = state.rows_fetched == 0;
        let mut execution_time_ms = state.execution_time_ms;

        if is_first_fetch {
            // Calculate from when open_query() started (includes DECLARE CURSOR time)
            execution_time_ms = Some(state.created_at.elapsed().as_millis() as u64);
        }

        let decode_start = Instant::now();

        // Use fast converter - Direct to JSON, NO CellValue overhead
        let result_rows = FastPostgresConverter::rows_to_json(&rows)?;

        let rows_fetched = state.rows_fetched + result_rows.len();
        state.rows_fetched = rows_fetched;
        state.execution_time_ms = execution_time_ms;
        let is_complete = result_rows.len() < max_rows;

        // Drop the mutable reference before removing
        drop(state);

        // Clean up cursor if complete
        if is_complete {
            let cursor_name = self
                .active_queries
                .get(&handle.id)
                .map(|s| s.cursor_name.clone())
                .unwrap_or_default();

            if !cursor_name.is_empty() {
                // Close cursor and commit transaction
                if let Ok(conn) = self.get_connection().await {
                    let _ = conn.execute(&format!("CLOSE {}", cursor_name), &[]).await;
                    let _ = conn.execute("COMMIT", &[]).await;
                }
            }

            self.active_queries.remove(&handle.id);
        }

        Ok(PageChunk {
            rows: result_rows,
            has_more: !is_complete,
            rows_fetched,
            timing: Some(PageTiming {
                fetch_ms: (decode_start.duration_since(fetch_start).as_millis() as u32),
                decode_ms: decode_start.elapsed().as_millis() as u32,
            }),
            execution_time_ms,
        })
    }

    pub async fn close_query(&self, handle: &QueryHandle) -> Result<()> {
        // Close cursor and commit transaction before removing from active queries
        if let Some(state) = self.active_queries.get(&handle.id) {
            let conn = self.get_connection().await?;
            
            // Try to close cursor, but don't fail if it's already closed
            let close_result = conn.execute(&format!("CLOSE {}", state.cursor_name), &[]).await;
            if let Err(e) = close_result {
                tracing::warn!("Failed to close cursor {}: {}", state.cursor_name, e);
            }

            // COMMIT must succeed - if it fails, connection is in bad state
            conn.execute("COMMIT", &[]).await
                .map_err(|e| {
                    tracing::error!("COMMIT failed after query close: {}", e);
                    AppError::from(e)
                })?;
        }

        self.active_queries.remove(&handle.id);
        Ok(())
    }

    pub async fn cancel_query(&self, handle: &QueryHandle) -> Result<()> {
        tracing::info!("Cancelling query: {}", handle.id);

        // Close cursor and rollback transaction (cancelled = rollback)
        if let Some(state) = self.active_queries.get(&handle.id) {
            let conn = self.get_connection().await?;
            
            // Try to close cursor, but don't fail if it's already closed
            let close_result = conn.execute(&format!("CLOSE {}", state.cursor_name), &[]).await;
            if let Err(e) = close_result {
                tracing::warn!("Failed to close cursor {} during cancel: {}", state.cursor_name, e);
            }

            // ROLLBACK must succeed - if it fails, connection is in bad state
            conn.execute("ROLLBACK", &[]).await
                .map_err(|e| {
                    tracing::error!("ROLLBACK failed during query cancel: {}. Connection may be stuck!", e);
                    AppError::from(e)
                })?;

            tracing::info!("Query cancelled successfully: {}", handle.id);
        }

        self.active_queries.remove(&handle.id);
        Ok(())
    }
}
