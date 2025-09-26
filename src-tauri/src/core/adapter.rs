use crate::error::Result;
use crate::types::*;
use async_trait::async_trait;

#[async_trait]
pub trait DbAdapter: Send + Sync {
    // Connection management
    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()>;
    async fn disconnect(&mut self) -> Result<()>;
    async fn test_connection(&self) -> Result<ConnectionTestResult>;
    async fn is_connected(&self) -> bool;

    // Query execution with streaming
    async fn open_query(&self, sql: &str) -> Result<QueryHandle>;
    async fn fetch_page(&self, handle: &QueryHandle, max_rows: usize) -> Result<PageChunk>;
    async fn close_query(&self, handle: &QueryHandle) -> Result<()>;
    async fn cancel_query(&self, handle: &QueryHandle) -> Result<()>;

    // Simple query execution (for DDL, etc)
    async fn execute(&self, sql: &str) -> Result<u64>;

    // Complete introspection
    async fn get_databases(&self) -> Result<Vec<Database>>;
    async fn get_schemas(&self, database: &str) -> Result<Vec<Schema>>;
    async fn get_tables(&self, schema: &str) -> Result<Vec<Table>>;
    async fn get_views(&self, schema: &str) -> Result<Vec<View>>;
    async fn get_functions(&self, schema: &str) -> Result<Vec<Function>>;
    async fn get_indexes(&self, table: &str) -> Result<Vec<Index>>;
    async fn get_index_usage_stats(&self, table: &str) -> Result<Vec<IndexUsageStats>>;
    async fn get_supported_index_types(&self) -> Result<Vec<String>>;
    async fn get_supported_column_types(&self) -> Result<Vec<String>>;
    async fn get_constraints(&self, table: &str) -> Result<Vec<Constraint>>;

    // Table operations
    async fn get_table_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnMeta>>;
    async fn get_table_row_count(&self, schema: &str, table: &str) -> Result<i64>;
    async fn get_triggers(&self, schema: &str, table: &str) -> Result<Vec<Trigger>>;
    async fn get_object_definition(
        &self,
        database: &str,
        schema: &str,
        object_name: &str,
        object_type: &str,
    ) -> Result<String>;
    async fn get_table_data(
        &self,
        schema: &str,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> Result<TableDataResult>;
    async fn get_table_data_filtered(
        &self,
        schema: &str,
        table: &str,
        limit: usize,
        offset: usize,
        filters: Option<crate::types::FilterConfig>,
        sorts: Option<Vec<crate::types::SortConfig>>,
    ) -> Result<TableDataResult>;
    async fn get_table_count(&self, schema: &str, table: &str) -> Result<i64>;

    // Index operations
    async fn create_index(
        &self,
        schema: &str,
        table: &str,
        index: &CreateIndexRequest,
    ) -> Result<()>;
    async fn drop_index(&self, schema: &str, index_name: &str) -> Result<()>;
    async fn rename_index(&self, schema: &str, old_name: &str, new_name: &str) -> Result<()>;

    // Table structure operations
    async fn alter_table_add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<()>;
    async fn alter_table_drop_column(
        &self,
        schema: &str,
        table: &str,
        column_name: &str,
    ) -> Result<()>;
    async fn alter_table_modify_column(
        &self,
        schema: &str,
        table: &str,
        column: &ModifyColumnRequest,
    ) -> Result<()>;
    async fn alter_table_rename_column(
        &self,
        schema: &str,
        table: &str,
        old_name: &str,
        new_name: &str,
    ) -> Result<()>;
    async fn alter_table_add_foreign_key(
        &self,
        schema: &str,
        table: &str,
        fk: &AddForeignKeyRequest,
    ) -> Result<()>;
    async fn alter_table_drop_foreign_key(
        &self,
        schema: &str,
        table: &str,
        constraint_name: &str,
    ) -> Result<()>;

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
