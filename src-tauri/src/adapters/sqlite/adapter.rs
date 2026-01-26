use async_trait::async_trait;
use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::simple_converter::SimpleConverter;
#[allow(unused_imports)]
use super::types::SqliteTypeConverter;
use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityColumnMeta, CapabilityQueryResult,
    CapabilityTestResult, SqlQueryable,
};
use crate::error::AppError;
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
    async fn execute_blocking<F, T>(&self, f: F) -> Result<T, AppError>
    where
        F: FnOnce(&Connection) -> Result<T, AppError> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.connection.clone();

        tokio::task::spawn_blocking(move || {
            let guard = conn.blocking_lock();
            let conn = guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
            f(conn)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    /// Get a clone of the connection Arc for backup operations
    pub(crate) fn get_connection(&self) -> Arc<Mutex<Option<Connection>>> {
        self.connection.clone()
    }

    /// Get a clone of the db_path Arc for backup operations
    pub(crate) fn get_db_path(&self) -> Arc<Mutex<Option<PathBuf>>> {
        self.db_path.clone()
    }
}

impl Default for SqliteAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseCapability for SqliteAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
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

    async fn disconnect(&self) -> Result<(), AppError> {
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

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let start = std::time::Instant::now();
        // Use timeout to avoid hanging on dead connections
        let test = self.execute_blocking(|conn| {
            // Get SQLite version
            let version: String = conn
                .query_row("SELECT sqlite_version()", [], |row| row.get(0))
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;

            Ok(version)
        });

        // 10 second timeout for test_connection (longer than is_connected since it does more work)
        let version = tokio::time::timeout(std::time::Duration::from_secs(10), test)
            .await
            .map_err(|_| AppError::ConnectionClosed("Connection test timed out".into()))??;

        Ok(CapabilityTestResult {
            success: true,
            message: "Connected to SQLite database".to_string(),
            latency_ms: Some(start.elapsed().as_millis() as u64),
            server_version: Some(format!("SQLite {}", version)),
        })
    }

    fn is_connected(&self) -> bool {
        // Note: Using try_lock() since this is called from sync context.
        // Returns false if lock can't be acquired, which is safe behavior.
        self.connection
            .try_lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![
            AdapterCapability::SqlQueryable,
        ]
    }
}

#[async_trait]
impl SqlQueryable for SqliteAdapter {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        let sql = sql.to_string();

        self.execute_blocking(move |conn| {
            // Check if this is a multi-statement query (contains multiple semicolons or transaction keywords)
            let trimmed = sql.trim();
            let is_multi_statement = trimmed.matches(';').count() > 1
                || trimmed.to_uppercase().contains("BEGIN")
                || trimmed.to_uppercase().contains("COMMIT");

            if is_multi_statement {
                // Use execute_batch for multi-statement queries (transactions, DDL scripts)
                // This doesn't return results, just executes the statements
                conn.execute_batch(&sql)
                    .map_err(|e| AppError::DatabaseError(format!("Batch execute failed: {}", e)))?;

                // Return empty result for batch operations
                return Ok(CapabilityQueryResult {
                    columns: vec![CapabilityColumnMeta {
                        name: "result".to_string(),
                        data_type: "TEXT".to_string(),
                    }],
                    rows: vec![vec![serde_json::Value::String(
                        "Batch executed successfully".to_string(),
                    )]],
                });
            }

            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

            // Get column metadata
            let column_count = stmt.column_count();
            let column_names: Vec<String> =
                stmt.column_names().iter().map(|s| s.to_string()).collect();
            let columns: Vec<CapabilityColumnMeta> = (0..column_count)
                .map(|i| {
                    let name = column_names.get(i).cloned().unwrap_or_default();
                    CapabilityColumnMeta {
                        name,
                        data_type: "TEXT".to_string(),
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

            Ok(CapabilityQueryResult { columns, rows })
        })
        .await
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError> {
        let sql = sql.to_string();

        self.execute_blocking(move |conn| {
            // Check if this is a multi-statement query (contains multiple semicolons or transaction keywords)
            let trimmed = sql.trim();
            let is_multi_statement = trimmed.matches(';').count() > 1
                || trimmed.to_uppercase().contains("BEGIN")
                || trimmed.to_uppercase().contains("COMMIT");

            if is_multi_statement {
                // Use execute_batch for multi-statement queries (transactions, DDL scripts)
                conn.execute_batch(&sql)
                    .map_err(|e| AppError::DatabaseError(format!("Batch execute failed: {}", e)))?;
                // execute_batch doesn't return affected rows count
                Ok(0)
            } else {
                let affected = conn
                    .execute(&sql, [])
                    .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;
                Ok(affected as u64)
            }
        })
        .await
    }
}

