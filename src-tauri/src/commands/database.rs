use tauri::State;
use uuid::Uuid;
use serde::{Deserialize, Serialize};

use crate::database::registry::ConnectionRegistry;
use crate::database::adapter::types::*;
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectResponse {
    pub connection_id: String,
    pub server_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryBeginResponse {
    pub cursor_id: String,
    pub columns: Vec<ColumnMeta>,
    pub total_approx: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryFetchResponse {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub page: usize,
    pub is_complete: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CellUpdate {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub pk: std::collections::HashMap<String, serde_json::Value>,
    pub new_value: serde_json::Value,
}

#[tauri::command]
pub async fn db_connect(
    config: ConnectionConfig,
    registry: State<'_, ConnectionRegistry>,
) -> Result<ConnectResponse, AppError> {
    let conn_id = registry.connect(config).await?;
    
    // Get server version
    let conn = registry.get(&conn_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(conn_id.clone()))?;
    
    let server_version = conn.adapter.server_version().await.ok();
    
    Ok(ConnectResponse { 
        connection_id: conn_id,
        server_version,
    })
}

#[tauri::command]
pub async fn db_disconnect(
    connection_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<(), AppError> {
    registry.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn db_ping(
    connection_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<u64, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    let duration = conn.adapter.ping().await?;
    Ok(duration.as_millis() as u64)
}

#[tauri::command]
pub async fn db_list_databases(
    connection_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<String>, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    conn.adapter.list_databases().await
}

#[tauri::command]
pub async fn db_list_schemas(
    connection_id: String,
    database: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<String>, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    conn.adapter.list_schemas(&database).await
}

#[tauri::command]
pub async fn db_list_tables(
    connection_id: String,
    database: String,
    schema: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<TableMeta>, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    conn.adapter.list_tables(&database, &schema).await
}

#[tauri::command]
pub async fn db_table_columns(
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<ColumnMeta>, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    conn.adapter.table_columns(&database, &schema, &table).await
}

#[tauri::command]
pub async fn db_query_begin(
    connection_id: String,
    sql: String,
    params: Option<Vec<serde_json::Value>>,
    opts: Option<QueryOptions>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<QueryBeginResponse, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.clone()))?;
    
    let query_id = Uuid::new_v4().to_string();
    let options = opts.unwrap_or_default();
    
    // Execute query with cancellation support
    let cursor = conn.query_executor.begin_query_cancellable(
        query_id.clone(),
        conn.adapter.clone(),
        sql,
        params,
        options,
    ).await?;
    
    Ok(QueryBeginResponse {
        cursor_id: cursor.id,
        columns: cursor.columns,
        total_approx: cursor.total_rows,
    })
}

#[tauri::command]
pub async fn db_query_fetch(
    connection_id: String,
    cursor_id: String,
    page: usize,
    page_size: usize,
    registry: State<'_, ConnectionRegistry>,
) -> Result<QueryFetchResponse, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    // Create a temporary cursor for fetching
    let mut cursor = QueryCursor {
        id: cursor_id.clone(),
        sql: String::new(),
        columns: Vec::new(),
        rows: Vec::new(),
        page_size,
        current_page: page,
        total_rows: None,
        is_complete: false,
        created_at: None,
    };
    
    let page_data = conn.adapter.fetch_page(&mut cursor, page, page_size).await?;
    
    Ok(QueryFetchResponse {
        rows: page_data.rows,
        page: page_data.page,
        is_complete: page_data.is_complete,
    })
}

#[tauri::command]
pub async fn db_query_cancel(
    connection_id: String,
    query_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<(), AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    conn.query_executor.cancel(&query_id).await
}

#[tauri::command]
pub async fn db_execute(
    connection_id: String,
    sql: String,
    params: Option<Vec<serde_json::Value>>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<ExecuteResult, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.clone()))?;
    
    let query_id = Uuid::new_v4().to_string();
    
    // Execute with cancellation support
    conn.query_executor.execute_cancellable(
        query_id,
        conn.adapter.clone(),
        sql,
        params,
    ).await
}

#[tauri::command]
pub async fn db_update_cell(
    connection_id: String,
    update: CellUpdate,
    registry: State<'_, ConnectionRegistry>,
) -> Result<ExecuteResult, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    // Build UPDATE query with PK conditions
    let set_clause = format!("{} = $1", update.column);
    let mut where_clauses = Vec::new();
    let mut param_idx = 2;
    
    for (key, _value) in &update.pk {
        where_clauses.push(format!("{} = ${}", key, param_idx));
        param_idx += 1;
    }
    
    let sql = format!(
        "UPDATE {}.{} SET {} WHERE {}",
        update.schema,
        update.table,
        set_clause,
        where_clauses.join(" AND ")
    );
    
    // Build params array
    let mut params = vec![update.new_value];
    for (_key, value) in update.pk {
        params.push(value);
    }
    
    conn.adapter.execute(&sql, Some(params)).await
}