use anyhow::{anyhow, Result};
use tokio::sync::RwLock;

pub struct SidecarManager {
    port: RwLock<Option<u16>>,
    process_handle: RwLock<Option<tauri_plugin_shell::process::CommandChild>>,
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
        *self.process_handle.write().await = Some(child);

        // Wait for the server to start with retries
        let mut attempts = 0;
        let max_attempts = 10;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            if self.check_health(port).await {
                break;
            }
            attempts += 1;
            if attempts >= max_attempts {
                return Err(anyhow!("AI sidecar failed to start after {} attempts", max_attempts));
            }
            tracing::debug!("Waiting for AI sidecar to start (attempt {}/{})", attempts, max_attempts);
        }

        *self.port.write().await = Some(port);
        tracing::info!("AI Sidecar started on port {}", port);

        Ok(port)
    }

    /// Stop the AI sidecar process
    pub async fn stop(&self) -> Result<()> {
        let mut handle = self.process_handle.write().await;
        if let Some(child) = handle.take() {
            tracing::info!("Stopping AI sidecar process");

            // Kill the process explicitly
            if let Err(e) = child.kill() {
                tracing::warn!("Failed to kill AI sidecar process: {}", e);
            } else {
                tracing::info!("AI sidecar process killed successfully");
            }
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

    /// Configure API keys and telemetry for the sidecar
    pub async fn configure_api_keys(
        &self,
        keys: std::collections::HashMap<String, String>,
        sentry_enabled: bool,
        sentry_dsn: Option<String>,
    ) -> Result<()> {
        let url = self
            .get_url()
            .await
            .ok_or_else(|| anyhow!("Sidecar not running"))?;

        // Build config payload with API keys + Sentry config
        let mut config = serde_json::Map::new();

        // Add API keys
        for (key, value) in keys {
            config.insert(key, serde_json::Value::String(value));
        }

        // Add Sentry configuration
        config.insert(
            "sentryEnabled".to_string(),
            serde_json::Value::Bool(sentry_enabled),
        );

        if let Some(dsn) = sentry_dsn {
            config.insert("sentryDsn".to_string(), serde_json::Value::String(dsn));
        }

        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/config", url))
            .json(&config)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "Failed to configure sidecar: {}",
                response.status()
            ));
        }

        tracing::info!("✅ Sidecar configured (API keys + Sentry: {})", sentry_enabled);
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
