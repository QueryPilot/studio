use crate::tunnel::auth::azure_ad;
use crate::tunnel::auth::AuthManager;
use crate::types::{AuthProfile, TunnelProfile};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::RwLock;

/// Shared state for auth and tunnel profiles (in-memory cache).
/// The frontend vault is the source of truth; these commands provide
/// backend-side access when needed during connection establishment.
pub struct TunnelState {
    pub auth_profiles: RwLock<Vec<AuthProfile>>,
    pub tunnel_profiles: RwLock<Vec<TunnelProfile>>,
}

impl Default for TunnelState {
    fn default() -> Self {
        Self::new()
    }
}

impl TunnelState {
    pub fn new() -> Self {
        Self {
            auth_profiles: RwLock::new(Vec::new()),
            tunnel_profiles: RwLock::new(Vec::new()),
        }
    }
}

#[tauri::command]
pub async fn sync_tunnel_state(
    auth_profiles: Vec<AuthProfile>,
    tunnel_profiles: Vec<TunnelProfile>,
    state: State<'_, Arc<TunnelState>>,
    tunnel_manager: State<'_, Arc<crate::tunnel::TunnelManager>>,
) -> Result<(), String> {
    // Sync to TunnelState (legacy)
    let mut ap = state.auth_profiles.write().await;
    *ap = auth_profiles.clone();
    let mut tp = state.tunnel_profiles.write().await;
    *tp = tunnel_profiles.clone();
    drop(ap);
    drop(tp);

    // Sync to TunnelManager (needed for auth resolution during connect)
    tunnel_manager.set_auth_profiles(auth_profiles).await;
    tunnel_manager.set_tunnel_profiles(tunnel_profiles).await;
    Ok(())
}

#[tauri::command]
pub async fn get_auth_profile(
    id: String,
    state: State<'_, Arc<TunnelState>>,
) -> Result<Option<AuthProfile>, String> {
    let profiles = state.auth_profiles.read().await;
    Ok(profiles.iter().find(|p| p.id == id).cloned())
}

#[tauri::command]
pub async fn get_tunnel_profile(
    id: String,
    state: State<'_, Arc<TunnelState>>,
) -> Result<Option<TunnelProfile>, String> {
    let profiles = state.tunnel_profiles.read().await;
    Ok(profiles.iter().find(|p| p.id == id).cloned())
}

#[tauri::command]
pub fn get_system_arch() -> String {
    std::env::consts::ARCH.to_string()
}

#[tauri::command]
pub async fn check_session_manager_plugin() -> Result<serde_json::Value, String> {
    match tokio::process::Command::new("session-manager-plugin")
        .arg("--version")
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(serde_json::json!({
                "available": true,
                "version": if version.is_empty() { None::<String> } else { Some(version) },
            }))
        }
        _ => Ok(serde_json::json!({
            "available": false,
        })),
    }
}

#[tauri::command]
pub async fn build_saml_login_url(
    tenant_id: String,
    app_id_uri: String,
) -> Result<String, String> {
    azure_ad::build_saml_login_url(&tenant_id, &app_id_uri).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn handle_saml_response(
    saml_response: String,
    role_arn: String,
    principal_arn: String,
    duration_hours: u32,
    region: String,
    auth_profile_id: String,
    auth_manager: State<'_, Arc<AuthManager>>,
) -> Result<(), String> {
    let creds = azure_ad::assume_role_with_saml(
        &saml_response,
        &role_arn,
        &principal_arn,
        duration_hours,
        &region,
    )
    .await
    .map_err(|e| e.to_string())?;
    auth_manager.store_credentials(&auth_profile_id, creds);
    Ok(())
}

#[tauri::command]
pub async fn parse_saml_roles(saml_response: String) -> Result<Vec<(String, String)>, String> {
    azure_ad::parse_saml_roles(&saml_response).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_auth_status(
    auth_profile_id: String,
    auth_manager: State<'_, Arc<AuthManager>>,
) -> Result<bool, String> {
    Ok(auth_manager.has_valid_credentials(&auth_profile_id))
}

#[tauri::command]
pub async fn open_auth_webview(
    url: String,
    auth_profile_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let label = format!("auth-{}", &auth_profile_id[..8.min(auth_profile_id.len())]);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.close();
    }
    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title("Authenticate — Azure AD")
        .inner_size(500.0, 700.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
