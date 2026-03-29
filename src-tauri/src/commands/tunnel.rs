use crate::tunnel::auth::azure_ad;
use crate::tunnel::auth::AuthManager;
use crate::types::{AuthProfile, TunnelProfile};
use std::sync::Arc;
use tauri::State;
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
) -> Result<(), String> {
    let mut ap = state.auth_profiles.write().await;
    *ap = auth_profiles;
    let mut tp = state.tunnel_profiles.write().await;
    *tp = tunnel_profiles;
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
pub async fn check_session_manager_plugin() -> Result<bool, String> {
    let output = tokio::process::Command::new("session-manager-plugin")
        .arg("--version")
        .output()
        .await;
    Ok(output.is_ok())
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
