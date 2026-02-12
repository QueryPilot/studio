//! Query Pilot MCP Server
//!
//! This is an MCP (Model Context Protocol) server that enables LLM agents to
//! interact with databases through Query Pilot. It communicates with the
//! Tauri backend via an IPC socket and exposes database operations as MCP tools.
//!
//! ## Protocol
//!
//! The server uses JSON-RPC 2.0 over stdio (stdin/stdout). Each message is a
//! single line of JSON.
//!
//! ## Usage
//!
//! ```bash
//! # Start the server (Query Pilot must be running)
//! querypilot-mcp
//!
//! # Or with debug logging
//! RUST_LOG=debug querypilot-mcp
//! ```

mod ipc_client;
mod tools;
mod types;

use std::sync::Arc;

use anyhow::Result;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::ipc_client::IpcClient;
use crate::types::*;

/// MCP protocol version
const PROTOCOL_VERSION: &str = "2024-11-05";

/// Server name and version
const SERVER_NAME: &str = "querypilot-mcp";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// MCP Server state
struct McpServer {
    initialized: bool,
    client: Option<Arc<IpcClient>>,
}

impl McpServer {
    fn new() -> Self {
        Self {
            initialized: false,
            client: None,
        }
    }

    /// Handle incoming JSON-RPC request (takes &mut self for reconnection in tools/call)
    async fn handle_request(&mut self, request: JsonRpcRequest) -> JsonRpcResponse {
        debug!("Handling request: {} (id: {:?})", request.method, request.id);

        match request.method.as_str() {
            "initialize" => self.handle_initialize(request.id).await,
            "initialized" => {
                // Notification, no response needed
                JsonRpcResponse::success(request.id, serde_json::json!(null))
            }
            "tools/list" => self.handle_tools_list(request.id).await,
            "tools/call" => self.handle_tools_call(request.id, request.params).await,
            "ping" => JsonRpcResponse::success(request.id, serde_json::json!({})),
            _ => {
                warn!("Unknown method: {}", request.method);
                JsonRpcResponse::error(
                    request.id,
                    JsonRpcError::method_not_found(&request.method),
                )
            }
        }
    }

    /// Handle initialize request
    async fn handle_initialize(&mut self, id: Option<serde_json::Value>) -> JsonRpcResponse {
        info!("Initializing MCP server");

        // Try to connect to the bridge
        match IpcClient::connect().await {
            Ok(client) => {
                self.client = Some(Arc::new(client));
                info!("Connected to Query Pilot bridge");
            }
            Err(e) => {
                warn!(
                    "Failed to connect to Query Pilot bridge: {}. \
                    Tools will return errors until Query Pilot is running.",
                    e
                );
                // We still initialize, but tools will fail
            }
        }

        self.initialized = true;

        let result = InitializeResult {
            protocol_version: PROTOCOL_VERSION.to_string(),
            capabilities: ServerCapabilities::default(),
            server_info: ServerInfo {
                name: SERVER_NAME.to_string(),
                version: SERVER_VERSION.to_string(),
            },
        };

        JsonRpcResponse::success(
            id,
            serde_json::to_value(&result).unwrap_or_else(|e| {
                serde_json::json!({"error": format!("Serialization failed: {}", e)})
            }),
        )
    }

    /// Handle tools/list request
    async fn handle_tools_list(&self, id: Option<serde_json::Value>) -> JsonRpcResponse {
        if !self.initialized {
            return JsonRpcResponse::error(
                id,
                JsonRpcError::invalid_request("Server not initialized"),
            );
        }

        let result = ToolListResult {
            tools: tools::get_tool_definitions(),
        };

        JsonRpcResponse::success(
            id,
            serde_json::to_value(&result).unwrap_or_else(|e| {
                serde_json::json!({"error": format!("Serialization failed: {}", e)})
            }),
        )
    }

    /// Handle tools/call request
    async fn handle_tools_call(
        &mut self,
        id: Option<serde_json::Value>,
        params: Option<serde_json::Value>,
    ) -> JsonRpcResponse {
        if !self.initialized {
            return JsonRpcResponse::error(
                id,
                JsonRpcError::invalid_request("Server not initialized"),
            );
        }

        // Parse params
        let params: ToolCallParams = match params {
            Some(p) => match serde_json::from_value(p) {
                Ok(p) => p,
                Err(e) => {
                    return JsonRpcResponse::error(
                        id,
                        JsonRpcError::invalid_params(&e.to_string()),
                    )
                }
            },
            None => {
                return JsonRpcResponse::error(
                    id,
                    JsonRpcError::invalid_params("Missing params"),
                )
            }
        };

        debug!("Calling tool: {}", params.name);

        // Check if we have a bridge connection, attempt reconnect if dead
        let needs_reconnect = match &self.client {
            Some(c) => !c.is_connected(),
            None => true,
        };

        if needs_reconnect {
            info!("Bridge connection lost, attempting reconnect...");
            match IpcClient::connect().await {
                Ok(new_client) => {
                    info!("Reconnected to Query Pilot bridge");
                    self.client = Some(Arc::new(new_client));
                }
                Err(e) => {
                    warn!("Reconnection failed: {}", e);
                    self.client = None;
                }
            }
        }

        let client = match &self.client {
            Some(c) => c,
            None => {
                let error_result = ToolCallResult::error(
                    "Not connected to Query Pilot. Please ensure Query Pilot is running.",
                );
                return JsonRpcResponse::success(
                    id,
                    serde_json::to_value(&error_result).unwrap_or_else(|e| {
                        serde_json::json!({"error": format!("Serialization failed: {}", e)})
                    }),
                );
            }
        };

        // Execute the tool
        let result = tools::execute_tool(client, &params).await;

        JsonRpcResponse::success(
            id,
            serde_json::to_value(&result).unwrap_or_else(|e| {
                serde_json::json!({"error": format!("Serialization failed: {}", e)})
            }),
        )
    }
}

/// Run the MCP server
async fn run_server() -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    let server = Arc::new(Mutex::new(McpServer::new()));

    // Read from stdin, write to stdout (async)
    let stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    let mut lines = stdin.lines();

    info!("MCP server started, waiting for requests...");

    while let Some(line) = lines.next_line().await? {
        if line.is_empty() {
            continue;
        }

        debug!("Received: {}", line);

        // Parse JSON-RPC request
        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let response = JsonRpcResponse::error(None, JsonRpcError::parse_error());
                let response_json = serde_json::to_string(&response)?;
                stdout.write_all(response_json.as_bytes()).await?;
                stdout.write_all(b"\n").await?;
                stdout.flush().await?;
                continue;
            }
        };

        // Handle request
        let mut server = server.lock().await;
        let response = server.handle_request(request).await;
        drop(server);

        // Send response
        let response_json = serde_json::to_string(&response)?;
        debug!("Sending: {}", response_json);
        stdout.write_all(response_json.as_bytes()).await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;
    }

    info!("MCP server shutting down");
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging to stderr (stdout is for MCP protocol)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .with_writer(std::io::stderr)
        .with_ansi(false) // Disable ANSI colors for cleaner logs
        .init();

    info!("Query Pilot MCP Server v{}", SERVER_VERSION);

    run_server().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_initialize() {
        let mut server = McpServer::new();

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(serde_json::json!(1)),
            method: "initialize".to_string(),
            params: Some(serde_json::json!({})),
        };

        let response = server.handle_request(request).await;

        assert!(response.result.is_some());
        assert!(response.error.is_none());

        let result: InitializeResult =
            serde_json::from_value(response.result.unwrap()).unwrap();
        assert_eq!(result.protocol_version, PROTOCOL_VERSION);
        assert_eq!(result.server_info.name, SERVER_NAME);
    }

    #[tokio::test]
    async fn test_tools_list() {
        let mut server = McpServer::new();
        server.initialized = true;

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(serde_json::json!(2)),
            method: "tools/list".to_string(),
            params: None,
        };

        let response = server.handle_request(request).await;

        assert!(response.result.is_some());
        assert!(response.error.is_none());

        let result: ToolListResult =
            serde_json::from_value(response.result.unwrap()).unwrap();
        assert!(!result.tools.is_empty());

        // Check we have the expected tools
        let tool_names: Vec<&str> = result.tools.iter().map(|t| t.name.as_str()).collect();
        assert!(tool_names.contains(&"query_database"));
        assert!(tool_names.contains(&"list_tables"));
        assert!(tool_names.contains(&"list_connections"));
        assert!(tool_names.contains(&"describe_table"));
    }

    #[tokio::test]
    async fn test_unknown_method() {
        let mut server = McpServer::new();

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(serde_json::json!(3)),
            method: "unknown/method".to_string(),
            params: None,
        };

        let response = server.handle_request(request).await;

        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32601);
    }
}
