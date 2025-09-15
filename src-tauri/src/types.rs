use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    // TODO: Encrypt passwords before storing in production
    pub password: Option<String>,
    pub ssl_mode: Option<SslMode>,
    pub ssl_config: Option<SslConfig>,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub options: HashMap<String, String>,
}

impl ConnectionProfile {
    pub fn connection_key(&self) -> String {
        // Format: {db_type}://{host}:{port}/{database}#{username}
        // This ensures unique keys for connections to different database types
        format!("{:?}://{}:{}/{}#{}", 
            self.db_type, 
            self.host, 
            self.port, 
            self.database, 
            self.username
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum DbType {
    PostgreSQL,
    MySQL,
    SQLite,
    SQLServer,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SslMode {
    Disable,
    Require,
    VerifyCa,
    VerifyFull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslConfig {
    pub key_file: Option<String>,
    pub cert_file: Option<String>,
    pub ca_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SshAuthMethod {
    Password(String),
    KeyFile { path: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHandle {
    pub id: String,
    pub columns: Vec<ColumnMeta>,
    pub estimated_rows: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: CellValueType,
    pub nullable: bool,
    pub primary_key: bool,
    pub db_type: String,
    pub type_oid: Option<u32>,
    pub default_value: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageChunk {
    pub rows: Vec<Vec<CellValue>>,
    pub has_more: bool,
    pub rows_fetched: usize,
    pub timing: Option<PageTiming>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageTiming {
    pub fetch_ms: u32,
    pub decode_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellValue {
    pub value_type: CellValueType,
    pub raw_value: Option<Vec<u8>>,
    pub display_value: String,
    pub db_specific: Option<DbSpecificValue>,
}

impl CellValue {
    pub fn null() -> Self {
        CellValue {
            value_type: CellValueType::Null,
            raw_value: None,
            display_value: String::new(),
            db_specific: None,
        }
    }
    
    pub fn text(value: impl Into<String>) -> Self {
        let val = value.into();
        CellValue {
            value_type: CellValueType::Text,
            raw_value: None,
            display_value: val,
            db_specific: None,
        }
    }
    
    pub fn integer(value: i64) -> Self {
        CellValue {
            value_type: CellValueType::Integer,
            raw_value: None,
            display_value: value.to_string(),
            db_specific: None,
        }
    }
    
    pub fn boolean(value: bool) -> Self {
        CellValue {
            value_type: CellValueType::Boolean,
            raw_value: None,
            display_value: value.to_string(),
            db_specific: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CellValueType {
    // Standard types (shared across all databases)
    Null,
    Text,
    Integer,
    Decimal,
    Boolean,
    Date,
    Time,
    DateTime,
    Binary,
    Json,
    
    // PostgreSQL specific types
    Array(Box<CellValueType>),
    Composite(Vec<(String, CellValueType)>),
    Range(Box<CellValueType>),
    Multirange(Box<CellValueType>),
    Geometry,
    Geography,
    Box2d,
    Box3d,
    Path,
    Polygon,
    Circle,
    Xml,
    Uuid,
    Cidr,
    Inet,
    MacAddr,
    MacAddr8,
    Interval,
    TsVector,
    TsQuery,
    Ltree,
    Lquery,
    Ltxtquery,
    Hstore,
    Cube,
    Enum(String),
    Domain(String),
    Void,
    Trigger,
    EventTrigger,
    Money,
    PgLsn,
    PgSnapshot,
    Txid,
    Xid8,
    Bit,
    VarBit,
    
    // Type modifiers
    ArrayMultiDim { base: Box<CellValueType>, dimensions: Vec<usize> },
    CustomType(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DbSpecificValue {
    PostgreSQL(PostgresValue),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostgresValue {
    pub oid: u32,
    pub type_name: String,
    pub type_modifier: i32,
}

// Database introspection types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Database {
    pub name: String,
    pub owner: Option<String>,
    pub encoding: Option<String>,
    pub collation: Option<String>,
    pub size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schema {
    pub name: String,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Table {
    pub schema: String,
    pub name: String,
    pub kind: TableKind,
    pub owner: Option<String>,
    pub size: Option<String>,
    pub row_count: Option<i64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum TableKind {
    Regular,
    Partitioned,
    Foreign,
    Temporary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct View {
    pub schema: String,
    pub name: String,
    pub owner: Option<String>,
    pub definition: Option<String>,
    pub is_materialized: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Function {
    pub schema: String,
    pub name: String,
    pub arguments: String,
    pub return_type: String,
    pub language: String,
    pub is_aggregate: bool,
    pub is_window: bool,
    pub is_trigger: bool,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    pub name: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub is_partial: bool,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexUsageStats {
    pub index_name: String,
    pub scan_count: Option<i64>,
    pub rows_read: Option<i64>,
    pub rows_returned: Option<i64>,
    pub last_accessed: Option<String>,
    pub cache_hit_ratio: Option<f64>,
    pub size_bytes: Option<i64>,
    pub size_pretty: Option<String>,
    pub is_unused: bool,
    pub efficiency_score: Option<i32>, // 0-100
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraint {
    pub name: String,
    pub table_name: String,
    pub constraint_type: ConstraintType,
    pub definition: String,
    pub foreign_table: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConstraintType {
    PrimaryKey,
    ForeignKey,
    Unique,
    Check,
    Exclusion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub id: String,
    pub db_type: DbType,
    pub database: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub message: String,
    pub version: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionHealth {
    pub connection_id: String,
    pub status: String,
    pub healthy: bool,
    pub rtt_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionStats {
    pub query_count: usize,
    pub active_queries: usize,
    #[serde(skip)]
    pub created_at: Instant,
    #[serde(skip)]
    pub last_used: Instant,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagerStats {
    pub total_connections: usize,
    pub active_connections: usize,
    pub total_queries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trigger {
    pub name: String,
    pub schema: String,
    pub table_name: String,
    pub event: String,        // INSERT, UPDATE, DELETE, TRUNCATE
    pub timing: String,       // BEFORE, AFTER, INSTEAD OF
    pub level: String,        // ROW, STATEMENT
    pub enabled: bool,
    pub function: String,
    pub condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDataResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<CellValue>>,
    pub has_more: bool,
    pub total_count: Option<i64>,
}

// Filter and Sort types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterConfig {
    pub root: FilterNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterNode {
    Condition(FilterCondition),
    Group(FilterGroup),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCondition {
    pub column: String,
    pub operator: FilterOperator,
    pub value: serde_json::Value,
    #[serde(default)]
    pub case_sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterGroup {
    pub logic: LogicOperator,
    pub conditions: Vec<FilterNode>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogicOperator {
    And,
    Or,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    Between,
    In,
    NotIn,
    IsNull,
    IsNotNull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortConfig {
    pub column: String,
    pub direction: SortDirection,
    #[serde(default)]
    pub nulls_position: NullsPosition,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NullsPosition {
    First,
    Last,
}

impl Default for NullsPosition {
    fn default() -> Self {
        NullsPosition::Last
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    Started { 
        columns: Vec<ColumnMeta>,
        estimated_rows: Option<i64>,
    },
    Data {
        rows: Vec<Vec<CellValue>>,
        row_offset: usize,
    },
    Progress {
        rows_fetched: usize,
        percentage: Option<f32>,
    },
    Completed {
        total_rows: usize,
        execution_time_ms: u64,
    },
    Error {
        message: String,
        code: Option<String>,
    },
}