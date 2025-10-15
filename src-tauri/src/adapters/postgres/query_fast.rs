use deadpool_postgres::Pool;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use super::fast_converter::FastPostgresConverter;
use super::types::PostgresTypeConverter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct FastPostgresQueryExecutor {
    pool: Pool,
    /// Track concurrent pre-warming operations (rate limiting)
    prewarm_in_progress: AtomicUsize,
}

impl FastPostgresQueryExecutor {
    pub fn new_with_pool(pool: Pool) -> Self {
        Self {
            pool,
            prewarm_in_progress: AtomicUsize::new(0),
        }
    }

    /// Get connection from pool for each operation
    async fn get_connection(&self) -> Result<deadpool_postgres::Object> {
        self.pool.get().await
            .map_err(|e| AppError::Internal(format!("Failed to get connection from pool: {}", e)))
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
}
