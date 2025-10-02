use dashmap::DashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio_postgres::{Client, Transaction};
use uuid::Uuid;

use super::types::PostgresTypeConverter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct PostgresQueryExecutor {
    client: Arc<Client>,
    active_portals: DashMap<String, PortalState>,
}

struct PortalState {
    portal_name: String,
    column_info: Vec<ColumnMeta>,
    created_at: Instant,
    rows_fetched: usize,
    original_sql: String,
}

impl PostgresQueryExecutor {
    pub fn new(client: Arc<Client>) -> Self {
        Self {
            client,
            active_portals: DashMap::new(),
        }
    }

    pub async fn open_query(&self, sql: &str) -> Result<QueryHandle> {
        let handle_id = Uuid::new_v4().to_string();

        // For simple queries without portal (DDL, single statements)
        if sql.trim().to_uppercase().starts_with("CREATE")
            || sql.trim().to_uppercase().starts_with("ALTER")
            || sql.trim().to_uppercase().starts_with("DROP")
            || sql.trim().to_uppercase().starts_with("INSERT")
            || sql.trim().to_uppercase().starts_with("UPDATE")
            || sql.trim().to_uppercase().starts_with("DELETE")
        {
            // Just prepare the statement to get column info
            let stmt = self.client.prepare(sql).await?;

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

            // Store simple state
            let portal_state = PortalState {
                portal_name: String::new(),
                column_info: columns.clone(),
                created_at: Instant::now(),
                rows_fetched: 0,
                original_sql: sql.to_string(),
            };

            self.active_portals.insert(handle_id.clone(), portal_state);

            return Ok(QueryHandle {
                id: handle_id,
                columns,
                estimated_rows: None,
            });
        }

        // For SELECT queries, check if we need to build a modified query with casts
        // to handle types that tokio-postgres cannot deserialize
        let _needs_casting = sql.to_uppercase().contains("SELECT");

        // First, prepare the original statement to get column metadata
        let stmt = self.client.prepare(sql).await?;

        let mut columns = Vec::new();
        let mut original_columns = Vec::new();

        eprintln!("DEBUG: Statement has {} columns", stmt.columns().len());

        for col in stmt.columns() {
            let cell_type = PostgresTypeConverter::type_to_cell_type(col.type_());
            let _db_type_name = col.type_().name();

            // Check if this needs casting - including ALL custom types (enums, etc.)
            let _needs_cast = matches!(
                cell_type,
                CellValueType::Range(_)
                    | CellValueType::Multirange(_)
                    | CellValueType::TsVector
                    | CellValueType::TsQuery
                    | CellValueType::Money
                    | CellValueType::CustomType(_)
            );

            // Store the original column info for type hints
            original_columns.push(ColumnMeta {
                name: col.name().to_string(),
                data_type: cell_type.clone(),
                nullable: true,
                primary_key: false,
                db_type: col.type_().name().to_string(),
                type_oid: Some(col.type_().oid()),
                default_value: None,
                comment: None,
                enum_values: None,
                type_category: None,
            });

            // For display, if we'll cast to text, show it as the original type
            // but we'll handle it specially in value conversion
            columns.push(ColumnMeta {
                name: col.name().to_string(),
                data_type: cell_type,
                nullable: true,
                primary_key: false,
                db_type: col.type_().name().to_string(),
                type_oid: Some(col.type_().oid()),
                default_value: None,
                comment: None,
                enum_values: None,
                type_category: None,
            });
        }

        // Store portal state with original column info
        let portal_state = PortalState {
            portal_name: format!("portal_{}", handle_id),
            column_info: original_columns,
            created_at: Instant::now(),
            rows_fetched: 0,
            original_sql: sql.to_string(),
        };

        self.active_portals.insert(handle_id.clone(), portal_state);

        Ok(QueryHandle {
            id: handle_id,
            columns,
            estimated_rows: None,
        })
    }

    pub async fn fetch_page(&self, handle: &QueryHandle, max_rows: usize) -> Result<PageChunk> {
        let fetch_start = Instant::now();

        // Check if this is a simple query (no portal)
        if let Some(portal) = self.active_portals.get(&handle.id) {
            if portal.portal_name.is_empty() {
                // Execute the query directly for non-SELECT statements
                drop(portal);
                self.active_portals.remove(&handle.id);
                return Ok(PageChunk {
                    rows: vec![],
                    has_more: false,
                    rows_fetched: 0,
                    timing: Some(PageTiming {
                        fetch_ms: fetch_start.elapsed().as_millis() as u32,
                        decode_ms: 0,
                    }),
                });
            }
        }

        // For SELECT queries, use simple pagination for now
        // (Portal-based streaming requires more complex transaction management)
        let mut portal = self
            .active_portals
            .get_mut(&handle.id)
            .ok_or_else(|| AppError::not_found("Query handle not found"))?;

        // Build paginated query - avoid wrapping aggregate queries and JOIN queries
        let offset = portal.rows_fetched;
        let needs_wrapping = !is_aggregate_query(&portal.original_sql) && !has_joins(&portal.original_sql);

        // Build query with type casting for range types
        let query = if needs_wrapping {
            // Check if we need to cast range columns to text
            let columns_with_casts = portal
                .column_info
                .iter()
                .enumerate()
                .map(|(_idx, col)| {
                    // Check if this is a type that needs casting to text
                    // This includes ranges, text search types, money, and ALL custom types (including enums)
                    if matches!(
                        col.data_type,
                        CellValueType::Range(_)
                            | CellValueType::Multirange(_)
                            | CellValueType::TsVector
                            | CellValueType::TsQuery
                            | CellValueType::Money
                            | CellValueType::CustomType(_)
                    ) {
                        // Cast these types to text for proper display
                        // Use double quotes to handle special characters in column names
                        format!("subquery.\"{}\"::text AS \"{}\"", col.name, col.name)
                    } else {
                        format!("subquery.\"{}\"", col.name)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");

            // If we have columns that need casting, use custom SELECT list, otherwise use *
            if portal.column_info.iter().any(|col| {
                matches!(
                    col.data_type,
                    CellValueType::Range(_)
                        | CellValueType::Multirange(_)
                        | CellValueType::TsVector
                        | CellValueType::TsQuery
                        | CellValueType::Money
                        | CellValueType::CustomType(_)
                )
            }) {
                format!(
                    "SELECT {} FROM ({}) AS subquery LIMIT {} OFFSET {}",
                    columns_with_casts, portal.original_sql, max_rows, offset
                )
            } else {
                format!(
                    "SELECT * FROM ({}) AS subquery LIMIT {} OFFSET {}",
                    portal.original_sql, max_rows, offset
                )
            }
        } else {
            // Execute queries without wrapping (aggregate queries or queries with JOINs)
            if is_aggregate_query(&portal.original_sql) && offset > 0 {
                // For aggregate queries, there's only one result row
                // If we've already fetched it, return empty result
                String::new()
            } else {
                // For JOIN queries or first fetch of aggregate queries, add LIMIT/OFFSET directly
                let sql_trimmed = portal.original_sql.trim().trim_end_matches(';');
                if has_joins(&portal.original_sql) {
                    // Add pagination directly to JOIN queries
                    format!("{} LIMIT {} OFFSET {}", sql_trimmed, max_rows, offset)
                } else {
                    // Aggregate query - just execute as-is
                    portal.original_sql.clone()
                }
            }
        };

        // Debug: Log the query being executed
        if !query.is_empty() {
            eprintln!("DEBUG: Executing query: {}", query);
        }

        let rows = if query.is_empty() {
            // Empty query means we're fetching beyond the first page of an aggregate query
            Vec::new()
        } else {
            self.client.query(&query, &[]).await?
        };

        let decode_start = Instant::now();

        // Convert rows to CellValues
        let mut result_rows = Vec::with_capacity(rows.len());

        // Check if we cast any columns - if so, we need to use the original types
        let columns_were_cast = portal.column_info.iter().any(|col| {
            matches!(
                col.data_type,
                CellValueType::Range(_)
                    | CellValueType::Multirange(_)
                    | CellValueType::TsVector
                    | CellValueType::TsQuery
                    | CellValueType::CustomType(_)
            )
        });

        // Debug: Log column types
        for (idx, col) in portal.column_info.iter().enumerate() {
            eprintln!(
                "DEBUG: Column {}: {} - Type: {:?}",
                idx, col.name, col.data_type
            );
        }

        for row in &rows {
            let mut cells = Vec::with_capacity(portal.column_info.len());
            for idx in 0..portal.column_info.len() {
                // If we cast columns to text, use the original type info for conversion
                if columns_were_cast {
                    let original_type = &portal.column_info[idx].data_type;
                    cells.push(PostgresTypeConverter::value_to_cell_with_type_hint(
                        &row,
                        idx,
                        Some(original_type),
                    )?);
                } else {
                    cells.push(PostgresTypeConverter::value_to_cell(&row, idx)?);
                }
            }
            result_rows.push(cells);
        }

        let rows_fetched = portal.rows_fetched + result_rows.len();
        portal.rows_fetched = rows_fetched;
        let is_complete = result_rows.len() < max_rows;

        // Drop the mutable reference before removing
        drop(portal);

        // Clean up if complete
        if is_complete {
            self.active_portals.remove(&handle.id);
        }

        Ok(PageChunk {
            rows: result_rows,
            has_more: !is_complete,
            rows_fetched,
            timing: Some(PageTiming {
                fetch_ms: (decode_start.duration_since(fetch_start).as_millis() as u32),
                decode_ms: decode_start.elapsed().as_millis() as u32,
            }),
        })
    }

    pub async fn close_query(&self, handle: &QueryHandle) -> Result<()> {
        self.active_portals.remove(&handle.id);
        Ok(())
    }

    pub async fn cancel_query(&self, handle: &QueryHandle) -> Result<()> {
        // Cancel via pg_cancel_backend would be implemented here
        self.active_portals.remove(&handle.id);
        Ok(())
    }
}

/// Check if a SQL query is an aggregate query that should not be wrapped for pagination
fn is_aggregate_query(sql: &str) -> bool {
    let sql_upper = sql.to_uppercase();
    (sql_upper.contains("COUNT(")
        || sql_upper.contains("SUM(")
        || sql_upper.contains("AVG(")
        || sql_upper.contains("MAX(")
        || sql_upper.contains("MIN("))
        && !sql_upper.contains("GROUP BY")
}

/// Check if a SQL query has JOINs that would cause ambiguous columns when wrapped
fn has_joins(sql: &str) -> bool {
    let sql_upper = sql.to_uppercase();
    sql_upper.contains(" JOIN ")
        || sql_upper.contains(" LEFT ")
        || sql_upper.contains(" RIGHT ")
        || sql_upper.contains(" INNER ")
        || sql_upper.contains(" OUTER ")
        || sql_upper.contains(" CROSS ")
}
