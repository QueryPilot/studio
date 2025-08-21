use tauri::State;
use uuid::Uuid;
use serde::{Deserialize, Serialize};

use crate::database::registry::ConnectionRegistry;
use crate::database::adapter::types::*;
use crate::database::adapter::DbAdapter;
use crate::error::AppError;
use crate::commands::secure_storage::SecureStorageState;

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
pub struct TestConnectionResult {
    pub success: bool,
    pub error_message: Option<String>,
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
pub async fn db_connect_by_id(
    connection_id: String,
    workspace_id: Option<String>,
    registry: State<'_, ConnectionRegistry>,
    secure_storage: State<'_, SecureStorageState>,
) -> Result<ConnectResponse, AppError> {
    println!("[db_connect_by_id] Starting connection for ID: {}", connection_id);
    println!("[db_connect_by_id] Workspace ID: {:?}", workspace_id);
    
    // Get connection details from secure storage
    let mut storage = secure_storage.lock().await;
    let storage = storage.as_mut()
        .ok_or_else(|| {
            println!("[db_connect_by_id] ERROR: Secure storage not initialized");
            AppError::ValidationError("Secure storage not initialized".to_string())
        })?;
    
    println!("[db_connect_by_id] Fetching connection details from secure storage...");
    let connection_config = storage.get_connection(&connection_id)
        .await
        .map_err(|e| {
            println!("[db_connect_by_id] ERROR: Failed to get connection from secure storage: {}", e);
            AppError::ValidationError(format!("Failed to get connection: {}", e))
        })?;
    
    println!("[db_connect_by_id] Successfully retrieved connection config for: {}", connection_config.name);
    
    // Convert to database adapter types
    println!("[db_connect_by_id] Connection type: {}", connection_config.connection_type);
    let db_type = match connection_config.connection_type.as_str() {
        "postgresql" => DbType::Postgres,
        "mysql" => DbType::Mysql,
        "sqlite" => DbType::Sqlite,
        _ => {
            println!("[db_connect_by_id] ERROR: Unsupported database type: {}", connection_config.connection_type);
            return Err(AppError::ValidationError(format!("Unsupported database type: {}", connection_config.connection_type)));
        }
    };
    
    // Clone values we need for logging before moving into adapter_config
    let username = connection_config.username.clone();
    let host = connection_config.host.clone();
    let port = connection_config.port;
    let database = connection_config.database.as_ref().unwrap_or(&"<default>".to_string()).clone();
    
    println!("[db_connect_by_id] Attempting connection to {}:{}@{}:{}/{}", 
        username, "***", host, port, database);
    
    let adapter_config = ConnectionConfig {
        id: connection_id.clone(),
        name: connection_config.name,
        db_type,
        host: connection_config.host,
        port: connection_config.port as u16,
        database: connection_config.database.unwrap_or_default(),
        username: connection_config.username,
        user: None,
        password: connection_config.password,
        database_url: None,
        pool_size: Some(5), // Reduce pool size to avoid connection exhaustion
        max_connections: 5,
        min_connections: 1,
        connection_timeout: 10000, // Reduce to 10 seconds for faster feedback
        idle_timeout: 600000,
        max_lifetime: 3600000,
        enable_health_check: Some(true),
    };
    
    // Create unique connection ID with workspace isolation if provided
    let isolated_connection_id = if let Some(workspace_id) = workspace_id {
        format!("{}_{}", workspace_id, connection_id)
    } else {
        connection_id.clone()
    };
    
    println!("[db_connect_by_id] Using isolated connection ID: {}", isolated_connection_id);
    println!("[db_connect_by_id] Calling registry.connect_with_id...");
    
    let conn_id = registry.connect_with_id(adapter_config, isolated_connection_id.clone()).await
        .map_err(|e| {
            println!("[db_connect_by_id] ERROR: Failed to connect to registry: {}", e);
            e
        })?;
    
    println!("[db_connect_by_id] Registry connection successful, conn_id: {}", conn_id);
    
    // Get server version
    println!("[db_connect_by_id] Getting connection handle from registry...");
    let conn = registry.get(&conn_id).await
        .ok_or_else(|| {
            println!("[db_connect_by_id] ERROR: Connection not found in registry with ID: {}", conn_id);
            AppError::ConnectionNotFound(conn_id.clone())
        })?;
    
    println!("[db_connect_by_id] Getting server version...");
    let server_version = conn.adapter.server_version().await.ok();
    
    println!("[db_connect_by_id] Success! Returning connection ID: {}", isolated_connection_id);
    
    Ok(ConnectResponse { 
        connection_id: isolated_connection_id,
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
    println!("[db_ping] Pinging connection ID: {}", connection_id);
    
    // List all connections in registry for debugging
    let all_connections = registry.list_connections().await;
    println!("[db_ping] Available connections in registry: {:?}", all_connections);
    
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| {
            println!("[db_ping] ERROR: Connection not found in registry for ID: {}", connection_id);
            AppError::ConnectionNotFound(connection_id)
        })?;
    
    println!("[db_ping] Connection found, pinging adapter...");
    let duration = conn.adapter.ping().await
        .map_err(|e| {
            println!("[db_ping] ERROR: Adapter ping failed: {}", e);
            e
        })?;
    
    println!("[db_ping] Ping successful: {}ms", duration.as_millis());
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
pub async fn db_list_functions(
    connection_id: String,
    database: String,
    schema: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<FunctionMeta>, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.clone()))?;
    
    conn.adapter.list_functions(&database, &schema).await
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
    
    // Store the cursor for later fetch operations
    let cursor_id = cursor.id.clone();
    let columns = cursor.columns.clone();
    let total_rows = cursor.total_rows;
    conn.query_executor.store_cursor(cursor).await;
    
    Ok(QueryBeginResponse {
        cursor_id,
        columns,
        total_approx: total_rows,
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
    
    // Retrieve the stored cursor
    let mut cursor = conn.query_executor.get_cursor(&cursor_id).await
        .ok_or_else(|| AppError::QueryNotFound(cursor_id.clone()))?;
    
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
pub async fn db_query_close(
    connection_id: String,
    cursor_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<(), AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    // Remove the cursor from storage
    conn.query_executor.remove_cursor(&cursor_id).await;
    
    // Also close it in the adapter if needed
    conn.adapter.close_cursor(&cursor_id).await?;
    
    Ok(())
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

#[tauri::command]
pub async fn db_estimate_count(
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<i64, AppError> {
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id))?;
    
    // Get table metadata which includes row estimate
    let tables = conn.adapter.list_tables(&database, &schema).await?;
    
    for table_meta in tables {
        if table_meta.name == table {
            return Ok(table_meta.row_estimate.unwrap_or(0) as i64);
        }
    }
    
    // If no estimate available, do a COUNT query
    let sql = format!("SELECT COUNT(*) AS count FROM \"{}\".\"{}\"", schema, table);
    
    // Use begin_query which doesn't add LIMIT for aggregate queries
    let cursor = conn.adapter.begin_query(&sql, None, QueryOptions {
        page_size: 1,  // We only need one row
        max_rows: Some(1),
        timeout_ms: Some(5000),
    }).await?;
    
    if !cursor.rows.is_empty() && !cursor.rows[0].is_empty() {
        if let Some(count) = cursor.rows[0][0].as_i64() {
            return Ok(count);
        }
    }
    
    Ok(0)
}

#[tauri::command]
pub async fn db_test_connection(
    config: ConnectionConfig,
) -> Result<TestConnectionResult, AppError> {
    use crate::database::adapter::{postgres::PostgresAdapter, mysql::MySqlAdapter, sqlite::SqliteAdapter};
    use sqlx::{PgPool, MySqlPool, SqlitePool};
    
    // Create a temporary connection pool for testing
    match config.db_type {
        crate::database::adapter::types::DbType::Postgres => {
            let database_url = format!(
                "postgresql://{}:{}@{}:{}/{}",
                config.username,
                config.password.unwrap_or_default(),
                config.host,
                config.port,
                config.database
            );
            
            // Try to create a temporary connection for testing
            match PgPool::connect(&database_url).await {
                Ok(pool) => {
                    let adapter = PostgresAdapter::new(pool);
                    // Try a simple ping
                    match adapter.ping().await {
                        Ok(_) => Ok(TestConnectionResult { success: true, error_message: None }),
                        Err(e) => Ok(TestConnectionResult { success: false, error_message: Some(e.to_string()) }),
                    }
                }
                Err(e) => Ok(TestConnectionResult { success: false, error_message: Some(e.to_string()) }),
            }
        }
        crate::database::adapter::types::DbType::Mysql => {
            let database_url = format!(
                "mysql://{}:{}@{}:{}/{}",
                config.username,
                config.password.unwrap_or_default(),
                config.host,
                config.port,
                config.database
            );
            
            match MySqlPool::connect(&database_url).await {
                Ok(pool) => {
                    let adapter = MySqlAdapter::new(pool);
                    match adapter.ping().await {
                        Ok(_) => Ok(TestConnectionResult { success: true, error_message: None }),
                        Err(e) => Ok(TestConnectionResult { success: false, error_message: Some(e.to_string()) }),
                    }
                }
                Err(e) => Ok(TestConnectionResult { success: false, error_message: Some(e.to_string()) }),
            }
        }
        crate::database::adapter::types::DbType::Sqlite => {
            match SqlitePool::connect(&config.database).await {
                Ok(pool) => {
                    let adapter = SqliteAdapter::new(pool);
                    match adapter.ping().await {
                        Ok(_) => Ok(TestConnectionResult { success: true, error_message: None }),
                        Err(e) => Ok(TestConnectionResult { success: false, error_message: Some(e.to_string()) }),
                    }
                }
                Err(e) => Ok(TestConnectionResult { success: false, error_message: Some(e.to_string()) }),
            }
        }
    }
}