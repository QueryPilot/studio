//! query_database tool implementation.
//!
//! Executes SQL queries against a connected database.

use std::collections::HashMap;

use crate::ipc_client::IpcClient;
use crate::types::{QueryDatabaseInput, QueryResultData, ToolCallResult, ToolDefinition};

/// Get the tool definition for query_database
pub fn definition() -> ToolDefinition {
    ToolDefinition {
        name: "query_database".to_string(),
        description: "Execute a SQL query against a connected database. Returns results as a formatted table. Use this for SELECT queries, data exploration, and analysis.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "connectionId": {
                    "type": "string",
                    "description": "The ID of the database connection to use. Get this from list_connections."
                },
                "query": {
                    "type": "string",
                    "description": "The SQL query to execute. Should be a valid SQL statement for the target database."
                },
                "database": {
                    "type": "string",
                    "description": "Optional database name to query against (for databases that support multiple databases)."
                },
                "schema": {
                    "type": "string",
                    "description": "Optional schema name to use (e.g., 'public' for PostgreSQL)."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of rows to return. Defaults to 100 if not specified. Max is 1000.",
                    "default": 100,
                    "maximum": 1000
                }
            },
            "required": ["connectionId", "query"]
        }),
    }
}

/// Execute the query_database tool
pub async fn execute(
    client: &IpcClient,
    arguments: &HashMap<String, serde_json::Value>,
) -> ToolCallResult {
    // Parse input
    let input: QueryDatabaseInput = match parse_input(arguments) {
        Ok(input) => input,
        Err(e) => return ToolCallResult::error(format!("Invalid input: {}", e)),
    };

    // Apply default limit if not specified, cap at 1000
    let limit = input.limit.map(|l| l.min(1000)).unwrap_or(100);

    // Execute query via bridge
    match client.query(&input.connection_id, &input.query, Some(limit)).await {
        Ok(result) => format_query_result(result),
        Err(e) => ToolCallResult::error(format!("Query execution failed: {}", e)),
    }
}

fn parse_input(arguments: &HashMap<String, serde_json::Value>) -> Result<QueryDatabaseInput, String> {
    let connection_id = arguments
        .get("connectionId")
        .and_then(|v| v.as_str())
        .ok_or("connectionId is required")?
        .to_string();

    let query = arguments
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or("query is required")?
        .to_string();

    let database = arguments
        .get("database")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let schema = arguments
        .get("schema")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .and_then(|l| u32::try_from(l).ok());

    Ok(QueryDatabaseInput {
        connection_id,
        database,
        schema,
        query,
        limit,
    })
}

/// Format query result as a readable table
fn format_query_result(result: serde_json::Value) -> ToolCallResult {
    // Try to parse as QueryResultData
    let data: QueryResultData = match serde_json::from_value(result) {
        Ok(data) => data,
        Err(e) => return ToolCallResult::error(format!("Failed to parse query result: {}", e)),
    };

    if data.rows.is_empty() {
        return ToolCallResult::text("Query returned no results.");
    }

    // Calculate column widths
    let mut widths: Vec<usize> = data.columns.iter().map(|c| c.name.len()).collect();

    for row in &data.rows {
        for (i, cell) in row.iter().enumerate() {
            if i < widths.len() {
                let cell_str = format_cell(cell);
                widths[i] = widths[i].max(cell_str.len().min(50)); // Cap at 50 chars
            }
        }
    }

    // Build table
    let mut output = String::new();

    // Header
    let header: Vec<String> = data
        .columns
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{:width$}", c.name, width = widths[i]))
        .collect();
    output.push_str(&header.join(" | "));
    output.push('\n');

    // Separator
    let sep: Vec<String> = widths.iter().map(|w| "-".repeat(*w)).collect();
    output.push_str(&sep.join("-+-"));
    output.push('\n');

    // Rows
    for row in &data.rows {
        let row_strs: Vec<String> = row
            .iter()
            .enumerate()
            .map(|(i, cell)| {
                let s = format_cell(cell);
                let w = widths.get(i).copied().unwrap_or(10);
                if s.len() > w {
                    format!("{}...", &s[..w.saturating_sub(3)])
                } else {
                    format!("{:width$}", s, width = w)
                }
            })
            .collect();
        output.push_str(&row_strs.join(" | "));
        output.push('\n');
    }

    output.push_str(&format!("\n({} rows)", data.rows.len()));

    ToolCallResult::text(output)
}

fn format_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => format!("[{} items]", arr.len()),
        serde_json::Value::Object(obj) => format!("{{{} keys}}", obj.len()),
    }
}
