//! Shared capability handler for workspace and query operations.
//!
//! Dispatches `workspace.*` and `query.*` capabilities.
//! Used by both the Unix socket server (CLI/ACP agents) and Tauri IPC (BYOK frontend).

use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::ai_context::{ActiveContext, AiContextStore};
use crate::core::capabilities::FindOptions;
use crate::core::safe_mode::{classify_sql, OperationKind};
use crate::core::ConnectionManager;
use crate::types::DbType;

/// Maximum number of rows returned by `query.run`.
const MAX_ROWS: usize = 200;
/// Default query timeout in seconds.
const DEFAULT_TIMEOUT_SECS: u64 = 30;
/// Maximum allowed query timeout in seconds.
const MAX_TIMEOUT_SECS: u64 = 300;

/// Errors returned by capability handlers.
#[derive(Debug)]
pub enum CapabilityError {
    UnsupportedCapability(String),
    MissingParam(String),
    NotFound(String),
    ReadOnlyViolation(String),
    ConnectionNotFound(String),
    QueryError(String),
    Timeout(String),
}

impl CapabilityError {
    /// Machine-readable error code for JSON responses.
    pub fn error_code(&self) -> &'static str {
        match self {
            CapabilityError::UnsupportedCapability(_) => "UNSUPPORTED_CAPABILITY",
            CapabilityError::MissingParam(_) => "MISSING_PARAM",
            CapabilityError::NotFound(_) => "NOT_FOUND",
            CapabilityError::ReadOnlyViolation(_) => "READ_ONLY_VIOLATION",
            CapabilityError::ConnectionNotFound(_) => "CONNECTION_NOT_FOUND",
            CapabilityError::QueryError(_) => "QUERY_ERROR",
            CapabilityError::Timeout(_) => "TIMEOUT",
        }
    }
}

impl fmt::Display for CapabilityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CapabilityError::UnsupportedCapability(cap) => {
                write!(f, "Unsupported capability: {}", cap)
            }
            CapabilityError::MissingParam(param) => {
                write!(f, "Missing required parameter: {}", param)
            }
            CapabilityError::NotFound(what) => write!(f, "Not found: {}", what),
            CapabilityError::ReadOnlyViolation(msg) => {
                write!(f, "Read-only violation: {}", msg)
            }
            CapabilityError::ConnectionNotFound(id) => {
                write!(f, "Connection not found: {}", id)
            }
            CapabilityError::QueryError(msg) => write!(f, "Query error: {}", msg),
            CapabilityError::Timeout(msg) => write!(f, "Timeout: {}", msg),
        }
    }
}

impl std::error::Error for CapabilityError {}

/// Convert an `ActiveContext` into a tab summary (used in list responses).
fn context_to_tab_summary(ctx: &ActiveContext) -> Value {
    json!({
        "tabId": ctx.tab_id,
        "panelId": ctx.panel_id,
        "type": ctx.tab_type,
        "title": ctx.title,
        "connectionId": ctx.connection_id,
        "database": ctx.database,
        "schema": ctx.schema,
    })
}

/// Convert an `ActiveContext` into a full tab context (used in detail responses).
fn context_to_tab_context(ctx: &ActiveContext) -> Value {
    let sort = match (&ctx.sort_column, &ctx.sort_direction) {
        (Some(col), Some(dir)) => json!({ "column": col, "direction": dir }),
        _ => Value::Null,
    };

    json!({
        "tab": context_to_tab_summary(ctx),
        "sql": ctx.query,
        "filter": ctx.filter,
        "sort": sort,
        "viewType": ctx.view_type,
        "resultSummary": {
            "hasResults": ctx.has_results,
            "rowCount": ctx.row_count,
            "columnCount": ctx.column_count,
        },
    })
}

/// Dispatch a capability request to the appropriate handler.
///
/// # Arguments
/// * `capability` - The capability name (e.g. `workspace.listTabs`)
/// * `params` - JSON parameters for the capability
/// * `context_store` - The shared AI context store
/// * `connection_manager` - The shared connection manager (for query capabilities)
pub async fn handle_capability(
    capability: &str,
    params: &Value,
    context_store: &Arc<AiContextStore>,
    connection_manager: &Arc<ConnectionManager>,
) -> Result<Value, CapabilityError> {
    match capability {
        "workspace.listTabs" => handle_list_tabs(context_store).await,
        "workspace.getFocusedTab" => handle_get_focused_tab(context_store).await,
        "workspace.getTabContext" => handle_get_tab_context(params, context_store).await,
        "query.run" => handle_query_run(params, connection_manager).await,
        _ => Err(CapabilityError::UnsupportedCapability(
            capability.to_string(),
        )),
    }
}

async fn handle_list_tabs(context_store: &Arc<AiContextStore>) -> Result<Value, CapabilityError> {
    let contexts = context_store.get_all_active_contexts().await;
    let tabs: Vec<Value> = contexts.iter().map(context_to_tab_summary).collect();
    Ok(json!({ "tabs": tabs }))
}

async fn handle_get_focused_tab(
    context_store: &Arc<AiContextStore>,
) -> Result<Value, CapabilityError> {
    let contexts = context_store.get_all_active_contexts().await;
    if contexts.is_empty() {
        return Err(CapabilityError::NotFound(
            "No active tabs".to_string(),
        ));
    }
    // get_all_active_contexts returns sorted by updated_at desc, so first is most recent
    Ok(context_to_tab_context(&contexts[0]))
}

async fn handle_get_tab_context(
    params: &Value,
    context_store: &Arc<AiContextStore>,
) -> Result<Value, CapabilityError> {
    let tab_id = params
        .get("tabId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CapabilityError::MissingParam("tabId".to_string()))?;

    let contexts = context_store.get_all_active_contexts().await;
    let ctx = contexts
        .iter()
        .find(|c| c.tab_id.as_deref() == Some(tab_id))
        .ok_or_else(|| CapabilityError::NotFound(format!("Tab with id '{}'", tab_id)))?;

    Ok(context_to_tab_context(ctx))
}

// ============================================================================
// query.run
// ============================================================================

/// Validate that a SQL string is read-only.
///
/// Returns `Ok(())` if every statement classifies as `OperationKind::Read`,
/// or a `CapabilityError::ReadOnlyViolation` otherwise.
pub fn validate_sql_read_only(sql: &str) -> Result<(), CapabilityError> {
    let kind = classify_sql(sql);
    if kind == OperationKind::Read {
        Ok(())
    } else {
        Err(CapabilityError::ReadOnlyViolation(format!(
            "Only read-only SQL is allowed via query.run. Got {:?} operation: {}",
            kind,
            sql.chars().take(120).collect::<String>()
        )))
    }
}

/// Determine which paradigm to use for query execution.
enum QueryParadigm {
    Sql,
    Document,
    KeyValue,
}

/// Parse the requested timeout, clamping to [1, MAX_TIMEOUT_SECS].
fn parse_timeout(params: &Value) -> Duration {
    let secs = params
        .get("timeoutSecs")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(1, MAX_TIMEOUT_SECS);
    Duration::from_secs(secs)
}

async fn handle_query_run(
    params: &Value,
    connection_manager: &Arc<ConnectionManager>,
) -> Result<Value, CapabilityError> {
    // 1. Parse required params
    let conn_id = params
        .get("connectionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CapabilityError::MissingParam("connectionId".to_string()))?;

    let query = params
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CapabilityError::MissingParam("query".to_string()))?;

    let language = params.get("language").and_then(|v| v.as_str());
    let timeout = parse_timeout(params);

    // 2. Borrow the adapter (validates connection exists)
    let adapter = connection_manager
        .borrow_adapter_with_retry(conn_id, 3)
        .await
        .map_err(|e| {
            CapabilityError::ConnectionNotFound(format!("{}: {}", conn_id, e))
        })?;

    // 3. Determine paradigm
    let paradigm = match language {
        Some("mongo") => QueryParadigm::Document,
        Some("redis") => QueryParadigm::KeyValue,
        _ => match adapter.db_type() {
            DbType::MongoDB => QueryParadigm::Document,
            DbType::Redis => QueryParadigm::KeyValue,
            _ => QueryParadigm::Sql,
        },
    };

    // 4. Dispatch by paradigm
    match paradigm {
        QueryParadigm::Sql => execute_sql_query(conn_id, query, &adapter, timeout).await,
        QueryParadigm::Document => {
            execute_mongo_query(conn_id, query, &adapter, timeout).await
        }
        QueryParadigm::KeyValue => {
            execute_redis_query(conn_id, query, &adapter, timeout).await
        }
    }
}

async fn execute_sql_query(
    conn_id: &str,
    query: &str,
    adapter: &crate::core::manager::UnifiedAdapter,
    timeout: Duration,
) -> Result<Value, CapabilityError> {
    // Validate read-only
    validate_sql_read_only(query)?;

    // Get SQL capability
    let sql_adapter = adapter.as_sql().ok_or_else(|| {
        CapabilityError::QueryError(
            "Connection does not support SQL queries".to_string(),
        )
    })?;

    // Execute with timeout
    let start = Instant::now();
    let result = tokio::time::timeout(timeout, sql_adapter.execute_query(query))
        .await
        .map_err(|_| {
            CapabilityError::Timeout(format!(
                "Query exceeded {}s timeout",
                timeout.as_secs()
            ))
        })?
        .map_err(|e| CapabilityError::QueryError(e.to_string()))?;

    let elapsed_ms = start.elapsed().as_millis() as u64;

    // Format response
    let columns: Vec<Value> = result
        .columns
        .iter()
        .map(|c| Value::String(c.name.clone()))
        .collect();

    let total_rows = result.rows.len();
    let truncated = total_rows > MAX_ROWS;
    let rows: Vec<Value> = result
        .rows
        .into_iter()
        .take(MAX_ROWS)
        .map(Value::Array)
        .collect();
    let row_count = rows.len();

    Ok(json!({
        "success": true,
        "connectionId": conn_id,
        "query": query,
        "columns": columns,
        "rows": rows,
        "rowCount": row_count,
        "truncated": truncated,
        "executionTimeMs": elapsed_ms,
    }))
}

// ============================================================================
// MongoDB query execution
// ============================================================================

/// Parse the MongoDB query JSON string.
///
/// Expected format: `{"operation":"find","collection":"users","filter":{},"limit":20}`
/// Supported operations: `find`, `aggregate`, `count`, `listCollections`
async fn execute_mongo_query(
    conn_id: &str,
    query: &str,
    adapter: &crate::core::manager::UnifiedAdapter,
    timeout: Duration,
) -> Result<Value, CapabilityError> {
    let doc_adapter = adapter.as_document().ok_or_else(|| {
        CapabilityError::QueryError("Connection does not support document queries".to_string())
    })?;

    // Parse the query string as JSON
    let query_json: Value = serde_json::from_str(query).map_err(|e| {
        CapabilityError::QueryError(format!(
            "Invalid MongoDB query JSON: {}. Expected format: {{\"operation\":\"find\",\"collection\":\"users\",\"filter\":{{}},\"limit\":20}}",
            e
        ))
    })?;

    let operation = query_json
        .get("operation")
        .and_then(|v| v.as_str())
        .unwrap_or("find");

    let start = Instant::now();

    let result = tokio::time::timeout(timeout, async {
        match operation {
            "find" => {
                let collection = query_json
                    .get("collection")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        CapabilityError::MissingParam("collection".to_string())
                    })?;

                let filter = query_json
                    .get("filter")
                    .cloned()
                    .unwrap_or(json!({}));

                let options = FindOptions {
                    skip: query_json.get("skip").and_then(|v| v.as_u64()),
                    limit: query_json
                        .get("limit")
                        .and_then(|v| v.as_u64())
                        .or(Some(MAX_ROWS as u64)),
                    sort: query_json.get("sort").cloned(),
                    projection: query_json.get("projection").cloned(),
                };

                let docs = doc_adapter
                    .find_documents(collection, filter.clone(), options)
                    .await
                    .map_err(|e| CapabilityError::QueryError(e.to_string()))?;

                let total = docs.len();
                let truncated = total > MAX_ROWS;
                let docs: Vec<Value> = docs.into_iter().take(MAX_ROWS).collect();

                Ok(json!({
                    "success": true,
                    "connectionId": conn_id,
                    "operation": "find",
                    "collection": collection,
                    "documents": docs,
                    "documentCount": docs.len(),
                    "truncated": truncated,
                }))
            }
            "aggregate" => {
                let collection = query_json
                    .get("collection")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        CapabilityError::MissingParam("collection".to_string())
                    })?;

                let pipeline = query_json
                    .get("pipeline")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .ok_or_else(|| {
                        CapabilityError::MissingParam("pipeline (array)".to_string())
                    })?;

                let docs = doc_adapter
                    .aggregate(collection, pipeline)
                    .await
                    .map_err(|e| CapabilityError::QueryError(e.to_string()))?;

                let total = docs.len();
                let truncated = total > MAX_ROWS;
                let docs: Vec<Value> = docs.into_iter().take(MAX_ROWS).collect();

                Ok(json!({
                    "success": true,
                    "connectionId": conn_id,
                    "operation": "aggregate",
                    "collection": collection,
                    "documents": docs,
                    "documentCount": docs.len(),
                    "truncated": truncated,
                }))
            }
            "count" => {
                let collection = query_json
                    .get("collection")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        CapabilityError::MissingParam("collection".to_string())
                    })?;

                let filter = query_json.get("filter").cloned();

                let count = doc_adapter
                    .count_documents(collection, filter)
                    .await
                    .map_err(|e| CapabilityError::QueryError(e.to_string()))?;

                Ok(json!({
                    "success": true,
                    "connectionId": conn_id,
                    "operation": "count",
                    "collection": collection,
                    "count": count,
                }))
            }
            "listCollections" => {
                let collections = doc_adapter
                    .list_collections()
                    .await
                    .map_err(|e| CapabilityError::QueryError(e.to_string()))?;

                let names: Vec<&str> = collections.iter().map(|c| c.name.as_str()).collect();

                Ok(json!({
                    "success": true,
                    "connectionId": conn_id,
                    "operation": "listCollections",
                    "collections": names,
                    "count": names.len(),
                }))
            }
            other => Err(CapabilityError::QueryError(format!(
                "Unsupported MongoDB operation: '{}'. Supported: find, aggregate, count, listCollections",
                other
            ))),
        }
    })
    .await
    .map_err(|_| {
        CapabilityError::Timeout(format!(
            "MongoDB query exceeded {}s timeout",
            timeout.as_secs()
        ))
    })??;

    // Inject execution time
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let mut result = result;
    if let Value::Object(ref mut map) = result {
        map.insert("executionTimeMs".to_string(), json!(elapsed_ms));
    }
    Ok(result)
}

// ============================================================================
// Redis query execution
// ============================================================================

/// Execute a Redis command string.
///
/// The query is a raw Redis command, e.g. `"GET mykey"`, `"HGETALL myhash"`, `"INFO memory"`.
/// Write commands are blocked for safety.
async fn execute_redis_query(
    conn_id: &str,
    query: &str,
    adapter: &crate::core::manager::UnifiedAdapter,
    timeout: Duration,
) -> Result<Value, CapabilityError> {
    let kv_adapter = adapter.as_keyvalue().ok_or_else(|| {
        CapabilityError::QueryError("Connection does not support key-value queries".to_string())
    })?;

    // Parse command and args
    let parts = shell_split(query);
    if parts.is_empty() {
        return Err(CapabilityError::MissingParam(
            "Redis command cannot be empty".to_string(),
        ));
    }

    let command = parts[0].to_uppercase();
    let args: Vec<String> = parts[1..].to_vec();

    // Block write commands
    validate_redis_read_only(&command)?;

    let start = Instant::now();

    let result = tokio::time::timeout(timeout, kv_adapter.execute_raw(&command, &args))
        .await
        .map_err(|_| {
            CapabilityError::Timeout(format!(
                "Redis command exceeded {}s timeout",
                timeout.as_secs()
            ))
        })?
        .map_err(|e| CapabilityError::QueryError(e.to_string()))?;

    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(json!({
        "success": true,
        "connectionId": conn_id,
        "command": format!("{} {}", command, args.join(" ")),
        "result": redis_value_to_json(&result),
        "executionTimeMs": elapsed_ms,
    }))
}

/// Validate that a Redis command is read-only.
fn validate_redis_read_only(command: &str) -> Result<(), CapabilityError> {
    const WRITE_COMMANDS: &[&str] = &[
        "SET", "SETNX", "SETEX", "PSETEX", "MSET", "MSETNX", "SETRANGE", "APPEND", "INCR",
        "INCRBY", "INCRBYFLOAT", "DECR", "DECRBY", "DEL", "UNLINK", "EXPIRE", "EXPIREAT",
        "PEXPIRE", "PEXPIREAT", "PERSIST", "RENAME", "RENAMENX", "MOVE", "COPY",
        "HSET", "HSETNX", "HMSET", "HDEL", "HINCRBY", "HINCRBYFLOAT",
        "LPUSH", "LPUSHX", "RPUSH", "RPUSHX", "LPOP", "RPOP", "LSET", "LINSERT", "LREM", "LTRIM",
        "SADD", "SREM", "SPOP", "SMOVE", "SDIFFSTORE", "SINTERSTORE", "SUNIONSTORE",
        "ZADD", "ZREM", "ZINCRBY", "ZRANGESTORE", "ZDIFFSTORE", "ZINTERSTORE", "ZUNIONSTORE",
        "XADD", "XDEL", "XTRIM", "XGROUP",
        "FLUSHDB", "FLUSHALL", "SELECT", "SWAPDB", "SORT",
        "RESTORE", "DUMP", "MIGRATE", "WAIT",
        "EVAL", "EVALSHA", "SCRIPT",
    ];

    if WRITE_COMMANDS.contains(&command) {
        return Err(CapabilityError::ReadOnlyViolation(format!(
            "Write command '{}' is not allowed via query.run. Only read-only Redis commands are permitted.",
            command
        )));
    }
    Ok(())
}

/// Simple shell-like splitting of a command string into parts.
/// Handles double-quoted strings.
fn shell_split(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars = input.chars();

    for ch in chars {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

/// Convert a RedisValue to a JSON-friendly representation.
fn redis_value_to_json(value: &crate::core::capabilities::RedisValue) -> Value {
    use crate::core::capabilities::RedisValue;
    match value {
        RedisValue::Nil => Value::Null,
        RedisValue::String(s) => json!(s),
        RedisValue::Bytes(b) => json!(format!("<binary {} bytes>", b.len())),
        RedisValue::Integer(i) => json!(i),
        RedisValue::Float(f) => json!(f),
        RedisValue::Boolean(b) => json!(b),
        RedisValue::Array(arr) => {
            Value::Array(arr.iter().map(redis_value_to_json).collect())
        }
        RedisValue::Map(map) => {
            let obj: serde_json::Map<String, Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), redis_value_to_json(v)))
                .collect();
            Value::Object(obj)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ConnectionManager;

    /// Helper to create a test context store and connection manager.
    fn make_deps() -> (Arc<AiContextStore>, Arc<ConnectionManager>) {
        (
            Arc::new(AiContextStore::new()),
            Arc::new(ConnectionManager::new()),
        )
    }

    fn make_context(tab_id: &str, title: &str, updated_at: u64) -> ActiveContext {
        ActiveContext {
            tab_id: Some(tab_id.to_string()),
            panel_id: Some("panel-1".to_string()),
            tab_type: Some("query".to_string()),
            title: Some(title.to_string()),
            connection_id: Some(format!("conn-{}", tab_id)),
            database: Some("mydb".to_string()),
            schema: Some("public".to_string()),
            query: Some("SELECT 1".to_string()),
            has_results: true,
            row_count: Some(10),
            column_count: Some(3),
            updated_at,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn list_tabs_returns_all_contexts() {
        let (store, cm) = make_deps();
        store.set_active_context(make_context("tab-1", "Users", 100)).await;
        store.set_active_context(make_context("tab-2", "Orders", 200)).await;

        let result = handle_capability("workspace.listTabs", &json!({}), &store, &cm)
            .await
            .unwrap();

        let tabs = result["tabs"].as_array().unwrap();
        assert_eq!(tabs.len(), 2);
        // Sorted by updated_at desc — most recent first
        assert_eq!(tabs[0]["title"], "Orders");
        assert_eq!(tabs[1]["title"], "Users");
        assert_eq!(tabs[0]["tabId"], "tab-2");
        assert_eq!(tabs[1]["tabId"], "tab-1");
    }

    #[tokio::test]
    async fn get_focused_tab_returns_most_recent() {
        let (store, cm) = make_deps();
        store.set_active_context(make_context("tab-1", "Users", 100)).await;
        store.set_active_context(make_context("tab-2", "Orders", 200)).await;

        let result = handle_capability("workspace.getFocusedTab", &json!({}), &store, &cm)
            .await
            .unwrap();

        assert_eq!(result["tab"]["tabId"], "tab-2");
        assert_eq!(result["tab"]["title"], "Orders");
        assert_eq!(result["sql"], "SELECT 1");
        assert_eq!(result["resultSummary"]["hasResults"], true);
        assert_eq!(result["resultSummary"]["rowCount"], 10);
        assert_eq!(result["resultSummary"]["columnCount"], 3);
    }

    #[tokio::test]
    async fn get_tab_context_by_id() {
        let (store, cm) = make_deps();
        store.set_active_context(make_context("tab-1", "Users", 100)).await;
        store.set_active_context(make_context("tab-2", "Orders", 200)).await;

        let result = handle_capability(
            "workspace.getTabContext",
            &json!({ "tabId": "tab-1" }),
            &store,
            &cm,
        )
        .await
        .unwrap();

        assert_eq!(result["tab"]["tabId"], "tab-1");
        assert_eq!(result["tab"]["title"], "Users");
        assert_eq!(result["tab"]["connectionId"], "conn-tab-1");
    }

    #[tokio::test]
    async fn get_tab_context_missing_param() {
        let (store, cm) = make_deps();

        let err = handle_capability("workspace.getTabContext", &json!({}), &store, &cm)
            .await
            .unwrap_err();

        assert_eq!(err.error_code(), "MISSING_PARAM");
        assert!(err.to_string().contains("tabId"));
    }

    #[tokio::test]
    async fn unsupported_capability() {
        let (store, cm) = make_deps();

        let err = handle_capability("workspace.unknownThing", &json!({}), &store, &cm)
            .await
            .unwrap_err();

        assert_eq!(err.error_code(), "UNSUPPORTED_CAPABILITY");
        assert!(err.to_string().contains("workspace.unknownThing"));
    }

    #[tokio::test]
    async fn get_focused_tab_empty_store() {
        let (store, cm) = make_deps();

        let err = handle_capability("workspace.getFocusedTab", &json!({}), &store, &cm)
            .await
            .unwrap_err();

        assert_eq!(err.error_code(), "NOT_FOUND");
        assert!(err.to_string().contains("No active tabs"));
    }

    // ---- query.run param validation ----

    #[tokio::test]
    async fn query_run_missing_connection_id() {
        let (store, cm) = make_deps();

        let err = handle_capability("query.run", &json!({}), &store, &cm)
            .await
            .unwrap_err();

        assert_eq!(err.error_code(), "MISSING_PARAM");
        assert!(err.to_string().contains("connectionId"));
    }

    #[tokio::test]
    async fn query_run_missing_query() {
        let (store, cm) = make_deps();

        let err = handle_capability(
            "query.run",
            &json!({"connectionId": "c1"}),
            &store,
            &cm,
        )
        .await
        .unwrap_err();

        assert_eq!(err.error_code(), "MISSING_PARAM");
        assert!(err.to_string().contains("query"));
    }

    // ---- validate_sql_read_only ----

    #[test]
    fn query_run_rejects_write_sql() {
        let write_queries = [
            "DROP TABLE x",
            "INSERT INTO t VALUES (1)",
            "UPDATE t SET x = 1",
            "DELETE FROM t WHERE id = 1",
            "CREATE TABLE t (id INT)",
            "ALTER TABLE t ADD COLUMN c INT",
            "TRUNCATE TABLE t",
        ];

        for sql in &write_queries {
            let result = validate_sql_read_only(sql);
            assert!(
                result.is_err(),
                "Expected read-only violation for: {}",
                sql
            );
            let err = result.unwrap_err();
            assert_eq!(err.error_code(), "READ_ONLY_VIOLATION");
        }
    }

    #[test]
    fn query_run_allows_read_sql() {
        let read_queries = [
            "SELECT 1",
            "EXPLAIN SELECT 1",
            "SHOW TABLES",
            "WITH cte AS (SELECT 1) SELECT * FROM cte",
            "SELECT * FROM users WHERE id = 1",
            "DESCRIBE users",
        ];

        for sql in &read_queries {
            let result = validate_sql_read_only(sql);
            assert!(
                result.is_ok(),
                "Expected read-only pass for: {}, got: {:?}",
                sql,
                result.unwrap_err()
            );
        }
    }
}
