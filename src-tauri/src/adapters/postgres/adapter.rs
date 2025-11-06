use async_trait::async_trait;
use deadpool_postgres::Pool;
use native_tls::{Certificate, TlsConnector};
use postgres_native_tls::MakeTlsConnector;
use std::fs;
use std::sync::Arc;
use tokio_postgres::config::{ChannelBinding as PgChannelBinding, SslMode as PgSslMode};
use tokio_postgres::{Config, NoTls};

use super::introspection::PostgresIntrospector;
use super::parser::quote_identifier;
use super::pool::PostgresPoolBuilder;
use super::query_fast::FastPostgresQueryExecutor;
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
use crate::types::*;

pub struct PostgresAdapter {
    pool: Option<Pool>,
    connection_handle: Option<tokio::task::JoinHandle<()>>,
    query_executor: Option<Arc<FastPostgresQueryExecutor>>,
    introspector: Option<Arc<PostgresIntrospector>>,
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            pool: None,
            connection_handle: None,
            query_executor: None,
            introspector: None,
        }
    }

    /// Get query executor (for fast path optimization)
    pub fn get_query_executor(&self) -> Option<Arc<FastPostgresQueryExecutor>> {
        self.query_executor.clone()
    }

    /// Execute multiple SQL statements within a transaction
    /// This properly uses a SINGLE connection for all operations
    pub async fn execute_in_transaction(&self, statements: Vec<String>) -> Result<Vec<u64>> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        // Get ONE connection and hold it for the entire transaction
        let mut client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        // Start transaction
        let transaction = client
            .transaction()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to begin transaction: {}", e)))?;

        let mut results = Vec::new();

        // Execute all statements in the transaction
        for sql in statements {
            let rows_affected = transaction
                .execute(&sql, &[])
                .await
                .map_err(|e| {
                    AppError::DatabaseError(format!("Transaction failed: {}", e))
                })?;
            results.push(rows_affected);
        }

        // Commit transaction
        transaction
            .commit()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to commit transaction: {}", e)))?;

        Ok(results)
    }

    /// Execute a query within a transaction and return results
    /// Used for INSERT...RETURNING statements
    pub async fn query_in_transaction(&self, sql: &str) -> Result<QueryResult> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let mut client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let rows = client
            .query(sql, &[])
            .await
            .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

        // Convert rows to QueryResult format
        if rows.is_empty() {
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
            });
        }

        let columns = rows[0]
            .columns()
            .iter()
            .map(|col| ColumnMeta {
                name: col.name().to_string(),
                data_type: super::types::PostgresTypeConverter::type_to_cell_type(col.type_()),
                nullable: true,
                primary_key: false,
                db_type: col.type_().name().to_string(),
                type_oid: Some(col.type_().oid()),
                default_value: None,
                comment: None,
                enum_values: None,
                type_category: None,
                precision: None,
                scale: None,
            })
            .collect();

        let json_rows = super::fast_converter::FastPostgresConverter::rows_to_json(&rows)?;

        Ok(QueryResult {
            columns,
            rows: json_rows,
        })
    }

    fn build_config(profile: &ConnectionProfile) -> Result<(Config, PgSslMode)> {
        let mut config = Config::new();
        config.host(&profile.host);
        config.port(profile.port);
        config.dbname(&profile.database);
        config.user(&profile.username);

        if let Some(password) = &profile.password {
            config.password(password);
        }

        // Determine SSL mode from profile or connection options
        let mut ssl_mode = profile
            .ssl_mode
            .and_then(Self::map_profile_ssl_mode)
            .unwrap_or(PgSslMode::Disable);
        let mut channel_binding: Option<PgChannelBinding> = None;
        let mut runtime_options: Vec<String> = Vec::new();

        for (key, value) in &profile.options {
            let key_lower = key.to_ascii_lowercase();
            match key_lower.as_str() {
                "sslmode" => {
                    if let Some(parsed) = Self::parse_ssl_mode(value) {
                        ssl_mode = parsed;
                    }
                }
                "channel_binding" => {
                    if let Some(parsed) = Self::parse_channel_binding(value) {
                        channel_binding = Some(parsed);
                    }
                }
                _ => runtime_options.push(format!("-c {}={}", key, value)),
            }
        }

        config.ssl_mode(ssl_mode);

        if let Some(binding) = channel_binding {
            config.channel_binding(binding);
        }

        // TCP optimizations: Reduce network latency and improve responsiveness
        use std::time::Duration;
        config.tcp_user_timeout(Duration::from_secs(60));
        config.connect_timeout(Duration::from_secs(10));
        config.keepalives(true);
        config.keepalives_idle(Duration::from_secs(30));

        // Add additional runtime options (converted to -c style parameters)
        if !runtime_options.is_empty() {
            config.options(&runtime_options.join(" "));
        }

        Ok((config, ssl_mode))
    }

    fn map_profile_ssl_mode(mode: SslMode) -> Option<PgSslMode> {
        match mode {
            SslMode::Disable => Some(PgSslMode::Disable),
            SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => Some(PgSslMode::Require),
        }
    }

    fn parse_ssl_mode(value: &str) -> Option<PgSslMode> {
        match value.to_ascii_lowercase().as_str() {
            "disable" => Some(PgSslMode::Disable),
            "prefer" => Some(PgSslMode::Prefer),
            "require" | "verify-ca" | "verify_full" | "verify-full" => Some(PgSslMode::Require),
            _ => None,
        }
    }

    fn parse_channel_binding(value: &str) -> Option<PgChannelBinding> {
        match value.to_ascii_lowercase().as_str() {
            "disable" => Some(PgChannelBinding::Disable),
            "prefer" => Some(PgChannelBinding::Prefer),
            "require" => Some(PgChannelBinding::Require),
            _ => None,
        }
    }

    fn build_tls_connector(
        profile: &ConnectionProfile,
        ssl_mode: PgSslMode,
    ) -> Result<Option<MakeTlsConnector>> {
        if matches!(ssl_mode, PgSslMode::Disable) {
            return Ok(None);
        }

        let mut builder = TlsConnector::builder();

        if let Some(ssl_config) = &profile.ssl_config {
            if let Some(ca_file) = &ssl_config.ca_file {
                let pem = fs::read(ca_file).map_err(|err| {
                    AppError::Internal(format!(
                        "Failed to read CA certificate file {}: {}",
                        ca_file, err
                    ))
                })?;
                let cert = Certificate::from_pem(&pem).map_err(|err| {
                    AppError::Internal(format!(
                        "Failed to parse CA certificate from {}: {}",
                        ca_file, err
                    ))
                })?;
                builder.add_root_certificate(cert);
            }

            if ssl_config.key_file.is_some() || ssl_config.cert_file.is_some() {
                tracing::warn!(
                    "Client TLS key/certificate files are not yet supported for PostgreSQL adapter"
                );
            }
        }

        let connector = builder
            .build()
            .map_err(|err| AppError::Internal(format!("Failed to build TLS connector: {}", err)))?;

        Ok(Some(MakeTlsConnector::new(connector)))
    }

    /// Pre-warm connection in background (Phase 1: basic queries)
    async fn prewarm_connection(executor: Arc<FastPostgresQueryExecutor>, connection_id: String) {
        tracing::info!("Starting connection pre-warming for {}", connection_id);

        // Phase 1: Minimal connection warm-up (~15ms)
        let _ = executor.prepare_streaming_query("SELECT 1").await;
        let _ = executor
            .prepare_streaming_query("SELECT current_database()")
            .await;

        tracing::info!(
            "Phase 1 complete: Basic queries pre-warmed for {}",
            connection_id
        );
    }

    /// Pre-warm tables after schema is loaded (Phase 2: smart table pre-warming)
    pub async fn prewarm_tables(&self, schema: &str, tables: Vec<String>) -> Result<()> {
        let _executor = self
            .query_executor
            .as_ref()
            .ok_or_else(|| AppError::Internal("Query executor not initialized".to_string()))?;

        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::Internal("Pool not initialized".to_string()))?;

        let table_count = tables.len();

        if table_count == 0 {
            return Ok(());
        }

        // Filter out log/audit tables (usually huge and rarely accessed in development)
        let filtered_tables: Vec<String> = tables
            .into_iter()
            .filter(|t| {
                let lower = t.to_lowercase();
                // Skip tables that are likely logs/audit/large data dumps
                !lower.contains("log")
                    && !lower.contains("audit")
                    && !lower.contains("migrations")
                    && !lower.contains("history")
                    && !lower.contains("archive")
                    && !lower.contains("backup")
            })
            .collect();

        if filtered_tables.is_empty() {
            tracing::info!("No suitable tables to pre-warm (all filtered out)");
            return Ok(());
        }

        // Get table row counts to sort by (most records first = most actively used)
        // Use the same query as get_tables() for consistency
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let row_count_query = r#"
            SELECT c.relname, c.reltuples::bigint as row_count
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 
              AND c.relkind IN ('r', 'p', 'f')
              AND c.relname = ANY($2)
              AND c.reltuples > 100
            ORDER BY c.reltuples DESC
        "#;

        let table_counts = client
            .query(row_count_query, &[&schema, &filtered_tables])
            .await
            .unwrap_or_else(|_| {
                // Fallback: use original order if row count query fails
                vec![]
            });

        let sorted_tables: Vec<String> = if !table_counts.is_empty() {
            table_counts
                .iter()
                .map(|row| row.get::<_, String>(0))
                .collect()
        } else {
            filtered_tables.clone()
        };

        // Smart strategy: Pre-warm 20% of tables, minimum 16, maximum 20%
        let target_count = std::cmp::max(16, (sorted_tables.len() * 20) / 100);

        let tables_to_prewarm: Vec<String> = sorted_tables.into_iter().take(target_count).collect();

        tracing::info!(
            "Pre-warming {} tables from schema {} (filtered: {}, total: {}) - parallel batch of 4",
            tables_to_prewarm.len(),
            schema,
            filtered_tables.len(),
            table_count
        );

        // Pre-warm tables in parallel batches of 4 for faster warmup
        use futures::stream::{self, StreamExt};

        let schema_str = schema.to_string();
        let pool_clone = pool.clone();
        let prewarm_futures: Vec<_> = tables_to_prewarm
            .into_iter()
            .map(|table| {
                let pool = pool_clone.clone();
                let schema_clone = schema_str.clone();

                async move {
                    // Actually EXECUTE a query to warm PostgreSQL's cache (not just prepare)
                    let sql = format!("SELECT * FROM {}.{} LIMIT 1", schema_clone, table);
                    if let Ok(conn) = pool.get().await {
                        // Execute the query to warm up the table in PostgreSQL's cache
                        let _ = conn.query(&sql, &[]).await;
                    }
                    (schema_clone, table)
                }
            })
            .collect();

        // Run max 4 concurrent pre-warming operations
        let results: Vec<_> = stream::iter(prewarm_futures)
            .buffer_unordered(4)
            .collect()
            .await;

        for (schema_name, table) in results {
            tracing::info!("  ✅ Pre-warmed: {}.{}", schema_name, table);
        }

        tracing::info!("Table pre-warming complete for schema {}", schema);
        Ok(())
    }
}

#[async_trait]
impl DbAdapter for PostgresAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        // Disconnect if already connected
        if self.pool.is_some() {
            self.disconnect().await?;
        }

        let (config, ssl_mode) = Self::build_config(profile)?;
        let tls = Self::build_tls_connector(profile, ssl_mode)?;

        // Create connection pool (2-3 connections per window)
        let pool_result = match tls {
            Some(tls_connector) => PostgresPoolBuilder::default().build(config, tls_connector),
            None => PostgresPoolBuilder::default().build(config, NoTls),
        };

        let pool = pool_result
            .map_err(|e| AppError::Internal(format!("Failed to create connection pool: {}", e)))?;

        // Get a connection to verify pool is working
        let _conn = pool.get().await.map_err(|e| {
            AppError::Internal(format!("Failed to get connection from pool: {}", e))
        })?;

        // Initialize components with pool
        let executor = Arc::new(FastPostgresQueryExecutor::new_with_pool(pool.clone()));

        // Create introspector with pool (gets fresh connections for each operation)
        let introspector = Arc::new(PostgresIntrospector::new_with_pool(pool.clone()));

        self.pool = Some(pool);
        self.query_executor = Some(executor.clone());
        self.introspector = Some(introspector);

        // Background pre-warming (fire-and-forget)
        let connection_id = profile.id.clone();
        tokio::spawn(Self::prewarm_connection(executor.clone(), connection_id));

        Ok(())
    }

    async fn disconnect(&mut self) -> Result<()> {
        // Drop pool and components
        self.pool = None;
        self.query_executor = None;
        self.introspector = None;

        // Cancel connection task
        if let Some(handle) = self.connection_handle.take() {
            handle.abort();
        }

        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult> {
        // Use pool if available (new connection pooling), otherwise fall back to client
        if let Some(pool) = &self.pool {
            let conn = pool.get().await.map_err(|e| {
                AppError::ConnectionClosed(format!("Failed to get connection from pool: {}", e))
            })?;

            // Test query and get version
            let row = conn
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
        } else {
            Err(AppError::ConnectionClosed("Not connected".into()))
        }
    }

    async fn is_connected(&self) -> bool {
        if let Some(pool) = &self.pool {
            // Try to get a connection from the pool and run a simple query
            if let Ok(conn) = pool.get().await {
                return conn.query_one("SELECT 1", &[]).await.is_ok();
            }
            false
        } else {
            false
        }
    }

    async fn query(&self, sql: &str) -> Result<QueryResult> {
        let executor = self
            .query_executor
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

        let (rows, columns, _execution_time) = executor.execute_single_fetch(sql).await?;

        Ok(QueryResult { columns, rows })
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let query = "SELECT amname AS index_type FROM pg_am WHERE amtype = 'i' ORDER BY 1";
        let rows = client
            .query(query, &[])
            .await
            .map_err(|e| AppError::Driver(e.to_string()))?;

        let index_types: Vec<String> = rows.iter().map(|row| row.get::<_, String>(0)).collect();

        Ok(index_types)
    }

    async fn get_supported_column_types(&self) -> Result<Vec<String>> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

        let sql = format!(
            "DROP INDEX IF EXISTS {}.{}",
            quote_identifier(schema),
            quote_identifier(index_name)
        );

        client.execute(&sql, &[]).await?;

        Ok(())
    }

    async fn rename_index(&self, schema: &str, old_name: &str, new_name: &str) -> Result<()> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to get connection: {}", e)))?;

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
