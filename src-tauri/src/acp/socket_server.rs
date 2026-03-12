//! Unix domain socket server for CLI agent communication.
//!
//! Listens on `~/.querypilot/agent.sock` for one-shot JSON-line requests,
//! dispatches them to [`super::capabilities::handle_capability`], and returns
//! a JSON-line response before closing the connection.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::Notify;
use tracing::{error, info, warn};

use super::capabilities::handle_capability;
use crate::ai_context::AiContextStore;
use crate::core::ConnectionManager;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SocketRequest {
    version: String,
    request_id: String,
    capability: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SocketResponse {
    ok: bool,
    request_id: String,
    capability: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<SocketError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SocketError {
    code: String,
    message: String,
}

// ---------------------------------------------------------------------------
// Default socket path
// ---------------------------------------------------------------------------

fn socket_filename() -> &'static str {
    if cfg!(debug_assertions) {
        "agent.dev.sock"
    } else {
        "agent.sock"
    }
}

fn default_socket_path() -> PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".querypilot")
        .join(socket_filename())
}

// ---------------------------------------------------------------------------
// AgentSocketServer
// ---------------------------------------------------------------------------

pub struct AgentSocketServer {
    shutdown: Arc<Notify>,
}

impl Default for AgentSocketServer {
    fn default() -> Self {
        Self {
            shutdown: Arc::new(Notify::new()),
        }
    }
}

impl AgentSocketServer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start listening on the default socket path (`~/.querypilot/agent.sock`).
    /// Spawns a background tokio task. Returns immediately.
    pub async fn start(
        &self,
        context_store: Arc<AiContextStore>,
        connection_manager: Arc<ConnectionManager>,
    ) -> Result<(), String> {
        self.start_at(default_socket_path(), context_store, connection_manager)
            .await
    }

    /// Start listening on a custom socket path.
    /// Spawns a background tokio task. Returns immediately.
    pub async fn start_at(
        &self,
        socket_path: PathBuf,
        context_store: Arc<AiContextStore>,
        connection_manager: Arc<ConnectionManager>,
    ) -> Result<(), String> {
        // Ensure parent directory exists
        if let Some(parent) = socket_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create socket directory {}: {}",
                    parent.display(),
                    e
                )
            })?;
        }

        // Remove stale socket file (leftover from unclean shutdown)
        if socket_path.exists() {
            std::fs::remove_file(&socket_path).map_err(|e| {
                format!(
                    "Failed to remove stale socket {}: {}",
                    socket_path.display(),
                    e
                )
            })?;
        }

        let listener = UnixListener::bind(&socket_path).map_err(|e| {
            format!("Failed to bind socket {}: {}", socket_path.display(), e)
        })?;

        // Set permissions to 0600 (owner-only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&socket_path, perms).map_err(|e| {
                format!(
                    "Failed to set socket permissions on {}: {}",
                    socket_path.display(),
                    e
                )
            })?;
        }

        info!("Agent socket server listening on {}", socket_path.display());

        let shutdown = self.shutdown.clone();
        let path_for_cleanup = socket_path.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((stream, _addr)) => {
                                let store = context_store.clone();
                                let cm = connection_manager.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = handle_connection(stream, store, cm).await {
                                        warn!("Socket connection error: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                error!("Failed to accept socket connection: {}", e);
                            }
                        }
                    }
                    _ = shutdown.notified() => {
                        info!("Agent socket server shutting down");
                        break;
                    }
                }
            }

            // Clean up socket file
            if path_for_cleanup.exists() {
                let _ = std::fs::remove_file(&path_for_cleanup);
            }
        });

        Ok(())
    }

    /// Signal the server to stop and clean up the socket file.
    pub fn shutdown(&self) {
        self.shutdown.notify_one();
    }
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

async fn handle_connection(
    stream: tokio::net::UnixStream,
    context_store: Arc<AiContextStore>,
    connection_manager: Arc<ConnectionManager>,
) -> Result<(), String> {
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);
    let mut line = String::new();

    buf_reader
        .read_line(&mut line)
        .await
        .map_err(|e| format!("Failed to read request line: {}", e))?;

    let line = line.trim();
    if line.is_empty() {
        return Ok(());
    }

    let response = process_request(line, &context_store, &connection_manager).await;

    let mut response_json =
        serde_json::to_string(&response).map_err(|e| format!("Failed to serialize response: {}", e))?;
    response_json.push('\n');

    writer
        .write_all(response_json.as_bytes())
        .await
        .map_err(|e| format!("Failed to write response: {}", e))?;

    writer
        .shutdown()
        .await
        .map_err(|e| format!("Failed to shutdown writer: {}", e))?;

    Ok(())
}

async fn process_request(
    line: &str,
    context_store: &Arc<AiContextStore>,
    connection_manager: &Arc<ConnectionManager>,
) -> SocketResponse {
    // Parse JSON
    let request: SocketRequest = match serde_json::from_str(line) {
        Ok(req) => req,
        Err(e) => {
            return SocketResponse {
                ok: false,
                request_id: String::new(),
                capability: String::new(),
                result: None,
                error: Some(SocketError {
                    code: "invalid_request".to_string(),
                    message: format!("Invalid JSON: {}", e),
                }),
            };
        }
    };

    // Version check
    if request.version != "1" {
        return SocketResponse {
            ok: false,
            request_id: request.request_id,
            capability: request.capability,
            result: None,
            error: Some(SocketError {
                code: "unsupported_version".to_string(),
                message: format!(
                    "Unsupported protocol version '{}'. Only version '1' is supported.",
                    request.version
                ),
            }),
        };
    }

    // Dispatch to capability handler
    match handle_capability(&request.capability, &request.params, context_store, connection_manager).await {
        Ok(value) => SocketResponse {
            ok: true,
            request_id: request.request_id,
            capability: request.capability,
            result: Some(value),
            error: None,
        },
        Err(e) => SocketResponse {
            ok: false,
            request_id: request.request_id,
            capability: request.capability,
            result: None,
            error: Some(SocketError {
                code: e.error_code().to_string(),
                message: e.to_string(),
            }),
        },
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixStream;

    fn make_deps() -> (Arc<AiContextStore>, Arc<ConnectionManager>) {
        (
            Arc::new(AiContextStore::new()),
            Arc::new(ConnectionManager::new()),
        )
    }

    fn temp_socket_path() -> PathBuf {
        // Unix socket paths have a ~104-byte limit on macOS (SUN_LEN).
        // Use /tmp with a short random suffix to stay within the limit.
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = PathBuf::from(format!(
            "/tmp/qp-{}-{}.sock",
            std::process::id(),
            id
        ));
        // Clean up any leftover from a previous run
        let _ = std::fs::remove_file(&path);
        path
    }

    async fn send_request(socket_path: &PathBuf, request: &Value) -> Value {
        let stream = UnixStream::connect(socket_path).await.unwrap();
        let (reader, mut writer) = stream.into_split();

        let mut request_json = serde_json::to_string(request).unwrap();
        request_json.push('\n');
        writer.write_all(request_json.as_bytes()).await.unwrap();
        writer.shutdown().await.unwrap();

        let mut buf_reader = BufReader::new(reader);
        let mut response_line = String::new();
        buf_reader.read_line(&mut response_line).await.unwrap();

        serde_json::from_str(response_line.trim()).unwrap()
    }

    #[tokio::test]
    async fn socket_server_handles_list_tabs() {
        let (store, cm) = make_deps();
        let socket_path = temp_socket_path();

        let server = AgentSocketServer::new();
        server
            .start_at(socket_path.clone(), store.clone(), cm.clone())
            .await
            .unwrap();

        // Small delay to let the server start accepting
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let request = json!({
            "version": "1",
            "requestId": "r1",
            "capability": "workspace.listTabs",
            "params": {}
        });

        let response = send_request(&socket_path, &request).await;

        assert_eq!(response["ok"], true);
        assert_eq!(response["requestId"], "r1");
        assert_eq!(response["capability"], "workspace.listTabs");
        assert!(response["result"]["tabs"].is_array());
        assert!(response["error"].is_null());

        server.shutdown();
        // Let cleanup happen
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    #[tokio::test]
    async fn socket_server_rejects_invalid_json() {
        let (store, cm) = make_deps();
        let socket_path = temp_socket_path();

        let server = AgentSocketServer::new();
        server
            .start_at(socket_path.clone(), store, cm)
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Send raw garbage (not valid JSON)
        let stream = UnixStream::connect(&socket_path).await.unwrap();
        let (reader, mut writer) = stream.into_split();

        writer.write_all(b"this is not json\n").await.unwrap();
        writer.shutdown().await.unwrap();

        let mut buf_reader = BufReader::new(reader);
        let mut response_line = String::new();
        buf_reader.read_line(&mut response_line).await.unwrap();

        let response: Value = serde_json::from_str(response_line.trim()).unwrap();

        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "invalid_request");
        assert!(response["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Invalid JSON"));

        server.shutdown();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    #[tokio::test]
    async fn socket_server_rejects_unsupported_version() {
        let (store, cm) = make_deps();
        let socket_path = temp_socket_path();

        let server = AgentSocketServer::new();
        server
            .start_at(socket_path.clone(), store, cm)
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let request = json!({
            "version": "99",
            "requestId": "r2",
            "capability": "workspace.listTabs",
            "params": {}
        });

        let response = send_request(&socket_path, &request).await;

        assert_eq!(response["ok"], false);
        assert_eq!(response["requestId"], "r2");
        assert_eq!(response["capability"], "workspace.listTabs");
        assert_eq!(response["error"]["code"], "unsupported_version");
        assert!(response["error"]["message"]
            .as_str()
            .unwrap()
            .contains("99"));

        server.shutdown();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}
