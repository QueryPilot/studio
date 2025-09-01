use tokio_postgres::{Client, Transaction};
use std::sync::Arc;
use dashmap::DashMap;
use uuid::Uuid;
use std::time::Instant;

use crate::error::{AppError, Result};
use crate::types::*;
use super::types::PostgresTypeConverter;

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
        if sql.trim().to_uppercase().starts_with("CREATE") ||
           sql.trim().to_uppercase().starts_with("ALTER") ||
           sql.trim().to_uppercase().starts_with("DROP") ||
           sql.trim().to_uppercase().starts_with("INSERT") ||
           sql.trim().to_uppercase().starts_with("UPDATE") ||
           sql.trim().to_uppercase().starts_with("DELETE") {
            
            // Just prepare the statement to get column info
            let stmt = self.client.prepare(sql).await?;
            
            let columns = stmt.columns().iter().map(|col| {
                ColumnMeta {
                    name: col.name().to_string(),
                    data_type: PostgresTypeConverter::type_to_cell_type(col.type_()),
                    nullable: true,
                    primary_key: false,
                    db_type: col.type_().name().to_string(),
                    type_oid: Some(col.type_().oid()),
                }
            }).collect::<Vec<_>>();
            
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
        
        // For SELECT queries, we'll use portal-based streaming
        // First, prepare the statement to get column metadata
        let stmt = self.client.prepare(sql).await?;
        
        let columns = stmt.columns().iter().map(|col| {
            ColumnMeta {
                name: col.name().to_string(),
                data_type: PostgresTypeConverter::type_to_cell_type(col.type_()),
                nullable: true, // Would need to query pg_catalog for actual nullability
                primary_key: false, // Would need constraint info
                db_type: col.type_().name().to_string(),
                type_oid: Some(col.type_().oid()),
            }
        }).collect::<Vec<_>>();
        
        // Store portal state (we'll create the actual portal on first fetch)
        let portal_state = PortalState {
            portal_name: format!("portal_{}", handle_id),
            column_info: columns.clone(),
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
        let mut portal = self.active_portals.get_mut(&handle.id)
            .ok_or_else(|| AppError::not_found("Query handle not found"))?;
        
        // Build paginated query - avoid wrapping aggregate queries
        let offset = portal.rows_fetched;
        let needs_wrapping = !is_aggregate_query(&portal.original_sql);
        let query = if needs_wrapping {
            format!(
                "SELECT * FROM ({}) AS subquery LIMIT {} OFFSET {}",
                portal.original_sql,
                max_rows,
                offset
            )
        } else {
            // Execute aggregate queries directly without wrapping
            if offset > 0 {
                // For aggregate queries, there's only one result row
                // If we've already fetched it, return empty result
                String::new()
            } else {
                portal.original_sql.clone()
            }
        };
        
        let rows = if query.is_empty() {
            // Empty query means we're fetching beyond the first page of an aggregate query
            Vec::new()
        } else {
            self.client.query(&query, &[]).await?
        };
        
        let decode_start = Instant::now();
        
        // Convert rows to CellValues
        let mut result_rows = Vec::with_capacity(rows.len());
        
        for row in &rows {
            let mut cells = Vec::with_capacity(portal.column_info.len());
            for idx in 0..portal.column_info.len() {
                cells.push(PostgresTypeConverter::value_to_cell(&row, idx)?);
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
    (sql_upper.contains("COUNT(") || sql_upper.contains("SUM(") || 
     sql_upper.contains("AVG(") || sql_upper.contains("MAX(") || 
     sql_upper.contains("MIN(")) && !sql_upper.contains("GROUP BY")
}