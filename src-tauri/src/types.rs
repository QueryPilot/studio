use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

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
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bastion: Option<BastionConfig>,
    pub options: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub group: Option<String>,
    #[serde(default)]
    pub safe_mode: Option<SafeMode>,
}

/// Per-connection safe mode that restricts what operations the GUI allows,
/// regardless of the actual database user's permissions.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SafeMode {
    ReadOnly,
    ReadWrite,
    ReadWriteUpdate,
    #[default]
    FullAccess,
}

impl ConnectionProfile {
    // identity is the provided id (UUID) from the frontend/vault
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DbType {
    PostgreSQL,
    MySQL,
    MariaDB,
    SQLite,
    SQLServer,
    // New paradigms
    MongoDB,
    Redis,
}

/// Database paradigm - categorizes databases by their query model
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseParadigm {
    Sql,
    Document,
    KeyValue,
}

impl DbType {
    /// Parse version string to detect MariaDB vs MySQL
    /// MariaDB version strings contain "MariaDB" (e.g., "10.11.2-MariaDB")
    pub fn detect_mysql_variant(version: &str) -> DbType {
        if version.to_lowercase().contains("mariadb") {
            DbType::MariaDB
        } else {
            DbType::MySQL
        }
    }

    /// Check if this is a MySQL-compatible database (MySQL or MariaDB)
    pub fn is_mysql_compatible(&self) -> bool {
        matches!(self, DbType::MySQL | DbType::MariaDB)
    }

    /// Get the database paradigm for this database type
    pub fn paradigm(&self) -> DatabaseParadigm {
        match self {
            DbType::PostgreSQL
            | DbType::MySQL
            | DbType::MariaDB
            | DbType::SQLite
            | DbType::SQLServer => DatabaseParadigm::Sql,
            DbType::MongoDB => DatabaseParadigm::Document,
            DbType::Redis => DatabaseParadigm::KeyValue,
        }
    }

    /// Check if this database uses SQL
    pub fn is_sql(&self) -> bool {
        self.paradigm() == DatabaseParadigm::Sql
    }

    /// Check if this is a document database
    pub fn is_document(&self) -> bool {
        self.paradigm() == DatabaseParadigm::Document
    }

    /// Check if this is a key-value database
    pub fn is_keyvalue(&self) -> bool {
        self.paradigm() == DatabaseParadigm::KeyValue
    }
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
    KeyFile {
        path: String,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BastionConfig {
    Ssh(SshTunnelConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHandle {
    pub id: String,
    pub columns: Vec<ColumnMeta>,
    pub estimated_rows: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: CellValueType,
    pub nullable: bool,
    pub primary_key: bool,
    pub db_type: String,
    pub type_oid: Option<u32>,
    #[serde(rename = "default")]
    pub default_value: Option<String>,
    pub comment: Option<String>,
    /// Enum values for enum types, domain info for domain types
    pub enum_values: Option<Vec<String>>,
    /// Type category: 'e' for enum, 'd' for domain, 'c' for composite, etc.
    pub type_category: Option<String>,
    /// Numeric precision (total digits) for numeric/decimal types
    pub precision: Option<i32>,
    /// Numeric scale (decimal places) for numeric/decimal types
    pub scale: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageChunk {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub has_more: bool,
    pub rows_fetched: usize,
    pub timing: Option<PageTiming>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_time_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageTiming {
    pub fetch_ms: u32,
    pub decode_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

// NEW: Lightweight streaming value - NO display_value allocation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CellValue {
    Null,
    Bool(bool),
    I16(i16),
    I32(i32),
    I64(i64),
    F32(f32),
    F64(f64),
    Text(String),
    Bytes(Vec<u8>),
    // Timestamps stored as microseconds since epoch
    Timestamp(i64),
    // Dates stored as days since epoch
    Date(i32),
    // Arrays and complex types as JSON
    Json(serde_json::Value),
}

impl std::fmt::Display for CellValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CellValue::Null => Ok(()),
            CellValue::Bool(b) => write!(f, "{}", b),
            CellValue::I16(i) => write!(f, "{}", i),
            CellValue::I32(i) => write!(f, "{}", i),
            CellValue::I64(i) => write!(f, "{}", i),
            CellValue::F32(v) => write!(f, "{}", v),
            CellValue::F64(v) => write!(f, "{}", v),
            CellValue::Text(s) => f.write_str(s),
            CellValue::Bytes(b) => write!(f, "<Binary {} bytes>", b.len()),
            CellValue::Timestamp(micros) => {
                use chrono::DateTime;
                if let Some(dt) = DateTime::from_timestamp_micros(*micros) {
                    write!(f, "{}", dt.format("%Y-%m-%d %H:%M:%S"))
                } else {
                    write!(f, "{}", micros)
                }
            }
            CellValue::Date(days) => {
                use chrono::NaiveDate;
                if let Some(date) = NaiveDate::from_ymd_opt(1970, 1, 1)
                    .and_then(|epoch| epoch.checked_add_days(chrono::Days::new(*days as u64)))
                {
                    write!(f, "{}", date.format("%Y-%m-%d"))
                } else {
                    write!(f, "{}", days)
                }
            }
            CellValue::Json(v) => write!(f, "{}", v),
        }
    }
}

impl CellValue {
    pub fn null() -> Self {
        CellValue::Null
    }

    pub fn text(value: impl Into<String>) -> Self {
        CellValue::Text(value.into())
    }

    pub fn integer(value: i64) -> Self {
        CellValue::I64(value)
    }

    pub fn boolean(value: bool) -> Self {
        CellValue::Bool(value)
    }

    pub fn bytes(value: Vec<u8>) -> Self {
        CellValue::Bytes(value)
    }

    pub fn timestamp(micros: i64) -> Self {
        CellValue::Timestamp(micros)
    }

    pub fn date(days: i32) -> Self {
        CellValue::Date(days)
    }

    pub fn json(value: serde_json::Value) -> Self {
        CellValue::Json(value)
    }


    /// Check if value is empty (null or empty string)
    pub fn is_empty(&self) -> bool {
        match self {
            CellValue::Null => true,
            CellValue::Text(s) => s.is_empty(),
            _ => false,
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
    ArrayMultiDim {
        base: Box<CellValueType>,
        dimensions: Vec<usize>,
    },
    CustomType(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DbSpecificValue {
    PostgreSQL(PostgresValue),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostgresValue {
    pub oid: u32,
    pub type_name: String,
    pub type_modifier: i32,
}

// Database introspection types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub name: String,
    pub owner: Option<String>,
    pub encoding: Option<String>,
    pub collation: Option<String>,
    pub size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    pub name: String,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct View {
    pub schema: String,
    pub name: String,
    pub owner: Option<String>,
    pub definition: Option<String>,
    pub is_materialized: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub name: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub is_partial: bool,
    pub definition: String,
    pub is_foreign_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexUsageStats {
    pub index_name: String,
    pub scan_count: Option<i64>,
    pub rows_read: Option<i64>,
    pub rows_returned: Option<i64>,
    pub last_accessed: Option<String>,
    pub last_used: Option<String>, // ISO timestamp of last index scan (PG16+)
    pub cache_hit_ratio: Option<f64>,
    pub size_bytes: Option<i64>,
    pub size_pretty: Option<String>,
    pub is_unused: bool,
    pub efficiency_score: Option<i32>, // 0-100
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: String,
    pub db_type: DbType,
    pub database: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub success: bool,
    pub message: String,
    pub version: Option<String>,
    pub warnings: Vec<String>,
    /// Detected database type (e.g., MariaDB detected from MySQL connection)
    /// Only set when detected type differs from configured type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_db_type: Option<DbType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHealth {
    pub connection_id: String,
    pub status: String,
    pub healthy: bool,
    pub rtt_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStats {
    pub query_count: usize,
    pub active_queries: usize,
    #[serde(skip)]
    pub created_at: Instant,
    #[serde(skip)]
    pub last_used: Instant,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerStats {
    pub total_connections: usize,
    pub active_connections: usize,
    pub total_queries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    pub name: String,
    pub schema: String,
    pub table_name: String,
    pub event: String,  // INSERT, UPDATE, DELETE, TRUNCATE
    pub timing: String, // BEFORE, AFTER, INSTEAD OF
    pub level: String,  // ROW, STATEMENT
    pub enabled: bool,
    pub function: String,
    pub condition: Option<String>,
}

// Filter and Sort types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    pub column: String,
    pub operator: FilterOperator,
    pub value: serde_json::Value,
    #[serde(default)]
    pub case_sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[derive(Default)]
pub enum NullsPosition {
    First,
    #[default]
    Last,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
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

// ============================================================================
// STREAMING PROTOCOL TYPES - For channel-based query streaming
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamMessage {
    Started {
        columns: Vec<ColumnMeta>,
        #[serde(skip_serializing_if = "Option::is_none")]
        estimated_rows: Option<i64>,
    },
    // NOTE: Batch data now sent via separate data_channel as Response (raw binary)
    // Metadata-only messages below:
    Success {
        total_rows: usize,
        execution_time_ms: u64,
        // Detailed timing metrics
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor_setup_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_streaming_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fetch_count: Option<u64>,
        // Performance breakdown
        #[serde(skip_serializing_if = "Option::is_none")]
        network_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        conversion_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ipc_send_ms: Option<u64>,
    },
    Error {
        code: String,
        message: String,
    },
    Interrupted {
        resumable: bool,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamQueryParams {
    pub conn_id: String,
    pub sql: String,
    pub batch_size: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DocumentStreamMessage {
    Started {
        collection: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        estimated_count: Option<u64>,
    },
    Success {
        total_documents: usize,
        execution_time_ms: u64,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum KeyValueStreamMessage {
    Started {
        pattern: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        estimated_keys: Option<u64>,
    },
    Progress {
        cursor: u64,
        keys_so_far: usize,
    },
    Success {
        total_keys: usize,
        execution_time_ms: u64,
    },
    Error {
        code: String,
        message: String,
    },
}
