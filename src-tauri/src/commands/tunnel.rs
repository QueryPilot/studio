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
