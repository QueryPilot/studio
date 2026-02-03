//! MCP tool registry and implementations.
//!
//! This module contains all the MCP tools that can be called by LLM agents.

pub mod describe;
pub mod list;
pub mod query;

use crate::ipc_client::IpcClient;
use crate::types::{ToolCallParams, ToolCallResult, ToolDefinition};

/// Get all available tool definitions
pub fn get_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        query::definition(),
        list::list_tables_definition(),
        list::list_connections_definition(),
        describe::definition(),
    ]
}

/// Execute a tool call
pub async fn execute_tool(
    client: &IpcClient,
    params: &ToolCallParams,
) -> ToolCallResult {
    match params.name.as_str() {
        "query_database" => query::execute(client, &params.arguments).await,
        "list_tables" => list::execute_list_tables(client, &params.arguments).await,
        "list_connections" => list::execute_list_connections(client, &params.arguments).await,
        "describe_table" => describe::execute(client, &params.arguments).await,
        _ => ToolCallResult::error(format!("Unknown tool: {}", params.name)),
    }
}
