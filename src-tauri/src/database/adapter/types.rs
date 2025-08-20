use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DbType {
    Postgres,
    Mysql,
    Sqlite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub user: Option<String>, // Alias for username
    pub password: Option<String>,
    pub database_url: Option<String>, // Optional connection URL override
    pub pool_size: Option<u32>, // Alias for max_connections
    pub max_connections: u32,
    pub min_connections: u32,
    pub connection_timeout: u64,
    pub idle_timeout: u64,
    pub max_lifetime: u64,
    pub enable_health_check: Option<bool>,
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
pub enum DbObjectKind {
    Table,
    View,
    MaterializedView,
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
    #[serde(skip)]
    pub created_at: Option<Instant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryPage {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub page: usize,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryOptions {
    pub page_size: usize,
    pub max_rows: Option<usize>,
    pub timeout_ms: Option<u64>,
}

impl Default for QueryOptions {
    fn default() -> Self {
        Self {
            page_size: 100,
            max_rows: None,
            timeout_ms: Some(30000),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<String>,
    pub execution_time_ms: f64,
}

pub type TransactionId = String;