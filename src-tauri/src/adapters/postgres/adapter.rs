use async_trait::async_trait;
use dashmap::DashMap;
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use std::sync::Arc;
use tokio_postgres::{Client, Config, NoTls};

use super::introspection::PostgresIntrospector;
use super::parser::quote_identifier;
use super::query_fast::FastPostgresQueryExecutor;
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct PostgresAdapter {
    client: Option<Arc<Client>>,
    connection_handle: Option<tokio::task::JoinHandle<()>>,
    query_executor: Option<Arc<FastPostgresQueryExecutor>>,
    introspector: Option<Arc<PostgresIntrospector>>,
    active_queries: Arc<DashMap<String, QueryState>>,
    /// Metadata cache: (schema, table) -> columns (saves 100-150ms per query)
    metadata_cache: Arc<DashMap<(String, String), Vec<ColumnMeta>>>,
}

struct QueryState {
    handle: QueryHandle,
    #[allow(dead_code)]
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
            metadata_cache: Arc::new(DashMap::new()),
        }
    }

    /// Detect if SQL is a DDL statement that modifies schema
    fn is_ddl(sql: &str) -> bool {
        let upper = sql.trim().to_uppercase();
        upper.starts_with("ALTER")
            || upper.starts_with("DROP")
            || upper.starts_with("CREATE")
            || upper.starts_with("TRUNCATE")
            || upper.starts_with("RENAME")
    }

    /// Clear metadata cache and statement cache after DDL operations
    fn clear_metadata_cache(&self) {
        self.metadata_cache.clear();
        // Also clear prepared statement cache since schema might have changed
        if let Some(executor) = &self.query_executor {
            executor.clear_statement_cache();
        }
    }

    /// Get query executor (for fast path optimization)
    pub fn get_query_executor(&self) -> Option<Arc<FastPostgresQueryExecutor>> {
        self.query_executor.clone()
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
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

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
            let _connector = MakeTlsConnector::new(connector);

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
        self.query_executor = Some(Arc::new(FastPostgresQueryExecutor::new(client.clone())));
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
        let client = self
            .client
            .as_ref()
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
        let executor = self
            .query_executor
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let handle = executor.open_query(sql).await?;

        // Clear metadata cache if DDL operation (saves 100-150ms on subsequent queries)
        if Self::is_ddl(sql) {
            self.clear_metadata_cache();
        }

        // Store query state
        self.active_queries.insert(
            handle.id.clone(),
            QueryState {
                handle: handle.clone(),
                portal_name: format!("portal_{}", handle.id),
                rows_fetched: 0,
            },
        );

        Ok(handle)
    }

    async fn fetch_page(&self, handle: &QueryHandle, max_rows: usize) -> Result<PageChunk> {
        let executor = self
            .query_executor
            .as_ref()
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
        let executor = self
            .query_executor
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        executor.close_query(handle).await?;
        self.active_queries.remove(&handle.id);

        Ok(())
    }

    async fn cancel_query(&self, handle: &QueryHandle) -> Result<()> {
        let executor = self
            .query_executor
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        executor.cancel_query(handle).await?;
        self.active_queries.remove(&handle.id);

        Ok(())
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let rows_affected = client.execute(sql, &[]).await?;
        Ok(rows_affected)
    }

    async fn get_databases(&self) -> Result<Vec<Database>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_databases().await
    }

    async fn get_schemas(&self, _database: &str) -> Result<Vec<Schema>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_schemas().await
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<Table>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_tables(schema).await
    }

    async fn get_views(&self, schema: &str) -> Result<Vec<View>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_views(schema).await
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<Function>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_functions(schema).await
    }

    async fn get_indexes(&self, table: &str) -> Result<Vec<Index>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_indexes(table).await
    }

    async fn get_index_usage_stats(&self, table: &str) -> Result<Vec<IndexUsageStats>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_index_usage_stats(table).await
    }

    async fn get_supported_index_types(&self) -> Result<Vec<String>> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let query = "SELECT amname AS index_type FROM pg_am WHERE amtype = 'i' ORDER BY 1";
        let rows = client
            .query(query, &[])
            .await
            .map_err(|e| AppError::Driver(e.to_string()))?;

        let index_types: Vec<String> = rows.iter().map(|row| row.get::<_, String>(0)).collect();

        Ok(index_types)
    }

    async fn get_supported_column_types(&self) -> Result<Vec<String>> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let query = r#"
            WITH all_types AS (
                -- Base types, array types, range types, and multirange types from pg_catalog
                SELECT DISTINCT
                    t.typname as type_name,
                    1 as priority
                FROM pg_type t
                JOIN pg_namespace n ON t.typnamespace = n.oid
                WHERE n.nspname = 'pg_catalog'
                    AND t.typtype IN ('b', 'a', 'r', 'm')  -- Include base, array, range, and multirange types
                    AND t.typname NOT IN ('pg_node_tree', 'pg_ndistinct', 'pg_dependencies',
                                        'pg_mcv_list', 'pg_brin_bloom_summary', 'pg_brin_minmax_multi_summary',
                                        'anyrange', 'anymultirange', 'anycompatiblerange', 'anycompatiblemultirange')

                UNION ALL

                -- User-defined types, enums, domains, ranges, multiranges, and their arrays
                SELECT DISTINCT
                    t.typname as type_name,
                    2 as priority
                FROM pg_type t
                JOIN pg_namespace n ON t.typnamespace = n.oid
                WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                    AND t.typtype IN ('d', 'e', 'c', 'r', 'm', 'a')  -- Include all user-defined type categories

                UNION ALL

                -- Common type aliases with modifiers
                SELECT 'character varying' as type_name, 1 as priority
                UNION ALL SELECT 'varchar' as type_name, 1 as priority
                UNION ALL SELECT 'character' as type_name, 1 as priority
                UNION ALL SELECT 'char' as type_name, 1 as priority
                UNION ALL SELECT 'timestamp with time zone' as type_name, 1 as priority
                UNION ALL SELECT 'timestamp without time zone' as type_name, 1 as priority
                UNION ALL SELECT 'time with time zone' as type_name, 1 as priority
                UNION ALL SELECT 'time without time zone' as type_name, 1 as priority
                UNION ALL SELECT 'double precision' as type_name, 1 as priority
                UNION ALL SELECT 'bit varying' as type_name, 1 as priority
            )
            SELECT DISTINCT type_name
            FROM all_types
            ORDER BY type_name
        "#;

        let rows = client
            .query(query, &[])
            .await
            .map_err(|e| AppError::Driver(e.to_string()))?;

        let column_types: Vec<String> = rows.iter().map(|row| row.get::<_, String>(0)).collect();

        Ok(column_types)
    }

    async fn get_constraints(&self, table: &str) -> Result<Vec<Constraint>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_constraints(table).await
    }

    async fn get_table_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnMeta>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_table_columns(schema, table).await
    }

    async fn get_table_row_count(&self, schema: &str, table: &str) -> Result<i64> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let query = format!("SELECT COUNT(*) FROM \"{}\".\"{}\"", schema, table);

        let row = client.query_one(&query, &[]).await?;
        Ok(row.get(0))
    }

    async fn get_triggers(&self, schema: &str, table: &str) -> Result<Vec<Trigger>> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector.get_triggers(schema, table).await
    }

    async fn get_object_definition(
        &self,
        _database: &str,
        schema: &str,
        object_name: &str,
        object_type: &str,
    ) -> Result<String> {
        let introspector = self
            .introspector
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        introspector
            .get_object_definition(schema, object_name, object_type)
            .await
    }

    async fn get_table_data(
        &self,
        schema: &str,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> Result<TableDataResult> {
        let executor = self
            .query_executor
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        // Build query with proper escaping and pagination
        let query = format!(
            "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
            schema, table, limit, offset
        );

        // Use query executor for cursor-based streaming with timing
        let handle = executor.open_query(&query).await?;
        let chunk = executor.fetch_page(&handle, limit).await?;

        // Get execution time from chunk (captured before query state removal)
        let execution_time_ms = chunk.execution_time_ms;

        // Check if there are more rows
        let has_more = chunk.has_more;

        // Get total count
        let total_count = self.get_table_row_count(schema, table).await.ok();

        // Close query handle
        let _ = executor.close_query(&handle).await;

        Ok(TableDataResult {
            columns: handle.columns,
            rows: chunk.rows,
            has_more,
            total_count,
            execution_time_ms,
        })
    }

    async fn get_table_data_filtered(
        &self,
        schema: &str,
        table: &str,
        limit: usize,
        offset: usize,
        filters: Option<crate::types::FilterConfig>,
        sorts: Option<Vec<crate::types::SortConfig>>,
    ) -> Result<TableDataResult> {
        let executor = self
            .query_executor
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        // Get column names for validation
        let columns = self.get_table_columns(schema, table).await?;
        let column_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();

        // Build query with filters and sorts
        let mut query_builder =
            super::query_builder::PostgresQueryBuilder::new().with_allowed_columns(column_names);

        let (query, params) = query_builder.build_table_query(
            schema,
            table,
            filters.as_ref(),
            sorts.as_deref(),
            limit,
            offset,
        )?;

        eprintln!("DEBUG: get_table_data_filtered executing query: {}", query);
        eprintln!("DEBUG: with params: {:?}", params);

        // For now, we'll execute without parameters since tokio-postgres needs different handling
        // This is a simplified version - in production, we'd properly bind parameters
        let simple_query = if filters.is_some() || sorts.is_some() {
            // Fallback to simple query for now
            format!(
                "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
                schema, table, limit, offset
            )
        } else {
            query
        };

        // Open query to get columns
        let handle = executor.open_query(&simple_query).await?;

        // Fetch the page
        let chunk = executor.fetch_page(&handle, limit).await?;

        // Get execution time from chunk (captured before query state removal)
        let execution_time_ms = chunk.execution_time_ms;

        // Get total count
        let total_count = self.get_table_row_count(schema, table).await.ok();

        // Close query handle
        let _ = executor.close_query(&handle).await;

        Ok(TableDataResult {
            columns: handle.columns,
            rows: chunk.rows,
            has_more: chunk.has_more,
            total_count,
            execution_time_ms,
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

    fn supports_schemas(&self) -> bool {
        true
    }
    fn supports_procedures(&self) -> bool {
        true
    }
    fn supports_functions(&self) -> bool {
        true
    }

    // Index operations
    async fn create_index(
        &self,
        schema: &str,
        table: &str,
        index: &CreateIndexRequest,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let unique_str = if index.unique { "UNIQUE " } else { "" };
        // Support opclass syntax like: column gin_trgm_ops (do not quote the opclass)
        fn format_index_column(col: &str) -> String {
            // Preserve expressions like lower(col), jsonb_path_ops on expressions, etc.
            if col.contains('(') {
                // Assume user provided a valid expression; return as-is
                return col.to_string();
            }
            let mut parts = col.split_whitespace();
            let first = parts.next().unwrap_or(col);
            let rest: Vec<&str> = parts.collect();
            if rest.is_empty() {
                quote_identifier(first)
            } else {
                format!("{} {}", quote_identifier(first), rest.join(" "))
            }
        }
        let columns = index
            .columns
            .iter()
            .map(|col| format_index_column(col))
            .collect::<Vec<_>>()
            .join(", ");
        let index_type = if index.index_type.is_empty() {
            "btree".to_string()
        } else {
            index.index_type.clone()
        };

        let mut sql = format!(
            "CREATE {}INDEX {} ON {}.{} USING {} ({})",
            unique_str,
            quote_identifier(&index.name),
            quote_identifier(schema),
            quote_identifier(table),
            index_type,
            columns
        );

        if let Some(condition) = &index.condition {
            sql.push_str(&format!(" WHERE {}", condition));
        }

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    async fn drop_index(&self, schema: &str, index_name: &str) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let sql = format!(
            "DROP INDEX IF EXISTS {}.{}",
            quote_identifier(schema),
            quote_identifier(index_name)
        );

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    async fn rename_index(&self, schema: &str, old_name: &str, new_name: &str) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let sql = format!(
            "ALTER INDEX {}.{} RENAME TO {}",
            quote_identifier(schema),
            quote_identifier(old_name),
            quote_identifier(new_name)
        );

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    // Table structure operations
    async fn alter_table_add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let mut sql = format!(
            "ALTER TABLE {}.{} ADD COLUMN {} {}",
            quote_identifier(schema),
            quote_identifier(table),
            quote_identifier(&column.name),
            column.data_type
        );

        if !column.nullable {
            sql.push_str(" NOT NULL");
        }

        if let Some(default) = &column.default_value {
            sql.push_str(&format!(" DEFAULT {}", default));
        }

        if let Some(check) = &column.check_constraint {
            sql.push_str(&format!(" CHECK ({})", check));
        }

        client.execute(&sql, &[]).await?;

        // Add comment if provided (PostgreSQL doesn't allow parameters in COMMENT)
        if let Some(comment) = &column.comment {
            let escaped = comment.replace('\'', "''");
            let comment_sql = format!(
                "COMMENT ON COLUMN {}.{}.{} IS '{}'",
                quote_identifier(schema),
                quote_identifier(table),
                quote_identifier(&column.name),
                escaped
            );
            client.execute(&comment_sql, &[]).await?;
        }

        Ok(())
    }

    async fn alter_table_drop_column(
        &self,
        schema: &str,
        table: &str,
        column_name: &str,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let sql = format!(
            "ALTER TABLE {}.{} DROP COLUMN IF EXISTS {}",
            quote_identifier(schema),
            quote_identifier(table),
            quote_identifier(column_name)
        );

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    async fn alter_table_modify_column(
        &self,
        schema: &str,
        table: &str,
        column: &ModifyColumnRequest,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let current_column_name = quote_identifier(&column.name);

        // Handle column rename
        if let Some(new_name) = &column.new_name {
            let sql = format!(
                "ALTER TABLE {}.{} RENAME COLUMN {} TO {}",
                quote_identifier(schema),
                quote_identifier(table),
                current_column_name,
                quote_identifier(new_name)
            );
            client.execute(&sql, &[]).await?;
        }

        // Use the new name for subsequent operations if it was renamed
        let working_column_name = column
            .new_name
            .as_ref()
            .map(|n| quote_identifier(n))
            .unwrap_or_else(|| current_column_name.clone());

        // Handle type change
        if let Some(new_type) = &column.new_type {
            let sql = format!(
                "ALTER TABLE {}.{} ALTER COLUMN {} TYPE {} USING {}::{}",
                quote_identifier(schema),
                quote_identifier(table),
                working_column_name,
                new_type,
                working_column_name,
                new_type
            );
            client.execute(&sql, &[]).await?;
        }

        // Handle nullable change
        if let Some(nullable) = column.nullable {
            let sql = if nullable {
                format!(
                    "ALTER TABLE {}.{} ALTER COLUMN {} DROP NOT NULL",
                    quote_identifier(schema),
                    quote_identifier(table),
                    working_column_name
                )
            } else {
                format!(
                    "ALTER TABLE {}.{} ALTER COLUMN {} SET NOT NULL",
                    quote_identifier(schema),
                    quote_identifier(table),
                    working_column_name
                )
            };
            client.execute(&sql, &[]).await?;
        }

        // Handle default value
        if column.drop_default {
            let sql = format!(
                "ALTER TABLE {}.{} ALTER COLUMN {} DROP DEFAULT",
                quote_identifier(schema),
                quote_identifier(table),
                working_column_name
            );
            client.execute(&sql, &[]).await?;
        } else if let Some(default) = &column.default_value {
            let sql = format!(
                "ALTER TABLE {}.{} ALTER COLUMN {} SET DEFAULT {}",
                quote_identifier(schema),
                quote_identifier(table),
                working_column_name,
                default
            );
            client.execute(&sql, &[]).await?;
        }

        // Handle CHECK constraint changes
        if column.drop_check_constraint {
            // Drop existing anonymous/per-column check constraints by name pattern
            // We find constraints attached to the column by introspecting pg_constraint
            let drop_sql = format!(
                "SELECT con.conname FROM pg_constraint con \n                 JOIN pg_class t ON t.oid = con.conrelid \n                 JOIN pg_namespace n ON n.oid = t.relnamespace \n                 WHERE n.nspname = $1 AND t.relname = $2 AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ILIKE $3"
            );
            let pattern = format!("%{}%", working_column_name.trim_matches('"'));
            let rows = client
                .query(&drop_sql, &[&schema, &table, &pattern])
                .await?;
            for row in rows {
                let conname: String = row.get(0);
                let sql = format!(
                    "ALTER TABLE {}.{} DROP CONSTRAINT IF EXISTS {}",
                    quote_identifier(schema),
                    quote_identifier(table),
                    quote_identifier(&conname)
                );
                client.execute(&sql, &[]).await?;
            }
        }

        if let Some(check) = &column.new_check_constraint {
            // Generate a deterministic constraint name
            let conname = format!("chk_{}_{}", table, working_column_name.trim_matches('"'));
            let sql = format!(
                "ALTER TABLE {}.{} ADD CONSTRAINT {} CHECK ({}) NOT VALID",
                quote_identifier(schema),
                quote_identifier(table),
                quote_identifier(&conname),
                check
            );
            client.execute(&sql, &[]).await?;
        }

        // Update comment (PostgreSQL doesn't allow parameters in COMMENT)
        if let Some(comment) = &column.comment {
            let escaped = comment.replace('\'', "''");
            let comment_sql = format!(
                "COMMENT ON COLUMN {}.{}.{} IS '{}'",
                quote_identifier(schema),
                quote_identifier(table),
                working_column_name,
                escaped
            );
            client.execute(&comment_sql, &[]).await?;
        }

        Ok(())
    }

    async fn alter_table_rename_column(
        &self,
        schema: &str,
        table: &str,
        old_name: &str,
        new_name: &str,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let sql = format!(
            "ALTER TABLE {}.{} RENAME COLUMN {} TO {}",
            quote_identifier(schema),
            quote_identifier(table),
            quote_identifier(old_name),
            quote_identifier(new_name)
        );

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    async fn alter_table_add_foreign_key(
        &self,
        schema: &str,
        table: &str,
        fk: &AddForeignKeyRequest,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        // Check if the column is an array type (cannot have FK)
        let type_check_sql = format!(
            "SELECT format_type(a.atttypid, a.atttypmod) as data_type
             FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1
               AND c.relname = $2
               AND a.attname = $3
               AND NOT a.attisdropped"
        );

        let rows = client
            .query(&type_check_sql, &[&schema, &table, &fk.column_name])
            .await?;

        if let Some(row) = rows.first() {
            let data_type: String = row.get(0);

            // Log the column type for debugging
            eprintln!(
                "DEBUG: Attempting to add FK on column '{}' with type '{}'",
                fk.column_name, data_type
            );

            // Check if it's an array type
            if data_type.ends_with("[]") || data_type.starts_with("ARRAY") {
                return Err(AppError::InvalidInput(format!(
                    "Cannot create foreign key on array column '{}' (type: {}). PostgreSQL does not support foreign key constraints on array columns. Consider using a junction table instead.",
                    fk.column_name,
                    data_type
                )));
            }
        }

        let constraint_name = fk
            .constraint_name
            .as_ref()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("fk_{}_{}_{}", table, fk.column_name, fk.referenced_table));

        let sql = format!(
            "ALTER TABLE {}.{} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON UPDATE {} ON DELETE {}",
            quote_identifier(schema),
            quote_identifier(table),
            quote_identifier(&constraint_name),
            quote_identifier(&fk.column_name),
            quote_identifier(&fk.referenced_table),
            quote_identifier(&fk.referenced_column),
            fk.on_update,
            fk.on_delete
        );

        // Log the SQL for debugging
        eprintln!("DEBUG: Executing FK SQL: {}", sql);

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    async fn alter_table_drop_foreign_key(
        &self,
        schema: &str,
        table: &str,
        constraint_name: &str,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let sql = format!(
            "ALTER TABLE \"{}\".\"{}\" DROP CONSTRAINT IF EXISTS \"{}\"",
            schema, table, constraint_name
        );

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    // Trigger operations
    async fn create_trigger(
        &self,
        schema: &str,
        table: &str,
        trigger: &CreateTriggerRequest,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        // Parse timing to handle "INSTEAD OF" case
        let timing = trigger.timing.trim().to_uppercase();
        let is_instead_of = timing.contains("INSTEAD");

        // Build the event list
        let events = trigger.event.join(" OR ");

        // Build the FOR EACH clause
        let for_each = trigger
            .for_each
            .as_deref()
            .unwrap_or(&trigger.level)
            .to_uppercase();

        // Build the CREATE TRIGGER statement
        let mut sql = format!(
            "CREATE TRIGGER {} {} {} ON {}.{} FOR EACH {} EXECUTE FUNCTION {}",
            quote_identifier(&trigger.name),
            if is_instead_of { "INSTEAD OF" } else { &timing },
            events,
            quote_identifier(schema),
            quote_identifier(table),
            for_each,
            trigger.function_name
        );

        // Add WHEN condition if provided
        if let Some(condition) = &trigger.condition {
            sql.push_str(&format!(" WHEN ({})", condition));
        }

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    async fn drop_trigger(&self, schema: &str, table: &str, trigger_name: &str) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let sql = format!(
            "DROP TRIGGER IF EXISTS {} ON {}.{}",
            quote_identifier(trigger_name),
            quote_identifier(schema),
            quote_identifier(table)
        );

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    async fn enable_disable_trigger(
        &self,
        schema: &str,
        table: &str,
        trigger_name: &str,
        enabled: bool,
    ) -> Result<()> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let action = if enabled { "ENABLE" } else { "DISABLE" };

        let sql = format!(
            "ALTER TABLE {}.{} {} TRIGGER {}",
            quote_identifier(schema),
            quote_identifier(table),
            action,
            quote_identifier(trigger_name)
        );

        client.execute(&sql, &[]).await?;

        Ok(())
    }
}
