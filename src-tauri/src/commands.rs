use std::sync::Arc;
use std::fs; // needed for reset_vault_vault
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

use crate::core::ConnectionManager;
use crate::types::*;
use serde::Serialize;

#[tauri::command]
pub async fn connect(
    profile: ConnectionProfile,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionInfo, String> {
    let conn_id = manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ConnectionInfo {
        id: conn_id,
        db_type: profile.db_type,
        database: profile.database,
        version: None,
    })
}

#[tauri::command]
pub async fn disconnect(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    manager
        .disconnect(&conn_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn disconnect_all(
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    manager
        .disconnect_all()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionTestResult, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .test_connection()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn execute_query(
    conn_id: String,
    sql: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<QueryHandle, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .open_query(&sql)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_results(
    conn_id: String,
    query_handle: QueryHandle,
    max_rows: usize,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<PageChunk, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .fetch_page(&query_handle, max_rows)
        .await
        .map_err(|e| e.to_string())
}

/// Execute a query and return columns + first page of rows in a single call
#[tauri::command]
pub async fn execute_query_simple(
    conn_id: String,
    sql: String,
    max_rows: Option<usize>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TableDataResult, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Open, fetch one page, then close the query to avoid keeping portal state around
    let handle = conn
        .adapter
        .open_query(&sql)
        .await
        .map_err(|e| e.to_string())?;

    let chunk = conn
        .adapter
        .fetch_page(&handle, max_rows.unwrap_or(1000))
        .await
        .map_err(|e| e.to_string())?;

    // Get execution time from chunk (captured before query state removal)
    let execution_time_ms = chunk.execution_time_ms;

    let _ = conn.adapter.close_query(&handle).await;

    Ok(TableDataResult {
        columns: handle.columns.clone(),
        rows: chunk.rows,
        has_more: chunk.has_more,
        total_count: None,
        execution_time_ms,
    })
}

#[tauri::command]
pub async fn get_databases(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Database>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_databases()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_schemas(
    conn_id: String,
    database: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Schema>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_schemas(&database)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tables(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Table>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_tables(&schema)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_views(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<View>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_views(&schema)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_functions(
    conn_id: String,
    schema: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Function>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_functions(&schema)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_indexes(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Index>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_indexes(&table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_index_usage_stats(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<IndexUsageStats>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_index_usage_stats(&table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_supported_index_types(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<String>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_supported_index_types()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_supported_column_types(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<String>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_supported_column_types()
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct TypeInfo {
    pub type_name: String,
    pub type_category: String,
    pub enum_values: Option<Vec<String>>,
    pub base_type: Option<String>,
}

#[tauri::command]
pub async fn get_type_info(
    conn_id: String,
    type_name: String,
    schema: Option<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TypeInfo, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // For PostgreSQL, query type information
    if matches!(conn.profile.db_type, DbType::PostgreSQL) {
        let schema = schema.unwrap_or_else(|| "public".to_string());

        let query_sql = format!(
            "SELECT \
                t.typname as type_name, \
                t.typtype as type_category, \
                CASE WHEN t.typtype = 'e' THEN ( \
                    SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) \
                    FROM pg_enum e WHERE e.enumtypid = t.oid \
                ) ELSE NULL END as enum_values, \
                CASE WHEN t.typtype = 'd' THEN \
                    pg_catalog.format_type(t.typbasetype, t.typtypmod) \
                ELSE NULL END as base_type \
            FROM pg_type t \
            JOIN pg_namespace n ON t.typnamespace = n.oid \
            WHERE t.typname = '{}' AND n.nspname = '{}'",
            type_name, schema
        );

        let handle = conn
            .adapter
            .open_query(&query_sql)
            .await
            .map_err(|e| e.to_string())?;
        let chunk = conn
            .adapter
            .fetch_page(&handle, 1)
            .await
            .map_err(|e| e.to_string())?;
        let _ = conn.adapter.close_query(&handle).await;

        if chunk.rows.is_empty() {
            return Err(format!(
                "Type '{}' not found in schema '{}'",
                type_name, schema
            ));
        }

        let row = &chunk.rows[0];
        let type_category = if let Some(cat_value) = &row.get(1).and_then(|v| {
            let s = v.to_string();
            if !s.is_empty() {
                s.chars().next()
            } else {
                None
            }
        }) {
            match cat_value {
                'e' => "enum",
                'd' => "domain",
                'c' => "composite",
                'b' => "base",
                'r' => "range",
                'm' => "multirange",
                _ => "unknown",
            }
        } else {
            "unknown"
        };

        let enum_values = row.get(2).and_then(|v| {
            let s = v.to_string();
            if !s.is_empty() {
                Some(s.split(',').map(|s| s.to_string()).collect())
            } else {
                None
            }
        });

        let base_type = row.get(3).map(|v| v.to_string());

        Ok(TypeInfo {
            type_name: type_name.clone(),
            type_category: type_category.to_string(),
            enum_values,
            base_type,
        })
    } else {
        Err("get_type_info is only supported for PostgreSQL".to_string())
    }
}

#[tauri::command]
pub async fn get_constraints(
    conn_id: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Constraint>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_constraints(&table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_columns(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<ColumnMeta>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_table_columns(&schema, &table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_triggers(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<Trigger>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_triggers(&schema, &table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_object_definition(
    conn_id: String,
    database: String,
    schema: String,
    object_name: String,
    object_type: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<String, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_object_definition(&database, &schema, &object_name, &object_type)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_data(
    conn_id: String,
    schema: String,
    table: String,
    limit: usize,
    offset: usize,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TableDataResult, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_table_data(&schema, &table, limit, offset)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_data_filtered(
    conn_id: String,
    schema: String,
    table: String,
    limit: usize,
    offset: usize,
    filters: Option<FilterConfig>,
    sorts: Option<Vec<SortConfig>>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TableDataResult, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_table_data_filtered(&schema, &table, limit, offset, filters, sorts)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_count(
    conn_id: String,
    schema: String,
    table: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<i64, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .get_table_count(&schema, &table)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection_health(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionHealth, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Test the connection
    let test_result = conn
        .adapter
        .test_connection()
        .await
        .map_err(|e| e.to_string())?;

    Ok(ConnectionHealth {
        connection_id: conn_id,
        status: if test_result.success {
            "ready".to_string()
        } else {
            "error".to_string()
        },
        healthy: test_result.success,
        rtt_ms: None,
        error: if !test_result.success {
            Some(test_result.message)
        } else {
            None
        },
    })
}

#[tauri::command]
pub async fn ping(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<u64, String> {
    use std::time::Instant;

    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    let start = Instant::now();
    let is_connected = conn.adapter.is_connected().await;
    let elapsed = start.elapsed().as_millis() as u64;

    if is_connected {
        Ok(elapsed)
    } else {
        Err("Connection is not active".to_string())
    }
}

/// Stream query results via IPC channel (FAST PATH - eliminates 300-350ms window.emit overhead)
#[tauri::command]
pub async fn stream_query(
    conn_id: String,
    sql: String,
    batch_size: Option<usize>,
    channel: tauri::ipc::Channel<StreamMessage>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let batch_size = batch_size.unwrap_or(1000);

    // Get connection
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Open query
    let handle = match conn.adapter.open_query(&sql).await {
        Ok(h) => h,
        Err(e) => {
            let _ = channel.send(StreamMessage::Error {
                code: "QUERY_ERROR".to_string(),
                message: e.to_string(),
            });
            return Err(e.to_string());
        }
    };

    // Send started message with column metadata
    let _ = channel.send(StreamMessage::Started {
        columns: handle.columns.clone(),
        estimated_rows: handle.estimated_rows,
    });

    // Stream batches
    let mut total_rows = 0;
    let mut execution_time_ms = 0u64;
    loop {
        match conn.adapter.fetch_page(&handle, batch_size).await {
            Ok(chunk) => {
                let row_count = chunk.rows.len();

                // Capture execution time from first chunk (before query state removal)
                if total_rows == 0 {
                    execution_time_ms = chunk.execution_time_ms.unwrap_or(0);
                }

                // Send batch
                let _ = channel.send(StreamMessage::Batch {
                    rows: chunk.rows,
                    row_offset: total_rows,
                });

                total_rows += row_count;

                // Check if we're done
                if !chunk.has_more || row_count == 0 {
                    break;
                }
            }
            Err(e) => {
                let _ = channel.send(StreamMessage::Error {
                    code: "FETCH_ERROR".to_string(),
                    message: e.to_string(),
                });
                let _ = conn.adapter.close_query(&handle).await;
                return Err(e.to_string());
            }
        }
    }

    // Close query
    let _ = conn.adapter.close_query(&handle).await;

    // Send success message with real database execution time
    let _ = channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms,
    });

    Ok(())
}

// Index operation commands
#[tauri::command]
pub async fn create_index(
    conn_id: String,
    schema: String,
    table: String,
    index: CreateIndexRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Guard against indefinite hangs: enforce a 30s timeout
    match timeout(
        Duration::from_secs(30),
        conn.adapter.create_index(&schema, &table, &index),
    )
    .await
    {
        Ok(res) => res.map_err(|e| e.to_string()),
        Err(_) => Err("Timed out creating index after 30s".to_string()),
    }
}

#[tauri::command]
pub async fn drop_index(
    conn_id: String,
    schema: String,
    index_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .drop_index(&schema, &index_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_index(
    conn_id: String,
    schema: String,
    old_name: String,
    new_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .rename_index(&schema, &old_name, &new_name)
        .await
        .map_err(|e| e.to_string())
}

// Table structure operation commands
#[tauri::command]
pub async fn alter_table_add_column(
    conn_id: String,
    schema: String,
    table: String,
    column: AddColumnRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_add_column(&schema, &table, &column)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_drop_column(
    conn_id: String,
    schema: String,
    table: String,
    column_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_drop_column(&schema, &table, &column_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_modify_column(
    conn_id: String,
    schema: String,
    table: String,
    column: ModifyColumnRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_modify_column(&schema, &table, &column)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_rename_column(
    conn_id: String,
    schema: String,
    table: String,
    old_name: String,
    new_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_rename_column(&schema, &table, &old_name, &new_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_add_foreign_key(
    conn_id: String,
    schema: String,
    table: String,
    fk: AddForeignKeyRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_add_foreign_key(&schema, &table, &fk)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table_drop_foreign_key(
    conn_id: String,
    schema: String,
    table: String,
    constraint_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .alter_table_drop_foreign_key(&schema, &table, &constraint_name)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// vault maintenance helpers
// ============================================================================

#[tauri::command]
pub async fn reset_vault_vault(app_handle: AppHandle) -> std::result::Result<(), String> {
    let data_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let vault_path = data_dir.join("vault.hold");
    let salt_path = data_dir.join("salt.txt");

    if vault_path.exists() {
        if let Err(err) = fs::remove_file(&vault_path) {
            tracing::warn!(
                "Failed to remove vault vault file {}: {}",
                vault_path.display(),
                err
            );
        } else {
            tracing::info!("Removed vault vault file at {}", vault_path.display());
        }
    }

    if salt_path.exists() {
        if let Err(err) = fs::remove_file(&salt_path) {
            tracing::warn!(
                "Failed to remove vault salt file {}: {}",
                salt_path.display(),
                err
            );
        } else {
            tracing::info!("Removed vault salt file at {}", salt_path.display());
        }
    }

    if let Err(err) = crate::keychain::delete_vault_password() {
        tracing::warn!(
            "Failed to delete vault password from keychain: {}",
            err
        );
    }

    Ok(())
}

// Trigger operation commands
#[tauri::command]
pub async fn create_trigger(
    conn_id: String,
    schema: String,
    table: String,
    trigger: CreateTriggerRequest,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .create_trigger(&schema, &table, &trigger)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn drop_trigger(
    conn_id: String,
    schema: String,
    table: String,
    trigger_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .drop_trigger(&schema, &table, &trigger_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn enable_disable_trigger(
    conn_id: String,
    schema: String,
    table: String,
    trigger_name: String,
    enabled: bool,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter
        .enable_disable_trigger(&schema, &table, &trigger_name, enabled)
        .await
        .map_err(|e| e.to_string())
}
