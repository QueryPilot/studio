use deadpool_postgres::Pool;
use std::sync::Arc;
use std::time::Instant;

use super::fast_converter::FastPostgresConverter;
use super::types::PostgresTypeConverter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct FastPostgresQueryExecutor {
    pool: Pool,
}

impl FastPostgresQueryExecutor {
    pub fn new_with_pool(pool: Pool) -> Self {
        Self { pool }
    }

    /// Get connection from pool for each operation
    async fn get_connection(&self) -> Result<deadpool_postgres::Object> {
        self.pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection from pool: {}", e)))
    }

    /// Fast path: Execute query with single fetch (no cursor)
    /// Best for small result sets (<50k rows) - avoids cursor overhead
    pub async fn execute_single_fetch(
        &self,
        sql: &str,
    ) -> Result<(Vec<Vec<serde_json::Value>>, Vec<ColumnMeta>, u64)> {
        let query_start = Instant::now();

        // Get connection from pool - MUST reuse same connection for prepare + execute
        let conn = self.get_connection().await?;

        // STEP 1: Prepare statement
        // NOTE: We can't cache statements with connection pooling because prepared
        // statements are per-connection. Each pool connection needs its own preparation.
        let stmt = Arc::new(conn.prepare(sql).await?);

        // Collect table OIDs for resolving table names
        let table_oids: Vec<Option<u32>> = stmt.columns().iter().map(|col| col.table_oid()).collect();
        let unique_oids: Vec<u32> = table_oids.iter().filter_map(|&oid| oid).collect::<std::collections::HashSet<_>>().into_iter().collect();

        // Resolve table OIDs to table names in a single query
        let table_names: std::collections::HashMap<u32, String> = if !unique_oids.is_empty() {
            let oid_list = unique_oids.iter().map(|o| o.to_string()).collect::<Vec<_>>().join(",");
            let resolve_sql = format!(
                "SELECT oid::int, relname FROM pg_class WHERE oid IN ({})",
                oid_list
            );
            match conn.query(&resolve_sql, &[]).await {
                Ok(rows) => rows
                    .iter()
                    .filter_map(|row| {
                        let oid: i32 = row.get(0);
                        let name: String = row.get(1);
                        Some((oid as u32, name))
                    })
                    .collect(),
                Err(_) => std::collections::HashMap::new(),
            }
        } else {
            std::collections::HashMap::new()
        };

        let columns = stmt
            .columns()
            .iter()
            .enumerate()
            .map(|(idx, col)| {
                let table_name = table_oids.get(idx)
                    .and_then(|&oid| oid)
                    .and_then(|oid| table_names.get(&oid).cloned());
                ColumnMeta {
                    name: col.name().to_string(),
                    table_name,
                    data_type: PostgresTypeConverter::type_to_cell_type(col.type_()),
                    nullable: true,
                    primary_key: false,
                    db_type: col.type_().name().to_string(),
                    type_oid: Some(col.type_().oid()),
                    default_value: None,
                    comment: None,
                    enum_values: None,
                    type_category: None,
                    precision: None,
                    scale: None,
                }
            })
            .collect::<Vec<_>>();

        // STEP 2: Execute query with single fetch (no cursor, no transaction)
        // IMPORTANT: Reuse the same connection - prepared statements are per-connection!
        let db_start = Instant::now();
        let rows = conn.query(stmt.as_ref(), &[]).await?;
        let db_time_ms = db_start.elapsed().as_millis() as u64;

        // STEP 3: Convert rows to JSON (direct, no CellValue overhead)
        let convert_start = Instant::now();
        let json_rows = FastPostgresConverter::rows_to_json(&rows)?;
        let convert_time_ms = convert_start.elapsed().as_millis() as u64;

        tracing::info!("  Postgres Query: {}ms", db_time_ms);
        tracing::info!(
            "  Row→JSON Conversion: {}ms ({} rows × {} cols)",
            convert_time_ms,
            rows.len(),
            columns.len()
        );

        // Measure total time including conversion (matches TablePlus measurement)
        let fetch_time_ms = query_start.elapsed().as_millis() as u64;

        Ok((json_rows, columns, fetch_time_ms))
    }

    /// Get the underlying pool for streaming queries
    pub fn get_pool(&self) -> Pool {
        self.pool.clone()
    }
}
