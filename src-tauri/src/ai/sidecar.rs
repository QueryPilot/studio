use anyhow::{anyhow, Result};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct SidecarManager {
    port: RwLock<Option<u16>>,
    process_handle: RwLock<Option<Arc<tauri_plugin_shell::process::CommandChild>>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            port: RwLock::new(None),
            process_handle: RwLock::new(None),
        }
    }

    /// Start the AI sidecar process
    pub async fn start(&self, app_handle: &tauri::AppHandle) -> Result<u16> {
        // Check if already running
        if self.port.read().await.is_some() {
            return Ok(self.port.read().await.unwrap());
        }

        // Use hardcoded port 47856
        let port = 47856u16;

        // Start sidecar using Tauri's sidecar API
        tracing::info!("Starting AI sidecar binary...");
        use tauri_plugin_shell::ShellExt;

        let (mut rx, child) = app_handle
            .shell()
            .sidecar("qp-ai")
            .map_err(|e| anyhow!("Failed to create sidecar command: {}", e))?
            .spawn()
            .map_err(|e| anyhow!("Failed to spawn sidecar: {}", e))?;

        // Monitor stdout and stderr
        tokio::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        tracing::info!("AI Sidecar [stdout]: {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Stderr(line) => {
                        tracing::warn!("AI Sidecar [stderr]: {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(err) => {
                        tracing::error!("AI Sidecar error: {}", err);
                    }
                    CommandEvent::Terminated(status) => {
                        tracing::info!("AI Sidecar terminated with status: {:?}", status);
                        break;
                    }
                    _ => {}
                }
            }
        });

        // Store the child process
        *self.process_handle.write().await = Some(Arc::new(child));

        // Wait a bit for the server to start
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Verify the server is running
        if !self.check_health(port).await {
            return Err(anyhow!("AI sidecar failed to start"));
        }

        *self.port.write().await = Some(port);
        tracing::info!("AI Sidecar started on port {}", port);

        Ok(port)
    }

    /// Stop the AI sidecar process
    pub async fn stop(&self) -> Result<()> {
        let mut handle = self.process_handle.write().await;
        if let Some(_child) = handle.take() {
            // The process will be killed when the Arc is dropped
            tracing::info!("Stopping AI sidecar");
        }

        *self.port.write().await = None;
        Ok(())
    }

    /// Get the current port
    pub async fn get_port(&self) -> Option<u16> {
        *self.port.read().await
    }

    /// Get the sidecar URL
    pub async fn get_url(&self) -> Option<String> {
        self.port
            .read()
            .await
            .map(|port| format!("http://localhost:{}", port))
    }

    /// Configure API keys for the sidecar
    pub async fn configure_api_keys(
        &self,
        keys: std::collections::HashMap<String, String>,
    ) -> Result<()> {
        let url = self
            .get_url()
            .await
            .ok_or_else(|| anyhow!("Sidecar not running"))?;

        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/config", url))
            .json(&keys)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "Failed to configure API keys: {}",
                response.status()
            ));
        }

        tracing::info!("✅ API keys configured for sidecar");
        Ok(())
    }

    /// Fetch supported providers from the sidecar
    pub async fn get_providers(&self) -> Result<serde_json::Value> {
        let url = self
            .get_url()
            .await
            .ok_or_else(|| anyhow!("Sidecar not running"))?;

        let client = reqwest::Client::new();
        let response = client
            .get(format!("{}/providers", url))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("Failed to fetch providers: {}", response.status()));
        }

        let providers = response.json().await?;
        Ok(providers)
    }

    /// Check if the sidecar is healthy
    async fn check_health(&self, port: u16) -> bool {
        let client = reqwest::Client::new();
        let url = format!("http://localhost:{}/health", port);

        match client
            .get(&url)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
}
