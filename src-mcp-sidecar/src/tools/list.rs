//! list_tables and list_connections tool implementations.

use std::collections::HashMap;

use crate::ipc_client::IpcClient;
use crate::types::{ConnectionListItem, ListTablesInput, TableInfo, ToolCallResult, ToolDefinition};

/// Get the tool definition for list_tables
pub fn list_tables_definition() -> ToolDefinition {
    ToolDefinition {
        name: "list_tables".to_string(),
        description: "List all tables in a database. Returns table names, schemas, and basic metadata. Use this to discover what tables are available before querying.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "connectionId": {
                    "type": "string",
                    "description": "The ID of the database connection to use. Get this from list_connections."
                },
                "database": {
                    "type": "string",
                    "description": "Optional database name to list tables from (for databases that support multiple databases)."
                },
                "schema": {
                    "type": "string",
                    "description": "Optional schema name to filter tables (e.g., 'public' for PostgreSQL)."
                }
            },
            "required": ["connectionId"]
        }),
    }
}

/// Get the tool definition for list_connections
pub fn list_connections_definition() -> ToolDefinition {
    ToolDefinition {
        name: "list_connections".to_string(),
        description: "List all available database connections. Returns connection IDs, names, database types, and connection status. Call this first to discover which databases you can query.".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {},
            "required": []
        }),
    }
}

/// Execute the list_tables tool
pub async fn execute_list_tables(
    client: &IpcClient,
    arguments: &HashMap<String, serde_json::Value>,
) -> ToolCallResult {
    // Parse input
    let input: ListTablesInput = match parse_list_tables_input(arguments) {
        Ok(input) => input,
        Err(e) => return ToolCallResult::error(format!("Invalid input: {}", e)),
    };

    // Execute via bridge
    match client
        .list_tables(
            &input.connection_id,
            input.database.as_deref(),
            input.schema.as_deref(),
        )
        .await
    {
        Ok(result) => format_tables_result(result),
        Err(e) => ToolCallResult::error(format!("Failed to list tables: {}", e)),
    }
}

/// Execute the list_connections tool
pub async fn execute_list_connections(
    client: &IpcClient,
    _arguments: &HashMap<String, serde_json::Value>,
) -> ToolCallResult {
    match client.list_connections().await {
        Ok(result) => format_connections_result(result),
        Err(e) => ToolCallResult::error(format!("Failed to list connections: {}", e)),
    }
}

fn parse_list_tables_input(
    arguments: &HashMap<String, serde_json::Value>,
) -> Result<ListTablesInput, String> {
    let connection_id = arguments
        .get("connectionId")
        .and_then(|v| v.as_str())
        .ok_or("connectionId is required")?
        .to_string();

    let database = arguments
        .get("database")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let schema = arguments
        .get("schema")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(ListTablesInput {
        connection_id,
        database,
        schema,
    })
}

fn format_tables_result(result: serde_json::Value) -> ToolCallResult {
    // Unwrap from wrapper object if needed (bridge sends {"tables": [...]})
    let inner = result.get("tables").cloned().unwrap_or(result);
    // Try to parse as array of TableInfo
    let tables: Vec<TableInfo> = match serde_json::from_value(inner) {
        Ok(tables) => tables,
        Err(e) => return ToolCallResult::error(format!("Failed to parse tables: {}", e)),
    };

    if tables.is_empty() {
        return ToolCallResult::text("No tables found in the specified database/schema.");
    }

    let mut output = String::new();
    output.push_str("Tables:\n\n");

    // Group by schema
    let mut by_schema: HashMap<String, Vec<&TableInfo>> = HashMap::new();
    for table in &tables {
        by_schema
            .entry(table.schema.clone())
            .or_default()
            .push(table);
    }

    for (schema, schema_tables) in by_schema.iter() {
        output.push_str(&format!("Schema: {}\n", schema));
        output.push_str(&"-".repeat(40));
        output.push('\n');

        for table in schema_tables {
            let kind_suffix = if table.kind != "Regular" {
                format!(" ({})", table.kind)
            } else {
                String::new()
            };

            let row_info = table
                .row_count
                .map(|c| format!(" - ~{} rows", c))
                .unwrap_or_default();

            output.push_str(&format!("  - {}{}{}\n", table.name, kind_suffix, row_info));

            if let Some(comment) = &table.comment {
                if !comment.is_empty() {
                    output.push_str(&format!("    {}\n", comment));
                }
            }
        }
        output.push('\n');
    }

    output.push_str(&format!("Total: {} tables", tables.len()));

    ToolCallResult::text(output)
}

fn format_connections_result(result: serde_json::Value) -> ToolCallResult {
    // Unwrap from wrapper object if needed (bridge sends {"connections": [...]})
    let inner = result.get("connections").cloned().unwrap_or(result);
    // Try to parse as array of ConnectionListItem
    let connections: Vec<ConnectionListItem> = match serde_json::from_value(inner) {
        Ok(conns) => conns,
        Err(e) => {
            return ToolCallResult::error(format!("Failed to parse connections: {}", e))
        }
    };

    if connections.is_empty() {
        return ToolCallResult::text(
            "No database connections available. Please add a connection in Query Pilot first.",
        );
    }

    let mut output = String::new();
    output.push_str("Available Database Connections:\n\n");

    for conn in &connections {
        let status = if conn.connected {
            "Connected"
        } else {
            "Disconnected"
        };

        output.push_str(&format!(
            "- {} ({})\n  ID: {}\n  Type: {} | Database: {} | Status: {}\n\n",
            conn.name, conn.db_type, conn.id, conn.db_type, conn.database, status
        ));
    }

    output.push_str(&format!("Total: {} connections", connections.len()));
    output.push_str("\n\nUse the connection ID with other tools like query_database or list_tables.");

    ToolCallResult::text(output)
}
