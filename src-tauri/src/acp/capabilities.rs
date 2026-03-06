//! Shared capability handler for workspace read operations.
//!
//! Dispatches `workspace.*` capabilities against the in-memory `AiContextStore`.
//! Used by both the Unix socket server (CLI/ACP agents) and Tauri IPC (BYOK frontend).

use std::fmt;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::ai_context::{ActiveContext, AiContextStore};
use crate::core::ConnectionManager;

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
/// * `_connection_manager` - The shared connection manager (unused for workspace reads,
///   but needed for query capabilities in Task 2)
pub async fn handle_capability(
    capability: &str,
    params: &Value,
    context_store: &Arc<AiContextStore>,
    _connection_manager: &Arc<ConnectionManager>,
) -> Result<Value, CapabilityError> {
    match capability {
        "workspace.listTabs" => handle_list_tabs(context_store).await,
        "workspace.getFocusedTab" => handle_get_focused_tab(context_store).await,
        "workspace.getTabContext" => handle_get_tab_context(params, context_store).await,
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
}
