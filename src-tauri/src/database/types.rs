use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum DbType { 
    Postgres, 
    Mysql, 
    Sqlite,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConnectionConfig {
    pub db_type: DbType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub database_url: Option<String>,
    pub pool_size: Option<u32>,
    pub enable_health_check: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TableMeta {
    pub schema: String,
    pub name: String,
    pub kind: DbObjectKind,
    pub row_estimate: Option<i64>,
    pub size_bytes: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum DbObjectKind {
    Table,
    View,
    MaterializedView,
    Function,
    Procedure,
    Trigger,
    Sequence,
    Index,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<String>,
    pub execution_time_ms: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QueryOptions {
    pub page_size: usize,
    pub read_only: bool,
    pub max_rows: Option<usize>,
    pub timeout_ms: Option<u64>,
    pub explain: bool,
    pub allow_multiple: bool,
}

impl Default for QueryOptions {
    fn default() -> Self {
        Self {
            page_size: 1000,
            read_only: false,
            max_rows: None,
            timeout_ms: Some(30000),
            explain: false,
            allow_multiple: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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

#[derive(Serialize, Deserialize, Debug)]
pub struct QueryPage {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub page: usize,
    pub is_complete: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct QueryBeginResponse {
    pub cursor_id: String,
    pub columns: Vec<ColumnMeta>,
    pub total_approx: Option<usize>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct QueryFetchResponse {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub page: usize,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ConnectResponse {
    pub connection_id: String,
    pub server_version: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CellUpdate {
    pub schema: String,
    pub table: String,
    pub pk: serde_json::Map<String, serde_json::Value>,
    pub column: String,
    pub new_value: serde_json::Value,
}

pub type TransactionId = String;