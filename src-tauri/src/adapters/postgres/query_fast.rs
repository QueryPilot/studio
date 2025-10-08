use dashmap::DashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio_postgres::{Client, Statement};
use uuid::Uuid;

use super::fast_converter::FastPostgresConverter;
use super::types::PostgresTypeConverter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct FastPostgresQueryExecutor {
    client: Arc<Client>,
    active_queries: DashMap<String, QueryState>,
    /// Prepared statement cache: SQL -> Statement (saves ~10-20ms per query)
    statement_cache: DashMap<String, Arc<Statement>>,
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
    pub fn new(client: Arc<Client>) -> Self {
        Self {
            client,
            active_queries: DashMap::new(),
            statement_cache: DashMap::new(),
        }
    }

    /// Clear the prepared statement cache (call after DDL operations)
    pub fn clear_statement_cache(&self) {
        self.statement_cache.clear();
    }

    /// Fast path: Execute query with single fetch (no cursor)
    /// Best for small result sets (<50k rows) - avoids cursor overhead
    pub async fn execute_single_fetch(&self, sql: &str) -> Result<(Vec<Vec<CellValue>>, Vec<ColumnMeta>, u64)> {
        let query_start = Instant::now();

        // STEP 1: Get or prepare statement (with caching)
        let stmt = if let Some(cached) = self.statement_cache.get(sql) {
            cached.value().clone()
        } else {
            let stmt = Arc::new(self.client.prepare(sql).await?);
            self.statement_cache.insert(sql.to_string(), stmt.clone());
            stmt
        };

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
        let rows = self.client.query(stmt.as_ref(), &[]).await?;

        let fetch_time_ms = query_start.elapsed().as_millis() as u64;

        // STEP 3: Convert rows to cells
        let cells = FastPostgresConverter::rows_to_cells(&rows)?;

        Ok((cells, columns, fetch_time_ms))
    }

    pub async fn open_query(&self, sql: &str) -> Result<QueryHandle> {
        let handle_id = Uuid::new_v4().to_string();
        let cursor_name = format!("cursor_{}", handle_id.replace("-", "_"));

        // STEP 1: Get or prepare statement (with caching)
        let stmt = if let Some(cached) = self.statement_cache.get(sql) {
            // Cache hit - reuse prepared statement (saves ~10-20ms)
            cached.value().clone()
        } else {
            // Cache miss - prepare and cache
            let stmt = Arc::new(self.client.prepare(sql).await?);
            self.statement_cache.insert(sql.to_string(), stmt.clone());
            stmt
        };

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

        // STEP 2: BEGIN transaction (REQUIRED for DECLARE CURSOR)
        self.client.execute("BEGIN", &[]).await?;

        // STEP 3: DECLARE CURSOR for streaming (avoids LIMIT/OFFSET re-execution)
        let sql_trimmed = sql.trim().trim_end_matches(';');
        let declare_sql = format!("DECLARE {} NO SCROLL CURSOR FOR {}", cursor_name, sql_trimmed);

        // If DECLARE fails, rollback transaction
        if let Err(e) = self.client.execute(&declare_sql, &[]).await {
            let _ = self.client.execute("ROLLBACK", &[]).await;
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
        let rows = self.client.query(&fetch_sql, &[]).await?;

        // Track execution time ONLY on first fetch (comparable to TablePlus)
        // Measures: BEGIN + DECLARE CURSOR + first FETCH (true database execution time)
        let is_first_fetch = state.rows_fetched == 0;
        let mut execution_time_ms = state.execution_time_ms;

        if is_first_fetch {
            // Calculate from when open_query() started (includes DECLARE CURSOR time)
            execution_time_ms = Some(state.created_at.elapsed().as_millis() as u64);
        }

        let decode_start = Instant::now();

        // Use fast converter - NO display_value allocation
        let result_rows = FastPostgresConverter::rows_to_cells(&rows)?;

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
                let _ = self.client.execute(&format!("CLOSE {}", cursor_name), &[]).await;
                let _ = self.client.execute("COMMIT", &[]).await;
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
            let _ = self.client.execute(&format!("CLOSE {}", state.cursor_name), &[]).await;
            let _ = self.client.execute("COMMIT", &[]).await;
        }

        self.active_queries.remove(&handle.id);
        Ok(())
    }

    pub async fn cancel_query(&self, handle: &QueryHandle) -> Result<()> {
        // Close cursor and rollback transaction (cancelled = rollback)
        if let Some(state) = self.active_queries.get(&handle.id) {
            let _ = self.client.execute(&format!("CLOSE {}", state.cursor_name), &[]).await;
            let _ = self.client.execute("ROLLBACK", &[]).await;
        }

        self.active_queries.remove(&handle.id);
        Ok(())
    }
}
