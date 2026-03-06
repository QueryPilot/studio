//! querypilot agent CLI
//!
//! Usage:
//!   querypilot agent <capability-id>
//!
//! Reads JSON request envelope from stdin and writes JSON response envelope to stdout.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cmp::Reverse;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;

const REQUEST_VERSION: &str = "1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentRequest {
    version: String,
    request_id: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    context: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentError {
    code: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentResponse {
    ok: bool,
    request_id: String,
    capability: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<AgentError>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveContextSnapshot {
    connection_id: Option<String>,
    database: Option<String>,
    schema: Option<String>,
    query: Option<String>,
    #[allow(dead_code)]
    last_executed_query: Option<String>,
    has_results: bool,
    row_count: Option<usize>,
    column_count: Option<usize>,
    updated_at: u64,
    panel_id: Option<String>,
    tab_id: Option<String>,
    tab_type: Option<String>,
    title: Option<String>,
    filter: Option<String>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
    view_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AiContextSnapshot {
    #[serde(default)]
    active_contexts: Vec<ActiveContextSnapshot>,
}

fn snapshot_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".querypilot").join("ai-context-store.json")
}

fn read_snapshot() -> Result<AiContextSnapshot, String> {
    let path = snapshot_path();
    if !path.exists() {
        return Ok(AiContextSnapshot::default());
    }

    let content =
        fs::read_to_string(&path).map_err(|err| format!("Failed to read snapshot: {}", err))?;
    serde_json::from_str::<AiContextSnapshot>(&content)
        .map_err(|err| format!("Failed to parse snapshot: {}", err))
}

fn normalized_contexts(snapshot: &AiContextSnapshot) -> Vec<ActiveContextSnapshot> {
    let mut contexts = snapshot.active_contexts.clone();
    contexts.sort_by_key(|ctx| Reverse(ctx.updated_at));
    contexts
}

fn context_tab_id(ctx: &ActiveContextSnapshot, index: usize) -> String {
    if let Some(tab_id) = &ctx.tab_id {
        return tab_id.clone();
    }
    if let Some(connection_id) = &ctx.connection_id {
        return format!("focused:{}", connection_id);
    }
    format!("context:{}", index)
}

fn context_panel_id(ctx: &ActiveContextSnapshot) -> String {
    ctx.panel_id
        .clone()
        .unwrap_or_else(|| "primary".to_string())
}

fn context_tab_type(ctx: &ActiveContextSnapshot) -> String {
    ctx.tab_type.clone().unwrap_or_else(|| "query".to_string())
}

fn context_to_tab_summary(ctx: &ActiveContextSnapshot, index: usize) -> Value {
    json!({
        "tabId": context_tab_id(ctx, index),
        "panelId": context_panel_id(ctx),
        "type": context_tab_type(ctx),
        "title": ctx.title,
        "connectionId": ctx.connection_id,
        "database": ctx.database,
        "schema": ctx.schema,
    })
}

fn context_to_tab_context(ctx: &ActiveContextSnapshot, index: usize) -> Value {
    let sort = match (&ctx.sort_column, &ctx.sort_direction) {
        (Some(column), Some(direction)) => json!({
            "column": column,
            "direction": direction,
        }),
        _ => Value::Null,
    };

    json!({
        "tab": context_to_tab_summary(ctx, index),
        "sql": ctx.query,
        "filter": ctx.filter,
        "sort": sort,
        "viewType": ctx.view_type,
        "resultSummary": {
            "hasResults": ctx.has_results,
            "rowCount": ctx.row_count,
            "columnCount": ctx.column_count,
        }
    })
}

fn dispatch_workspace_capability(
    capability: &str,
    params: &Value,
    snapshot: &AiContextSnapshot,
) -> Result<Value, String> {
    let contexts = normalized_contexts(snapshot);

    match capability {
        "workspace.listTabs" => {
            let tabs: Vec<Value> = contexts
                .iter()
                .enumerate()
                .map(|(idx, ctx)| context_to_tab_summary(ctx, idx))
                .collect();
            Ok(json!({ "tabs": tabs }))
        }
        "workspace.getFocusedTab" => {
            if let Some(ctx) = contexts.first() {
                Ok(context_to_tab_context(ctx, 0))
            } else {
                Ok(json!({ "tab": Value::Null }))
            }
        }
        "workspace.getTabContext" => {
            let tab_id = params
                .get("tabId")
                .and_then(Value::as_str)
                .ok_or_else(|| "Missing required parameter: tabId".to_string())?;

            let found = contexts
                .iter()
                .enumerate()
                .find(|(idx, ctx)| context_tab_id(ctx, *idx) == tab_id);

            if let Some((idx, ctx)) = found {
                Ok(context_to_tab_context(ctx, idx))
            } else {
                Ok(json!({ "tab": Value::Null }))
            }
        }
        _ => Err(format!("Unsupported capability: {}", capability)),
    }
}

fn write_response(response: &AgentResponse) {
    let serialized = serde_json::to_string(response).unwrap_or_else(|_| {
        "{\"ok\":false,\"requestId\":\"unknown\",\"capability\":\"unknown\",\"error\":{\"code\":\"internal_error\",\"message\":\"Failed to serialize response\"}}".to_string()
    });
    let _ = std::io::stdout().write_all(serialized.as_bytes());
    let _ = std::io::stdout().write_all(b"\n");
}

fn main() {
    let mut args = std::env::args().skip(1);
    let subcommand = args.next();
    let capability = args.next();

    if subcommand.as_deref() != Some("agent") || capability.is_none() {
        eprintln!("Usage: querypilot agent <capability-id>");
        std::process::exit(2);
    }

    let capability = capability.unwrap_or_default();
    let mut stdin_buf = String::new();
    if std::io::stdin().read_to_string(&mut stdin_buf).is_err() {
        write_response(&AgentResponse {
            ok: false,
            request_id: "unknown".to_string(),
            capability,
            result: None,
            error: Some(AgentError {
                code: "read_stdin_failed".to_string(),
                message: "Failed to read stdin".to_string(),
            }),
        });
        std::process::exit(1);
    }

    let request = match serde_json::from_str::<AgentRequest>(&stdin_buf) {
        Ok(req) => req,
        Err(err) => {
            write_response(&AgentResponse {
                ok: false,
                request_id: "unknown".to_string(),
                capability,
                result: None,
                error: Some(AgentError {
                    code: "invalid_request".to_string(),
                    message: format!("Invalid JSON request: {}", err),
                }),
            });
            std::process::exit(1);
        }
    };

    // Ensure request envelope is a known version. Unknown versions fail safely.
    if request.version != REQUEST_VERSION {
        write_response(&AgentResponse {
            ok: false,
            request_id: request.request_id,
            capability,
            result: None,
            error: Some(AgentError {
                code: "unsupported_version".to_string(),
                message: format!("Unsupported request version: {}", request.version),
            }),
        });
        std::process::exit(1);
    }

    // Reserved for future use; keeps request contract parity.
    let _context = request.context;

    let snapshot = match read_snapshot() {
        Ok(data) => data,
        Err(err) => {
            write_response(&AgentResponse {
                ok: false,
                request_id: request.request_id,
                capability,
                result: None,
                error: Some(AgentError {
                    code: "snapshot_read_failed".to_string(),
                    message: err,
                }),
            });
            std::process::exit(1);
        }
    };

    match dispatch_workspace_capability(&capability, &request.params, &snapshot) {
        Ok(result) => {
            write_response(&AgentResponse {
                ok: true,
                request_id: request.request_id,
                capability,
                result: Some(result),
                error: None,
            });
        }
        Err(message) => {
            write_response(&AgentResponse {
                ok: false,
                request_id: request.request_id,
                capability,
                result: None,
                error: Some(AgentError {
                    code: "unsupported_capability".to_string(),
                    message,
                }),
            });
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_snapshot() -> AiContextSnapshot {
        AiContextSnapshot {
            active_contexts: vec![
                ActiveContextSnapshot {
                    connection_id: Some("conn-1".to_string()),
                    database: Some("db1".to_string()),
                    schema: Some("public".to_string()),
                    query: Some("SELECT * FROM users".to_string()),
                    last_executed_query: None,
                    has_results: true,
                    row_count: Some(10),
                    column_count: Some(3),
                    updated_at: 2,
                    panel_id: Some("panel-main".to_string()),
                    tab_id: Some("tab-users".to_string()),
                    tab_type: Some("query".to_string()),
                    title: Some("Users".to_string()),
                    filter: Some("name LIKE 'A%'".to_string()),
                    sort_column: Some("name".to_string()),
                    sort_direction: Some("asc".to_string()),
                    view_type: Some("data".to_string()),
                },
                ActiveContextSnapshot {
                    connection_id: Some("conn-2".to_string()),
                    database: Some("db2".to_string()),
                    schema: Some("public".to_string()),
                    query: Some("SELECT * FROM orders".to_string()),
                    last_executed_query: None,
                    has_results: false,
                    row_count: None,
                    column_count: None,
                    updated_at: 1,
                    panel_id: Some("panel-secondary".to_string()),
                    tab_id: Some("tab-orders".to_string()),
                    tab_type: Some("query".to_string()),
                    title: Some("Orders".to_string()),
                    filter: None,
                    sort_column: None,
                    sort_direction: None,
                    view_type: Some("data".to_string()),
                },
            ],
        }
    }

    #[test]
    fn list_tabs_returns_all_tabs_sorted_by_recent_activity() {
        let snapshot = sample_snapshot();
        let value =
            dispatch_workspace_capability("workspace.listTabs", &json!({}), &snapshot).unwrap();
        let tabs = value
            .get("tabs")
            .and_then(Value::as_array)
            .expect("tabs array");

        assert_eq!(tabs.len(), 2);
        assert_eq!(tabs[0].get("tabId").and_then(Value::as_str), Some("tab-users"));
        assert_eq!(tabs[1].get("tabId").and_then(Value::as_str), Some("tab-orders"));
    }

    #[test]
    fn get_focused_tab_returns_most_recent_context() {
        let snapshot = sample_snapshot();
        let value =
            dispatch_workspace_capability("workspace.getFocusedTab", &json!({}), &snapshot)
                .unwrap();

        assert_eq!(
            value
                .get("tab")
                .and_then(|tab| tab.get("tabId"))
                .and_then(Value::as_str),
            Some("tab-users")
        );
        assert_eq!(
            value
                .get("resultSummary")
                .and_then(|summary| summary.get("rowCount"))
                .and_then(Value::as_u64),
            Some(10)
        );
    }

    #[test]
    fn get_tab_context_requires_tab_id() {
        let snapshot = sample_snapshot();
        let err = dispatch_workspace_capability("workspace.getTabContext", &json!({}), &snapshot)
            .expect_err("missing tabId should error");
        assert!(err.contains("tabId"));
    }

    #[test]
    fn unsupported_capability_returns_error() {
        let snapshot = sample_snapshot();
        let err =
            dispatch_workspace_capability("workspace.unknown", &json!({}), &snapshot)
                .expect_err("unsupported capability should error");
        assert!(err.contains("Unsupported capability"));
    }
}
