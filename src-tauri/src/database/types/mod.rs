pub mod converters;
pub mod postgres;
pub mod mysql;
pub mod sqlite;

pub use converters::*;

// Re-export all the main types from the old types.rs file
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl_mode: Option<String>,
    pub connect_timeout: Option<u64>,
    pub pool_max_connections: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryOptions {
    pub page_size: usize,
    pub timeout: Option<u64>,
    pub use_cursor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DbType {
    Postgres,
    Mysql,
    Sqlite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DbObjectKind {
    Table,
    View,
    MaterializedView,
    Function,
    Procedure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMeta {
    pub schema: String,
    pub name: String,
    pub kind: DbObjectKind,
    pub row_estimate: Option<i64>,
    pub size_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub db_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_pk: bool,
    pub is_fk: bool,
    pub ordinal: i32,
    pub precision: Option<i32>,
    pub scale: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryCursor {
    pub id: String,
    pub sql: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub page_size: usize,
    pub current_page: usize,
    pub total_rows: Option<usize>,
    pub is_complete: bool,
    pub created_at: Option<Instant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryPage {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub page: usize,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<i64>,
    pub execution_time_ms: f64,
}

pub type TransactionId = String;

// Response types for Tauri commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectResponse {
    pub connection_id: String,
    pub database_type: String,
    pub server_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryBeginResponse {
    pub cursor_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: Option<usize>,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryPageResponse {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryFetchResponse {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseListResponse {
    pub databases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaListResponse {
    pub schemas: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableListResponse {
    pub tables: Vec<TableMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnListResponse {
    pub columns: Vec<ColumnMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellUpdate {
    pub row_id: String,
    pub column: String,
    pub value: serde_json::Value,
}