use tauri::{State, Emitter};
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
        "mssql" | "sqlserver" => DbType::Mssql,
        "mariadb" => DbType::Mariadb,
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
        password: connection_config.password,
        max_connections: 5,
        min_connections: 1,
        connection_timeout: 5000, // Reduce to 5 seconds for faster feedback
        idle_timeout: 600000,
        max_lifetime: 3600000,
        enable_health_check: Some(true),
        // MSSQL specific fields - set defaults for development
        auth_type: None,
        instance_name: None,
        encrypt: Some(false),  // Don't require encryption for dev
        trust_server_certificate: Some(true),  // Trust server cert for dev
        named_pipe: None,
        // Additional optional fields
        user: None,
        database_url: None,
        pool_size: Some(5), // Reduce pool size to avoid connection exhaustion
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
pub async fn db_list_connections(
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<String>, AppError> {
    println!("[db_list_connections] Command called");
    
    let connections = registry.list_connections().await;
    
    println!("[db_list_connections] Found {} active database connections", connections.len());
    for conn_id in &connections {
        println!("[db_list_connections] - Active connection: {}", conn_id);
    }
    
    Ok(connections)
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
    println!("[db_list_tables] Called with connection_id: {}, database: {}, schema: {}", 
             connection_id, database, schema);
    
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| {
            println!("[db_list_tables] ERROR: Connection not found: {}", connection_id);
            AppError::ConnectionNotFound(connection_id.clone())
        })?;
    
    println!("[db_list_tables] Connection found, calling adapter.list_tables...");
    let result = conn.adapter.list_tables(&database, &schema).await;
    
    match &result {
        Ok(tables) => println!("[db_list_tables] Success: returning {} tables", tables.len()),
        Err(e) => println!("[db_list_tables] ERROR: {}", e),
    }
    
    result
}

#[tauri::command]
pub async fn db_list_functions(
    connection_id: String,
    database: String,
    schema: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<FunctionMeta>, AppError> {
    println!("[db_list_functions] Called with connection_id: {}, database: {}, schema: {}", 
             connection_id, database, schema);
    
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| {
            println!("[db_list_functions] ERROR: Connection not found: {}", connection_id);
            AppError::ConnectionNotFound(connection_id.clone())
        })?;
    
    println!("[db_list_functions] Connection found, calling adapter.list_functions...");
    let result = conn.adapter.list_functions(&database, &schema).await;
    
    match &result {
        Ok(functions) => println!("[db_list_functions] Success: returning {} functions", functions.len()),
        Err(e) => println!("[db_list_functions] ERROR: {}", e),
    }
    
    result
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
pub async fn db_table_indexes(
    connection_id: String,
    _database: String,
    _schema: String,
    _table: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<crate::database::metadata::TableIndex>, AppError> {
    let _conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.clone()))?;
    
    // TODO: Each database adapter will implement index retrieval
    // Return empty for now since all adapters are placeholder implementations
    Ok(vec![])
}

#[tauri::command]
pub async fn db_table_triggers(
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<TriggerMeta>, AppError> {
    println!("[db_table_triggers] Called with connection_id: {}, database: {}, schema: {}, table: {}", 
             connection_id, database, schema, table);
    
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| {
            println!("[db_table_triggers] ERROR: Connection not found: {}", connection_id);
            AppError::ConnectionNotFound(connection_id.clone())
        })?;
    
    println!("[db_table_triggers] Connection found, calling adapter.table_triggers...");
    let result = conn.adapter.table_triggers(&database, &schema, &table).await;
    
    match &result {
        Ok(triggers) => println!("[db_table_triggers] Success: returning {} triggers", triggers.len()),
        Err(e) => println!("[db_table_triggers] ERROR: {}", e),
    }
    
    result
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
pub async fn db_table_data(
    connection_id: String,
    table: String,
    schema: Option<String>,
    select: Option<Vec<String>>,
    sorts: Option<Vec<SortSpec>>,
    filters: Option<Vec<FilterSpec>>,
    search: Option<String>,
    cursor: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
    registry: State<'_, ConnectionRegistry>,
    app_handle: tauri::AppHandle,
) -> Result<String, AppError> {
    
    println!("[db_table_data] Starting table data fetch for connection: {}, table: {}", connection_id, table);
    
    let conn = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.clone()))?;
    
    // Determine pagination mode
    let pagination = if let Some(cursor_str) = cursor {
        PaginationMode::Cursor { cursor: Some(cursor_str) }
    } else {
        let actual_limit = limit.unwrap_or(100).min(1000).max(1);
        PaginationMode::Offset { 
            offset: offset.unwrap_or(0), 
            limit: actual_limit 
        }
    };
    
    // Build request
    let request = TableReadRequest {
        schema,
        table: table.clone(),
        select,
        sorts: sorts.unwrap_or_default(),
        filters: filters.unwrap_or_default(),
        search,
        pagination,
    };
    
    // Generate unique stream ID for this request
    let stream_id = uuid::Uuid::new_v4().to_string();
    let event_name = format!("table-data-{}", stream_id);
    
    println!("[db_table_data] Stream ID: {}, Event name: {}", stream_id, event_name);
    
    // Spawn async task to stream data
    let adapter = conn.adapter.clone();
    let app_handle_clone = app_handle.clone();
    let event_name_clone = event_name.clone();
    
    tokio::spawn(async move {
        // First, send metadata
        let columns = match adapter.table_columns(
            request.schema.as_deref().unwrap_or(""),
            request.schema.as_deref().unwrap_or("public"),
            &request.table
        ).await {
            Ok(cols) => cols,
            Err(e) => {
                let error_response = TableDataResponse::Error {
                    code: "METADATA_FETCH_FAILED".to_string(),
                    message: e.to_string(),
                };
                let _ = app_handle_clone.emit(&event_name_clone, &error_response);
                return;
            }
        };
        
        // Determine selected columns
        let selected = if let Some(ref select_cols) = request.select {
            // Validate selected columns exist
            for col in select_cols {
                if !columns.iter().any(|c| &c.name == col) {
                    let error_response = TableDataResponse::Error {
                        code: "INVALID_COLUMN".to_string(),
                        message: format!("Column '{}' does not exist in table", col),
                    };
                    let _ = app_handle_clone.emit(&event_name_clone, &error_response);
                    return;
                }
            }
            select_cols.clone()
        } else {
            columns.iter().map(|c| c.name.clone()).collect()
        };
        
        // Send metadata
        let meta_response = TableDataResponse::Meta {
            table: request.table.clone(),
            schema: request.schema.clone(),
            columns: columns.clone(),
            selected: selected.clone(),
            page_size: match &request.pagination {
                PaginationMode::Offset { limit, .. } => *limit,
                PaginationMode::Cursor { .. } => 100,
            },
            cursor_key_columns: vec![], // Will be determined based on primary keys
        };
        
        if let Err(e) = app_handle_clone.emit(&event_name_clone, &meta_response) {
            println!("[db_table_data] Failed to emit metadata: {}", e);
            return;
        }
        
        // Fetch and stream data
        match adapter.read_table_data(request.clone()).await {
            Ok((response, next_cursor)) => {
                if let TableDataResponse::Rows { rows, .. } = response {
                    let rows_response = TableDataResponse::Rows {
                        rows,
                        next_cursor,
                    };
                    let _ = app_handle_clone.emit(&event_name_clone, &rows_response);
                }
                
                // Send done message
                let _ = app_handle_clone.emit(&event_name_clone, &TableDataResponse::Done);
            }
            Err(e) => {
                let error_response = TableDataResponse::Error {
                    code: "QUERY_FAILED".to_string(),
                    message: e.to_string(),
                };
                let _ = app_handle_clone.emit(&event_name_clone, &error_response);
            }
        }
    });
    
    // Return the stream ID immediately
    Ok(stream_id)
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
        crate::database::adapter::types::DbType::Mssql => {
            // TODO: Fix tiberius compatibility issues
            Ok(TestConnectionResult { 
                success: false, 
                error_message: Some("MSSQL support is temporarily disabled due to driver compatibility issues".to_string()) 
            })
        }
        crate::database::adapter::types::DbType::Mariadb => {
            // MariaDB uses the same connection URL format as MySQL
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
    }
}