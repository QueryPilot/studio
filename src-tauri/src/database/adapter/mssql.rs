use async_trait::async_trait;
use serde_json::Value;
use std::time::{Duration, Instant};
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;
use uuid::Uuid;
use futures::{StreamExt, TryStreamExt};

use tiberius::{Row, Column};
use bb8_tiberius::ConnectionManager;

use crate::error::AppError;
use crate::database::cell_value::{CellValue, CellValueType};
use super::{DbAdapter, TableMeta, FunctionMeta, ColumnMeta, QueryCursor, QueryPage, 
           ExecuteResult, QueryOptions, TransactionId, TableReadRequest, TableDataResponse,
           DbObjectKind, SortDirection, FilterOperator, PaginationMode, ConnectionConfig};

type MssqlPool = bb8::Pool<ConnectionManager>;
type MssqlConnection<'a> = bb8::PooledConnection<'a, ConnectionManager>;

pub struct MssqlAdapter {
    pool: MssqlPool,
    config: ConnectionConfig,
    // Store active cursors for streaming queries
    cursors: Arc<RwLock<HashMap<String, Arc<RwLock<QueryCursor>>>>>,
    // Store active transactions
    transactions: Arc<RwLock<HashMap<String, MssqlConnection<'static>>>>,
}

impl MssqlAdapter {
    pub async fn new(config: &ConnectionConfig) -> Result<Self, AppError> {
        println!("[MssqlAdapter::new] Starting MSSQL connection with config:");
        println!("[MssqlAdapter::new] Host: {}, Port: {}, Database: {}, Username: {}", 
            config.host, config.port, config.database, config.username);
        
        // First, test with a raw tiberius connection
        println!("[MssqlAdapter::new] Testing raw tiberius connection...");
        let mut tiberius_config = tiberius::Config::new();
        tiberius_config.host(&config.host);
        tiberius_config.port(config.port);
        tiberius_config.database(&config.database);
        tiberius_config.authentication(tiberius::AuthMethod::sql_server(
            &config.username,
            config.password.as_deref().unwrap_or("")
        ));
        tiberius_config.trust_cert();
        tiberius_config.encryption(tiberius::EncryptionLevel::NotSupported);
        
        // Test the connection
        println!("[MssqlAdapter::new] Attempting TCP connection to {}:{}...", config.host, config.port);
        let tcp = match tokio::net::TcpStream::connect(format!("{}:{}", config.host, config.port)).await {
            Ok(tcp) => {
                println!("[MssqlAdapter::new] TCP connection successful");
                tcp
            },
            Err(e) => {
                println!("[MssqlAdapter::new] ERROR: TCP connection failed: {}", e);
                return Err(AppError::Database(format!("Cannot connect to SQL Server at {}:{} - {}", config.host, config.port, e)));
            }
        };
        
        println!("[MssqlAdapter::new] Testing tiberius client connection...");
        let tcp = tokio_util::compat::TokioAsyncWriteCompatExt::compat_write(tcp);
        let client = match tiberius::Client::connect(tiberius_config.clone(), tcp).await {
            Ok(client) => {
                println!("[MssqlAdapter::new] Tiberius connection successful!");
                client
            },
            Err(e) => {
                println!("[MssqlAdapter::new] ERROR: Tiberius connection failed: {}", e);
                return Err(AppError::Database(format!("SQL Server authentication failed: {}", e)));
            }
        };
        drop(client); // Close test connection
        
        // Now create the bb8 pool with the same config
        println!("[MssqlAdapter::new] Creating bb8 connection manager...");
        
        // Build proper ADO.NET connection string for bb8-tiberius
        let conn_str = format!(
            "Server=tcp:{},{};Database={};User Id={};Password={};TrustServerCertificate=true;Encrypt=false",
            config.host,
            config.port,
            config.database,
            config.username,
            config.password.as_deref().unwrap_or("")
        );
        
        println!("[MssqlAdapter::new] Connection string: {}", 
            conn_str.replace(config.password.as_deref().unwrap_or(""), "***"));
        
        // Create connection manager directly from connection string
        println!("[MssqlAdapter::new] Creating connection manager...");
        let mgr = bb8_tiberius::ConnectionManager::build(conn_str.as_str())
            .map_err(|e| {
                println!("[MssqlAdapter::new] ERROR: Failed to create connection manager: {}", e);
                AppError::Database(format!("Failed to create MSSQL connection manager: {}", e))
            })?;
        
        
        // Build connection pool with optimal settings for Docker containers
        println!("[MssqlAdapter::new] Building connection pool...");
        let pool = bb8::Pool::builder()
            .max_size(5)  // Increase pool size
            .min_idle(Some(1))  // Keep minimum connections alive
            .connection_timeout(Duration::from_secs(30))  // Longer timeout for Docker containers
            .test_on_check_out(true)  // Enable connection testing
            .build(mgr)
            .await
            .map_err(|e| {
                println!("[MssqlAdapter::new] ERROR: Failed to build connection pool: {}", e);
                AppError::Database(format!("Failed to build MSSQL connection pool: {}", e))
            })?;
        
        // Test the pool by getting a connection
        println!("[MssqlAdapter::new] Testing pool connection...");
        match pool.get().await {
            Ok(mut conn) => {
                println!("[MssqlAdapter::new] Got connection from pool, testing with SELECT 1...");
                match conn.simple_query("SELECT 1 AS test").await {
                    Ok(_) => {
                        println!("[MssqlAdapter::new] Pool connection test successful!");
                    },
                    Err(e) => {
                        println!("[MssqlAdapter::new] ERROR: Query test failed: {}", e);
                        return Err(AppError::Database(format!("MSSQL connection test query failed: {}", e)));
                    }
                }
            },
            Err(e) => {
                println!("[MssqlAdapter::new] ERROR: Failed to get connection from pool: {}", e);
                println!("[MssqlAdapter::new] This usually means:");
                println!("[MssqlAdapter::new]   1. SQL Server is not accepting connections");
                println!("[MssqlAdapter::new]   2. Authentication failed (check username/password)");
                println!("[MssqlAdapter::new]   3. Database '{}' doesn't exist", config.database);
                println!("[MssqlAdapter::new]   4. Network/firewall issues");
                return Err(AppError::Database(format!(
                    "Cannot get connection from MSSQL pool. Error: {}", e
                )));
            }
        }
        
        println!("[MssqlAdapter::new] Connection pool created successfully");
        
        Ok(Self {
            pool,
            config: config.clone(),
            cursors: Arc::new(RwLock::new(HashMap::new())),
            transactions: Arc::new(RwLock::new(HashMap::new())),
        })
    }
    
    // Helper to convert MSSQL row to CellValue array
    fn convert_row_to_cells(&self, row: Row) -> Result<Vec<CellValue>, AppError> {
        let mut cells = Vec::new();
        
        for (idx, column) in row.columns().iter().enumerate() {
            let cell = Self::convert_mssql_value_to_cell(&row, column, idx)?;
            cells.push(cell);
        }
        
        Ok(cells)
    }
    
    // Convert MSSQL value to CellValue with rich metadata
    fn convert_mssql_value_to_cell(row: &Row, column: &Column, idx: usize) 
        -> Result<CellValue, AppError> 
    {
        let type_name = column.name();
        
        // Try to get value at index
        // Different types need different extraction methods
        
        // Try as string first (most common)
        if let Some(val) = row.try_get::<&str, _>(idx).ok().flatten() {
            return Ok(CellValue::text(val.to_string(), type_name));
        }
        
        // Try as i32
        if let Some(val) = row.try_get::<i32, _>(idx).ok().flatten() {
            return Ok(CellValue::integer(val as i64, "INT"));
        }
        
        // Try as i64
        if let Some(val) = row.try_get::<i64, _>(idx).ok().flatten() {
            return Ok(CellValue::integer(val, "BIGINT"));
        }
        
        // Try as i16
        if let Some(val) = row.try_get::<i16, _>(idx).ok().flatten() {
            return Ok(CellValue::integer(val as i64, "SMALLINT"));
        }
        
        // Try as u8 (TINYINT)
        if let Some(val) = row.try_get::<u8, _>(idx).ok().flatten() {
            return Ok(CellValue::integer(val as i64, "TINYINT"));
        }
        
        // Try as f32
        if let Some(val) = row.try_get::<f32, _>(idx).ok().flatten() {
            return Ok(CellValue::decimal(
                val as f64,
                "REAL",
                Some(7),
                None
            ));
        }
        
        // Try as f64
        if let Some(val) = row.try_get::<f64, _>(idx).ok().flatten() {
            return Ok(CellValue::decimal(
                val,
                "FLOAT",
                Some(15),
                None
            ));
        }
        
        // Try as bool
        if let Some(val) = row.try_get::<bool, _>(idx).ok().flatten() {
            return Ok(CellValue::boolean(val, "BIT"));
        }
        
        // Try as &[u8] for binary data
        if let Some(val) = row.try_get::<&[u8], _>(idx).ok().flatten() {
            let hex_string = hex::encode(val);
            return Ok(CellValue {
                value: Some(serde_json::Value::String(hex_string)),
                db_type: "VARBINARY".to_string(),
                value_type: CellValueType::Binary,
                metadata: None,
                is_truncated: false,
                byte_size: Some(val.len()),
            });
        }
        
        // Try as UUID
        if let Some(val) = row.try_get::<uuid::Uuid, _>(idx).ok().flatten() {
            return Ok(CellValue {
                value: Some(serde_json::Value::String(val.to_string())),
                db_type: "UNIQUEIDENTIFIER".to_string(),
                value_type: CellValueType::Uuid,
                metadata: None,
                is_truncated: false,
                byte_size: None,
            });
        }
        
        // If none of the above work, assume it's NULL
        // Tiberius will return None for NULL values in the try_get calls above
        return Ok(CellValue::null(type_name));
        
        // Default to unknown
        Ok(CellValue {
            value: None,
            db_type: type_name.to_string(),
            value_type: CellValueType::Unknown,
            metadata: None,
            is_truncated: false,
            byte_size: None,
        })
    }
}

#[async_trait]
impl DbAdapter for MssqlAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    
    async fn ping(&self) -> Result<Duration, AppError> {
        let start = Instant::now();
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("MSSQL ping failed: {}", e)))?;
        
        // Simple query to test connection
        conn.simple_query("SELECT 1").await
            .map_err(|e| AppError::Database(format!("MSSQL ping query failed: {}", e)))?
            .into_row().await
            .map_err(|e| AppError::Database(format!("MSSQL ping result failed: {}", e)))?;
        
        Ok(start.elapsed())
    }
    
    async fn disconnect(&self) -> Result<(), AppError> {
        // Clear cursors
        self.cursors.write().await.clear();
        
        // Clear transactions
        self.transactions.write().await.clear();
        
        // Connection pool will be dropped when adapter is dropped
        Ok(())
    }
    
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        let query = "SELECT name FROM sys.databases WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb') ORDER BY name";
        
        let stream = conn.simple_query(query).await
            .map_err(|e| AppError::Database(format!("Failed to list databases: {}", e)))?;
        
        let rows = stream.into_first_result().await
            .map_err(|e| AppError::Database(format!("Failed to fetch database list: {}", e)))?;
        
        let mut databases = Vec::new();
        for row in rows {
            if let Some(name) = row.get::<&str, _>(0) {
                databases.push(name.to_string());
            }
        }
        
        Ok(databases)
    }
    
    async fn list_schemas(&self, database: &str) -> Result<Vec<String>, AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Switch to the target database
        let use_db = format!("USE [{}]", database);
        conn.simple_query(&use_db).await
            .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?
            .into_results().await
            .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?;
        
        let query = "SELECT DISTINCT schema_name FROM information_schema.schemata 
                     WHERE schema_name NOT IN ('guest', 'INFORMATION_SCHEMA', 'sys') 
                     ORDER BY schema_name";
        
        let stream = conn.simple_query(query).await
            .map_err(|e| AppError::Database(format!("Failed to list schemas: {}", e)))?;
        
        let rows = stream.into_first_result().await
            .map_err(|e| AppError::Database(format!("Failed to fetch schema list: {}", e)))?;
        
        let mut schemas = Vec::new();
        for row in rows {
            if let Some(name) = row.get::<&str, _>(0) {
                schemas.push(name.to_string());
            }
        }
        
        Ok(schemas)
    }
    
    async fn list_tables(&self, database: &str, schema: &str) -> Result<Vec<TableMeta>, AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Only switch database if it's different from the current connection's database
        // and it's not a schema name (like 'dbo')
        if !database.is_empty() && database != self.config.database && database != schema {
            let use_db = format!("USE [{}]", database);
            conn.simple_query(&use_db).await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?
                .into_results().await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?;
        }
        
        let query = format!(
            "SELECT 
                t.TABLE_SCHEMA,
                t.TABLE_NAME,
                t.TABLE_TYPE,
                p.rows as row_count,
                SUM(a.total_pages) * 8 * 1024 as size_bytes
            FROM INFORMATION_SCHEMA.TABLES t
            LEFT JOIN sys.partitions p ON OBJECT_ID(CONCAT(t.TABLE_SCHEMA, '.', t.TABLE_NAME)) = p.object_id
            LEFT JOIN sys.allocation_units a ON p.partition_id = a.container_id
            WHERE t.TABLE_SCHEMA = '{}'
            GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_TYPE, p.rows
            ORDER BY t.TABLE_NAME", 
            schema
        );
        
        let stream = conn.simple_query(&query).await
            .map_err(|e| AppError::Database(format!("Failed to list tables: {}", e)))?;
        
        let rows = stream.into_first_result().await
            .map_err(|e| AppError::Database(format!("Failed to fetch table list: {}", e)))?;
        
        let mut tables = Vec::new();
        for row in rows {
            let schema_name = row.get::<&str, _>(0).unwrap_or(schema).to_string();
            let table_name = row.get::<&str, _>(1).unwrap_or("").to_string();
            let table_type = row.get::<&str, _>(2).unwrap_or("TABLE");
            let row_count = row.get::<i64, _>(3);
            let size_bytes = row.get::<i64, _>(4);
            
            let kind = match table_type {
                "VIEW" => DbObjectKind::View,
                _ => DbObjectKind::Table,
            };
            
            tables.push(TableMeta {
                schema: schema_name,
                name: table_name,
                kind,
                row_estimate: row_count,
                size_bytes,
            });
        }
        
        Ok(tables)
    }
    
    async fn list_functions(&self, database: &str, schema: &str) -> Result<Vec<FunctionMeta>, AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Only switch database if it's different from the current connection's database
        // and it's not just a schema name (e.g., 'dbo')
        if !database.is_empty() && database != self.config.database && database != schema {
            let use_db = format!("USE [{}]", database);
            conn.simple_query(&use_db).await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?
                .into_results().await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?;
        }
        
        let query = format!(
            "SELECT 
                ROUTINE_SCHEMA,
                ROUTINE_NAME,
                DATA_TYPE,
                ROUTINE_DEFINITION
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_SCHEMA = '{}' AND ROUTINE_TYPE = 'FUNCTION'
            ORDER BY ROUTINE_NAME",
            schema
        );
        
        let stream = conn.simple_query(&query).await
            .map_err(|e| AppError::Database(format!("Failed to list functions: {}", e)))?;
        
        let rows = stream.into_first_result().await
            .map_err(|e| AppError::Database(format!("Failed to fetch function list: {}", e)))?;
        
        let mut functions = Vec::new();
        for row in rows {
            let schema_name = row.get::<&str, _>(0).unwrap_or(schema).to_string();
            let function_name = row.get::<&str, _>(1).unwrap_or("").to_string();
            let return_type = row.get::<&str, _>(2).unwrap_or("").to_string();
            
            functions.push(FunctionMeta {
                schema: schema_name,
                name: function_name,
                return_type,
                arguments: Vec::new(), // TODO: Parse arguments from definition
            });
        }
        
        Ok(functions)
    }
    
    async fn table_columns(&self, database: &str, schema: &str, table: &str) 
        -> Result<Vec<ColumnMeta>, AppError> 
    {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Only switch database if it's different from the current connection's database
        // and it's not just a schema name (e.g., 'dbo')
        if !database.is_empty() && database != self.config.database && database != schema {
            let use_db = format!("USE [{}]", database);
            conn.simple_query(&use_db).await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?
                .into_results().await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?;
        }
        
        let query = format!(
            "SELECT 
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT,
                c.ORDINAL_POSITION,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_PRECISION,
                c.NUMERIC_SCALE,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as is_pk,
                CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as is_fk,
                COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') as is_identity,
                COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsComputed') as is_computed
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                    ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                    AND tc.TABLE_SCHEMA = '{}'
                    AND tc.TABLE_NAME = '{}'
            ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
            LEFT JOIN (
                SELECT ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                    ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
                    AND tc.TABLE_SCHEMA = '{}'
                    AND tc.TABLE_NAME = '{}'
            ) fk ON c.COLUMN_NAME = fk.COLUMN_NAME
            WHERE c.TABLE_SCHEMA = '{}' AND c.TABLE_NAME = '{}'
            ORDER BY c.ORDINAL_POSITION",
            schema, table, schema, table, schema, table
        );
        
        let stream = conn.simple_query(&query).await
            .map_err(|e| AppError::Database(format!("Failed to get column metadata: {}", e)))?;
        
        let rows = stream.into_first_result().await
            .map_err(|e| AppError::Database(format!("Failed to fetch column metadata: {}", e)))?;
        
        let mut columns = Vec::new();
        for row in rows {
            let name = row.get::<&str, _>(0).unwrap_or("").to_string();
            let data_type = row.get::<&str, _>(1).unwrap_or("").to_string();
            let is_nullable = row.get::<&str, _>(2).map(|s| s == "YES").unwrap_or(false);
            let default_value = row.get::<&str, _>(3).map(|s| s.to_string());
            let ordinal = row.get::<i32, _>(4).unwrap_or(0);
            let max_length = row.get::<i32, _>(5);
            let precision = row.get::<i32, _>(6);
            let scale = row.get::<i32, _>(7);
            let is_pk = row.get::<i32, _>(8).map(|v| v == 1).unwrap_or(false);
            let is_fk = row.get::<i32, _>(9).map(|v| v == 1).unwrap_or(false);
            let is_identity = row.get::<i32, _>(10).map(|v| v == 1);
            let is_computed = row.get::<i32, _>(11).map(|v| v == 1);
            
            // Check for spatial types
            let is_spatial = data_type.to_uppercase() == "GEOMETRY" || data_type.to_uppercase() == "GEOGRAPHY";
            let is_hierarchyid = data_type.to_uppercase() == "HIERARCHYID";
            
            columns.push(ColumnMeta {
                name,
                db_type: data_type,
                nullable: is_nullable,
                default: default_value,
                is_pk,
                is_fk,
                ordinal,
                precision,
                scale,
                // MSSQL specific
                is_identity,
                is_computed,
                is_hierarchyid: Some(is_hierarchyid),
                is_spatial: Some(is_spatial),
                // Not in this query but could be added
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
            });
        }
        
        Ok(columns)
    }
    
    async fn table_triggers(&self, database: &str, schema: &str, table: &str) -> Result<Vec<super::TriggerMeta>, AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Only switch database if it's different from the current connection's database
        if !database.is_empty() && database != self.config.database && database != schema {
            let use_db = format!("USE [{}]", database);
            conn.simple_query(&use_db).await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?;
        }
        
        let sql = format!(
            r#"SELECT 
                t.name AS trigger_name,
                CASE te.type
                    WHEN 'I' THEN 'INSERT'
                    WHEN 'U' THEN 'UPDATE'
                    WHEN 'D' THEN 'DELETE'
                    ELSE 'UNKNOWN'
                END AS event,
                CASE 
                    WHEN t.is_instead_of_trigger = 1 THEN 'INSTEAD OF'
                    WHEN te.is_first = 1 THEN 'BEFORE'
                    ELSE 'AFTER'
                END AS timing,
                'ROW' AS level,
                CASE WHEN t.is_disabled = 0 THEN 1 ELSE 0 END AS enabled,
                OBJECT_NAME(t.parent_id) + '.' + t.name AS function_name,
                NULL AS condition,
                NULL AS created
            FROM sys.triggers t
            INNER JOIN sys.trigger_events te ON t.object_id = te.object_id
            INNER JOIN sys.tables tb ON t.parent_id = tb.object_id
            INNER JOIN sys.schemas s ON tb.schema_id = s.schema_id
            WHERE tb.name = '{}' 
                AND s.name = '{}'
            ORDER BY t.name"#,
            table, schema
        );
        
        let mut stream = conn.simple_query(&sql).await
            .map_err(|e| AppError::Database(format!("Failed to get table triggers: {}", e)))?;
        
        let mut triggers = Vec::new();
        while let Some(item) = stream.try_next().await
            .map_err(|e| AppError::Database(format!("Failed to read trigger row: {}", e)))? {
            if let tiberius::QueryItem::Row(row) = item {
                let trigger_name = row.get::<&str, _>(0).unwrap_or("").to_string();
                let event = row.get::<&str, _>(1).unwrap_or("UNKNOWN").to_string();
                let timing = row.get::<&str, _>(2).unwrap_or("AFTER").to_string();
                let level = row.get::<&str, _>(3).unwrap_or("ROW").to_string();
                let enabled = row.get::<i32, _>(4).unwrap_or(1) == 1;
                let function = row.get::<&str, _>(5).unwrap_or("N/A").to_string();
                
                triggers.push(super::TriggerMeta {
                    name: trigger_name,
                    event,
                    timing,
                    level,
                    enabled,
                    function,
                    condition: None,
                    created: None,
                });
            }
        }
        
        Ok(triggers)
    }
    
    async fn estimate_count(&self, database: &str, schema: &str, table: &str) -> Result<i64, AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Only switch database if it's different from the current connection's database
        // and it's not just a schema name (e.g., 'dbo')
        if !database.is_empty() && database != self.config.database && database != schema {
            let use_db = format!("USE [{}]", database);
            conn.simple_query(&use_db).await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?
                .into_results().await
                .map_err(|e| AppError::Database(format!("Failed to switch database: {}", e)))?;
        }
        
        // Use sys.dm_db_partition_stats for fast row count estimation
        let query = format!(
            "SELECT SUM(row_count) 
            FROM sys.dm_db_partition_stats 
            WHERE object_id = OBJECT_ID('[{}].[{}]') 
            AND index_id IN (0, 1)",
            schema, table
        );
        
        let stream = conn.simple_query(&query).await
            .map_err(|e| AppError::Database(format!("Failed to estimate count: {}", e)))?;
        
        let row = stream.into_row().await
            .map_err(|e| AppError::Database(format!("Failed to fetch count: {}", e)))?;
        
        if let Some(row) = row {
            let count = row.get::<i64, _>(0).unwrap_or(0);
            Ok(count)
        } else {
            Ok(0)
        }
    }
    
    async fn begin_query(&self, sql: &str, params: Option<Vec<Value>>, opts: QueryOptions) 
        -> Result<QueryCursor, AppError> 
    {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Execute query
        // For now, we don't support parameters in streaming queries
        // This would need a more complex implementation
        if params.is_some() {
            return Err(AppError::Database("Parameters not yet supported in streaming queries".to_string()));
        }
        
        let mut stream = conn.simple_query(sql).await
            .map_err(|e| AppError::Database(format!("Query execution failed: {}", e)))?;
        
        // Get column metadata
        let columns_info = stream.columns().await
            .map_err(|e| AppError::Database(format!("Failed to get column metadata: {}", e)))?
            .unwrap_or_default();
        
        let mut columns = Vec::new();
        for (idx, col) in columns_info.iter().enumerate() {
            columns.push(ColumnMeta {
                name: col.name().to_string(),
                db_type: "UNKNOWN".to_string(), // Tiberius doesn't expose column type easily
                nullable: true, // TODO: Get actual nullability
                default: None,
                is_pk: false,
                is_fk: false,
                ordinal: idx as i32,
                precision: None,
                scale: None,
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
            });
        }
        
        // Fetch first page of results - stream incrementally to avoid timeout
        let mut rows = Vec::new();
        let mut total_fetched = 0;
        let page_size = opts.page_size;
        let max_rows = opts.max_rows.unwrap_or(usize::MAX);
        
        // Use into_row_stream to stream rows one by one instead of loading all at once
        let mut row_stream = stream.into_row_stream();
        
        while let Some(item) = row_stream.next().await {
            if total_fetched >= page_size || total_fetched >= max_rows {
                break;
            }
            
            match item {
                Ok(row) => {
                    let cells = self.convert_row_to_cells(row)?;
                    rows.push(cells);
                    total_fetched += 1;
                }
                Err(e) => {
                    return Err(AppError::Database(format!("Failed to fetch row: {}", e)));
                }
            }
        }
        
        let is_complete = total_fetched < page_size || total_fetched >= max_rows;
        
        // Create cursor
        let cursor_id = Uuid::new_v4().to_string();
        let cursor = QueryCursor {
            id: cursor_id.clone(),
            sql: sql.to_string(),
            columns,
            rows: rows.clone(),
            page_size,
            current_page: 0,
            total_rows: if is_complete { Some(total_fetched) } else { None },
            is_complete,
            created_at: Some(Instant::now()),
        };
        
        // Store cursor for future fetches
        if !is_complete {
            self.cursors.write().await.insert(cursor_id, Arc::new(RwLock::new(cursor.clone())));
        }
        
        Ok(cursor)
    }
    
    async fn fetch_page(&self, cursor: &mut QueryCursor, page: usize, page_size: usize) 
        -> Result<QueryPage, AppError> 
    {
        // For MSSQL, we need to re-execute the query with OFFSET/FETCH
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Add pagination to the original SQL
        let offset = page * page_size;
        let paginated_sql = format!(
            "{} ORDER BY (SELECT NULL) OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
            cursor.sql, offset, page_size
        );
        
        let mut stream = conn.simple_query(&paginated_sql).await
            .map_err(|e| AppError::Database(format!("Query execution failed: {}", e)))?;
        
        // Stream rows incrementally to avoid timeout
        let mut rows = Vec::new();
        let mut row_stream = stream.into_row_stream();
        
        while let Some(item) = row_stream.next().await {
            if rows.len() >= page_size {
                break;
            }
            
            match item {
                Ok(row) => {
                    let cells = self.convert_row_to_cells(row)?;
                    rows.push(cells);
                }
                Err(e) => {
                    return Err(AppError::Database(format!("Failed to fetch row: {}", e)));
                }
            }
        }
        
        let is_complete = rows.len() < page_size;
        
        Ok(QueryPage {
            rows,
            page,
            is_complete,
        })
    }
    
    async fn close_cursor(&self, cursor_id: &str) -> Result<(), AppError> {
        self.cursors.write().await.remove(cursor_id);
        Ok(())
    }
    
    async fn execute(&self, sql: &str, params: Option<Vec<Value>>) -> Result<ExecuteResult, AppError> {
        let start = Instant::now();
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // For parameterized execution, we'd need to convert JSON values to Tiberius types
        // For now, execute without parameters
        if params.is_some() {
            return Err(AppError::Database("Parameters not yet supported in execute".to_string()));
        }
        
        let result = conn.execute(sql, &[]).await
            .map_err(|e| AppError::Database(format!("Execution failed: {}", e)))?;
        
        let rows_affected = result.rows_affected().iter().sum::<u64>();
        
        Ok(ExecuteResult {
            rows_affected,
            last_insert_id: None, // MSSQL doesn't return this directly
            execution_time_ms: start.elapsed().as_millis() as f64,
        })
    }
    
    async fn begin_transaction(&self) -> Result<TransactionId, AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        conn.simple_query("BEGIN TRANSACTION").await
            .map_err(|e| AppError::Database(format!("Failed to begin transaction: {}", e)))?
            .into_results().await
            .map_err(|e| AppError::Database(format!("Failed to begin transaction: {}", e)))?;
        
        let tx_id = Uuid::new_v4().to_string();
        
        // Store the connection for this transaction
        // Note: This requires careful lifetime management
        // In production, you might want to use a different approach
        
        Ok(tx_id)
    }
    
    async fn commit(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        // Get the connection associated with this transaction
        // For now, we'll just use a new connection
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        conn.simple_query("COMMIT").await
            .map_err(|e| AppError::Database(format!("Failed to commit transaction: {}", e)))?
            .into_results().await
            .map_err(|e| AppError::Database(format!("Failed to commit transaction: {}", e)))?;
        
        Ok(())
    }
    
    async fn rollback(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        conn.simple_query("ROLLBACK").await
            .map_err(|e| AppError::Database(format!("Failed to rollback transaction: {}", e)))?
            .into_results().await
            .map_err(|e| AppError::Database(format!("Failed to rollback transaction: {}", e)))?;
        
        Ok(())
    }
    
    async fn server_version(&self) -> Result<String, AppError> {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        let query = "SELECT @@VERSION";
        let stream = conn.simple_query(query).await
            .map_err(|e| AppError::Database(format!("Failed to get server version: {}", e)))?;
        
        let row = stream.into_row().await
            .map_err(|e| AppError::Database(format!("Failed to fetch version: {}", e)))?;
        
        if let Some(row) = row {
            if let Some(version) = row.get::<&str, _>(0) {
                return Ok(version.to_string());
            }
        }
        
        Ok("Unknown".to_string())
    }
    
    async fn read_table_data(&self, request: TableReadRequest) 
        -> Result<(TableDataResponse, Option<String>), AppError> 
    {
        let mut conn = self.pool.get().await
            .map_err(|e| AppError::Database(format!("Failed to get connection: {}", e)))?;
        
        // Build the SQL query
        let mut sql = String::new();
        
        // Select columns
        if let Some(ref columns) = request.select {
            sql.push_str(&format!("SELECT {} ", columns.join(", ")));
        } else {
            sql.push_str("SELECT * ");
        }
        
        // From clause
        if let Some(ref schema) = request.schema {
            sql.push_str(&format!("FROM [{}].[{}] ", schema, request.table));
        } else {
            sql.push_str(&format!("FROM [{}] ", request.table));
        }
        
        // Where clause for filters
        let mut where_conditions = Vec::new();
        
        for filter in &request.filters {
            let condition = match filter.operator {
                FilterOperator::Equal => format!("[{}] = '{}'", filter.column, filter.value),
                FilterOperator::NotEqual => format!("[{}] != '{}'", filter.column, filter.value),
                FilterOperator::LessThan => format!("[{}] < '{}'", filter.column, filter.value),
                FilterOperator::LessThanOrEqual => format!("[{}] <= '{}'", filter.column, filter.value),
                FilterOperator::GreaterThan => format!("[{}] > '{}'", filter.column, filter.value),
                FilterOperator::GreaterThanOrEqual => format!("[{}] >= '{}'", filter.column, filter.value),
                FilterOperator::Like => format!("[{}] LIKE '%{}%'", filter.column, filter.value),
                FilterOperator::ILike => format!("LOWER([{}]) LIKE LOWER('%{}%')", filter.column, filter.value),
                FilterOperator::IsNull => format!("[{}] IS NULL", filter.column),
                FilterOperator::IsNotNull => format!("[{}] IS NOT NULL", filter.column),
                _ => continue,
            };
            where_conditions.push(condition);
        }
        
        // Add search condition
        if let Some(ref _search) = request.search {
            // For simplicity, search in all string columns
            // In production, you'd want to be more selective
            where_conditions.push(format!("1=1")); // Placeholder for search
        }
        
        if !where_conditions.is_empty() {
            sql.push_str(&format!("WHERE {} ", where_conditions.join(" AND ")));
        }
        
        // Order by clause
        if !request.sorts.is_empty() {
            let order_parts: Vec<String> = request.sorts.iter().map(|sort| {
                let dir = match sort.direction {
                    SortDirection::Asc => "ASC",
                    SortDirection::Desc => "DESC",
                };
                format!("[{}] {}", sort.column, dir)
            }).collect();
            sql.push_str(&format!("ORDER BY {} ", order_parts.join(", ")));
        } else {
            sql.push_str("ORDER BY (SELECT NULL) ");
        }
        
        // Pagination
        let (offset, limit) = match request.pagination {
            PaginationMode::Offset { offset, limit } => (offset, limit),
            PaginationMode::Cursor { .. } => (0, 100), // Default for cursor mode
        };
        
        sql.push_str(&format!("OFFSET {} ROWS FETCH NEXT {} ROWS ONLY", offset, limit));
        
        // Execute query
        let mut stream = conn.simple_query(&sql).await
            .map_err(|e| AppError::Database(format!("Failed to read table data: {}", e)))?;
        
        // Get column metadata
        let columns_info = stream.columns().await
            .map_err(|e| AppError::Database(format!("Failed to get column metadata: {}", e)))?
            .unwrap_or_default();
        
        let mut columns = Vec::new();
        let mut selected = Vec::new();
        
        for col in columns_info.iter() {
            let name = col.name().to_string();
            selected.push(name.clone());
            columns.push(ColumnMeta {
                name,
                db_type: "UNKNOWN".to_string(),
                nullable: true,
                default: None,
                is_pk: false,
                is_fk: false,
                ordinal: 0,
                precision: None,
                scale: None,
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
            });
        }
        
        // Fetch rows - stream incrementally to avoid timeout
        let mut rows = Vec::new();
        let mut row_count = 0;
        
        // Use into_row_stream to stream rows one by one instead of loading all at once
        let mut row_stream = stream.into_row_stream();
        
        while let Some(item) = row_stream.next().await {
            if row_count >= limit {
                break;  // Stop once we have enough rows for this page
            }
            
            match item {
                Ok(row) => {
                    let cells = self.convert_row_to_cells(row)?;
                    let mut row_map = std::collections::HashMap::new();
                    
                    for (idx, cell) in cells.into_iter().enumerate() {
                        if idx < selected.len() {
                            row_map.insert(selected[idx].clone(), cell);
                        }
                    }
                    
                    rows.push(row_map);
                    row_count += 1;
                }
                Err(e) => {
                    return Err(AppError::Database(format!("Failed to fetch row: {}", e)));
                }
            }
        }
        
        // Build response
        let response = if offset == 0 {
            TableDataResponse::Meta {
                table: request.table.clone(),
                schema: request.schema.clone(),
                columns,
                selected,
                page_size: limit,
                cursor_key_columns: vec![],
            }
        } else {
            let has_more = rows.len() == limit;
            TableDataResponse::Rows {
                rows,
                next_cursor: if has_more {
                    Some(format!("{}", offset + limit))
                } else {
                    None
                },
            }
        };
        
        Ok((response, None))
    }
}