use std::sync::Arc;

use crate::ai::provider::{mock::MockProvider, AIProvider};
use crate::ai::session::SessionManager;
use crate::ai::sidecar::SidecarManager;

pub struct AIManager {
    provider: Arc<dyn AIProvider>,
    session_manager: Arc<SessionManager>,
    sidecar_manager: Arc<SidecarManager>,
}

impl AIManager {
    pub fn new() -> Self {
        Self {
            provider: Arc::new(MockProvider::default()),
            session_manager: Arc::new(SessionManager::new()),
            sidecar_manager: Arc::new(SidecarManager::new()),
        }
    }

    pub fn provider(&self) -> Arc<dyn AIProvider> {
        self.provider.clone()
    }

    pub fn session_manager(&self) -> Arc<SessionManager> {
        self.session_manager.clone()
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

        // IMPORTANT: Must match the service name in secure_storage.rs
        const KEYCHAIN_SERVICE: &str = "dev.querypilot.studio.ai";
        let providers = ["openai", "anthropic", "google"];

        let mut keys = HashMap::new();

        for provider in providers {
            // Use same format as secure_storage.rs: "dev.querypilot.studio.ai.{provider}"
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
