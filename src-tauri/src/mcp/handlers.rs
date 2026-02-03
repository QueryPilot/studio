//! MCP Bridge request handlers.
//!
//! This module implements the handlers for each MCP method, translating
//! JSON-RPC requests into ConnectionManager operations.

use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::core::capabilities::{FindOptions, KeyValueOperable};
use crate::core::manager::ConnectionInfo as ManagerConnectionInfo;
use crate::core::ConnectionManager;
use crate::types::DbType;

use super::protocol::{error_codes, JsonRpcResponse};

// ============================================================================
// SQL Injection Prevention
// ============================================================================

/// Validate that a name is a safe SQL identifier (alphanumeric + underscore)
fn is_valid_sql_identifier(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_')
}

// ============================================================================
// Request Parameter Types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryParams {
    pub connection_id: String,
    pub query: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub order: Option<Vec<OrderSpec>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderSpec {
    pub column: String,
    pub direction: OrderDirection,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum OrderDirection {
    Asc,
    Desc,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTablesParams {
    pub connection_id: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribeTableParams {
    pub connection_id: String,
    pub table: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

// ============================================================================
// Response Types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub database: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConnectionsResult {
    pub connections: Vec<ConnectionInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub success: bool,
    pub data: Vec<Value>,
    pub metadata: QueryMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryMetadata {
    /// Column names as array of strings (spec compliant)
    pub columns: Vec<String>,
    /// Detailed column type info (name + dataType) for LLMs that need type information
    pub column_types: Vec<ColumnInfo>,
    pub row_count: usize,
    pub returned: usize,
    pub truncated: bool,
    pub execution_time_ms: u64,
    pub database_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub table_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTablesResult {
    pub tables: Vec<TableInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribeColumnInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribeTableResult {
    pub columns: Vec<DescribeColumnInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indexes: Option<Vec<IndexInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreign_keys: Option<Vec<ForeignKeyInfo>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
}

// ============================================================================
// Handler Implementation
// ============================================================================

/// MCP Bridge request handler
pub struct McpHandler {
    manager: Arc<ConnectionManager>,
}

impl McpHandler {
    pub fn new(manager: Arc<ConnectionManager>) -> Self {
        Self { manager }
    }

    /// Dispatch a JSON-RPC request to the appropriate handler
    pub async fn handle_request(&self, id: String, method: &str, params: Value) -> JsonRpcResponse {
        match method {
            "list_connections" => self.handle_list_connections(id).await,
            "query" => self.handle_query(id, params).await,
            "list_tables" => self.handle_list_tables(id, params).await,
            "describe_table" => self.handle_describe_table(id, params).await,
            _ => JsonRpcResponse::error(
                id,
                error_codes::METHOD_NOT_FOUND,
                format!("Unknown method: {}", method),
            ),
        }
    }

    /// List all active connections
    async fn handle_list_connections(&self, id: String) -> JsonRpcResponse {
        let connections: Vec<ManagerConnectionInfo> = self.manager.list_connections();

        let result = ListConnectionsResult {
            connections: connections
                .into_iter()
                .map(|c| ConnectionInfo {
                    id: c.id,
                    name: c.name,
                    db_type: c.db_type,
                    database: c.database,
                })
                .collect(),
        };

        match serde_json::to_value(&result) {
            Ok(value) => JsonRpcResponse::success(id, value),
            Err(e) => JsonRpcResponse::error(
                id,
                error_codes::INTERNAL_ERROR,
                format!("Serialization error: {}", e),
            ),
        }
    }

    /// Execute a query
    async fn handle_query(&self, id: String, params: Value) -> JsonRpcResponse {
        // Parse parameters
        let params: QueryParams = match serde_json::from_value(params) {
            Ok(p) => p,
            Err(e) => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::INVALID_PARAMS,
                    format!("Invalid parameters: {}", e),
                );
            }
        };

        let start = Instant::now();

        // Get connection
        let conn = match self.manager.get_connection(&params.connection_id) {
            Some(c) => c,
            None => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::CONNECTION_NOT_FOUND,
                    format!("Connection not found: {}", params.connection_id),
                );
            }
        };

        // Apply limit (default 100, max 1000)
        let limit = params.limit.unwrap_or(100).min(1000);
        let db_type = conn.adapter.db_type();

        // Dispatch based on database paradigm
        let result = match db_type {
            DbType::PostgreSQL | DbType::MySQL | DbType::MariaDB | DbType::SQLite | DbType::SQLServer => {
                self.execute_sql_query(&params.query, limit, &params.order, &conn).await
            }
            DbType::MongoDB => {
                self.execute_document_query(&params, limit, &conn).await
            }
            DbType::Redis => {
                self.execute_keyvalue_query(&params, &conn).await
            }
        };

        let execution_time_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok((data, column_types, row_count)) => {
                let returned = data.len();
                // Extract just column names for spec-compliant columns array
                let columns: Vec<String> = column_types.iter().map(|c| c.name.clone()).collect();
                let result = QueryResult {
                    success: true,
                    data,
                    metadata: QueryMetadata {
                        columns,
                        column_types,
                        row_count,
                        returned,
                        truncated: row_count > returned,
                        execution_time_ms,
                        database_type: format!("{:?}", db_type),
                    },
                    error: None,
                };
                match serde_json::to_value(&result) {
                    Ok(value) => JsonRpcResponse::success(id, value),
                    Err(e) => JsonRpcResponse::error(
                        id,
                        error_codes::INTERNAL_ERROR,
                        format!("Serialization error: {}", e),
                    ),
                }
            }
            Err(e) => {
                let result = QueryResult {
                    success: false,
                    data: vec![],
                    metadata: QueryMetadata {
                        columns: vec![],
                        column_types: vec![],
                        row_count: 0,
                        returned: 0,
                        truncated: false,
                        execution_time_ms,
                        database_type: format!("{:?}", db_type),
                    },
                    error: Some(e),
                };
                match serde_json::to_value(&result) {
                    Ok(value) => JsonRpcResponse::success(id, value),
                    Err(e) => JsonRpcResponse::error(
                        id,
                        error_codes::INTERNAL_ERROR,
                        format!("Serialization error: {}", e),
                    ),
                }
            }
        }
    }

    /// Execute SQL query
    async fn execute_sql_query(
        &self,
        query: &str,
        limit: u64,
        order: &Option<Vec<OrderSpec>>,
        conn: &crate::core::manager::LiveConnection,
    ) -> Result<(Vec<Value>, Vec<ColumnInfo>, usize), String> {
        let sql_adapter = conn
            .adapter
            .as_sql()
            .ok_or_else(|| "Connection does not support SQL queries".to_string())?;

        // Build query with limit and order (validates column names)
        let modified_query = self.build_limited_query(query, limit, order)?;

        let result = sql_adapter
            .execute_query(&modified_query)
            .await
            .map_err(|e| e.to_string())?;

        let columns: Vec<ColumnInfo> = result
            .columns
            .iter()
            .map(|c| ColumnInfo {
                name: c.name.clone(),
                data_type: c.data_type.clone(),
            })
            .collect();

        // Convert rows to array of objects
        let data: Vec<Value> = result
            .rows
            .into_iter()
            .map(|row| {
                let mut obj = serde_json::Map::new();
                for (i, cell) in row.into_iter().enumerate() {
                    if let Some(col) = columns.get(i) {
                        obj.insert(col.name.clone(), cell);
                    }
                }
                Value::Object(obj)
            })
            .collect();

        let row_count = data.len();
        Ok((data, columns, row_count))
    }

    /// Build a limited query (simple approach - wraps in subquery for safety)
    /// Returns None if any column name fails validation
    fn build_limited_query(&self, query: &str, limit: u64, order: &Option<Vec<OrderSpec>>) -> Result<String, String> {
        // If the query already has LIMIT, don't modify it
        let upper_query = query.to_uppercase();
        if upper_query.contains(" LIMIT ") {
            return Ok(query.to_string());
        }

        let mut modified = query.trim_end_matches(';').to_string();

        // Add ORDER BY if specified (supports multiple columns)
        if let Some(orders) = order {
            if !orders.is_empty() {
                // Validate all column names before building query
                for o in orders {
                    if !is_valid_sql_identifier(&o.column) {
                        return Err(format!("Invalid column name in ORDER BY: '{}'", o.column));
                    }
                }
                let order_clauses: Vec<String> = orders
                    .iter()
                    .map(|o| {
                        let direction = match o.direction {
                            OrderDirection::Asc => "ASC",
                            OrderDirection::Desc => "DESC",
                        };
                        format!("\"{}\" {}", o.column, direction)
                    })
                    .collect();
                modified = format!("{} ORDER BY {}", modified, order_clauses.join(", "));
            }
        }

        // Add LIMIT
        Ok(format!("{} LIMIT {}", modified, limit))
    }

    /// Execute document (MongoDB) query
    async fn execute_document_query(
        &self,
        params: &QueryParams,
        limit: u64,
        conn: &crate::core::manager::LiveConnection,
    ) -> Result<(Vec<Value>, Vec<ColumnInfo>, usize), String> {
        let mongo_adapter = conn
            .adapter
            .as_mongo()
            .ok_or_else(|| "Connection does not support document queries".to_string())?;

        // For MongoDB, the "query" field is interpreted as collection name + filter JSON
        // Format: "collection_name" or "collection_name:filter_json"
        let (collection, filter) = self.parse_mongo_query(&params.query)?;

        let options = FindOptions {
            skip: None,
            limit: Some(limit),
            sort: params.order.as_ref().and_then(|orders| {
                if orders.is_empty() {
                    None
                } else {
                    // Build MongoDB sort document from multiple order specs
                    let mut sort_doc = serde_json::Map::new();
                    for o in orders {
                        let direction = match o.direction {
                            OrderDirection::Asc => 1,
                            OrderDirection::Desc => -1,
                        };
                        sort_doc.insert(o.column.clone(), json!(direction));
                    }
                    Some(Value::Object(sort_doc))
                }
            }),
            projection: None,
        };

        let documents = mongo_adapter
            .find_documents(&collection, filter, options)
            .await
            .map_err(|e| e.to_string())?;

        // Infer columns from first document
        let columns: Vec<ColumnInfo> = documents
            .first()
            .and_then(|doc| doc.as_object())
            .map(|obj| {
                obj.keys()
                    .map(|k| ColumnInfo {
                        name: k.clone(),
                        data_type: "json".to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let row_count = documents.len();
        Ok((documents, columns, row_count))
    }

    /// Parse MongoDB query format: "collection" or "collection:filter_json"
    fn parse_mongo_query(&self, query: &str) -> Result<(String, Value), String> {
        let trimmed = query.trim();

        if let Some(idx) = trimmed.find(':') {
            let collection = trimmed[..idx].trim().to_string();
            let filter_str = trimmed[idx + 1..].trim();
            let filter: Value = serde_json::from_str(filter_str)
                .map_err(|e| format!("Invalid filter JSON: {}", e))?;
            Ok((collection, filter))
        } else {
            Ok((trimmed.to_string(), json!({})))
        }
    }

    /// Execute key-value (Redis) query
    async fn execute_keyvalue_query(
        &self,
        params: &QueryParams,
        conn: &crate::core::manager::LiveConnection,
    ) -> Result<(Vec<Value>, Vec<ColumnInfo>, usize), String> {
        let redis_adapter = conn
            .adapter
            .as_redis()
            .ok_or_else(|| "Connection does not support key-value queries".to_string())?;

        // For Redis, the "query" field is interpreted as a key pattern
        let pattern = params.query.trim();

        // Scan for keys matching the pattern
        let scan_result = redis_adapter
            .scan_keys(pattern, 0, 100)
            .await
            .map_err(|e| e.to_string())?;

        let columns = vec![
            ColumnInfo { name: "key".to_string(), data_type: "string".to_string() },
            ColumnInfo { name: "type".to_string(), data_type: "string".to_string() },
            ColumnInfo { name: "ttl".to_string(), data_type: "integer".to_string() },
        ];

        let data: Vec<Value> = scan_result
            .keys
            .into_iter()
            .map(|key_info| {
                json!({
                    "key": key_info.key,
                    "type": key_info.key_type.to_string(),
                    "ttl": key_info.ttl,
                })
            })
            .collect();

        let row_count = data.len();
        Ok((data, columns, row_count))
    }

    /// List tables/collections
    async fn handle_list_tables(&self, id: String, params: Value) -> JsonRpcResponse {
        let params: ListTablesParams = match serde_json::from_value(params) {
            Ok(p) => p,
            Err(e) => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::INVALID_PARAMS,
                    format!("Invalid parameters: {}", e),
                );
            }
        };

        let conn = match self.manager.get_connection(&params.connection_id) {
            Some(c) => c,
            None => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::CONNECTION_NOT_FOUND,
                    format!("Connection not found: {}", params.connection_id),
                );
            }
        };

        let db_type = conn.adapter.db_type();
        let result = match db_type {
            DbType::PostgreSQL | DbType::MySQL | DbType::MariaDB | DbType::SQLite | DbType::SQLServer => {
                self.list_sql_tables(&params, &conn).await
            }
            DbType::MongoDB => {
                self.list_mongo_collections(&conn).await
            }
            DbType::Redis => {
                // Redis doesn't have tables/collections
                Ok(ListTablesResult { tables: vec![] })
            }
        };

        match result {
            Ok(tables) => match serde_json::to_value(&tables) {
                Ok(value) => JsonRpcResponse::success(id, value),
                Err(e) => JsonRpcResponse::error(
                    id,
                    error_codes::INTERNAL_ERROR,
                    format!("Serialization error: {}", e),
                ),
            },
            Err(e) => JsonRpcResponse::error(id, error_codes::QUERY_FAILED, e),
        }
    }

    /// List SQL tables
    async fn list_sql_tables(
        &self,
        params: &ListTablesParams,
        conn: &crate::core::manager::LiveConnection,
    ) -> Result<ListTablesResult, String> {
        let sql_adapter = conn
            .adapter
            .as_sql()
            .ok_or_else(|| "Connection does not support SQL queries".to_string())?;

        // Build query based on database type
        let schema = params.schema.as_deref().unwrap_or("public");

        // Validate schema name to prevent SQL injection
        if !is_valid_sql_identifier(schema) {
            return Err(format!("Invalid schema name: '{}'", schema));
        }

        let db_type = conn.adapter.db_type();

        let query = match db_type {
            DbType::PostgreSQL => {
                format!(
                    "SELECT table_name AS name, table_type AS type
                     FROM information_schema.tables
                     WHERE table_schema = '{}'
                     ORDER BY table_name",
                    schema
                )
            }
            DbType::MySQL | DbType::MariaDB => {
                "SELECT table_name AS name, table_type AS type
                 FROM information_schema.tables
                 WHERE table_schema = DATABASE()
                 ORDER BY table_name".to_string()
            }
            DbType::SQLite => {
                "SELECT name, type
                 FROM sqlite_master
                 WHERE type IN ('table', 'view')
                 ORDER BY name".to_string()
            }
            DbType::SQLServer => {
                format!(
                    "SELECT TABLE_NAME AS name, TABLE_TYPE AS type
                     FROM INFORMATION_SCHEMA.TABLES
                     WHERE TABLE_SCHEMA = '{}'
                     ORDER BY TABLE_NAME",
                    schema
                )
            }
            _ => return Err("Unsupported database type for listing tables".to_string()),
        };

        let result = sql_adapter.execute_query(&query).await.map_err(|e| e.to_string())?;

        let tables: Vec<TableInfo> = result
            .rows
            .into_iter()
            .filter_map(|row| {
                let name = row.first()?.as_str()?.to_string();
                let table_type = row.get(1).and_then(|v| v.as_str()).unwrap_or("TABLE").to_string();
                Some(TableInfo {
                    name,
                    table_type,
                    schema: Some(schema.to_string()),
                })
            })
            .collect();

        Ok(ListTablesResult { tables })
    }

    /// List MongoDB collections
    async fn list_mongo_collections(
        &self,
        conn: &crate::core::manager::LiveConnection,
    ) -> Result<ListTablesResult, String> {
        let mongo_adapter = conn
            .adapter
            .as_mongo()
            .ok_or_else(|| "Connection does not support document queries".to_string())?;

        let collections = mongo_adapter.list_collections().await.map_err(|e| e.to_string())?;

        let tables: Vec<TableInfo> = collections
            .into_iter()
            .map(|c| TableInfo {
                name: c.name,
                table_type: "COLLECTION".to_string(),
                schema: None,
            })
            .collect();

        Ok(ListTablesResult { tables })
    }

    /// Describe table/collection structure
    async fn handle_describe_table(&self, id: String, params: Value) -> JsonRpcResponse {
        let params: DescribeTableParams = match serde_json::from_value(params) {
            Ok(p) => p,
            Err(e) => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::INVALID_PARAMS,
                    format!("Invalid parameters: {}", e),
                );
            }
        };

        let conn = match self.manager.get_connection(&params.connection_id) {
            Some(c) => c,
            None => {
                return JsonRpcResponse::error(
                    id,
                    error_codes::CONNECTION_NOT_FOUND,
                    format!("Connection not found: {}", params.connection_id),
                );
            }
        };

        let db_type = conn.adapter.db_type();
        let result = match db_type {
            DbType::PostgreSQL | DbType::MySQL | DbType::MariaDB | DbType::SQLite | DbType::SQLServer => {
                self.describe_sql_table(&params, &conn).await
            }
            DbType::MongoDB => {
                self.describe_mongo_collection(&params.table, &conn).await
            }
            DbType::Redis => {
                Err("Redis does not support table description".to_string())
            }
        };

        match result {
            Ok(desc) => match serde_json::to_value(&desc) {
                Ok(value) => JsonRpcResponse::success(id, value),
                Err(e) => JsonRpcResponse::error(
                    id,
                    error_codes::INTERNAL_ERROR,
                    format!("Serialization error: {}", e),
                ),
            },
            Err(e) => JsonRpcResponse::error(id, error_codes::QUERY_FAILED, e),
        }
    }

    /// Describe SQL table
    async fn describe_sql_table(
        &self,
        params: &DescribeTableParams,
        conn: &crate::core::manager::LiveConnection,
    ) -> Result<DescribeTableResult, String> {
        let sql_adapter = conn
            .adapter
            .as_sql()
            .ok_or_else(|| "Connection does not support SQL queries".to_string())?;

        let schema = params.schema.as_deref().unwrap_or("public");
        let table = &params.table;

        // Validate schema and table names to prevent SQL injection
        if !is_valid_sql_identifier(schema) {
            return Err(format!("Invalid schema name: '{}'", schema));
        }
        if !is_valid_sql_identifier(table) {
            return Err(format!("Invalid table name: '{}'", table));
        }

        let db_type = conn.adapter.db_type();

        // Query for columns
        let columns_query = match db_type {
            DbType::PostgreSQL => {
                format!(
                    "SELECT
                        c.column_name,
                        c.data_type,
                        c.is_nullable = 'YES' AS nullable,
                        EXISTS (
                            SELECT 1 FROM information_schema.table_constraints tc
                            JOIN information_schema.key_column_usage kcu
                                ON tc.constraint_name = kcu.constraint_name
                                AND tc.table_schema = kcu.table_schema
                            WHERE tc.constraint_type = 'PRIMARY KEY'
                                AND tc.table_schema = '{}'
                                AND tc.table_name = '{}'
                                AND kcu.column_name = c.column_name
                        ) AS is_primary
                     FROM information_schema.columns c
                     WHERE c.table_schema = '{}' AND c.table_name = '{}'
                     ORDER BY c.ordinal_position",
                    schema, table, schema, table
                )
            }
            DbType::MySQL | DbType::MariaDB => {
                format!(
                    "SELECT
                        column_name,
                        data_type,
                        is_nullable = 'YES' AS nullable,
                        column_key = 'PRI' AS is_primary
                     FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = '{}'
                     ORDER BY ordinal_position",
                    table
                )
            }
            DbType::SQLite => {
                format!("PRAGMA table_info('{}')", table)
            }
            DbType::SQLServer => {
                format!(
                    "SELECT
                        c.COLUMN_NAME,
                        c.DATA_TYPE,
                        CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
                        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary
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
                     WHERE c.TABLE_SCHEMA = '{}' AND c.TABLE_NAME = '{}'
                     ORDER BY c.ORDINAL_POSITION",
                    schema, table, schema, table
                )
            }
            _ => return Err("Unsupported database type".to_string()),
        };

        let result = sql_adapter.execute_query(&columns_query).await.map_err(|e| e.to_string())?;

        let columns: Vec<DescribeColumnInfo> = if db_type == DbType::SQLite {
            // SQLite PRAGMA returns different columns: cid, name, type, notnull, dflt_value, pk
            result.rows.into_iter().filter_map(|row| {
                let name = row.get(1)?.as_str()?.to_string();
                let data_type = row.get(2)?.as_str()?.to_string();
                let not_null = row.get(3).and_then(|v| v.as_i64()).unwrap_or(0);
                let pk = row.get(5).and_then(|v| v.as_i64()).unwrap_or(0);
                Some(DescribeColumnInfo {
                    name,
                    data_type,
                    nullable: not_null == 0,
                    primary_key: pk > 0,
                })
            }).collect()
        } else {
            result.rows.into_iter().filter_map(|row| {
                let name = row.first()?.as_str()?.to_string();
                let data_type = row.get(1)?.as_str()?.to_string();
                let nullable = row.get(2).map(|v| v.as_bool().unwrap_or(false)).unwrap_or(true);
                let primary_key = row.get(3).map(|v| v.as_bool().unwrap_or(false)).unwrap_or(false);
                Some(DescribeColumnInfo {
                    name,
                    data_type,
                    nullable,
                    primary_key,
                })
            }).collect()
        };

        Ok(DescribeTableResult {
            columns,
            indexes: None,  // TODO: Add index query
            foreign_keys: None,  // TODO: Add foreign key query
        })
    }

    /// Describe MongoDB collection (by sampling documents)
    async fn describe_mongo_collection(
        &self,
        collection: &str,
        conn: &crate::core::manager::LiveConnection,
    ) -> Result<DescribeTableResult, String> {
        let mongo_adapter = conn
            .adapter
            .as_mongo()
            .ok_or_else(|| "Connection does not support document queries".to_string())?;

        // Sample some documents to infer schema
        let options = FindOptions {
            skip: None,
            limit: Some(10),
            sort: None,
            projection: None,
        };

        let documents = mongo_adapter
            .find_documents(collection, json!({}), options)
            .await
            .map_err(|e| e.to_string())?;

        // Collect all unique fields across sampled documents
        let mut fields: std::collections::HashMap<String, String> = std::collections::HashMap::new();

        for doc in &documents {
            if let Some(obj) = doc.as_object() {
                for (key, value) in obj {
                    let type_name = match value {
                        Value::Null => "null",
                        Value::Bool(_) => "boolean",
                        Value::Number(n) => if n.is_i64() { "integer" } else { "number" },
                        Value::String(_) => "string",
                        Value::Array(_) => "array",
                        Value::Object(_) => "object",
                    };
                    fields.entry(key.clone()).or_insert_with(|| type_name.to_string());
                }
            }
        }

        let columns: Vec<DescribeColumnInfo> = fields
            .into_iter()
            .map(|(name, data_type)| DescribeColumnInfo {
                name,
                data_type,
                nullable: true,
                primary_key: false,
            })
            .collect();

        Ok(DescribeTableResult {
            columns,
            indexes: None,
            foreign_keys: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_mongo_query_simple() {
        let handler = McpHandler::new(Arc::new(ConnectionManager::new()));
        let (collection, filter) = handler.parse_mongo_query("users").unwrap();
        assert_eq!(collection, "users");
        assert_eq!(filter, json!({}));
    }

    #[test]
    fn test_parse_mongo_query_with_filter() {
        let handler = McpHandler::new(Arc::new(ConnectionManager::new()));
        let (collection, filter) = handler.parse_mongo_query("users:{\"age\": 25}").unwrap();
        assert_eq!(collection, "users");
        assert_eq!(filter, json!({"age": 25}));
    }

    #[test]
    fn test_build_limited_query_basic() {
        let handler = McpHandler::new(Arc::new(ConnectionManager::new()));
        let result = handler.build_limited_query("SELECT * FROM users", 100, &None).unwrap();
        assert_eq!(result, "SELECT * FROM users LIMIT 100");
    }

    #[test]
    fn test_build_limited_query_with_order() {
        let handler = McpHandler::new(Arc::new(ConnectionManager::new()));
        let order = Some(vec![OrderSpec {
            column: "created_at".to_string(),
            direction: OrderDirection::Desc,
        }]);
        let result = handler.build_limited_query("SELECT * FROM users", 50, &order).unwrap();
        assert_eq!(result, "SELECT * FROM users ORDER BY \"created_at\" DESC LIMIT 50");
    }

    #[test]
    fn test_build_limited_query_with_multiple_orders() {
        let handler = McpHandler::new(Arc::new(ConnectionManager::new()));
        let order = Some(vec![
            OrderSpec {
                column: "created_at".to_string(),
                direction: OrderDirection::Desc,
            },
            OrderSpec {
                column: "name".to_string(),
                direction: OrderDirection::Asc,
            },
        ]);
        let result = handler.build_limited_query("SELECT * FROM users", 50, &order).unwrap();
        assert_eq!(result, "SELECT * FROM users ORDER BY \"created_at\" DESC, \"name\" ASC LIMIT 50");
    }

    #[test]
    fn test_build_limited_query_already_has_limit() {
        let handler = McpHandler::new(Arc::new(ConnectionManager::new()));
        let result = handler.build_limited_query("SELECT * FROM users LIMIT 10", 100, &None).unwrap();
        assert_eq!(result, "SELECT * FROM users LIMIT 10");
    }

    #[test]
    fn test_build_limited_query_rejects_invalid_column() {
        let handler = McpHandler::new(Arc::new(ConnectionManager::new()));
        let order = Some(vec![OrderSpec {
            column: "column; DROP TABLE users;--".to_string(),
            direction: OrderDirection::Asc,
        }]);
        let result = handler.build_limited_query("SELECT * FROM users", 50, &order);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid column name"));
    }

    #[test]
    fn test_is_valid_sql_identifier() {
        assert!(is_valid_sql_identifier("users"));
        assert!(is_valid_sql_identifier("user_table"));
        assert!(is_valid_sql_identifier("User123"));
        assert!(is_valid_sql_identifier("_private"));
        assert!(!is_valid_sql_identifier(""));
        assert!(!is_valid_sql_identifier("table name"));
        assert!(!is_valid_sql_identifier("table;drop"));
        assert!(!is_valid_sql_identifier("table'injection"));
        assert!(!is_valid_sql_identifier("table--comment"));
    }

    #[test]
    fn test_query_params_deserialization() {
        let json = r#"{
            "connectionId": "conn-1",
            "query": "SELECT * FROM users",
            "limit": 50
        }"#;
        let params: QueryParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.connection_id, "conn-1");
        assert_eq!(params.query, "SELECT * FROM users");
        assert_eq!(params.limit, Some(50));
    }

    #[test]
    fn test_list_tables_params_deserialization() {
        let json = r#"{
            "connectionId": "conn-1",
            "schema": "public"
        }"#;
        let params: ListTablesParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.connection_id, "conn-1");
        assert_eq!(params.schema, Some("public".to_string()));
    }
}
