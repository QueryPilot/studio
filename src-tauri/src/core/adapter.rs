use crate::error::Result;
use crate::types::*;
use async_trait::async_trait;

/// Parameterized query value - safe for SQL injection prevention
#[derive(Debug, Clone)]
pub enum SqlParam {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Json(serde_json::Value),
}

impl SqlParam {
    /// Convert from serde_json::Value
    pub fn from_json(value: &serde_json::Value) -> Self {
        match value {
            serde_json::Value::Null => SqlParam::Null,
            serde_json::Value::Bool(b) => SqlParam::Bool(*b),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    SqlParam::Int(i)
                } else if let Some(f) = n.as_f64() {
                    SqlParam::Float(f)
                } else {
                    SqlParam::Text(n.to_string())
                }
            }
            serde_json::Value::String(s) => SqlParam::Text(s.clone()),
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                SqlParam::Json(value.clone())
            }
        }
    }
}

/// Parameterized SQL statement
#[derive(Debug, Clone)]
pub struct ParameterizedSql {
    pub sql: String,
    pub params: Vec<SqlParam>,
}

impl ParameterizedSql {
    pub fn new(sql: impl Into<String>, params: Vec<SqlParam>) -> Self {
        Self {
            sql: sql.into(),
            params,
        }
    }
}

/// Database adapter trait for connection management and query execution.
///
/// NOTE: Introspection methods (get_databases, get_schemas, get_tables, etc.) have been
/// removed. The frontend now uses IntrospectionService which generates dialect-specific SQL
/// and executes via the `query` method. See: src/services/introspectionService.ts
#[async_trait]
pub trait DbAdapter: Send + Sync {
    // Downcasting support for database-specific features
    fn as_any(&self) -> &dyn std::any::Any;

    // Connection management
    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()>;
    async fn disconnect(&mut self) -> Result<()>;
    async fn test_connection(&self) -> Result<ConnectionTestResult>;
    async fn is_connected(&self) -> bool;

    // Query execution (used by frontend IntrospectionService for dialect-specific queries)
    async fn query(&self, sql: &str) -> Result<QueryResult>;
    async fn execute(&self, sql: &str) -> Result<u64>;

    // Database-specific features
    fn get_supported_types(&self) -> Vec<CellValueType>;
    fn supports_schemas(&self) -> bool {
        true
    }
    fn supports_procedures(&self) -> bool {
        false
    }
    fn supports_functions(&self) -> bool {
        true
    }
    fn supports_streaming(&self) -> bool {
        true
    }
}
