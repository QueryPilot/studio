use async_trait::async_trait;
use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::simple_converter::SimpleConverter;
#[allow(unused_imports)]
use super::types::SqliteTypeConverter;
use crate::core::adapter::DbAdapter;
use crate::error::{AppError, Result};
use crate::types::*;

/// SQLite adapter using rusqlite with spawn_blocking for async compatibility.
///
/// SQLite is inherently synchronous (file I/O), so we wrap operations in
/// tokio::task::spawn_blocking to prevent blocking the async runtime.
pub struct SqliteAdapter {
    /// SQLite connection wrapped in Arc<Mutex> for thread-safe access
    connection: Arc<Mutex<Option<Connection>>>,
    /// Path to the database file
    db_path: Arc<Mutex<Option<PathBuf>>>,
}

impl SqliteAdapter {
    pub fn new() -> Self {
        Self {
            connection: Arc::new(Mutex::new(None)),
            db_path: Arc::new(Mutex::new(None)),
        }
    }

    /// Get a reference to check if connected
    async fn is_conn_open(&self) -> bool {
        self.connection.lock().await.is_some()
    }

    /// Execute a SQL statement in a blocking context
    async fn execute_blocking<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.connection.clone();
        
        tokio::task::spawn_blocking(move || {
            let guard = futures::executor::block_on(conn.lock());
            let conn = guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
            f(conn)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }
}

impl Default for SqliteAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DbAdapter for SqliteAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        // Disconnect if already connected
        if self.is_conn_open().await {
            self.disconnect().await?;
        }

        // SQLite uses the database field as the file path
        let db_path = PathBuf::from(&profile.database);

        // Open connection in blocking context
        let path = db_path.clone();
        let conn = tokio::task::spawn_blocking(move || {
            let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX;

            Connection::open_with_flags(&path, flags)
                .map_err(|e| AppError::Internal(format!("Failed to open SQLite database: {}", e)))
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))??;

        // Enable foreign keys and WAL mode for better performance
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -64000;", // 64MB cache
        )
        .map_err(|e| AppError::Internal(format!("Failed to configure SQLite: {}", e)))?;

        *self.connection.lock().await = Some(conn);
        *self.db_path.lock().await = Some(db_path);

        Ok(())
    }

    async fn disconnect(&mut self) -> Result<()> {
        let conn = self.connection.lock().await.take();
        if let Some(conn) = conn {
            // Close connection in blocking context
            tokio::task::spawn_blocking(move || {
                drop(conn);
            })
            .await
            .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?;
        }
        *self.db_path.lock().await = None;
        Ok(())
    }

    async fn test_connection(&self) -> Result<ConnectionTestResult> {
        self.execute_blocking(|conn| {
            // Get SQLite version
            let version: String = conn
                .query_row("SELECT sqlite_version()", [], |row| row.get(0))
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

            Ok(ConnectionTestResult {
                success: true,
                message: "Connected to SQLite database".to_string(),
                version: Some(format!("SQLite {}", version)),
                warnings: vec![],
            })
        })
        .await
    }

    async fn is_connected(&self) -> bool {
        if !self.is_conn_open().await {
            return false;
        }

        self.execute_blocking(|conn| {
            conn.query_row("SELECT 1", [], |_| Ok(()))
                .map_err(|e| AppError::DatabaseError(format!("Ping failed: {}", e)))
        })
        .await
        .is_ok()
    }

    async fn query(&self, sql: &str) -> Result<QueryResult> {
        let sql = sql.to_string();

        self.execute_blocking(move |conn| {
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

            // Get column metadata
            let column_count = stmt.column_count();
            let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let columns: Vec<ColumnMeta> = (0..column_count)
                .map(|i| {
                    let name = column_names.get(i).cloned().unwrap_or_default();
                    // SQLite doesn't provide column type info from prepared statements in a simple way
                    let db_type = "TEXT".to_string();
                    let data_type = CellValueType::Text;

                    ColumnMeta {
                        name,
                        data_type,
                        nullable: true, // SQLite doesn't enforce NOT NULL in schema introspection
                        primary_key: false,
                        db_type,
                        type_oid: None,
                        default_value: None,
                        comment: None,
                        enum_values: None,
                        type_category: None,
                        precision: None,
                        scale: None,
                    }
                })
                .collect();

            // Execute query and collect rows
            let mut rows = Vec::new();
            let mut result_rows = stmt
                .query([])
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

            while let Some(row) = result_rows
                .next()
                .map_err(|e| AppError::DatabaseError(format!("Row fetch failed: {}", e)))?
            {
                rows.push(SimpleConverter::row_to_json(row, column_count));
            }

            Ok(QueryResult { columns, rows })
        })
        .await
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        let sql = sql.to_string();

        self.execute_blocking(move |conn| {
            let affected = conn
                .execute(&sql, [])
                .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;

            Ok(affected as u64)
        })
        .await
    }

    fn get_supported_types(&self) -> Vec<CellValueType> {
        vec![
            CellValueType::Null,
            CellValueType::Text,
            CellValueType::Integer,
            CellValueType::Decimal,
            CellValueType::Binary,
            // SQLite doesn't have native boolean/date/time types, but we support them via affinity
            CellValueType::Boolean,
            CellValueType::Date,
            CellValueType::Time,
            CellValueType::DateTime,
            CellValueType::Json,
        ]
    }

    fn supports_schemas(&self) -> bool {
        // SQLite doesn't have schemas in the traditional sense
        false
    }

    fn supports_procedures(&self) -> bool {
        false
    }

    fn supports_functions(&self) -> bool {
        // SQLite has user-defined functions, but not stored procedures
        false
    }

    fn supports_streaming(&self) -> bool {
        // SQLite is file-based and doesn't benefit from streaming the same way
        true
    }
}

