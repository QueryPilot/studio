pub mod auth;
pub mod ssh;
pub mod ssm;

use crate::ssh::SshTunnel;
use crate::types::{AuthProfile, InlineTunnelConfig, TunnelProfile, TunnelType};
use anyhow::{Context, Result};
use auth::AuthManager;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

// ── Credential types ─────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AwsCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub region: String,
    pub expires_at: Option<DateTime<Utc>>,
}

impl AwsCredentials {
    pub fn expires_within(&self, duration: chrono::Duration) -> bool {
        match self.expires_at {
            Some(exp) => Utc::now() + duration >= exp,
            None => false,
        }
    }

    pub fn is_expired(&self) -> bool {
        self.expires_within(chrono::Duration::zero())
    }
}

// ── Tunnel endpoint ──────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct TunnelEndpoint {
    pub local_host: String,
    pub local_port: u16,
}

// ── Resolved tunnel config ───────────────────────────────────

#[derive(Debug, Clone)]
pub struct ResolvedTunnel {
    pub tunnel_type: TunnelType,
    pub auth_profile_id: Option<String>,
    pub remote_host: String,
    pub remote_port: u16,
}

impl ResolvedTunnel {
    pub fn from_profile(profile: &TunnelProfile, remote_host: &str, remote_port: u16) -> Self {
        Self {
            tunnel_type: profile.tunnel_type.clone(),
            auth_profile_id: profile.auth_profile_id.clone(),
            remote_host: remote_host.to_string(),
            remote_port,
        }
    }

    pub fn from_inline(inline: &InlineTunnelConfig, remote_host: &str, remote_port: u16) -> Self {
        Self {
            tunnel_type: inline.tunnel_type.clone(),
            auth_profile_id: inline.auth_profile_id.clone(),
            remote_host: remote_host.to_string(),
            remote_port,
        }
    }

    pub fn dedup_key(&self) -> String {
        match &self.tunnel_type {
            TunnelType::SshTunnel {
                host, port, user, ..
            } => {
                format!(
                    "ssh:{}:{}:{}:{}:{}",
                    host, port, user, self.remote_host, self.remote_port
                )
            }
            TunnelType::SsmBastion {
                region,
                task_definition,
                ..
            } => {
                let td = task_definition.as_deref().unwrap_or("ecs-ssm-bastion");
                format!(
                    "ssm:{}:{}:{}:{}",
                    region, td, self.remote_host, self.remote_port
                )
            }
        }
    }
}

// ── Active tunnel variants ───────────────────────────────────

enum ActiveTunnel {
    Ssh(SshTunnel),
    Ssm(ssm::SsmBastionTunnel),
}

impl ActiveTunnel {
    fn local_port(&self) -> u16 {
        match self {
            Self::Ssh(t) => t.local_port(),
            Self::Ssm(t) => t.local_port(),
        }
    }

    async fn health_check(&self) -> Result<()> {
        match self {
            Self::Ssh(t) => Ok(t.health_check().await?),
            Self::Ssm(t) => t.health_check().await,
        }
    }

    async fn close(self) -> Result<()> {
        match self {
            Self::Ssh(t) => Ok(t.close().await?),
            Self::Ssm(t) => t.close().await,
        }
    }
}

// ── Managed tunnel entry with ref counting ───────────────────

struct ManagedTunnelEntry {
    tunnel: ActiveTunnel,
    ref_count: AtomicUsize,
}

// ── Tunnel Manager ───────────────────────────────────────────

pub struct TunnelManager {
    tunnels: Arc<DashMap<String, ManagedTunnelEntry>>,
    pub auth_manager: Arc<AuthManager>,
    tunnel_profiles: tokio::sync::RwLock<Vec<TunnelProfile>>,
    auth_profiles: tokio::sync::RwLock<Vec<AuthProfile>>,
}

impl TunnelManager {
    pub fn new(auth_manager: Arc<AuthManager>) -> Self {
        Self {
            tunnels: Arc::new(DashMap::new()),
            auth_manager,
            tunnel_profiles: tokio::sync::RwLock::new(Vec::new()),
            auth_profiles: tokio::sync::RwLock::new(Vec::new()),
        }
    }

    pub async fn set_auth_profiles(&self, profiles: Vec<AuthProfile>) {
        let mut ap = self.auth_profiles.write().await;
        *ap = profiles;
    }

    pub async fn get_auth_profile(&self, id: &str) -> Option<AuthProfile> {
        let profiles = self.auth_profiles.read().await;
        profiles.iter().find(|p| p.id == id).cloned()
    }

    /// Resolve auth credentials for a tunnel. Must be called before ensure_tunnel for SSM.
    pub async fn resolve_auth(&self, auth_profile_id: &str) -> Result<()> {
        if self.auth_manager.has_valid_credentials(auth_profile_id) {
            return Ok(());
        }
        let profile = self.get_auth_profile(auth_profile_id).await
            .context(format!("Auth profile '{}' not found. Please sync profiles from Settings.", auth_profile_id))?;
        let result = self.auth_manager.get_credentials(auth_profile_id, &profile.provider).await?;
        if result.is_none() {
            anyhow::bail!("Azure AD SAML requires interactive login. This is not yet supported — use Environment Variables auth profile instead.");
        }
        Ok(())
    }

    pub async fn set_tunnel_profiles(&self, profiles: Vec<TunnelProfile>) {
        let mut tp = self.tunnel_profiles.write().await;
        *tp = profiles;
    }

    pub async fn get_tunnel_profile(&self, id: &str) -> Option<TunnelProfile> {
        let profiles = self.tunnel_profiles.read().await;
        profiles.iter().find(|p| p.id == id).cloned()
    }

    pub async fn ensure_tunnel(&self, resolved: &ResolvedTunnel) -> Result<TunnelEndpoint> {
        let key = resolved.dedup_key();

        // Check for existing healthy tunnel
        if let Some(entry) = self.tunnels.get(&key) {
            if entry.tunnel.health_check().await.is_ok() {
                entry.ref_count.fetch_add(1, Ordering::SeqCst);
                return Ok(TunnelEndpoint {
                    local_host: "127.0.0.1".to_string(),
                    local_port: entry.tunnel.local_port(),
                });
            }
            drop(entry);
            if let Some((_, old)) = self.tunnels.remove(&key) {
                let _ = old.tunnel.close().await;
            }
        }

        // Create new tunnel
        let tunnel = match &resolved.tunnel_type {
            TunnelType::SshTunnel {
                host,
                port,
                user,
                auth,
            } => {
                let config = crate::types::SshTunnelConfig {
                    host: host.clone(),
                    port: *port,
                    user: user.clone(),
                    auth: auth.clone(),
                };
                let ssh_tunnel =
                    ssh::establish(&config, &resolved.remote_host, resolved.remote_port).await?;
                ActiveTunnel::Ssh(ssh_tunnel)
            }
            TunnelType::SsmBastion {
                cluster_name,
                task_definition,
                region,
            } => {
                // Resolve auth before establishing tunnel
                let auth_id = resolved.auth_profile_id.as_deref().unwrap_or("");
                if !auth_id.is_empty() {
                    self.resolve_auth(auth_id).await?;
                }
                let creds = self
                    .auth_manager
                    .get_cached_credentials(auth_id)
                    .context("SSM bastion requires authenticated AWS credentials. Create an Environment Variables auth profile in Settings and link it to the tunnel.")?;
                let ssm_tunnel = ssm::establish(
                    &creds,
                    cluster_name.as_deref(),
                    task_definition.as_deref(),
                    region,
                    &resolved.remote_host,
                    resolved.remote_port,
                )
                .await?;
                ActiveTunnel::Ssm(ssm_tunnel)
            }
        };

        let local_port = tunnel.local_port();
        self.tunnels.insert(
            key,
            ManagedTunnelEntry {
                tunnel,
                ref_count: AtomicUsize::new(1),
            },
        );

        Ok(TunnelEndpoint {
            local_host: "127.0.0.1".to_string(),
            local_port,
        })
    }

    pub async fn release_tunnel(&self, dedup_key: &str) {
        if let Some(entry) = self.tunnels.get(dedup_key) {
            let prev = loop {
                let current = entry.ref_count.load(Ordering::SeqCst);
                if current == 0 {
                    break 0;
                }
                match entry.ref_count.compare_exchange(
                    current,
                    current - 1,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                ) {
                    Ok(v) => break v,
                    Err(_) => continue,
                }
            };
            if prev <= 1 {
                drop(entry);
                let tunnels = Arc::clone(&self.tunnels);
                let key = dedup_key.to_string();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(120)).await;
                    if let Some(entry) = tunnels.get(&key) {
                        if entry.ref_count.load(Ordering::SeqCst) == 0 {
                            drop(entry);
                            if let Some((_, removed)) = tunnels.remove(&key) {
                                let _ = removed.tunnel.close().await;
                                tracing::info!("Tunnel {} closed after grace period", key);
                            }
                        }
                    }
                });
            }
        }
    }

    pub async fn shutdown_all(&self) {
        let keys: Vec<String> = self.tunnels.iter().map(|e| e.key().clone()).collect();
        for key in keys {
            if let Some((_, entry)) = self.tunnels.remove(&key) {
                let _ = entry.tunnel.close().await;
            }
        }
    }
}
