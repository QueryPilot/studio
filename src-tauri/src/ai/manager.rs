use std::sync::Arc;

use crate::ai::sidecar::SidecarManager;

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
    async fn load_and_configure_api_keys(&self) -> anyhow::Result<()> {
        use keyring::Entry;
        use std::collections::HashMap;

        const KEYCHAIN_SERVICE: &str = "dev.querypilot.studio.ai";
        let providers = ["openai", "anthropic", "google"];

        let mut keys = HashMap::new();

        for provider in providers {
            let service_name = format!("{}.{}", KEYCHAIN_SERVICE, provider);
            if let Ok(entry) = Entry::new(&service_name, "api_key") {
                if let Ok(key) = entry.get_password() {
                    keys.insert(provider.to_string(), key);
                    tracing::info!("✅ Loaded API key for provider: {}", provider);
                }
            }
        }

        if !keys.is_empty() {
            self.sidecar_manager.configure_api_keys(keys).await?;
        } else {
            tracing::warn!("⚠️ No API keys found in keychain. Please configure in Settings.");
        }

        Ok(())
    }
}
