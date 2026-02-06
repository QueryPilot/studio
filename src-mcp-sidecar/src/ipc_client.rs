//! IPC client for communication with Tauri bridge.
//!
//! Connects to the Unix socket at `~/.querypilot/mcp-bridge.sock` and
//! forwards JSON-RPC requests to the Tauri backend.

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::types::{BridgeRequest, BridgeResponse};

/// Default socket path
fn default_socket_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".querypilot")
        .join("mcp-bridge.sock")
}

/// IPC client for communicating with the Tauri bridge
pub struct IpcClient {
    request_tx: mpsc::Sender<(BridgeRequest, oneshot::Sender<Result<serde_json::Value>>)>,
    request_counter: AtomicU64,
}

impl IpcClient {
    /// Create a new IPC client and connect to the bridge socket.
    /// Retries up to 5 times with 500ms delay to handle the race condition
    /// where the sidecar starts before the bridge socket is ready.
    pub async fn connect() -> Result<Self> {
        Self::connect_with_retry(default_socket_path(), 5, std::time::Duration::from_millis(500)).await
    }

    /// Connect with retry logic
    async fn connect_with_retry(socket_path: PathBuf, max_attempts: u32, delay: std::time::Duration) -> Result<Self> {
        let mut last_error = None;

        for attempt in 1..=max_attempts {
            match Self::connect_to(socket_path.clone()).await {
                Ok(client) => {
                    if attempt > 1 {
                        tracing::info!("Connected to bridge on attempt {}/{}", attempt, max_attempts);
                    }
                    return Ok(client);
                }
                Err(e) => {
                    tracing::warn!(
                        "Bridge connection attempt {}/{} failed: {}",
                        attempt, max_attempts, e
                    );
                    last_error = Some(e);
                    if attempt < max_attempts {
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Failed to connect after {} attempts", max_attempts)))
    }

    /// Connect to a specific socket path
    pub async fn connect_to(socket_path: PathBuf) -> Result<Self> {
        tracing::info!("Connecting to bridge socket: {:?}", socket_path);

        #[cfg(unix)]
        let stream = tokio::net::UnixStream::connect(&socket_path)
            .await
            .with_context(|| format!("Failed to connect to bridge socket: {:?}", socket_path))?;

        #[cfg(not(unix))]
        let stream = {
            // On non-Unix platforms, we'd need to use named pipes or TCP
            // For now, return an error
            return Err(anyhow::anyhow!(
                "MCP bridge is only supported on Unix platforms"
            ));
        };

        let (read_half, write_half) = stream.into_split();
        let reader = BufReader::new(read_half);
        let writer = Arc::new(Mutex::new(write_half));

        // Channel for sending requests
        let (request_tx, mut request_rx): (
            mpsc::Sender<(BridgeRequest, oneshot::Sender<Result<serde_json::Value>>)>,
            _,
        ) = mpsc::channel(100);

        // Pending responses map
        let pending: Arc<Mutex<std::collections::HashMap<String, oneshot::Sender<Result<serde_json::Value>>>>> =
            Arc::new(Mutex::new(std::collections::HashMap::new()));

        // Spawn writer task
        let writer_clone = Arc::clone(&writer);
        let pending_clone = Arc::clone(&pending);
        tokio::spawn(async move {
            while let Some((request, response_tx)) = request_rx.recv().await {
                let id = request.id.clone();

                // Register pending response
                pending_clone.lock().await.insert(id.clone(), response_tx);

                // Serialize and send request
                let mut line = match serde_json::to_string(&request) {
                    Ok(s) => s,
                    Err(e) => {
                        tracing::error!("Failed to serialize request: {}", e);
                        if let Some(tx) = pending_clone.lock().await.remove(&id) {
                            let _ = tx.send(Err(anyhow::anyhow!("Serialization error: {}", e)));
                        }
                        continue;
                    }
                };
                line.push('\n');

                let mut writer = writer_clone.lock().await;
                if let Err(e) = writer.write_all(line.as_bytes()).await {
                    tracing::error!("Failed to write to socket: {}", e);
                    if let Some(tx) = pending_clone.lock().await.remove(&id) {
                        let _ = tx.send(Err(anyhow::anyhow!("Write error: {}", e)));
                    }
                    break;
                }
                if let Err(e) = writer.flush().await {
                    tracing::error!("Failed to flush socket: {}", e);
                }
            }

            // Clean up any remaining pending requests when writer loop exits
            // Note: Both reader and writer attempt cleanup; whichever exits first drains the map,
            // the other finds it empty. This is intentional - ensures cleanup happens regardless
            // of which task exits first.
            let mut pending_to_drain = pending_clone.lock().await;
            for (_, tx) in pending_to_drain.drain() {
                let _ = tx.send(Err(anyhow::anyhow!("Connection closed")));
            }
        });

        // Spawn reader task
        let pending_reader = Arc::clone(&pending);
        tokio::spawn(async move {
            let mut reader = reader;
            let mut line = String::new();

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => {
                        tracing::info!("Bridge connection closed");
                        break;
                    }
                    Ok(_) => {
                        // Parse response
                        match serde_json::from_str::<BridgeResponse>(&line) {
                            Ok(response) => {
                                if let Some(tx) = pending_reader.lock().await.remove(&response.id) {
                                    let result = match response.error {
                                        Some(err) => Err(anyhow::anyhow!("{}", err)),
                                        None => Ok(response.result.unwrap_or(serde_json::Value::Null)),
                                    };
                                    let _ = tx.send(result);
                                }
                            }
                            Err(e) => {
                                tracing::warn!("Failed to parse bridge response: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("Error reading from socket: {}", e);
                        break;
                    }
                }
            }

            // Clean up any remaining pending requests when reader loop exits
            // (See writer cleanup comment for race condition explanation)
            let mut pending_to_drain = pending_reader.lock().await;
            for (_, tx) in pending_to_drain.drain() {
                let _ = tx.send(Err(anyhow::anyhow!("Connection closed")));
            }
        });

        Ok(Self {
            request_tx,
            request_counter: AtomicU64::new(1),
        })
    }

    /// Send a request to the bridge and wait for response
    pub async fn request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let id = self.request_counter.fetch_add(1, Ordering::SeqCst).to_string();

        let request = BridgeRequest {
            id,
            method: method.to_string(),
            params,
        };

        let (response_tx, response_rx) = oneshot::channel();

        self.request_tx
            .send((request, response_tx))
            .await
            .map_err(|_| anyhow::anyhow!("Failed to send request: channel closed"))?;

        response_rx
            .await
            .map_err(|_| anyhow::anyhow!("Failed to receive response: channel closed"))?
    }

    /// Execute a SQL query
    pub async fn query(
        &self,
        connection_id: &str,
        query: &str,
        limit: Option<u32>,
    ) -> Result<serde_json::Value> {
        let params = serde_json::json!({
            "connectionId": connection_id,
            "query": query,
            "limit": limit
        });
        self.request("query", params).await
    }

    /// List tables in a database
    pub async fn list_tables(
        &self,
        connection_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> Result<serde_json::Value> {
        let params = serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema
        });
        self.request("list_tables", params).await
    }

    /// Describe a table's structure
    pub async fn describe_table(
        &self,
        connection_id: &str,
        table: &str,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> Result<serde_json::Value> {
        let params = serde_json::json!({
            "connectionId": connection_id,
            "table": table,
            "database": database,
            "schema": schema
        });
        self.request("describe_table", params).await
    }

    /// List all available connections
    pub async fn list_connections(&self) -> Result<serde_json::Value> {
        self.request("list_connections", serde_json::json!({})).await
    }

    /// Get query history
    pub async fn get_query_history(
        &self,
        limit: Option<usize>,
        connection_id: Option<&str>,
    ) -> Result<serde_json::Value> {
        let params = serde_json::json!({
            "limit": limit,
            "connectionId": connection_id
        });
        self.request("get_query_history", params).await
    }

    /// Get current active context
    pub async fn get_current_context(&self) -> Result<serde_json::Value> {
        self.request("get_current_context", serde_json::json!({})).await
    }

    /// Get execution plan for a query
    pub async fn get_execution_plan(
        &self,
        connection_id: &str,
        query: &str,
        analyze: bool,
    ) -> Result<serde_json::Value> {
        let params = serde_json::json!({
            "connectionId": connection_id,
            "query": query,
            "analyze": analyze
        });
        self.request("get_execution_plan", params).await
    }
}

/// Mock IPC client for testing without a running Tauri backend
#[allow(dead_code)]
pub struct MockIpcClient;

#[allow(dead_code)]
impl MockIpcClient {
    pub fn new() -> Self {
        Self
    }

    pub async fn query(
        &self,
        _connection_id: &str,
        _query: &str,
        _limit: Option<u32>,
    ) -> Result<serde_json::Value> {
        // Return mock data
        Ok(serde_json::json!({
            "columns": [
                {"name": "id", "dbType": "integer"},
                {"name": "name", "dbType": "varchar"}
            ],
            "rows": [
                [1, "Test Row 1"],
                [2, "Test Row 2"]
            ]
        }))
    }

    pub async fn list_tables(
        &self,
        _connection_id: &str,
        _database: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<serde_json::Value> {
        Ok(serde_json::json!([
            {"schema": "public", "name": "users", "kind": "Regular"},
            {"schema": "public", "name": "orders", "kind": "Regular"}
        ]))
    }

    pub async fn describe_table(
        &self,
        _connection_id: &str,
        _table: &str,
        _database: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<serde_json::Value> {
        Ok(serde_json::json!([
            {"name": "id", "dataType": "integer", "nullable": false, "primaryKey": true},
            {"name": "name", "dataType": "varchar(255)", "nullable": true, "primaryKey": false}
        ]))
    }

    pub async fn list_connections(&self) -> Result<serde_json::Value> {
        Ok(serde_json::json!([
            {"id": "conn-1", "name": "Local PostgreSQL", "dbType": "PostgreSQL", "database": "postgres", "connected": true}
        ]))
    }
}
