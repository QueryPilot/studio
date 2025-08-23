use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DbType {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Mariadb,
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
    // MSSQL specific
    pub instance_name: Option<String>,
    pub encrypt: Option<bool>,
    pub trust_server_certificate: Option<bool>,
    pub auth_type: Option<String>, // "windows" or "sql"
    pub named_pipe: Option<bool>,
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
    // MSSQL specific
    pub is_identity: Option<bool>,
    pub is_computed: Option<bool>,
    pub is_hierarchyid: Option<bool>,
    pub is_spatial: Option<bool>,
    // MySQL/MariaDB specific
    pub is_json: Option<bool>,
    pub enum_values: Option<Vec<String>>,
    pub set_values: Option<Vec<String>>,
    pub is_virtual: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionMeta {
    pub schema: String,
    pub name: String,
    pub return_type: String,
    pub arguments: Vec<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryBeginResponse {
    pub cursor_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: Option<usize>,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryFetchResponse {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub page: usize,
    pub is_complete: bool,
}

// Table data reading types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableReadRequest {
    pub schema: Option<String>,
    pub table: String,
    pub select: Option<Vec<String>>,
    pub sorts: Vec<SortSpec>,
    pub filters: Vec<FilterSpec>,
    pub search: Option<String>,
    pub pagination: PaginationMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortSpec {
    pub column: String,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterSpec {
    pub column: String,
    pub operator: FilterOperator,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum FilterOperator {
    #[serde(rename = "=")]
    Equal,
    #[serde(rename = "!=")]
    NotEqual,
    #[serde(rename = "<")]
    LessThan,
    #[serde(rename = "<=")]
    LessThanOrEqual,
    #[serde(rename = ">")]
    GreaterThan,
    #[serde(rename = ">=")]
    GreaterThanOrEqual,
    Like,
    ILike,
    In,
    #[serde(rename = "IS NULL")]
    IsNull,
    #[serde(rename = "IS NOT NULL")]
    IsNotNull,
    Between,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PaginationMode {
    #[serde(rename = "cursor")]
    Cursor { cursor: Option<String> },
    #[serde(rename = "offset")]
    Offset { offset: usize, limit: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDataCursor {
    pub connection_id: String,
    pub table: String,
    pub schema: Option<String>,
    pub select: Option<Vec<String>>,
    pub sorts: Vec<SortSpec>,
    pub filters: Vec<FilterSpec>,
    pub search: Option<String>,
    pub offset: usize,
    pub keyset_values: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TableDataResponse {
    #[serde(rename = "meta")]
    Meta {
        table: String,
        schema: Option<String>,
        columns: Vec<ColumnMeta>,
        selected: Vec<String>,
        page_size: usize,
        cursor_key_columns: Vec<String>,
    },
    #[serde(rename = "rows")]
    Rows {
        rows: Vec<serde_json::Map<String, serde_json::Value>>,
        next_cursor: Option<String>,
    },
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error { code: String, message: String },
}