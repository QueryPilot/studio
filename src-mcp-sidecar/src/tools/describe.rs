//! describe_table tool implementation.
//!
//! Returns detailed schema information about a table.

use std::collections::HashMap;

use crate::ipc_client::IpcClient;
use crate::types::{ColumnInfo, DescribeTableInput, ToolCallResult, ToolDefinition};

/// Get the tool definition for describe_table
pub fn definition() -> ToolDefinition {
    ToolDefinition {
        name: "describe_table".to_string(),
        description: "Get detailed schema information about a table, including column names, data types, nullability, and constraints. Use this to understand table structure before writing queries.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "connectionId": {
                    "type": "string",
                    "description": "The ID of the database connection to use. Get this from list_connections."
                },
                "table": {
                    "type": "string",
                    "description": "The name of the table to describe. Can include schema prefix (e.g., 'public.users')."
                },
                "database": {
                    "type": "string",
                    "description": "Optional database name (for databases that support multiple databases)."
                },
                "schema": {
                    "type": "string",
                    "description": "Optional schema name (e.g., 'public' for PostgreSQL). If table name includes schema prefix, this is ignored."
                }
            },
            "required": ["connectionId", "table"]
        }),
    }
}

/// Execute the describe_table tool
pub async fn execute(
    client: &IpcClient,
    arguments: &HashMap<String, serde_json::Value>,
) -> ToolCallResult {
    // Parse input
    let input: DescribeTableInput = match parse_input(arguments) {
        Ok(input) => input,
        Err(e) => return ToolCallResult::error(format!("Invalid input: {}", e)),
    };

    // Execute via bridge
    match client
        .describe_table(
            &input.connection_id,
            &input.table,
            input.database.as_deref(),
            input.schema.as_deref(),
        )
        .await
    {
        Ok(result) => format_describe_result(&input.table, result),
        Err(e) => ToolCallResult::error(format!("Failed to describe table: {}", e)),
    }
}

fn parse_input(arguments: &HashMap<String, serde_json::Value>) -> Result<DescribeTableInput, String> {
    let connection_id = arguments
        .get("connectionId")
        .and_then(|v| v.as_str())
        .ok_or("connectionId is required")?
        .to_string();

    let table = arguments
        .get("table")
        .and_then(|v| v.as_str())
        .ok_or("table is required")?
        .to_string();

    let database = arguments
        .get("database")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let schema = arguments
        .get("schema")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(DescribeTableInput {
        connection_id,
        table,
        database,
        schema,
    })
}

fn format_describe_result(table_name: &str, result: serde_json::Value) -> ToolCallResult {
    // Unwrap from wrapper object if needed (bridge sends {"columns": [...]})
    let inner = result.get("columns").cloned().unwrap_or(result);
    // Try to parse as array of ColumnInfo
    let columns: Vec<ColumnInfo> = match serde_json::from_value(inner) {
        Ok(cols) => cols,
        Err(e) => return ToolCallResult::error(format!("Failed to parse columns: {}", e)),
    };

    if columns.is_empty() {
        return ToolCallResult::text(format!(
            "Table '{}' has no columns or does not exist.",
            table_name
        ));
    }

    let mut output = String::new();
    output.push_str(&format!("Table: {}\n", table_name));
    output.push_str(&"=".repeat(50));
    output.push_str("\n\n");

    // Find max column name length for alignment
    let max_name_len = columns.iter().map(|c| c.name.len()).max().unwrap_or(10);
    let max_type_len = columns
        .iter()
        .map(|c| c.data_type.len())
        .max()
        .unwrap_or(10);

    output.push_str(&format!(
        "{:name_width$} | {:type_width$} | Nullable | PK | Default\n",
        "Column",
        "Type",
        name_width = max_name_len,
        type_width = max_type_len
    ));
    output.push_str(&format!(
        "{}-+-{}-+-{}-+-{}-+-{}\n",
        "-".repeat(max_name_len),
        "-".repeat(max_type_len),
        "-".repeat(8),
        "-".repeat(2),
        "-".repeat(20)
    ));

    for col in &columns {
        let nullable = if col.nullable { "YES" } else { "NO" };
        let pk = if col.primary_key { "*" } else { " " };
        let default = col.default_value.as_deref().unwrap_or("-");

        output.push_str(&format!(
            "{:name_width$} | {:type_width$} | {:8} | {:2} | {}\n",
            col.name,
            col.data_type,
            nullable,
            pk,
            default,
            name_width = max_name_len,
            type_width = max_type_len
        ));

        if let Some(comment) = &col.comment {
            if !comment.is_empty() {
                output.push_str(&format!(
                    "{:name_width$}   -- {}\n",
                    "",
                    comment,
                    name_width = max_name_len
                ));
            }
        }
    }

    // Summary
    let pk_cols: Vec<&str> = columns
        .iter()
        .filter(|c| c.primary_key)
        .map(|c| c.name.as_str())
        .collect();

    output.push('\n');
    output.push_str(&format!("Total columns: {}\n", columns.len()));

    if !pk_cols.is_empty() {
        output.push_str(&format!("Primary key: {}\n", pk_cols.join(", ")));
    }

    ToolCallResult::text(output)
}
