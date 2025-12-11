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
    /// Default schema for PostgreSQL (search_path) or SQL Server (default schema)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub default_schema: Option<String>,
}

impl ConnectionProfile {
    // identity is the provided id (UUID) from the frontend/vault
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
    KeyFile {
        path: String,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BastionConfig {
    Ssh(SshTunnelConfig),
    AwsSsm(AwsSsmConfig),
    EcsBastion(EcsBastionConfig),
}

/// ECS Bastion configuration for ephemeral Fargate-based bastion hosts
/// Launches an ECS task that registers with SSM, then SSH tunnels through it
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcsBastionConfig {
    /// ECS cluster name (e.g., "ecs-ssm-bastion-cluster")
    pub cluster_name: String,
    /// ECS task definition name (e.g., "ecs-ssm-bastion")
    pub task_definition: String,
    /// AWS region (e.g., "ap-southeast-2")
    pub region: String,
    /// Authentication method for AWS API calls
    pub auth: AwsAuthMethod,
    /// Target database host (internal VPC address)
    pub remote_host: String,
    /// Target database port
    pub remote_port: u16,
    /// Optional: Subnet filter tags (e.g., ["private-a", "private-b"])
    #[serde(default)]
    pub subnet_tags: Vec<String>,
    /// Optional: Security group tag key=value (e.g., "Bastion=SSM")
    pub security_group_tag: Option<String>,
    /// Optional: IAM role for the ECS task
    pub task_role_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsSsmConfig {
    pub target_id: String,
    pub region: String,
    pub auth: AwsAuthMethod,
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AwsAuthMethod {
    OAuthFederated(OAuthConfig),
    AwsProfile {
        profile_name: String,
    },
    IamRole {
        role_arn: String,
    },
    AccessKey {
        access_key_id: String,
    },
    /// Azure AD SAML authentication (AssumeRoleWithSAML)
    AzureAdSaml(AzureAdSamlConfig),
}

/// Azure AD SAML configuration for AWS federated authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureAdSamlConfig {
    /// Azure AD tenant ID (e.g., "53c4eee7-df48-4119-b261-da130f3e1a32")
    pub tenant_id: String,
    /// Azure App ID URI (e.g., "https://signin.aws.amazon.com/saml#2")
    pub app_id_uri: String,
    /// Optional: Pre-selected IAM role ARN
    pub default_role_arn: Option<String>,
    /// Optional: Session duration in hours (1-12, default: 1)
    pub duration_hours: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthConfig {
    pub provider: OAuthProvider,
    pub client_id: String,
    pub tenant_id: Option<String>,
    pub organization: Option<String>,
    pub domain: Option<String>,
    pub scopes: Vec<String>,
    pub assume_role_arn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OAuthProvider {
    Microsoft,
    Google,
    Okta,
    Auth0,
    Keycloak,
    Generic {
        name: String,
        auth_url: String,
        token_url: String,
        issuer: String,
    },
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
    /// Source table name (for query results with JOINs)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_name: Option<String>,
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
pub struct PageChunk {
    pub rows: Vec<Vec<serde_json::Value>>,
    pub has_more: bool,
    pub rows_fetched: usize,
    pub timing: Option<PageTiming>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_time_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageTiming {
    pub fetch_ms: u32,
    pub decode_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

    /// Extract string representation for backward compatibility
    pub fn to_string(&self) -> String {
        match self {
            CellValue::Null => String::new(),
            CellValue::Bool(b) => b.to_string(),
            CellValue::I16(i) => i.to_string(),
            CellValue::I32(i) => i.to_string(),
            CellValue::I64(i) => i.to_string(),
            CellValue::F32(f) => f.to_string(),
            CellValue::F64(f) => f.to_string(),
            CellValue::Text(s) => s.clone(),
            CellValue::Bytes(b) => format!("<Binary {} bytes>", b.len()),
            CellValue::Timestamp(micros) => {
                // Format timestamp
                use chrono::DateTime;
                if let Some(dt) = DateTime::from_timestamp_micros(*micros) {
                    dt.format("%Y-%m-%d %H:%M:%S").to_string()
                } else {
                    micros.to_string()
                }
            }
            CellValue::Date(days) => {
                // Format date
                use chrono::NaiveDate;
                if let Some(date) = NaiveDate::from_ymd_opt(1970, 1, 1)
                    .and_then(|epoch| epoch.checked_add_days(chrono::Days::new(*days as u64)))
                {
                    date.format("%Y-%m-%d").to_string()
                } else {
                    days.to_string()
                }
            }
            CellValue::Json(v) => v.to_string(),
        }
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
    pub is_foreign_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub event: String,  // INSERT, UPDATE, DELETE, TRUNCATE
    pub timing: String, // BEFORE, AFTER, INSTEAD OF
    pub level: String,  // ROW, STATEMENT
    pub enabled: bool,
    pub function: String,
    pub condition: Option<String>,
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

// ============================================================================
// CRUD STAGING TRANSACTION TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrudTransaction {
    pub id: String,
    pub commands: Vec<CrudCommand>,
    #[serde(default)]
    pub rollback_on_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrudCommand {
    pub id: String,
    pub operation_type: String,
    pub target: CrudCommandTarget,
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<CrudCommandMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrudCommandTarget {
    pub connection_id: String, // REQUIRED - identifies which connection to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrudCommandMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_rows: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp_id: Option<String>, // Client-side temp ID for new rows
}

// Lightweight summary for committed commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSummary {
    pub id: String,
    pub operation_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_rows: Option<u64>,
}

// Detailed error information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub severity: String, // "info", "warning", "error"
    pub recoverable: bool,
}

// Failure record for failed commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandFailure {
    pub id: String,
    pub operation_type: String,
    pub error: CommandError,
    pub rolled_back: bool,
}

// Complete transaction result with ID mappings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionResult {
    pub transaction_id: String,
    pub success: bool,
    pub duration_ms: u64,
    pub committed: Vec<CommandSummary>,
    pub failures: Vec<CommandFailure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<CommandError>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_mappings: Option<HashMap<String, String>>, // temp ID → permanent ID
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
    LimitApplied {
        original_sql: String,
        applied_limit: usize,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamQueryParams {
    pub conn_id: String,
    pub sql: String,
    pub batch_size: Option<usize>,
}
