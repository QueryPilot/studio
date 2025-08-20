pub mod adapter;
pub mod connection_manager;
pub mod executor;
pub mod registry;

use serde::{Deserialize, Serialize};
use crate::database::connection_manager::{ConnectionManager, ConnectionConfig, DatabaseType, QueryResult, ConnectionStatus};
use std::sync::Arc;
use tokio::sync::RwLock;

pub use adapter::DbAdapter;
pub use executor::QueryExecutor;
pub use registry::ConnectionRegistry;

// Keep existing structs for compatibility
#[derive(Debug, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub size: Option<String>,
    pub encoding: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: String,
    pub table_type: String,
    pub row_count: Option<i64>,
    pub size: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub default_value: Option<String>,
    pub foreign_key: Option<ForeignKeyInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub table: String,
    pub column: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ViewInfo {
    pub name: String,
    pub schema: String,
    pub definition: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FunctionInfo {
    pub name: String,
    pub schema: String,
    pub return_type: String,
    pub arguments: Vec<String>,
}

// New secure database commands that use connection manager
#[tauri::command]
pub async fn create_db_connection(
    state: tauri::State<'_, Arc<RwLock<ConnectionManager>>>,
    connection_id: String,
    name: String,
    db_type: String,
    host: String,
    port: u16,
    database: String,
    username: String,
) -> Result<String, String> {
    let db_type = match db_type.as_str() {
        "postgresql" => DatabaseType::PostgreSQL,
        "mysql" => DatabaseType::MySQL,
        "sqlite" => DatabaseType::SQLite,
        _ => return Err(format!("Unsupported database type: {}", db_type)),
    };
    
    let config = ConnectionConfig {
        id: connection_id.clone(),
        name,
        db_type,
        host,
        port,
        database,
        username,
        password: None, // Will be fetched from secure storage
        max_connections: 10,
        min_connections: 2,
        connection_timeout: 30,
        idle_timeout: 600,
        max_lifetime: 1800,
    };
    
    let manager = state.read().await;
    manager.create_connection(config).await
}

#[tauri::command]
pub async fn test_db_connection(
    state: tauri::State<'_, Arc<RwLock<ConnectionManager>>>,
    connection_id: String,
) -> Result<bool, String> {
    let manager = state.read().await;
    manager.test_connection(&connection_id).await
}

#[tauri::command]
pub async fn execute_db_query(
    state: tauri::State<'_, Arc<RwLock<ConnectionManager>>>,
    connection_id: String,
    query: String,
) -> Result<QueryResult, String> {
    let manager = state.read().await;
    manager.execute_query(&connection_id, &query).await
}

#[tauri::command]
pub async fn close_db_connection(
    state: tauri::State<'_, Arc<RwLock<ConnectionManager>>>,
    connection_id: String,
) -> Result<(), String> {
    let manager = state.read().await;
    manager.close_connection(&connection_id).await
}

#[tauri::command]
pub async fn get_db_connection_status(
    state: tauri::State<'_, Arc<RwLock<ConnectionManager>>>,
    connection_id: String,
) -> Result<ConnectionStatus, String> {
    let manager = state.read().await;
    manager.get_connection_status(&connection_id).await
}

// Schema metadata commands
#[tauri::command]
pub async fn get_db_tables(
    state: tauri::State<'_, Arc<RwLock<ConnectionManager>>>,
    connection_id: String,
) -> Result<Vec<TableInfo>, String> {
    let manager = state.read().await;
    
    // Fast query using PostgreSQL system catalogs instead of slow information_schema
    let query = r#"
        SELECT 
            c.relname as name,
            n.nspname as schema,
            CASE c.relkind 
                WHEN 'r' THEN 'BASE TABLE'
                WHEN 'p' THEN 'PARTITIONED TABLE'
                WHEN 'f' THEN 'FOREIGN TABLE'
                ELSE 'TABLE'
            END as table_type
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'f')  -- regular tables, partitioned tables, foreign tables
          AND n.nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
          AND n.nspname NOT LIKE 'pg_temp_%'
          AND n.nspname NOT LIKE 'pg_toast_%'
        ORDER BY n.nspname, c.relname
    "#;
    
    let result = manager.execute_query(&connection_id, query).await?;
    
    let tables: Vec<TableInfo> = result.rows.iter().map(|row| {
        TableInfo {
            name: row.get(0).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            schema: row.get(1).and_then(|v| v.as_str()).unwrap_or("public").to_string(),
            table_type: row.get(2).and_then(|v| v.as_str()).unwrap_or("BASE TABLE").to_string(),
            row_count: None,
            size: None,
        }
    }).collect();
    
    Ok(tables)
}

#[tauri::command]
pub async fn get_db_views(
    state: tauri::State<'_, Arc<RwLock<ConnectionManager>>>,
    connection_id: String,
) -> Result<Vec<ViewInfo>, String> {
    let manager = state.read().await;
    
    // Fast query using PostgreSQL system catalogs for views
    let query = r#"
        SELECT 
            c.relname as name,
            n.nspname as schema
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'v'  -- views only
          AND n.nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
          AND n.nspname NOT LIKE 'pg_temp_%'
          AND n.nspname NOT LIKE 'pg_toast_%'
        ORDER BY n.nspname, c.relname
    "#;
    
    let result = manager.execute_query(&connection_id, query).await?;
    
    let views: Vec<ViewInfo> = result.rows.iter().map(|row| {
        ViewInfo {
            name: row.get(0).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            schema: row.get(1).and_then(|v| v.as_str()).unwrap_or("public").to_string(),
            definition: None,
        }
    }).collect();
    
    Ok(views)
}

#[tauri::command]
pub async fn get_db_functions(
    state: tauri::State<'_, Arc<RwLock<ConnectionManager>>>,
    connection_id: String,
) -> Result<Vec<FunctionInfo>, String> {
    let manager = state.read().await;
    
    // Fast query using PostgreSQL system catalogs for functions
    let query = r#"
        SELECT 
            p.proname as name,
            n.nspname as schema,
            CASE 
                WHEN p.prokind = 'f' THEN 'FUNCTION'
                WHEN p.prokind = 'p' THEN 'PROCEDURE'
                WHEN p.prokind = 'a' THEN 'AGGREGATE'
                WHEN p.prokind = 'w' THEN 'WINDOW'
                ELSE 'FUNCTION'
            END as return_type
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
          AND n.nspname NOT LIKE 'pg_temp_%'
          AND n.nspname NOT LIKE 'pg_toast_%'
        ORDER BY n.nspname, p.proname
    "#;
    
    let result = manager.execute_query(&connection_id, query).await?;
    
    let functions: Vec<FunctionInfo> = result.rows.iter().map(|row| {
        FunctionInfo {
            name: row.get(0).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            schema: row.get(1).and_then(|v| v.as_str()).unwrap_or("public").to_string(),
            return_type: row.get(2).and_then(|v| v.as_str()).unwrap_or("void").to_string(),
            arguments: vec![],
        }
    }).collect();
    
    Ok(functions)
}

// All legacy commands have been removed.
// Use the new secure database commands instead:
// - create_db_connection
// - test_db_connection
// - execute_db_query
// - close_db_connection
// - get_db_connection_status
// - get_db_tables
// - get_db_views
// - get_db_functions