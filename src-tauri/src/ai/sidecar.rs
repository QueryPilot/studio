use std::sync::Arc;
use tokio::sync::RwLock;
use anyhow::{Result, anyhow};
use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};

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

    /// Get the sidecar binary path
    fn get_sidecar_path(&self) -> Result<std::path::PathBuf> {
        // In development, look for the binary in src-tauri/sidecars
        // In production, it will be bundled by Tauri
        
        // Try to get from Tauri resource directory first
        let resource_path = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
            .map(|mut p| {
                // On macOS, binaries are in the bundle
                #[cfg(target_os = "macos")]
                {
                    p.push("../Resources");
                }
                p.push("ai-server");
                #[cfg(target_os = "windows")]
                {
                    p.set_extension("exe");
                }
                p
            });

        if let Some(path) = resource_path {
            if path.exists() {
                return Ok(path);
            }
        }

        // Development fallback: look in src-tauri/sidecars
        let target_triple = std::env::consts::ARCH;
        let os = std::env::consts::OS;
        let triple = match (os, target_triple) {
            ("macos", "aarch64") => "aarch64-apple-darwin",
            ("macos", "x86_64") => "x86_64-apple-darwin",
            ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
            ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
            ("windows", "x86_64") => "x86_64-pc-windows-msvc",
            _ => return Err(anyhow!("Unsupported platform: {}-{}", os, target_triple)),
        };

        // Try multiple possible paths
        let current_dir = std::env::current_dir()?;
        tracing::info!("Current directory: {:?}", current_dir);
        
        // Try relative to current directory
        let mut dev_path = current_dir.clone();
        dev_path.push("src-tauri");
        dev_path.push("sidecars");
        dev_path.push(format!("ai-server-{}", triple));
        #[cfg(target_os = "windows")]
        {
            dev_path.set_extension("exe");
        }

        tracing::info!("Trying path: {:?}", dev_path);
        
        if dev_path.exists() {
            tracing::info!("Found sidecar at: {:?}", dev_path);
            return Ok(dev_path);
        }

        // Try relative to executable (for dev mode when cwd is different)
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let mut alt_path = exe_dir.to_path_buf();
                // In dev mode, go up to workspace root
                alt_path.push("../../../src-tauri/sidecars");
                alt_path.push(format!("ai-server-{}", triple));
                #[cfg(target_os = "windows")]
                {
                    alt_path.set_extension("exe");
                }
                
                if let Ok(canonical) = alt_path.canonicalize() {
                    tracing::info!("Trying alternate path: {:?}", canonical);
                    if canonical.exists() {
                        tracing::info!("Found sidecar at alternate path: {:?}", canonical);
                        return Ok(canonical);
                    }
                }
            }
        }

        Err(anyhow!(
            "AI sidecar binary not found at {:?}. Run 'pnpm build:ai-sidecar' first. Current dir: {:?}",
            dev_path,
            current_dir
        ))
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
        self.port.read().await.map(|port| format!("http://localhost:{}", port))
    }

    /// Configure API keys for the sidecar
    pub async fn configure_api_keys(&self, keys: std::collections::HashMap<String, String>) -> Result<()> {
        let url = self.get_url().await.ok_or_else(|| anyhow!("Sidecar not running"))?;
        
        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/config", url))
            .json(&keys)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("Failed to configure API keys: {}", response.status()));
        }

        tracing::info!("✅ API keys configured for sidecar");
        Ok(())
    }

    /// Fetch supported providers from the sidecar
    pub async fn get_providers(&self) -> Result<serde_json::Value> {
        let url = self.get_url().await.ok_or_else(|| anyhow!("Sidecar not running"))?;

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

        match client.get(&url)
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

