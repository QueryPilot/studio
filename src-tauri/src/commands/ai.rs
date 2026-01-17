//! AI-facing commands for the sidecar.
//!
//! These commands are security wrappers around existing database operations,
//! restricted to read-only introspection operations. They expose capability
//! information and paradigm-specific data to the AI sidecar.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::capabilities::CapabilityQueryResult;
use crate::core::manager::ConnectionManager;

// ============ Types ============

/// Result of capability detection for a connection
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityResult {
    /// The kind of database: "sql", "document", "keyvalue", or "unknown"
    pub kind: String,
    /// List of capabilities the adapter supports
    pub capabilities: Vec<String>,
    /// Error message if capability detection failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Safe fallback tools that work even when capability detection fails
    pub fallback_tools: Vec<String>,
}

impl CapabilityResult {
    /// Create a result for when the connection is not found
    pub fn connection_not_found(conn_id: &str) -> Self {
        Self {
            kind: "unknown".to_string(),
            capabilities: vec![],
            error: Some(format!("Connection '{}' not found", conn_id)),
            fallback_tools: vec![], // No tools available without connection
        }
    }

    /// Create a result for SQL adapters
    pub fn sql(capabilities: Vec<String>) -> Self {
        Self {
            kind: "sql".to_string(),
            capabilities,
            error: None,
            fallback_tools: vec![
                "list_tables".to_string(),
                "get_sample_data".to_string(),
                "execute_readonly_query".to_string(),
            ],
        }
    }

    /// Create a result for document adapters (MongoDB)
    pub fn document(capabilities: Vec<String>) -> Self {
        Self {
            kind: "document".to_string(),
            capabilities,
            error: None,
            fallback_tools: vec![
                "list_collections".to_string(),
                "find_documents".to_string(),
            ],
        }
    }

    /// Create a result for key-value adapters (Redis)
    pub fn keyvalue(capabilities: Vec<String>) -> Self {
        Self {
            kind: "keyvalue".to_string(),
            capabilities,
            error: None,
            fallback_tools: vec!["scan_keys".to_string(), "get_key".to_string()],
        }
    }
}

// ============ Commands ============

/// Get capabilities for a connection.
///
/// This command exposes adapter capabilities to the AI sidecar so it can
/// determine which tools are available for the current connection.
#[tauri::command]
pub async fn ai_get_capabilities(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<CapabilityResult, String> {
    let conn = match manager.get_connection(&conn_id) {
        Some(c) => c,
        None => return Ok(CapabilityResult::connection_not_found(&conn_id)),
    };

    let adapter = &conn.adapter;

    // Check which paradigm this adapter supports
    if adapter.as_sql().is_some() {
        let caps = vec![
            "sql-queryable".to_string(),
            "list-schemas".to_string(),
            "list-tables".to_string(),
            "get-table-structure".to_string(),
            "get-indexes".to_string(),
            "get-foreign-keys".to_string(),
            "get-views".to_string(),
            "get-functions".to_string(),
            "explain-query".to_string(),
        ];
        return Ok(CapabilityResult::sql(caps));
    }

    if adapter.as_document().is_some() {
        let caps = vec![
            "document-queryable".to_string(),
            "list-collections".to_string(),
            "find-documents".to_string(),
            "aggregate".to_string(),
            "count-documents".to_string(),
            "list-databases".to_string(),
            "list-indexes".to_string(),
        ];
        return Ok(CapabilityResult::document(caps));
    }

    if adapter.as_keyvalue().is_some() {
        let caps = vec![
            "keyvalue-operable".to_string(),
            "rich-keyvalue-operable".to_string(),
            "scan-keys".to_string(),
            "get-key".to_string(),
            "get-key-type".to_string(),
            "get-ttl".to_string(),
            "db-size".to_string(),
            "server-info".to_string(),
            "hash-get-all".to_string(),
            "list-range".to_string(),
            "set-members".to_string(),
            "zset-range".to_string(),
            "stream-range".to_string(),
        ];
        return Ok(CapabilityResult::keyvalue(caps));
    }

    // Unknown adapter type - shouldn't happen but handle gracefully
    Ok(CapabilityResult {
        kind: "unknown".to_string(),
        capabilities: vec![],
        error: Some("Unknown adapter type".to_string()),
        fallback_tools: vec!["execute_readonly_query".to_string()],
    })
}

// ============ SQL Introspection ============

/// Read-only SQL introspection operations for the AI sidecar.
///
/// These operations are designed to be safe for AI tools to call,
/// restricted to read-only queries that retrieve schema metadata.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SqlIntrospectionOp {
    /// List all schemas in the database
    ListSchemas,
    /// List all tables in a schema
    ListTables {
        schema: String,
    },
    /// Get table structure (columns, types, constraints)
    GetTableStructure {
        schema: String,
        table: String,
    },
    /// Get indexes for a table
    GetIndexes {
        schema: String,
        table: String,
    },
    /// Get foreign keys for a table
    GetForeignKeys {
        schema: String,
        table: String,
    },
    /// Get views in a schema
    GetViews {
        schema: String,
    },
    /// Get functions in a schema
    GetFunctions {
        schema: String,
    },
    /// Explain a query plan (read-only)
    ExplainQuery {
        sql: String,
    },
    /// Get sample data from a table (limited)
    GetSampleData {
        schema: String,
        table: String,
        #[serde(default = "default_sample_limit")]
        limit: u32,
    },
}

fn default_sample_limit() -> u32 {
    10
}

impl SqlIntrospectionOp {
    /// Get the operation name for logging/error messages
    pub fn name(&self) -> &'static str {
        match self {
            Self::ListSchemas => "list_schemas",
            Self::ListTables { .. } => "list_tables",
            Self::GetTableStructure { .. } => "get_table_structure",
            Self::GetIndexes { .. } => "get_indexes",
            Self::GetForeignKeys { .. } => "get_foreign_keys",
            Self::GetViews { .. } => "get_views",
            Self::GetFunctions { .. } => "get_functions",
            Self::ExplainQuery { .. } => "explain_query",
            Self::GetSampleData { .. } => "get_sample_data",
        }
    }
}

/// Execute a read-only SQL introspection operation.
///
/// This command is designed for the AI sidecar to query database metadata
/// without needing to construct raw SQL. The backend handles dialect
/// differences between PostgreSQL, MySQL, SQLite, and SQL Server.
#[tauri::command]
pub async fn ai_sql_execute(
    conn_id: String,
    operation: SqlIntrospectionOp,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<CapabilityQueryResult, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let sql_adapter = conn
        .adapter
        .as_sql()
        .ok_or_else(|| "ai_sql_execute only supports SQL databases".to_string())?;

    let db_type = conn.adapter.db_type();
    let sql = build_introspection_sql(&operation, db_type)?;

    tracing::debug!("AI SQL introspection: {} - {}", operation.name(), sql);

    sql_adapter
        .execute_query(&sql)
        .await
        .map_err(|e| format!("SQL introspection failed: {}", e))
}

/// Build SQL for introspection based on database type.
///
/// This function handles dialect differences between database systems.
fn build_introspection_sql(
    op: &SqlIntrospectionOp,
    db_type: crate::types::DbType,
) -> Result<String, String> {
    use crate::types::DbType;

    match op {
        SqlIntrospectionOp::ListSchemas => match db_type {
            DbType::PostgreSQL => Ok(
                "SELECT schema_name FROM information_schema.schemata \
                 WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
                 ORDER BY schema_name"
                    .to_string(),
            ),
            DbType::MySQL | DbType::MariaDB => {
                Ok("SELECT schema_name FROM information_schema.schemata ORDER BY schema_name"
                    .to_string())
            }
            DbType::SQLite => {
                // SQLite doesn't have schemas in the traditional sense
                Ok("SELECT 'main' as schema_name".to_string())
            }
            DbType::SQLServer => Ok(
                "SELECT name as schema_name FROM sys.schemas \
                 WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') \
                 ORDER BY name"
                    .to_string(),
            ),
            _ => Err(format!("ListSchemas not supported for {:?}", db_type)),
        },

        SqlIntrospectionOp::ListTables { schema } => {
            let schema = sanitize_identifier(schema)?;
            match db_type {
                DbType::PostgreSQL => Ok(format!(
                    "SELECT schemaname as schema, tablename as name, 'table' as kind \
                     FROM pg_tables WHERE schemaname = '{}' \
                     ORDER BY tablename",
                    schema
                )),
                DbType::MySQL | DbType::MariaDB => Ok(format!(
                    "SELECT table_schema as schema, table_name as name, 'table' as kind \
                     FROM information_schema.tables \
                     WHERE table_schema = '{}' AND table_type = 'BASE TABLE' \
                     ORDER BY table_name",
                    schema
                )),
                DbType::SQLite => Ok(
                    "SELECT 'main' as schema, name, type as kind \
                     FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
                     ORDER BY name"
                        .to_string(),
                ),
                DbType::SQLServer => Ok(format!(
                    "SELECT s.name as schema, t.name, 'table' as kind \
                     FROM sys.tables t \
                     JOIN sys.schemas s ON t.schema_id = s.schema_id \
                     WHERE s.name = '{}' \
                     ORDER BY t.name",
                    schema
                )),
                _ => Err(format!("ListTables not supported for {:?}", db_type)),
            }
        }

        SqlIntrospectionOp::GetTableStructure { schema, table } => {
            let schema = sanitize_identifier(schema)?;
            let table = sanitize_identifier(table)?;
            match db_type {
                DbType::PostgreSQL => Ok(format!(
                    "SELECT column_name as name, data_type, \
                     is_nullable = 'YES' as nullable, column_default as default_value \
                     FROM information_schema.columns \
                     WHERE table_schema = '{}' AND table_name = '{}' \
                     ORDER BY ordinal_position",
                    schema, table
                )),
                DbType::MySQL | DbType::MariaDB => Ok(format!(
                    "SELECT column_name as name, column_type as data_type, \
                     is_nullable = 'YES' as nullable, column_default as default_value \
                     FROM information_schema.columns \
                     WHERE table_schema = '{}' AND table_name = '{}' \
                     ORDER BY ordinal_position",
                    schema, table
                )),
                DbType::SQLite => Ok(format!("PRAGMA table_info('{}')", table)),
                DbType::SQLServer => Ok(format!(
                    "SELECT c.name, t.name as data_type, c.is_nullable as nullable \
                     FROM sys.columns c \
                     JOIN sys.types t ON c.user_type_id = t.user_type_id \
                     JOIN sys.tables tb ON c.object_id = tb.object_id \
                     JOIN sys.schemas s ON tb.schema_id = s.schema_id \
                     WHERE s.name = '{}' AND tb.name = '{}' \
                     ORDER BY c.column_id",
                    schema, table
                )),
                _ => Err(format!("GetTableStructure not supported for {:?}", db_type)),
            }
        }

        SqlIntrospectionOp::GetIndexes { schema, table } => {
            let schema = sanitize_identifier(schema)?;
            let table = sanitize_identifier(table)?;
            match db_type {
                DbType::PostgreSQL => Ok(format!(
                    "SELECT indexname as name, indexdef as definition \
                     FROM pg_indexes \
                     WHERE schemaname = '{}' AND tablename = '{}' \
                     ORDER BY indexname",
                    schema, table
                )),
                DbType::MySQL | DbType::MariaDB => Ok(format!(
                    "SHOW INDEX FROM `{}`.`{}`",
                    schema, table
                )),
                DbType::SQLite => Ok(format!("PRAGMA index_list('{}')", table)),
                DbType::SQLServer => Ok(format!(
                    "SELECT i.name, i.type_desc as definition \
                     FROM sys.indexes i \
                     JOIN sys.tables t ON i.object_id = t.object_id \
                     JOIN sys.schemas s ON t.schema_id = s.schema_id \
                     WHERE s.name = '{}' AND t.name = '{}' AND i.name IS NOT NULL \
                     ORDER BY i.name",
                    schema, table
                )),
                _ => Err(format!("GetIndexes not supported for {:?}", db_type)),
            }
        }

        SqlIntrospectionOp::GetForeignKeys { schema, table } => {
            let schema = sanitize_identifier(schema)?;
            let table = sanitize_identifier(table)?;
            match db_type {
                DbType::PostgreSQL => Ok(format!(
                    "SELECT \
                        tc.constraint_name, \
                        kcu.column_name, \
                        ccu.table_schema AS foreign_table_schema, \
                        ccu.table_name AS foreign_table_name, \
                        ccu.column_name AS foreign_column_name \
                     FROM information_schema.table_constraints AS tc \
                     JOIN information_schema.key_column_usage AS kcu \
                        ON tc.constraint_name = kcu.constraint_name \
                        AND tc.table_schema = kcu.table_schema \
                     JOIN information_schema.constraint_column_usage AS ccu \
                        ON ccu.constraint_name = tc.constraint_name \
                     WHERE tc.constraint_type = 'FOREIGN KEY' \
                        AND tc.table_schema = '{}' AND tc.table_name = '{}'",
                    schema, table
                )),
                DbType::MySQL | DbType::MariaDB => Ok(format!(
                    "SELECT constraint_name, column_name, \
                     referenced_table_schema as foreign_table_schema, \
                     referenced_table_name as foreign_table_name, \
                     referenced_column_name as foreign_column_name \
                     FROM information_schema.key_column_usage \
                     WHERE table_schema = '{}' AND table_name = '{}' \
                     AND referenced_table_name IS NOT NULL",
                    schema, table
                )),
                DbType::SQLite => Ok(format!("PRAGMA foreign_key_list('{}')", table)),
                DbType::SQLServer => Ok(format!(
                    "SELECT f.name AS constraint_name, \
                     COL_NAME(fc.parent_object_id, fc.parent_column_id) AS column_name, \
                     OBJECT_SCHEMA_NAME(f.referenced_object_id) AS foreign_table_schema, \
                     OBJECT_NAME(f.referenced_object_id) AS foreign_table_name, \
                     COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS foreign_column_name \
                     FROM sys.foreign_keys AS f \
                     JOIN sys.foreign_key_columns AS fc ON f.object_id = fc.constraint_object_id \
                     JOIN sys.tables t ON f.parent_object_id = t.object_id \
                     JOIN sys.schemas s ON t.schema_id = s.schema_id \
                     WHERE s.name = '{}' AND t.name = '{}'",
                    schema, table
                )),
                _ => Err(format!("GetForeignKeys not supported for {:?}", db_type)),
            }
        }

        SqlIntrospectionOp::GetViews { schema } => {
            let schema = sanitize_identifier(schema)?;
            match db_type {
                DbType::PostgreSQL => Ok(format!(
                    "SELECT table_name as name, view_definition as definition \
                     FROM information_schema.views \
                     WHERE table_schema = '{}' \
                     ORDER BY table_name",
                    schema
                )),
                DbType::MySQL | DbType::MariaDB => Ok(format!(
                    "SELECT table_name as name, view_definition as definition \
                     FROM information_schema.views \
                     WHERE table_schema = '{}' \
                     ORDER BY table_name",
                    schema
                )),
                DbType::SQLite => Ok(
                    "SELECT name, sql as definition \
                     FROM sqlite_master WHERE type = 'view' \
                     ORDER BY name"
                        .to_string(),
                ),
                DbType::SQLServer => Ok(format!(
                    "SELECT v.name, m.definition \
                     FROM sys.views v \
                     JOIN sys.sql_modules m ON v.object_id = m.object_id \
                     JOIN sys.schemas s ON v.schema_id = s.schema_id \
                     WHERE s.name = '{}' \
                     ORDER BY v.name",
                    schema
                )),
                _ => Err(format!("GetViews not supported for {:?}", db_type)),
            }
        }

        SqlIntrospectionOp::GetFunctions { schema } => {
            let schema = sanitize_identifier(schema)?;
            match db_type {
                DbType::PostgreSQL => Ok(format!(
                    "SELECT routine_name as name, routine_type, data_type as return_type \
                     FROM information_schema.routines \
                     WHERE routine_schema = '{}' \
                     ORDER BY routine_name",
                    schema
                )),
                DbType::MySQL | DbType::MariaDB => Ok(format!(
                    "SELECT routine_name as name, routine_type, data_type as return_type \
                     FROM information_schema.routines \
                     WHERE routine_schema = '{}' \
                     ORDER BY routine_name",
                    schema
                )),
                DbType::SQLite => {
                    // SQLite doesn't have stored procedures/functions in the same way
                    Ok("SELECT NULL as name, NULL as routine_type WHERE 1=0".to_string())
                }
                DbType::SQLServer => Ok(format!(
                    "SELECT o.name, o.type_desc as routine_type \
                     FROM sys.objects o \
                     JOIN sys.schemas s ON o.schema_id = s.schema_id \
                     WHERE s.name = '{}' AND o.type IN ('FN', 'IF', 'TF', 'P') \
                     ORDER BY o.name",
                    schema
                )),
                _ => Err(format!("GetFunctions not supported for {:?}", db_type)),
            }
        }

        SqlIntrospectionOp::ExplainQuery { sql } => {
            // Validate the SQL is a SELECT statement to prevent mutations
            let trimmed = sql.trim().to_uppercase();
            if !trimmed.starts_with("SELECT") && !trimmed.starts_with("WITH") {
                return Err("ExplainQuery only supports SELECT statements".to_string());
            }

            match db_type {
                DbType::PostgreSQL => Ok(format!("EXPLAIN (FORMAT TEXT) {}", sql)),
                DbType::MySQL | DbType::MariaDB => Ok(format!("EXPLAIN {}", sql)),
                DbType::SQLite => Ok(format!("EXPLAIN QUERY PLAN {}", sql)),
                DbType::SQLServer => Ok(format!("SET SHOWPLAN_TEXT ON; {}", sql)),
                _ => Err(format!("ExplainQuery not supported for {:?}", db_type)),
            }
        }

        SqlIntrospectionOp::GetSampleData { schema, table, limit } => {
            let schema = sanitize_identifier(schema)?;
            let table = sanitize_identifier(table)?;
            let limit = (*limit).min(100); // Cap at 100 rows for safety

            match db_type {
                DbType::PostgreSQL => {
                    Ok(format!("SELECT * FROM \"{}\".\"{}\" LIMIT {}", schema, table, limit))
                }
                DbType::MySQL | DbType::MariaDB => {
                    Ok(format!("SELECT * FROM `{}`.`{}` LIMIT {}", schema, table, limit))
                }
                DbType::SQLite => Ok(format!("SELECT * FROM \"{}\" LIMIT {}", table, limit)),
                DbType::SQLServer => Ok(format!(
                    "SELECT TOP {} * FROM [{}].[{}]",
                    limit, schema, table
                )),
                _ => Err(format!("GetSampleData not supported for {:?}", db_type)),
            }
        }
    }
}

/// Sanitize an identifier to prevent SQL injection.
///
/// This function validates that the identifier contains only safe characters.
fn sanitize_identifier(id: &str) -> Result<String, String> {
    // Allow alphanumeric, underscore, and some special chars used in identifiers
    let valid = id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.');

    if !valid || id.is_empty() || id.len() > 128 {
        return Err(format!("Invalid identifier: {}", id));
    }

    // Check for SQL keywords that could be injection attempts
    let upper = id.to_uppercase();
    let dangerous = ["DROP", "DELETE", "INSERT", "UPDATE", "TRUNCATE", "ALTER", "CREATE", "EXEC"];
    if dangerous.iter().any(|kw| upper == *kw) {
        return Err(format!("Reserved keyword not allowed as identifier: {}", id));
    }

    Ok(id.to_string())
}

// ============ Document Introspection ============

/// Allowlist of read-only document operations for AI.
const AI_DOCUMENT_ALLOWLIST: &[&str] = &[
    "Find",
    "Aggregate",
    "Count",
    "ListCollections",
];

/// Execute a read-only document database operation.
///
/// This command wraps the existing `document_execute` command with a security
/// allowlist that only permits read-only operations. Write operations like
/// Insert, Update, and Delete are blocked.
#[tauri::command]
pub async fn ai_document_execute(
    conn_id: String,
    operation: super::document::DocumentOperation,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<super::document::DocumentResult, String> {
    // Validate operation is in read-only allowlist
    let op_name = get_document_operation_name(&operation);
    if !AI_DOCUMENT_ALLOWLIST.contains(&op_name) {
        return Err(format!(
            "Operation '{}' not allowed for AI (write operations blocked)",
            op_name
        ));
    }

    // Delegate to existing command
    // Note: We can't directly call document_execute because it takes State<'_, ...>
    // So we duplicate the logic here for the allowed operations
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let adapter = conn
        .adapter
        .as_mongo()
        .ok_or_else(|| "ai_document_execute only supports MongoDB connections".to_string())?;

    use super::document::{DocumentOperation, DocumentResult};

    match operation {
        DocumentOperation::Find {
            collection,
            filter,
            options,
        } => {
            // Apply safety limit for AI queries
            let safe_options = crate::core::capabilities::FindOptions {
                limit: Some(options.limit.unwrap_or(100).min(1000)),
                ..options
            };
            let docs = adapter
                .find_documents(&collection, filter, safe_options)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Documents(docs))
        }
        DocumentOperation::Aggregate {
            collection,
            pipeline,
        } => {
            let docs = adapter
                .aggregate(&collection, pipeline)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Documents(docs))
        }
        DocumentOperation::Count { collection, filter } => {
            let count = adapter
                .count_documents(&collection, filter)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Count(count))
        }
        DocumentOperation::ListCollections => {
            let collections = adapter
                .list_collections()
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Collections(collections))
        }
        // These should never be reached due to allowlist check, but handle them anyway
        _ => Err(format!(
            "Operation '{}' not allowed for AI",
            get_document_operation_name(&operation)
        )),
    }
}

/// Get the operation name from a DocumentOperation for logging/validation.
fn get_document_operation_name(op: &super::document::DocumentOperation) -> &'static str {
    use super::document::DocumentOperation;
    match op {
        DocumentOperation::Find { .. } => "Find",
        DocumentOperation::Insert { .. } => "Insert",
        DocumentOperation::InsertMany { .. } => "InsertMany",
        DocumentOperation::Update { .. } => "Update",
        DocumentOperation::Delete { .. } => "Delete",
        DocumentOperation::Aggregate { .. } => "Aggregate",
        DocumentOperation::Count { .. } => "Count",
        DocumentOperation::ListCollections => "ListCollections",
        DocumentOperation::RunCommand { .. } => "RunCommand",
    }
}

// ============ Key-Value Introspection ============

/// Allowlist of read-only key-value operations for AI.
const AI_KEYVALUE_ALLOWLIST: &[&str] = &[
    "Get",
    "Scan",
    "Type",
    "Ttl",
    "Exists",
    "DbSize",
    "ServerInfo",
    "HashGetAll",
    "ListRange",
    "SetMembers",
    "ZSetRange",
    "StreamRange",
    "ListLen",
    "StreamLen",
];

/// Execute a read-only key-value database operation.
///
/// This command wraps the existing `keyvalue_execute` command with a security
/// allowlist that only permits read-only operations. Write operations like
/// Set, Delete, and modifications are blocked.
#[tauri::command]
pub async fn ai_keyvalue_execute(
    conn_id: String,
    operation: super::keyvalue::KeyValueOperation,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<super::keyvalue::KeyValueResult, String> {
    // Validate operation is in read-only allowlist
    let op_name = get_keyvalue_operation_name(&operation);
    if !AI_KEYVALUE_ALLOWLIST.contains(&op_name) {
        return Err(format!(
            "Operation '{}' not allowed for AI (write operations blocked)",
            op_name
        ));
    }

    // Delegate to existing command logic
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "ai_keyvalue_execute only supports Redis connections".to_string())?;

    use super::keyvalue::{KeyValueOperation, KeyValueResult};
    use crate::core::capabilities::{KeyValueOperable, RichKeyValueOperable};

    match operation {
        KeyValueOperation::Get { key } => {
            let value = adapter.get_key(&key).await.map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Value(value))
        }
        KeyValueOperation::Scan {
            pattern,
            cursor,
            count,
        } => {
            // Apply safety limit for AI queries
            let safe_count = count.min(1000);
            let result = adapter
                .scan_keys(&pattern, cursor, safe_count)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Scan(result))
        }
        KeyValueOperation::Type { key } => {
            let key_type = adapter
                .get_key_type(&key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::KeyType(key_type))
        }
        KeyValueOperation::Ttl { key } => {
            let ttl = adapter
                .get_key_ttl(&key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Ttl(ttl))
        }
        KeyValueOperation::Exists { keys } => {
            // Limit key count for safety
            if keys.len() > 100 {
                return Err("Too many keys to check (max 100)".to_string());
            }
            let count = KeyValueOperable::key_exists(adapter, &keys)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        KeyValueOperation::DbSize => {
            let size = adapter
                .get_database_size()
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(size))
        }
        KeyValueOperation::ServerInfo { section } => {
            let info = adapter
                .get_server_info(section.as_deref())
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::ServerInfo(info))
        }
        KeyValueOperation::HashGetAll { key } => {
            let hash = adapter
                .hash_get_all(&key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Hash(hash))
        }
        KeyValueOperation::ListRange { key, start, stop } => {
            // Limit range size for safety
            let safe_stop = if stop < 0 {
                stop.max(-1000)
            } else {
                stop.min(start + 1000)
            };
            let list = adapter
                .list_range(&key, start, safe_stop)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::List(list))
        }
        KeyValueOperation::ListLen { key } => {
            let len = adapter.list_len(&key).await.map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(len))
        }
        KeyValueOperation::SetMembers { key } => {
            let members = adapter
                .set_members(&key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Set(members))
        }
        KeyValueOperation::ZSetRange {
            key,
            start,
            stop,
            with_scores,
        } => {
            // Limit range size for safety
            let safe_stop = if stop < 0 {
                stop.max(-1000)
            } else {
                stop.min(start + 1000)
            };
            let members = adapter
                .zset_range(&key, start, safe_stop, with_scores)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::ZSet(members))
        }
        KeyValueOperation::StreamRange {
            key,
            start,
            end,
            count,
        } => {
            // Limit count for safety
            let safe_count = count.map(|c| c.min(1000));
            let entries = adapter
                .stream_range(&key, &start, &end, safe_count)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Stream(entries))
        }
        KeyValueOperation::StreamLen { key } => {
            let len = adapter.stream_len(&key).await.map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(len))
        }
        // These should never be reached due to allowlist check
        _ => Err(format!(
            "Operation '{}' not allowed for AI",
            get_keyvalue_operation_name(&operation)
        )),
    }
}

/// Get the operation name from a KeyValueOperation for logging/validation.
fn get_keyvalue_operation_name(op: &super::keyvalue::KeyValueOperation) -> &'static str {
    use super::keyvalue::KeyValueOperation;
    match op {
        KeyValueOperation::Get { .. } => "Get",
        KeyValueOperation::Set { .. } => "Set",
        KeyValueOperation::Delete { .. } => "Delete",
        KeyValueOperation::Exists { .. } => "Exists",
        KeyValueOperation::Scan { .. } => "Scan",
        KeyValueOperation::Type { .. } => "Type",
        KeyValueOperation::Ttl { .. } => "Ttl",
        KeyValueOperation::SetTtl { .. } => "SetTtl",
        KeyValueOperation::ExecuteRaw { .. } => "ExecuteRaw",
        KeyValueOperation::DbSize => "DbSize",
        KeyValueOperation::SelectDb { .. } => "SelectDb",
        KeyValueOperation::ServerInfo { .. } => "ServerInfo",
        KeyValueOperation::HashGetAll { .. } => "HashGetAll",
        KeyValueOperation::HashSet { .. } => "HashSet",
        KeyValueOperation::HashDelete { .. } => "HashDelete",
        KeyValueOperation::ListRange { .. } => "ListRange",
        KeyValueOperation::ListPush { .. } => "ListPush",
        KeyValueOperation::ListLen { .. } => "ListLen",
        KeyValueOperation::SetMembers { .. } => "SetMembers",
        KeyValueOperation::SetAdd { .. } => "SetAdd",
        KeyValueOperation::SetRemove { .. } => "SetRemove",
        KeyValueOperation::ZSetRange { .. } => "ZSetRange",
        KeyValueOperation::ZSetAdd { .. } => "ZSetAdd",
        KeyValueOperation::StreamRange { .. } => "StreamRange",
        KeyValueOperation::StreamLen { .. } => "StreamLen",
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capability_result_connection_not_found() {
        let result = CapabilityResult::connection_not_found("test-conn");

        assert_eq!(result.kind, "unknown");
        assert!(result.capabilities.is_empty());
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("test-conn"));
        assert!(result.fallback_tools.is_empty());
    }

    #[test]
    fn test_capability_result_sql() {
        let caps = vec!["sql-queryable".to_string(), "list-tables".to_string()];
        let result = CapabilityResult::sql(caps.clone());

        assert_eq!(result.kind, "sql");
        assert_eq!(result.capabilities, caps);
        assert!(result.error.is_none());
        assert!(result.fallback_tools.contains(&"list_tables".to_string()));
    }

    #[test]
    fn test_capability_result_document() {
        let caps = vec!["document-queryable".to_string()];
        let result = CapabilityResult::document(caps.clone());

        assert_eq!(result.kind, "document");
        assert!(result.fallback_tools.contains(&"list_collections".to_string()));
    }

    #[test]
    fn test_capability_result_keyvalue() {
        let caps = vec!["keyvalue-operable".to_string()];
        let result = CapabilityResult::keyvalue(caps.clone());

        assert_eq!(result.kind, "keyvalue");
        assert!(result.fallback_tools.contains(&"scan_keys".to_string()));
    }

    #[test]
    fn test_capability_result_serialization() {
        let result = CapabilityResult::sql(vec!["sql-queryable".to_string()]);
        let json = serde_json::to_string(&result).unwrap();

        assert!(json.contains("\"kind\":\"sql\""));
        assert!(json.contains("\"capabilities\""));
        assert!(json.contains("\"fallbackTools\""));
        // Error should not be present when None
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn test_capability_result_serialization_with_error() {
        let result = CapabilityResult::connection_not_found("test");
        let json = serde_json::to_string(&result).unwrap();

        // Error should be present when Some
        assert!(json.contains("\"error\""));
    }

    // ============ SqlIntrospectionOp Tests ============

    #[test]
    fn test_sql_introspection_op_deserialization() {
        let json = r#"{"type": "list_tables", "schema": "public"}"#;
        let op: SqlIntrospectionOp = serde_json::from_str(json).unwrap();
        assert_eq!(op.name(), "list_tables");

        let json = r#"{"type": "list_schemas"}"#;
        let op: SqlIntrospectionOp = serde_json::from_str(json).unwrap();
        assert_eq!(op.name(), "list_schemas");
    }

    #[test]
    fn test_sql_introspection_op_default_limit() {
        let json = r#"{"type": "get_sample_data", "schema": "public", "table": "users"}"#;
        let op: SqlIntrospectionOp = serde_json::from_str(json).unwrap();
        if let SqlIntrospectionOp::GetSampleData { limit, .. } = op {
            assert_eq!(limit, 10); // default
        } else {
            panic!("Expected GetSampleData");
        }
    }

    #[test]
    fn test_sanitize_identifier_valid() {
        assert!(sanitize_identifier("users").is_ok());
        assert!(sanitize_identifier("my_table").is_ok());
        assert!(sanitize_identifier("table123").is_ok());
        assert!(sanitize_identifier("my-table").is_ok());
    }

    #[test]
    fn test_sanitize_identifier_invalid() {
        assert!(sanitize_identifier("").is_err());
        assert!(sanitize_identifier("table; DROP TABLE").is_err());
        assert!(sanitize_identifier("DROP").is_err());
        assert!(sanitize_identifier("DELETE").is_err());
    }

    #[test]
    fn test_build_introspection_sql_list_schemas() {
        use crate::types::DbType;

        let op = SqlIntrospectionOp::ListSchemas;
        let sql = build_introspection_sql(&op, DbType::PostgreSQL).unwrap();
        assert!(sql.contains("information_schema.schemata"));

        let sql = build_introspection_sql(&op, DbType::MySQL).unwrap();
        assert!(sql.contains("information_schema.schemata"));

        let sql = build_introspection_sql(&op, DbType::SQLite).unwrap();
        assert!(sql.contains("main"));
    }

    #[test]
    fn test_build_introspection_sql_list_tables() {
        use crate::types::DbType;

        let op = SqlIntrospectionOp::ListTables {
            schema: "public".to_string(),
        };
        let sql = build_introspection_sql(&op, DbType::PostgreSQL).unwrap();
        assert!(sql.contains("pg_tables"));
        assert!(sql.contains("public"));
    }

    #[test]
    fn test_build_introspection_sql_explain_query_blocks_mutations() {
        use crate::types::DbType;

        // SELECT should work
        let op = SqlIntrospectionOp::ExplainQuery {
            sql: "SELECT * FROM users".to_string(),
        };
        assert!(build_introspection_sql(&op, DbType::PostgreSQL).is_ok());

        // WITH (CTE) should work
        let op = SqlIntrospectionOp::ExplainQuery {
            sql: "WITH cte AS (SELECT 1) SELECT * FROM cte".to_string(),
        };
        assert!(build_introspection_sql(&op, DbType::PostgreSQL).is_ok());

        // INSERT should fail
        let op = SqlIntrospectionOp::ExplainQuery {
            sql: "INSERT INTO users VALUES (1)".to_string(),
        };
        assert!(build_introspection_sql(&op, DbType::PostgreSQL).is_err());

        // DELETE should fail
        let op = SqlIntrospectionOp::ExplainQuery {
            sql: "DELETE FROM users".to_string(),
        };
        assert!(build_introspection_sql(&op, DbType::PostgreSQL).is_err());
    }

    #[test]
    fn test_build_introspection_sql_sample_data_caps_limit() {
        use crate::types::DbType;

        let op = SqlIntrospectionOp::GetSampleData {
            schema: "public".to_string(),
            table: "users".to_string(),
            limit: 1000, // Should be capped at 100
        };
        let sql = build_introspection_sql(&op, DbType::PostgreSQL).unwrap();
        assert!(sql.contains("LIMIT 100")); // Capped
    }

    #[test]
    fn test_build_introspection_sql_injection_prevention() {
        use crate::types::DbType;

        // Attempt SQL injection via schema name
        let op = SqlIntrospectionOp::ListTables {
            schema: "public'; DROP TABLE users; --".to_string(),
        };
        assert!(build_introspection_sql(&op, DbType::PostgreSQL).is_err());
    }

    // ============ Document Operation Tests ============

    #[test]
    fn test_document_operation_name() {
        use super::super::document::DocumentOperation;

        let op = DocumentOperation::Find {
            collection: "test".to_string(),
            filter: serde_json::json!({}),
            options: Default::default(),
        };
        assert_eq!(get_document_operation_name(&op), "Find");

        let op = DocumentOperation::ListCollections;
        assert_eq!(get_document_operation_name(&op), "ListCollections");

        let op = DocumentOperation::Insert {
            collection: "test".to_string(),
            document: serde_json::json!({}),
        };
        assert_eq!(get_document_operation_name(&op), "Insert");
    }

    #[test]
    fn test_document_allowlist_contains_readonly_ops() {
        assert!(AI_DOCUMENT_ALLOWLIST.contains(&"Find"));
        assert!(AI_DOCUMENT_ALLOWLIST.contains(&"Aggregate"));
        assert!(AI_DOCUMENT_ALLOWLIST.contains(&"Count"));
        assert!(AI_DOCUMENT_ALLOWLIST.contains(&"ListCollections"));
    }

    #[test]
    fn test_document_allowlist_excludes_write_ops() {
        assert!(!AI_DOCUMENT_ALLOWLIST.contains(&"Insert"));
        assert!(!AI_DOCUMENT_ALLOWLIST.contains(&"InsertMany"));
        assert!(!AI_DOCUMENT_ALLOWLIST.contains(&"Update"));
        assert!(!AI_DOCUMENT_ALLOWLIST.contains(&"Delete"));
        assert!(!AI_DOCUMENT_ALLOWLIST.contains(&"RunCommand"));
    }

    // ============ Key-Value Operation Tests ============

    #[test]
    fn test_keyvalue_operation_name() {
        use super::super::keyvalue::KeyValueOperation;

        let op = KeyValueOperation::Get {
            key: "test".to_string(),
        };
        assert_eq!(get_keyvalue_operation_name(&op), "Get");

        let op = KeyValueOperation::Scan {
            pattern: "*".to_string(),
            cursor: 0,
            count: 100,
        };
        assert_eq!(get_keyvalue_operation_name(&op), "Scan");

        let op = KeyValueOperation::DbSize;
        assert_eq!(get_keyvalue_operation_name(&op), "DbSize");

        let op = KeyValueOperation::Delete {
            keys: vec!["key1".to_string()],
        };
        assert_eq!(get_keyvalue_operation_name(&op), "Delete");
    }

    #[test]
    fn test_keyvalue_allowlist_contains_readonly_ops() {
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"Get"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"Scan"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"Type"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"Ttl"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"Exists"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"DbSize"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"ServerInfo"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"HashGetAll"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"ListRange"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"SetMembers"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"ZSetRange"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"StreamRange"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"ListLen"));
        assert!(AI_KEYVALUE_ALLOWLIST.contains(&"StreamLen"));
    }

    #[test]
    fn test_keyvalue_allowlist_excludes_write_ops() {
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"Set"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"Delete"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"SetTtl"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"ExecuteRaw"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"SelectDb"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"HashSet"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"HashDelete"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"ListPush"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"SetAdd"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"SetRemove"));
        assert!(!AI_KEYVALUE_ALLOWLIST.contains(&"ZSetAdd"));
    }
}
