use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{async_runtime, Emitter, State, Window};

use crate::ai::manager::AIManager;
use crate::ai::provider::ProviderEvent;
use crate::ai::types::{
    AIMessage, ChatRequest, ChunkEvent, CompleteEvent, ErrorEvent, MessageRole, SessionSummary,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfig {
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIProviderConfig {
    pub name: String,
    pub models: Vec<String>,
    pub requires_api_key: bool,
}

#[tauri::command]
pub async fn create_ai_session(
    title: Option<String>,
    manager: State<'_, Arc<AIManager>>,
) -> Result<SessionSummary, String> {
    Ok(manager.session_manager().create_session(title).await)
}

#[tauri::command]
pub async fn list_ai_sessions(
    manager: State<'_, Arc<AIManager>>,
) -> Result<Vec<SessionSummary>, String> {
    Ok(manager.session_manager().list_sessions().await)
}

#[tauri::command]
pub async fn get_ai_session_history(
    session_id: String,
    manager: State<'_, Arc<AIManager>>,
) -> Result<Vec<AIMessage>, String> {
    manager
        .session_manager()
        .get_history(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_ai_message_streaming(
    session_id: String,
    message: String,
    window: Window,
    manager: State<'_, Arc<AIManager>>,
) -> Result<(), String> {
    let session_manager = manager.session_manager();
    session_manager
        .ensure_session(&session_id)
        .await
        .map_err(|e| e.to_string())?;

    // Store the user message immediately
    let user_message = session_manager
        .add_message(&session_id, MessageRole::User, message.clone())
        .await
        .map_err(|e| e.to_string())?;

    let history = session_manager
        .get_history(&session_id)
        .await
        .map_err(|e| e.to_string())?;

    let provider = manager.provider();
    let request = ChatRequest::new(user_message.content.clone(), history.clone());
    let stream = provider
        .stream_chat(request)
        .await
        .map_err(|e| e.to_string())?;

    let session_id_clone = session_id.clone();
    let window_clone = window.clone();
    let session_manager_clone = session_manager.clone();

    async_runtime::spawn(async move {
        let mut receiver = stream;
        let mut full_response = String::new();

        while let Some(event) = receiver.recv().await {
            match event {
                ProviderEvent::Delta(chunk) => {
                    full_response.push_str(&chunk);
                    if let Err(err) = window_clone.emit(
                        "ai:chunk",
                        ChunkEvent {
                            session_id: session_id_clone.clone(),
                            content: chunk,
                        },
                    ) {
                        tracing::error!("Failed to emit chunk: {}", err);
                        break;
                    }
                }
                ProviderEvent::Finished => {
                    break;
                }
            }
        }

        if full_response.trim().is_empty() {
            let _ = window_clone.emit(
                "ai:error",
                ErrorEvent {
                    session_id: session_id_clone.clone(),
                    message: "Provider returned an empty response".to_string(),
                },
            );
            let _ = window_clone.emit(
                "ai:complete",
                CompleteEvent {
                    session_id: session_id_clone.clone(),
                },
            );
            return;
        }

        if let Err(err) = session_manager_clone
            .add_message(
                &session_id_clone,
                MessageRole::Assistant,
                full_response.clone(),
            )
            .await
        {
            tracing::error!("Failed to persist assistant message: {}", err);
        }

        if let Err(err) = window_clone.emit(
            "ai:complete",
            CompleteEvent {
                session_id: session_id_clone,
            },
        ) {
            tracing::error!("Failed to emit completion: {}", err);
        }
    });

    Ok(())
}

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
                tracing::info!("✅ Reloaded API key for provider: {}", provider);
            }
        }
    }

    if keys.is_empty() {
        tracing::warn!("⚠️ No API keys found during reload");
    }

    manager
        .sidecar_manager()
        .configure_api_keys(keys)
        .await
        .map_err(|e| {
            tracing::error!("❌ Failed to configure API keys: {}", e);
            e.to_string()
        })?;

    Ok(())
}

/// Get list of configured providers (those with API keys)
#[tauri::command]
pub async fn get_configured_providers() -> Result<Vec<String>, String> {
    use keyring::Entry;

    // IMPORTANT: Must match the service name in secure_storage.rs
    const KEYCHAIN_SERVICE: &str = "dev.querypilot.studio.ai";
    let providers = ["openai", "anthropic", "google"];

    let mut configured = Vec::new();

    for provider in providers {
        // Use same format as secure_storage.rs: "dev.querypilot.studio.ai.{provider}"
        let service_name = format!("{}.{}", KEYCHAIN_SERVICE, provider);
        if let Ok(entry) = Entry::new(&service_name, "api_key") {
            if entry.get_password().is_ok() {
                configured.push(provider.to_string());
                tracing::info!("✅ Found configured provider in keychain: {}", provider);
            }
        }
    }

    // Ollama doesn't need API key
    configured.push("ollama".to_string());

    tracing::info!("📋 Configured providers: {:?}", configured);
    Ok(configured)
}

/// Check sidecar configuration status
#[tauri::command]
pub async fn get_sidecar_status(
    manager: State<'_, Arc<AIManager>>,
) -> Result<serde_json::Value, String> {
    if let Some(url) = manager.sidecar_manager().get_url().await {
        let client = reqwest::Client::new();

        // Try to get status from /status endpoint
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

/// Diagnostic command: Check sidecar's in-memory API keys (DANGEROUS - shows sensitive data!)
#[tauri::command]
pub async fn debug_sidecar_status(
    manager: State<'_, Arc<AIManager>>,
) -> Result<serde_json::Value, String> {
    if let Some(url) = manager.sidecar_manager().get_url().await {
        // Check if sidecar is running
        let client = reqwest::Client::new();
        match client.get(format!("{}/health", url)).send().await {
            Ok(resp) if resp.status().is_success() => Ok(serde_json::json!({
                "sidecar_running": true,
                "sidecar_url": url,
                "note": "Sidecar is running. Check browser console and sidecar logs for /config POST."
            })),
            _ => Ok(serde_json::json!({
                "sidecar_running": false,
                "sidecar_url": url,
                "note": "Sidecar health check failed"
            })),
        }
    } else {
        Ok(serde_json::json!({
            "sidecar_running": false,
            "note": "Sidecar port not initialized"
        }))
    }
}

#[tauri::command]
pub async fn get_ai_providers(
    manager: State<'_, Arc<AIManager>>,
) -> Result<Vec<AIProviderConfig>, String> {
    // Try to fetch from sidecar
    match manager.sidecar_manager().get_providers().await {
        Ok(providers_json) => {
            // Parse JSON response
            serde_json::from_value(providers_json)
                .map_err(|e| format!("Failed to parse providers: {}", e))
        }
        Err(e) => {
            tracing::warn!(
                "Failed to fetch providers from sidecar, using fallback: {}",
                e
            );

            // Fallback to hardcoded list if sidecar is not available
            Ok(vec![
                AIProviderConfig {
                    name: "openai".to_string(),
                    models: vec![
                        "gpt-5-2025-08-07".to_string(),
                        "gpt-5-pro-2025-10-06".to_string(),
                        "gpt-5-mini-2025-08-07".to_string(),
                        "gpt-5-nano-2025-08-07".to_string(),
                        "gpt-4.1-2025-04-14".to_string(),
                    ],
                    requires_api_key: true,
                },
                AIProviderConfig {
                    name: "anthropic".to_string(),
                    models: vec![
                        "claude-sonnet-4-5".to_string(),
                        "claude-haiku-4-5".to_string(),
                        "claude-opus-4-1".to_string(),
                    ],
                    requires_api_key: true,
                },
                AIProviderConfig {
                    name: "google".to_string(),
                    models: vec![
                        "gemini-2.5-pro".to_string(),
                        "gemini-2.5-flash".to_string(),
                        "gemini-2.5-flash-lite".to_string(),
                        "gemini-2.0-flash".to_string(),
                        "gemini-2.0-flash-lite".to_string(),
                    ],
                    requires_api_key: true,
                },
                AIProviderConfig {
                    name: "ollama".to_string(),
                    models: vec![
                        "llama3.1".to_string(),
                        "llama3".to_string(),
                        "codellama".to_string(),
                        "mistral".to_string(),
                        "qwen2.5".to_string(),
                        "deepseek-coder".to_string(),
                    ],
                    requires_api_key: false,
                },
            ])
        }
    }
}
