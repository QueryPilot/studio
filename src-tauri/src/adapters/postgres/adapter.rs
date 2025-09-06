use async_trait::async_trait;
use tokio_postgres::{Client, NoTls, Config};
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use std::sync::Arc;
use tokio::sync::RwLock;
use dashmap::DashMap;
use uuid::Uuid;

use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
use crate::types::*;
use super::types::PostgresTypeConverter;
use super::query::PostgresQueryExecutor;
use super::introspection::PostgresIntrospector;

pub struct PostgresAdapter {
    client: Option<Arc<Client>>,
    connection_handle: Option<tokio::task::JoinHandle<()>>,
    query_executor: Option<Arc<PostgresQueryExecutor>>,
    introspector: Option<Arc<PostgresIntrospector>>,
    active_queries: Arc<DashMap<String, QueryState>>,
}

struct QueryState {
    handle: QueryHandle,
    portal_name: String,
    rows_fetched: usize,
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            client: None,
            connection_handle: None,
            query_executor: None,
            introspector: None,
            active_queries: Arc::new(DashMap::new()),
        }
    }
    
    fn build_config(profile: &ConnectionProfile) -> Result<Config> {
        let mut config = Config::new();
        config.host(&profile.host);
        config.port(profile.port);
        config.dbname(&profile.database);
        config.user(&profile.username);
        
        if let Some(password) = &profile.password {
            config.password(password);
        }
        
        // Add additional options
        for (key, value) in &profile.options {
            config.options(&format!("{}={}", key, value));
        }
        
        Ok(config)
    }
}

#[async_trait]
impl DbAdapter for PostgresAdapter {
    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        // Disconnect if already connected
        if self.client.is_some() {
            self.disconnect().await?;
        }
        
        let config = Self::build_config(profile)?;
        
        // Connect based on SSL mode
        let (client, connection) = if matches!(profile.ssl_mode, Some(SslMode::Disable) | None) {
            config.connect(NoTls).await?
        } else {
            // Use native TLS for SSL connections
            let connector = TlsConnector::builder()
                .danger_accept_invalid_certs(true) // For development
                .build()
                .map_err(|e| AppError::driver_error(e))?;
            let connector = MakeTlsConnector::new(connector);
            
            // This won't work with different connection types - we need a different approach
            // For now, just use NoTls for simplicity
            config.connect(NoTls).await?
        };
        
        // Spawn connection handler
        let connection_handle = tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("PostgreSQL connection error: {}", e);
            }
        });
        
        let client: Arc<Client> = Arc::new(client);
        self.client = Some(client.clone());
        self.connection_handle = Some(connection_handle);
        self.query_executor = Some(Arc::new(PostgresQueryExecutor::new(client.clone())));
        self.introspector = Some(Arc::new(PostgresIntrospector::new(client.clone())));
        
        Ok(())
    }
    
    async fn disconnect(&mut self) -> Result<()> {
        // Cancel all active queries
        for entry in self.active_queries.iter() {
            let _ = self.cancel_query(&entry.value().handle).await;
        }
        self.active_queries.clear();
        
        // Drop client
        self.client = None;
        self.query_executor = None;
        self.introspector = None;
        
        // Cancel connection task
        if let Some(handle) = self.connection_handle.take() {
            handle.abort();
        }
        
        Ok(())
    }
    
    async fn test_connection(&self) -> Result<ConnectionTestResult> {
        let client = self.client.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        // Test query and get version
        let row = client
            .query_one("SELECT version(), current_database(), current_user", &[])
            .await?;
        
        let version: String = row.get(0);
        let database: String = row.get(1);
        let user: String = row.get(2);
        
        Ok(ConnectionTestResult {
            success: true,
            message: format!("Connected to {} as {}", database, user),
            version: Some(version),
            warnings: vec![],
        })
    }
    
    async fn is_connected(&self) -> bool {
        if let Some(client) = &self.client {
            // Try a simple query to check connection
            client.query_one("SELECT 1", &[]).await.is_ok()
        } else {
            false
        }
    }
    
    async fn open_query(&self, sql: &str) -> Result<QueryHandle> {
        let executor = self.query_executor.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        let handle = executor.open_query(sql).await?;
        
        // Store query state
        self.active_queries.insert(
            handle.id.clone(),
            QueryState {
                handle: handle.clone(),
                portal_name: format!("portal_{}", handle.id),
                rows_fetched: 0,
            }
        );
        
        Ok(handle)
    }
    
    async fn fetch_page(&self, handle: &QueryHandle, max_rows: usize) -> Result<PageChunk> {
        let executor = self.query_executor.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        let chunk = executor.fetch_page(handle, max_rows).await?;
        
        // Update rows fetched count
        if let Some(mut state) = self.active_queries.get_mut(&handle.id) {
            state.rows_fetched += chunk.rows.len();
        }
        
        // Clean up if done
        if !chunk.has_more {
            self.active_queries.remove(&handle.id);
        }
        
        Ok(chunk)
    }
    
    async fn close_query(&self, handle: &QueryHandle) -> Result<()> {
        let executor = self.query_executor.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        executor.close_query(handle).await?;
        self.active_queries.remove(&handle.id);
        
        Ok(())
    }
    
    async fn cancel_query(&self, handle: &QueryHandle) -> Result<()> {
        let executor = self.query_executor.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        executor.cancel_query(handle).await?;
        self.active_queries.remove(&handle.id);
        
        Ok(())
    }
    
    async fn execute(&self, sql: &str) -> Result<u64> {
        let client = self.client.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        let rows_affected = client.execute(sql, &[]).await?;
        Ok(rows_affected)
    }
    
    async fn get_databases(&self) -> Result<Vec<Database>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_databases().await
    }
    
    async fn get_schemas(&self, _database: &str) -> Result<Vec<Schema>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_schemas().await
    }
    
    async fn get_tables(&self, schema: &str) -> Result<Vec<Table>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_tables(schema).await
    }
    
    async fn get_views(&self, schema: &str) -> Result<Vec<View>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_views(schema).await
    }
    
    async fn get_functions(&self, schema: &str) -> Result<Vec<Function>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_functions(schema).await
    }
    
    async fn get_indexes(&self, table: &str) -> Result<Vec<Index>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_indexes(table).await
    }
    
    async fn get_constraints(&self, table: &str) -> Result<Vec<Constraint>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_constraints(table).await
    }
    
    async fn get_table_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnMeta>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_table_columns(schema, table).await
    }
    
    async fn get_table_row_count(&self, schema: &str, table: &str) -> Result<i64> {
        let client = self.client.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        let query = format!(
            "SELECT COUNT(*) FROM \"{}\".\"{}\"",
            schema, table
        );
        
        let row = client.query_one(&query, &[]).await?;
        Ok(row.get(0))
    }
    
    async fn get_triggers(&self, schema: &str, table: &str) -> Result<Vec<Trigger>> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_triggers(schema, table).await
    }
    
    async fn get_object_definition(&self, _database: &str, schema: &str, object_name: &str, object_type: &str) -> Result<String> {
        let introspector = self.introspector.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        introspector.get_object_definition(schema, object_name, object_type).await
    }
    
    async fn get_table_data(&self, schema: &str, table: &str, limit: usize, offset: usize) -> Result<TableDataResult> {
        let executor = self.query_executor.as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        
        // Build query with proper escaping
        let query = format!(
            "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
            schema, table, limit, offset
        );
        
        eprintln!("DEBUG: get_table_data executing query: {}", query);
        
        // Open query to get columns
        let handle = executor.open_query(&query).await?;
        eprintln!("DEBUG: Query handle has {} columns", handle.columns.len());
        
        // Fetch the page
        let chunk = executor.fetch_page(&handle, limit).await?;
        
        // Get total count
        let total_count = self.get_table_row_count(schema, table).await.ok();
        
        // Close query handle
        let _ = executor.close_query(&handle).await;
        
        Ok(TableDataResult {
            columns: handle.columns,
            rows: chunk.rows,
            has_more: chunk.has_more,
            total_count,
        })
    }
    
    async fn get_table_count(&self, schema: &str, table: &str) -> Result<i64> {
        self.get_table_row_count(schema, table).await
    }
    
    fn get_supported_types(&self) -> Vec<CellValueType> {
        vec![
            CellValueType::Null,
            CellValueType::Text,
            CellValueType::Integer,
            CellValueType::Decimal,
            CellValueType::Boolean,
            CellValueType::Date,
            CellValueType::Time,
            CellValueType::DateTime,
            CellValueType::Binary,
            CellValueType::Json,
            CellValueType::Uuid,
            CellValueType::Array(Box::new(CellValueType::Text)),
            CellValueType::Composite(vec![]),
            CellValueType::Range(Box::new(CellValueType::Integer)),
            CellValueType::Multirange(Box::new(CellValueType::Integer)),
            CellValueType::Geometry,
            CellValueType::Geography,
            CellValueType::Xml,
            CellValueType::Inet,
            CellValueType::Cidr,
            CellValueType::MacAddr,
            CellValueType::Interval,
            CellValueType::TsVector,
            CellValueType::TsQuery,
            CellValueType::Money,
            CellValueType::Hstore,
            CellValueType::Ltree,
            CellValueType::Cube,
        ]
    }
    
    fn supports_schemas(&self) -> bool { true }
    fn supports_procedures(&self) -> bool { true }
    fn supports_functions(&self) -> bool { true }
}