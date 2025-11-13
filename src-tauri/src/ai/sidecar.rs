use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct SidecarManager {
    port: RwLock<Option<u16>>,
    process_handle: RwLock<Option<Arc<Child>>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            port: RwLock::new(None),
            process_handle: RwLock::new(None),
        }
    }

    /// Start the AI sidecar process
    pub async fn start(&self) -> Result<u16> {
        // Check if already running
        if self.port.read().await.is_some() {
            return Ok(self.port.read().await.unwrap());
        }

        // Use hardcoded port 47856
        let port = 47856u16;

        // Get sidecar binary path
        tracing::info!("Looking for AI sidecar binary...");
        let sidecar_path = self.get_sidecar_path()?;
        tracing::info!("Found AI sidecar at: {:?}", sidecar_path);

        // Start the sidecar process
        let mut child = Command::new(&sidecar_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow!("Failed to spawn sidecar: {}", e))?;

        // Monitor stdout
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        tracing::info!("AI Sidecar [stdout]: {}", line);
                    }
                }
            });
        }

        // Monitor stderr
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        tracing::warn!("AI Sidecar [stderr]: {}", line);
                    }
                }
            });
        }

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

    /// Get the sidecar binary path by trying multiple candidate locations
    fn get_sidecar_path(&self) -> Result<std::path::PathBuf> {
        // Build list of candidate paths to try (similar to session-manager-plugin approach)
        let candidates = self.get_candidate_paths();

        // Try each candidate in order
        for (desc, path) in candidates {
            tracing::debug!("Trying {} path: {:?}", desc, path);
            if path.exists() {
                tracing::info!("✅ Found AI sidecar at {}: {:?}", desc, path);
                return Ok(path);
            }
        }

        Err(anyhow!(
            "AI sidecar binary not found. Run 'pnpm build:ai-sidecar' first."
        ))
    }

    /// Get list of candidate paths to search for the sidecar binary
    /// Tauri bundles sidecars with their full target triple name (e.g., ai-server-aarch64-apple-darwin)
    fn get_candidate_paths(&self) -> Vec<(&'static str, std::path::PathBuf)> {
        let mut candidates = Vec::new();

        // Determine target triple for platform-specific binary name
        let target_triple = std::env::consts::ARCH;
        let os = std::env::consts::OS;
        let triple = match (os, target_triple) {
            ("macos", "aarch64") => "aarch64-apple-darwin",
            ("macos", "x86_64") => "x86_64-apple-darwin",
            ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
            ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
            ("windows", "x86_64") => "x86_64-pc-windows-msvc",
            _ => {
                tracing::warn!("Unsupported platform: {}-{}", os, target_triple);
                return candidates;
            }
        };

        let binary_name = format!("ai-server-{}", triple);

        // 1. Production bundle (Tauri resource directory)
        if let Some(mut production_path) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        {
            #[cfg(target_os = "macos")]
            production_path.push("../Resources");

            production_path.push(&binary_name);

            #[cfg(target_os = "windows")]
            production_path.set_extension("exe");

            candidates.push(("production", production_path));
        }

        // 2. Development: src-tauri/sidecars relative to current directory
        if let Ok(mut dev_path) = std::env::current_dir() {
            dev_path.push("src-tauri");
            dev_path.push("sidecars");
            dev_path.push(&binary_name);

            #[cfg(target_os = "windows")]
            dev_path.set_extension("exe");

            candidates.push(("dev (cwd)", dev_path));
        }

        // 3. Development: src-tauri/sidecars relative to executable
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let mut alt_path = exe_dir.to_path_buf();
                alt_path.push("../../../src-tauri/sidecars");
                alt_path.push(&binary_name);

                #[cfg(target_os = "windows")]
                alt_path.set_extension("exe");

                if let Ok(canonical) = alt_path.canonicalize() {
                    candidates.push(("dev (exe)", canonical));
                }
            }
        }

        candidates
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
