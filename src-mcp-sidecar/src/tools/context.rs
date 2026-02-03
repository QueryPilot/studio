//! AI context tools for MCP.

use std::collections::HashMap;

use crate::ipc_client::IpcClient;
use crate::types::{ToolCallResult, ToolDefinition};

/// Tool definition for get_query_history
pub fn query_history_definition() -> ToolDefinition {
    ToolDefinition {
        name: "get_query_history".to_string(),
        description: "Get recent SQL queries executed by the user. Use this to understand what the user has been working on and to reference past queries.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of queries to return (default 20, max 100)",
                    "default": 20,
                    "maximum": 100
                },
                "connectionId": {
                    "type": "string",
                    "description": "Optional: filter to queries from a specific connection"
                }
            }
        }),
    }
}

/// Tool definition for get_current_context
pub fn current_context_definition() -> ToolDefinition {
    ToolDefinition {
        name: "get_current_context".to_string(),
        description: "Get the current editor state including the query being edited, active connection, and results summary. Use this to understand what the user is currently working on.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {}
        }),
    }
}

/// Tool definition for get_execution_plan
pub fn execution_plan_definition() -> ToolDefinition {
    ToolDefinition {
        name: "get_execution_plan".to_string(),
        description: "Get the query execution plan (EXPLAIN) for a SQL query. Use this to analyze query performance and suggest optimizations.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "connectionId": {
                    "type": "string",
                    "description": "The database connection to use"
                },
                "query": {
                    "type": "string",
                    "description": "The SQL query to analyze"
                },
                "analyze": {
                    "type": "boolean",
                    "description": "If true, actually run the query to get real execution statistics (EXPLAIN ANALYZE). Default false.",
                    "default": false
                }
            },
            "required": ["connectionId", "query"]
        }),
    }
}

/// Execute get_query_history
pub async fn execute_query_history(
    client: &IpcClient,
    arguments: &HashMap<String, serde_json::Value>,
) -> ToolCallResult {
    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);

    let connection_id = arguments.get("connectionId").and_then(|v| v.as_str());

    match client.get_query_history(limit, connection_id).await {
        Ok(result) => format_history_result(result),
        Err(e) => ToolCallResult::error(format!("Failed to get query history: {}", e)),
    }
}

/// Execute get_current_context
pub async fn execute_current_context(client: &IpcClient) -> ToolCallResult {
    match client.get_current_context().await {
        Ok(result) => format_context_result(result),
        Err(e) => ToolCallResult::error(format!("Failed to get current context: {}", e)),
    }
}

/// Execute get_execution_plan
pub async fn execute_execution_plan(
    client: &IpcClient,
    arguments: &HashMap<String, serde_json::Value>,
) -> ToolCallResult {
    let connection_id = match arguments.get("connectionId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return ToolCallResult::error("connectionId is required"),
    };

    let query = match arguments.get("query").and_then(|v| v.as_str()) {
        Some(q) => q,
        None => return ToolCallResult::error("query is required"),
    };

    let analyze = arguments
        .get("analyze")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    match client
        .get_execution_plan(connection_id, query, analyze)
        .await
    {
        Ok(result) => format_plan_result(result),
        Err(e) => ToolCallResult::error(format!("Failed to get execution plan: {}", e)),
    }
}

fn format_history_result(result: serde_json::Value) -> ToolCallResult {
    let entries = match result.as_array() {
        Some(arr) => arr,
        None => return ToolCallResult::text("No query history available."),
    };

    if entries.is_empty() {
        return ToolCallResult::text("No query history available.");
    }

    let mut output = String::from("## Recent Query History\n\n");

    for (i, entry) in entries.iter().enumerate() {
        let query = entry.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let success = entry
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let exec_time = entry.get("executionTimeMs").and_then(|v| v.as_u64());
        let row_count = entry.get("rowCount").and_then(|v| v.as_u64());

        let status = if success { "OK" } else { "FAIL" };
        let timing = exec_time
            .map(|t| format!(" ({}ms)", t))
            .unwrap_or_default();
        let rows = row_count
            .map(|r| format!(", {} rows", r))
            .unwrap_or_default();

        output.push_str(&format!(
            "{}. [{}] `{}`{}{}\n",
            i + 1,
            status,
            truncate_query(query, 80),
            timing,
            rows
        ));
    }

    ToolCallResult::text(output)
}

fn format_context_result(result: serde_json::Value) -> ToolCallResult {
    let mut output = String::from("## Current Editor Context\n\n");

    if let Some(conn) = result.get("connectionId").and_then(|v| v.as_str()) {
        output.push_str(&format!("**Connection:** {}\n", conn));
    } else {
        output.push_str("**Connection:** None\n");
    }

    if let Some(db) = result.get("database").and_then(|v| v.as_str()) {
        output.push_str(&format!("**Database:** {}\n", db));
    }

    if let Some(schema) = result.get("schema").and_then(|v| v.as_str()) {
        output.push_str(&format!("**Schema:** {}\n", schema));
    }

    output.push('\n');

    if let Some(query) = result.get("query").and_then(|v| v.as_str()) {
        if !query.is_empty() {
            output.push_str("**Current Query:**\n```sql\n");
            output.push_str(query);
            output.push_str("\n```\n\n");
        }
    }

    let has_results = result
        .get("hasResults")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if has_results {
        let row_count = result.get("rowCount").and_then(|v| v.as_u64()).unwrap_or(0);
        let col_count = result
            .get("columnCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        output.push_str(&format!(
            "**Results:** {} rows x {} columns\n",
            row_count, col_count
        ));
    } else {
        output.push_str("**Results:** None\n");
    }

    ToolCallResult::text(output)
}

fn format_plan_result(result: serde_json::Value) -> ToolCallResult {
    let plan = result
        .get("plan")
        .and_then(|v| v.as_str())
        .unwrap_or("No plan available");
    let db_type = result
        .get("databaseType")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown");
    let analyzed = result
        .get("analyzed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut output = format!("## Query Execution Plan ({})\n\n", db_type);
    if analyzed {
        output.push_str("*Note: This is an ANALYZED plan with actual execution statistics.*\n\n");
    }
    output.push_str("```\n");
    output.push_str(plan);
    output.push_str("\n```\n");

    ToolCallResult::text(output)
}

fn truncate_query(query: &str, max_len: usize) -> String {
    let normalized: String = query.split_whitespace().collect::<Vec<_>>().join(" ");

    if normalized.len() <= max_len {
        normalized
    } else {
        format!("{}...", &normalized[..max_len.saturating_sub(3)])
    }
}
