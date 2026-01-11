use async_trait::async_trait;
use crate::error::Result;
use crate::types::{CellValueType, ConnectionProfile, ConnectionTestResult, QueryResult};
use std::any::Any;

#[async_trait]
pub trait DbAdapter: Send + Sync {
    /// Allow downcasting to concrete type
    fn as_any(&self) -> &dyn Any;

    /// Connect to the database
    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()>;

    /// Disconnect from the database
    async fn disconnect(&mut self) -> Result<()>;

    /// Test the connection configuration
    async fn test_connection(&self) -> Result<ConnectionTestResult>;

    /// Check if the connection is alive
    async fn is_connected(&self) -> bool;

    /// Execute a query and return rows (for metadata/introspection)
    async fn query(&self, sql: &str) -> Result<QueryResult>;

    /// Execute a query and return affected rows count (for INSERT/UPDATE/DELETE)
    async fn execute(&self, sql: &str) -> Result<u64>;
}
