use std::sync::Arc;

use crate::ai::{secure_storage, sidecar::SidecarManager};

pub struct AIManager {
    sidecar_manager: Arc<SidecarManager>,
}

impl AIManager {
    pub fn new() -> Self {
        Self {
            sidecar_manager: Arc::new(SidecarManager::new()),
        }
    }

    pub fn sidecar_manager(&self) -> Arc<SidecarManager> {
        self.sidecar_manager.clone()
    }

    /// Initialize the AI sidecar
    pub async fn initialize_sidecar(&self, app_handle: &tauri::AppHandle) -> anyhow::Result<()> {
        let port = self.sidecar_manager.start(app_handle).await?;
        tracing::info!("AI sidecar initialized on port {}", port);

        // Load and configure API keys
        self.load_and_configure_api_keys().await?;

        Ok(())
    }

    /// Load API keys from secure storage and send to sidecar
    /// Note: Sentry config is set separately via configure_telemetry command
    async fn load_and_configure_api_keys(&self) -> anyhow::Result<()> {
        let keys = secure_storage::get_all_ai_api_keys().map_err(anyhow::Error::msg)?;
        let has_keys = !keys.is_empty();
        let providers: Vec<_> = if has_keys {
            keys.keys().cloned().collect()
        } else {
            Vec::new()
        };

        // Default: Sentry disabled until frontend calls configure_telemetry
        let sentry_dsn = std::env::var("SENTRY_DSN").ok();
        self.sidecar_manager
            .configure_api_keys(keys, false, sentry_dsn)
            .await?;

        if !has_keys {
            tracing::warn!("⚠️ No API keys found in keychain. Please configure in Settings.");
        } else {
            tracing::info!("✅ Loaded API keys for providers: {:?}", providers);
        }

        Ok(())
    }

    /// Configure telemetry for both backend and sidecar
    pub async fn configure_telemetry(&self, sentry_enabled: bool) -> anyhow::Result<()> {
        let sentry_dsn = std::env::var("SENTRY_DSN").ok();

        // Reload API keys and send with updated Sentry config
        let keys = secure_storage::get_all_ai_api_keys().map_err(anyhow::Error::msg)?;

        // Send updated config to sidecar
        self.sidecar_manager
            .configure_api_keys(keys, sentry_enabled, sentry_dsn.clone())
            .await?;

        tracing::info!("✅ Telemetry configured: Sentry={}", sentry_enabled);
        Ok(())
    }
}
