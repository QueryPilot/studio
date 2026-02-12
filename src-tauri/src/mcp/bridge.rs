//! MCP Bridge IPC Server
//!
//! Implements a Unix socket server that accepts connections from the MCP sidecar
//! and handles JSON-RPC requests for database operations.

use std::path::PathBuf;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::Notify;

use crate::ai_context::AiContextStore;
use crate::core::ConnectionManager;

use super::handlers::McpHandler;
use super::protocol::{error_codes, JsonRpcRequest, JsonRpcResponse};

/// MCP Bridge server that listens on a Unix socket
pub struct McpBridge {
    socket_path: PathBuf,
    handler: Arc<McpHandler>,
    shutdown: Arc<Notify>,
    #[allow(dead_code)]
    ai_context: Arc<AiContextStore>,
    /// Whether this instance created/owns the socket (for safe cleanup)
    owns_socket: std::sync::atomic::AtomicBool,
}

impl McpBridge {
    /// Create a new MCP bridge
    pub fn new(manager: Arc<ConnectionManager>, ai_context: Arc<AiContextStore>) -> Self {
        let socket_path = Self::default_socket_path();
        let handler = Arc::new(McpHandler::new(
            Arc::clone(&manager),
            Arc::clone(&ai_context),
        ));
        let shutdown = Arc::new(Notify::new());

        Self {
            socket_path,
            handler,
            shutdown,
            ai_context,
            owns_socket: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Get the default socket path (~/.querypilot/mcp-bridge.sock)
    fn default_socket_path() -> PathBuf {
        let home = dirs::home_dir().expect("Could not determine home directory");
        home.join(".querypilot").join("mcp-bridge.sock")
    }

    /// Get the socket path
    pub fn socket_path(&self) -> &PathBuf {
        &self.socket_path
    }

    /// Start the MCP bridge server
    ///
    /// This method spawns a background task that listens for connections
    /// on the Unix socket and handles incoming JSON-RPC requests.
    pub async fn start(&self) -> Result<(), String> {
        // Ensure the parent directory exists
        if let Some(parent) = self.socket_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create socket directory: {}", e))?;
        }

        // Try to bind first, remove and retry if file exists (avoids TOCTOU race)
        let listener = match UnixListener::bind(&self.socket_path) {
            Ok(l) => l,
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                // Check if another instance is alive on this socket
                match tokio::net::UnixStream::connect(&self.socket_path).await {
                    Ok(_) => {
                        // Another instance is alive — don't steal its socket
                        tracing::error!(
                            "Another Query Pilot instance is already running on {:?}. Skipping MCP bridge start.",
                            self.socket_path
                        );
                        return Err("Another Query Pilot instance owns the MCP bridge socket".to_string());
                    }
                    Err(_) => {
                        // Stale socket — safe to remove and rebind
                        tracing::info!("Removing stale socket at {:?}", self.socket_path);
                        tokio::fs::remove_file(&self.socket_path)
                            .await
                            .map_err(|e| format!("Failed to remove stale socket: {}", e))?;
                        UnixListener::bind(&self.socket_path)
                            .map_err(|e| format!("Failed to bind after cleanup: {}", e))?
                    }
                }
            }
            Err(e) => return Err(format!("Failed to bind socket: {}", e)),
        };

        self.owns_socket.store(true, std::sync::atomic::Ordering::SeqCst);
        tracing::info!("MCP Bridge started on {:?}", self.socket_path);

        let handler = self.handler.clone();
        let shutdown = self.shutdown.clone();
        let socket_path = self.socket_path.clone();

        // Spawn the listener task
        tokio::spawn(async move {
            Self::run_listener(listener, handler, shutdown, socket_path).await;
        });

        Ok(())
    }

    /// Run the listener loop
    async fn run_listener(
        listener: UnixListener,
        handler: Arc<McpHandler>,
        shutdown: Arc<Notify>,
        socket_path: PathBuf,
    ) {
        loop {
            tokio::select! {
                _ = shutdown.notified() => {
                    tracing::info!("MCP Bridge shutting down");
                    break;
                }
                result = listener.accept() => {
                    match result {
                        Ok((stream, _addr)) => {
                            let handler = handler.clone();
                            tokio::spawn(async move {
                                if let Err(e) = Self::handle_connection(stream, handler).await {
                                    tracing::error!("Error handling MCP connection: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("Error accepting MCP connection: {}", e);
                        }
                    }
                }
            }
        }

        // Cleanup socket file
        if let Err(e) = tokio::fs::remove_file(&socket_path).await {
            tracing::warn!("Failed to remove socket file on shutdown: {}", e);
        }
    }

    /// Handle a single client connection
    async fn handle_connection(
        stream: tokio::net::UnixStream,
        handler: Arc<McpHandler>,
    ) -> Result<(), String> {
        let (reader, mut writer) = stream.into_split();
        let mut reader = BufReader::new(reader);
        let mut line = String::new();

        loop {
            line.clear();
            let bytes_read = reader
                .read_line(&mut line)
                .await
                .map_err(|e| format!("Read error: {}", e))?;

            if bytes_read == 0 {
                // Connection closed
                break;
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Parse the JSON-RPC request
            let response = match serde_json::from_str::<JsonRpcRequest>(trimmed) {
                Ok(request) => {
                    tracing::debug!("MCP request: {} {}", request.method, request.id);
                    handler
                        .handle_request(request.id, &request.method, request.params)
                        .await
                }
                Err(e) => {
                    tracing::warn!("Invalid MCP request: {}", e);
                    JsonRpcResponse::error(
                        "".to_string(),
                        error_codes::PARSE_ERROR,
                        format!("Invalid JSON: {}", e),
                    )
                }
            };

            // Serialize and send response
            let response_json = serde_json::to_string(&response)
                .map_err(|e| format!("Serialization error: {}", e))?;

            writer
                .write_all(response_json.as_bytes())
                .await
                .map_err(|e| format!("Write error: {}", e))?;
            writer
                .write_all(b"\n")
                .await
                .map_err(|e| format!("Write error: {}", e))?;
            writer
                .flush()
                .await
                .map_err(|e| format!("Flush error: {}", e))?;
        }

        Ok(())
    }

    /// Signal the bridge to shut down
    pub fn shutdown(&self) {
        self.shutdown.notify_one();
    }
}

impl Drop for McpBridge {
    fn drop(&mut self) {
        // Only remove the socket if this instance created it
        if self.owns_socket.load(std::sync::atomic::Ordering::SeqCst) && self.socket_path.exists() {
            let _ = std::fs::remove_file(&self.socket_path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_socket_path() {
        let path = McpBridge::default_socket_path();
        assert!(path.ends_with("mcp-bridge.sock"));
        assert!(path.to_string_lossy().contains(".querypilot"));
    }

    #[tokio::test]
    async fn test_bridge_creation() {
        let manager = Arc::new(ConnectionManager::new());
        let ai_context = Arc::new(AiContextStore::new());
        let bridge = McpBridge::new(manager, ai_context);
        assert!(bridge.socket_path().ends_with("mcp-bridge.sock"));
    }
}
