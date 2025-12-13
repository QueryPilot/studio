use std::sync::Arc;
use tauri::State;

use crate::ai::{manager::AIManager, secure_storage};

/// Get the AI sidecar URL
#[tauri::command]
pub async fn get_ai_sidecar_url(
    manager: State<'_, Arc<AIManager>>,
) -> Result<Option<String>, String> {
    let url = manager.sidecar_manager().get_url().await;
    Ok(url)
}

/// Reload API keys and send to sidecar (called after user updates keys in settings)
#[tauri::command]
pub async fn reload_ai_api_keys(manager: State<'_, Arc<AIManager>>) -> Result<(), String> {
    let keys = secure_storage::get_all_ai_api_keys()?;

    if keys.is_empty() {
        tracing::warn!("⚠️ No API keys found during reload");
    } else {
        let providers: Vec<_> = keys.keys().cloned().collect();
        tracing::info!("✅ Reloaded API keys for providers: {:?}", providers);
    }

    // Get Sentry DSN from environment
    let sentry_dsn = std::env::var("SENTRY_DSN").ok();

    manager
        .sidecar_manager()
        .configure_api_keys(keys, false, sentry_dsn)
        .await
        .map_err(|e| {
            tracing::error!("❌ Failed to configure API keys: {}", e);
            e.to_string()
        })?;

    Ok(())
}

/// Check sidecar configuration status
#[tauri::command]
pub async fn get_sidecar_status(
    manager: State<'_, Arc<AIManager>>,
) -> Result<serde_json::Value, String> {
    if let Some(url) = manager.sidecar_manager().get_url().await {
        let client = reqwest::Client::new();

        match client
            .get(format!("{}/status", url))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<serde_json::Value>().await {
                    Ok(status) => Ok(status),
                    Err(e) => Err(format!("Failed to parse sidecar status: {}", e)),
                }
            }
            Ok(resp) => Err(format!("Sidecar returned error: {}", resp.status())),
            Err(e) => Err(format!("Failed to connect to sidecar: {}", e)),
        }
    } else {
        Err("Sidecar not initialized".to_string())
    }
}

/// Configure telemetry (Sentry) for backend and sidecar
/// Called by frontend when user changes telemetry preferences
#[tauri::command]
pub async fn configure_telemetry(
    manager: State<'_, Arc<AIManager>>,
    sentry_enabled: bool,
) -> Result<(), String> {
    manager
        .configure_telemetry(sentry_enabled)
        .await
        .map_err(|e| {
            tracing::error!("❌ Failed to configure telemetry: {}", e);
            e.to_string()
        })?;

    // Also initialize/reinitialize backend Sentry
    #[cfg(feature = "telemetry")]
    {
        crate::sentry_integration::initialize_sentry(sentry_enabled, env!("CARGO_PKG_VERSION"));
    }

    Ok(())
}
