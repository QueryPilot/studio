use crate::error::Result;
use crate::types::*;
use async_trait::async_trait;

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
