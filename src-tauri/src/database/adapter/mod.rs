use async_trait::async_trait;
use serde_json::Value;
use std::time::Duration;

use crate::error::AppError;

pub mod types;
pub use types::*;

pub mod postgres;
pub mod mysql;
pub mod sqlite;
pub mod mssql;
pub mod mongodb;

#[cfg(test)]
mod postgres_test;

#[cfg(test)]
mod mysql_test;

#[cfg(test)]
mod mongodb_test;

#[async_trait]
pub trait DbAdapter: Send + Sync {
    // For downcasting
    fn as_any(&self) -> &dyn std::any::Any;
    // Connection management
    async fn ping(&self) -> Result<Duration, AppError>;
    async fn disconnect(&self) -> Result<(), AppError>;
    
    // Database/Schema discovery
    async fn list_databases(&self) -> Result<Vec<String>, AppError>;
    async fn list_schemas(&self, database: &str) -> Result<Vec<String>, AppError>;
    
    // Table metadata
    async fn list_tables(&self, database: &str, schema: &str) 
        -> Result<Vec<TableMeta>, AppError>;
    async fn list_functions(&self, database: &str, schema: &str) 
        -> Result<Vec<FunctionMeta>, AppError>;
    async fn table_columns(&self, database: &str, schema: &str, table: &str) 
        -> Result<Vec<ColumnMeta>, AppError>;
    async fn table_triggers(&self, database: &str, schema: &str, table: &str) 
        -> Result<Vec<TriggerMeta>, AppError>;
    async fn table_indexes(&self, database: &str, schema: &str, table: &str) 
        -> Result<Vec<TableIndex>, AppError>;
    async fn estimate_count(&self, database: &str, schema: &str, table: &str) 
        -> Result<i64, AppError>;
    
    // Query execution with cursors
    async fn begin_query(&self, sql: &str, params: Option<Vec<Value>>, 
                         opts: QueryOptions) -> Result<QueryCursor, AppError>;
    async fn fetch_page(&self, cursor: &mut QueryCursor, page: usize, 
                        page_size: usize) -> Result<QueryPage, AppError>;
    async fn close_cursor(&self, cursor_id: &str) -> Result<(), AppError>;
    
    // Direct execution (for DML)
    async fn execute(&self, sql: &str, params: Option<Vec<Value>>) 
        -> Result<ExecuteResult, AppError>;
    
    // Transactions (optional for now)
    async fn begin_transaction(&self) -> Result<TransactionId, AppError>;
    async fn commit(&self, tx_id: TransactionId) -> Result<(), AppError>;
    async fn rollback(&self, tx_id: TransactionId) -> Result<(), AppError>;
    
    // Server info
    async fn server_version(&self) -> Result<String, AppError>;
    
    // Table data reading with projection and filtering
    async fn read_table_data(&self, request: TableReadRequest) 
        -> Result<(TableDataResponse, Option<String>), AppError>;
    
    // Execute raw SQL query (for query editor)
    async fn execute_raw_query(
        &self,
        database: &str,
        query: &str,
        limit: u32,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>>;
}