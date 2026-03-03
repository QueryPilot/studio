use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::ssh_key;
use tokio::net::TcpListener;
use tokio::task;

use crate::error::{AppError, Result};
use crate::types::{SshAuthMethod, SshTunnelConfig};

/// SSH tunnel implementation using russh (pure-Rust, async-native)
/// Supports password, key-based, and SSH agent authentication
pub struct SshTunnel {
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    task_handle: Option<task::JoinHandle<Result<()>>>,
}

impl SshTunnel {
    pub async fn establish(
        config: &SshTunnelConfig,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Self> {
        let config = with_ssh_config_overrides(config);

        // Validate auth method early (fail-fast for missing key files)
        validate_auth_method(&config.auth)?;

        // Allocate local port
        let local_port = super::allocate_local_port().map_err(|e| {
            AppError::SshTunnelError(format!("Failed to allocate local port: {}", e))
        })?;

        let ssh_host = config.host.trim().to_string();
        let ssh_port = if config.port == 0 { 22 } else { config.port };
        let ssh_user = config.user.trim().to_string();
        let auth = config.auth.clone();
        let remote_host_str = remote_host.to_string();

        // Start port forwarding in background — session is created inside the task
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let (startup_tx, startup_rx) = tokio::sync::oneshot::channel();

        let task_handle = task::spawn({
            let remote_host_clone = remote_host_str.clone();
            async move {
                run_port_forward(
                    local_port,
                    &ssh_host,
                    ssh_port,
                    &ssh_user,
                    &auth,
                    &remote_host_clone,
                    remote_port,
                    shutdown_rx,
                    Some(startup_tx),
                )
                .await
            }
        });

        // Wait for the tunnel to report ready (session created + listener bound).
        // Must exceed the 30s connect timeout inside create_ssh_session so that
        // the inner timeout fires first with a more precise error message.
        match tokio::time::timeout(Duration::from_secs(35), startup_rx).await {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(err))) => {
                let _ = task_handle.await;
                return Err(err);
            }
            Ok(Err(_)) => {
                task_handle.abort();
                let _ = task_handle.await;
                return Err(AppError::SshTunnelError(
                    "SSH tunnel startup handshake channel unexpectedly closed".into(),
                ));
            }
            Err(_) => {
                task_handle.abort();
                let _ = task_handle.await;
                return Err(AppError::SshTimeout(
                    "Timed out waiting for local SSH tunnel listener to start".into(),
                ));
            }
        }

        Ok(Self {
            local_port,
            remote_host: remote_host_str,
            remote_port,
            shutdown_tx: Some(shutdown_tx),
            task_handle: Some(task_handle),
        })
    }

    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    pub fn remote_endpoint(&self) -> (&str, u16) {
        (&self.remote_host, self.remote_port)
    }

    pub async fn health_check(&self) -> Result<()> {
        // Check if local port is still listening
        if !super::is_port_listening(self.local_port).await {
            return Err(AppError::SshTunnelError(
                "SSH tunnel port no longer listening".into(),
            ));
        }
        Ok(())
    }

    pub async fn close(mut self) -> Result<()> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        if let Some(handle) = self.task_handle.take() {
            match handle.await {
                Ok(Ok(())) => {}
                Ok(Err(err)) => {
                    tracing::debug!("SSH tunnel task exited with error during close: {}", err);
                }
                Err(err) if err.is_cancelled() => {}
                Err(err) => {
                    tracing::warn!("SSH tunnel task join error during close: {}", err);
                }
            }
        }

        Ok(())
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

// ---------------------------------------------------------------------------
// SSH client handler — implements host key verification for russh
// ---------------------------------------------------------------------------

struct SshClientHandler {
    host: String,
    port: u16,
    /// Shared slot for host key error details (read after connect fails)
    host_key_error: Arc<std::sync::Mutex<Option<String>>>,
}

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        match verify_known_hosts(&self.host, self.port, server_public_key) {
            Ok(()) => Ok(true),
            Err(e) => {
                *self.host_key_error.lock().unwrap_or_else(|p| p.into_inner()) =
                    Some(e.to_string());
                Ok(false) // Reject — russh will fail the connection
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Known-hosts verification
// ---------------------------------------------------------------------------

/// Verify server key against known_hosts files.
///
/// - Returns `Ok(())` on match or if the host is new (TOFU — Trust On First Use).
/// - Auto-appends new host keys to `~/.ssh/known_hosts`.
/// - Returns `Err(SshHostKey)` only on key **mismatch** (potential MITM).
fn verify_known_hosts(host: &str, port: u16, server_key: &ssh_key::PublicKey) -> Result<()> {
    let paths = known_hosts_paths();

    for path in &paths {
        if !path.exists() {
            continue;
        }

        match russh::keys::check_known_hosts_path(host, port, server_key, path) {
            Ok(true) => return Ok(()),
            Ok(false) => {
                // Host not found in this file — try next
            }
            Err(russh::keys::Error::KeyChanged { line }) => {
                let fingerprint = server_key.fingerprint(ssh_key::HashAlg::Sha256);
                return Err(AppError::SshHostKey(format!(
                    "Host key mismatch for {}:{} at known_hosts line {} ({}). Remove the old entry to connect.",
                    host, port, line, fingerprint
                )));
            }
            Err(e) => {
                tracing::warn!(
                    "Error reading known_hosts {}: {}",
                    path.display(),
                    e
                );
            }
        }
    }

    // Host not found in any known_hosts — TOFU: accept and persist
    let fingerprint = server_key.fingerprint(ssh_key::HashAlg::Sha256);
    tracing::info!(
        "New SSH host key for {}:{} ({}), adding to known_hosts (TOFU)",
        host,
        port,
        fingerprint
    );

    if let Err(e) = append_known_hosts(host, port, server_key) {
        tracing::warn!("Failed to save host key to known_hosts: {}", e);
    }

    Ok(())
}

/// Append a new host key entry to ~/.ssh/known_hosts
fn append_known_hosts(host: &str, port: u16, server_key: &ssh_key::PublicKey) -> Result<()> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::SshHostKey("Cannot determine home directory for known_hosts".into())
    })?;
    let ssh_dir = home.join(".ssh");
    if !ssh_dir.exists() {
        std::fs::create_dir_all(&ssh_dir).map_err(|e| {
            AppError::SshHostKey(format!("Failed to create ~/.ssh directory: {}", e))
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| {
                    AppError::SshHostKey(format!("Failed to set ~/.ssh permissions: {}", e))
                })?;
        }
    }

    let known_hosts_path = ssh_dir.join("known_hosts");

    // Format: [host]:port key_type base64_key
    let host_entry = if port == 22 {
        host.to_string()
    } else {
        format!("[{}]:{}", host, port)
    };

    // Encode the public key in OpenSSH format (e.g. "ssh-ed25519 AAAA...")
    let openssh_key = server_key.to_openssh().map_err(|e| {
        AppError::SshHostKey(format!("Failed to encode host key: {}", e))
    })?;
    let encoded = format!("{} {}", host_entry, openssh_key);

    use std::io::Write as IoWrite;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&known_hosts_path)
        .map_err(|e| {
            AppError::SshHostKey(format!("Failed to open known_hosts: {}", e))
        })?;

    // Ensure we start on a new line
    writeln!(file, "{}", encoded).map_err(|e| {
        AppError::SshHostKey(format!("Failed to write to known_hosts: {}", e))
    })?;

    tracing::info!("Added host key to {}", known_hosts_path.display());
    Ok(())
}

fn known_hosts_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();

    if let Ok(custom) = std::env::var("QUERY_PILOT_SSH_KNOWN_HOSTS") {
        let expanded = shellexpand::tilde(&custom);
        paths.push(std::path::PathBuf::from(expanded.as_ref()));
        return paths;
    }

    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".ssh/known_hosts"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        paths.push(std::path::PathBuf::from("/etc/ssh/ssh_known_hosts"));
        paths.push(std::path::PathBuf::from("/etc/ssh/ssh_known_hosts2"));
    }

    paths
}

fn with_ssh_config_overrides(config: &SshTunnelConfig) -> SshTunnelConfig {
    let mut effective = config.clone();
    if let Some(overrides) = super::parse_ssh_config(&effective.host) {
        super::apply_ssh_config_overrides(&mut effective, &overrides);
    }
    effective
}

/// Validate auth method before attempting connection (fail-fast for missing key files)
fn validate_auth_method(auth: &SshAuthMethod) -> Result<()> {
    if let SshAuthMethod::KeyFile { path, .. } = auth {
        let key_path = Path::new(path);
        if !key_path.exists() {
            return Err(AppError::SshKeyError(format!(
                "SSH key file does not exist: {}",
                key_path.display()
            )));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Async session creation + authentication
// ---------------------------------------------------------------------------

/// Create and authenticate an SSH session.
async fn create_ssh_session(
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    auth: &SshAuthMethod,
) -> Result<client::Handle<SshClientHandler>> {
    let config = Arc::new(client::Config {
        nodelay: true,
        inactivity_timeout: Some(Duration::from_secs(30)),
        keepalive_interval: Some(Duration::from_secs(15)),
        ..Default::default()
    });

    let host_key_error = Arc::new(std::sync::Mutex::new(None));
    let handler = SshClientHandler {
        host: ssh_host.to_string(),
        port: ssh_port,
        host_key_error: host_key_error.clone(),
    };

    let mut session = tokio::time::timeout(
        Duration::from_secs(30),
        client::connect(config, (ssh_host, ssh_port), handler),
    )
    .await
    .map_err(|_| {
        AppError::SshTimeout(format!(
            "SSH connection to {}:{} timed out",
            ssh_host, ssh_port
        ))
    })?
    .map_err(|e| {
        // If the handler stored a host-key error, surface that instead
        if let Some(msg) = host_key_error
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            AppError::SshHostKey(msg)
        } else {
            AppError::SshAuthFailed(format!("SSH handshake failed: {}", e))
        }
    })?;

    authenticate_session(&mut session, ssh_user, auth).await?;

    Ok(session)
}

/// Authenticate SSH session based on auth method
async fn authenticate_session(
    session: &mut client::Handle<SshClientHandler>,
    user: &str,
    auth: &SshAuthMethod,
) -> Result<()> {
    match auth {
        SshAuthMethod::Password(password) => {
            let result = session
                .authenticate_password(user, password)
                .await
                .map_err(|e| {
                    AppError::SshAuthFailed(format!("SSH password authentication failed: {}", e))
                })?;
            if !result.success() {
                return Err(AppError::SshAuthFailed(
                    "SSH password authentication failed".into(),
                ));
            }
        }
        SshAuthMethod::KeyFile { path, passphrase } => {
            let key_path = Path::new(path);
            // Note: existence check already done in validate_auth_method for early failure
            if !key_path.exists() {
                return Err(AppError::SshKeyError(format!(
                    "SSH key file does not exist: {}",
                    key_path.display()
                )));
            }

            let passphrase_opt = passphrase.as_deref().filter(|p| !p.is_empty());
            let key_pair =
                russh::keys::load_secret_key(key_path, passphrase_opt).map_err(|e| {
                    if passphrase_opt.is_some() {
                        AppError::SshKeyError(format!(
                            "SSH key authentication failed (possibly wrong passphrase): {}",
                            e
                        ))
                    } else {
                        AppError::SshKeyError(format!(
                            "SSH key authentication failed: {}. If the key is encrypted, provide a passphrase.",
                            e
                        ))
                    }
                })?;

            let hash_alg = session
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();

            let result = session
                .authenticate_publickey(
                    user,
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), hash_alg),
                )
                .await
                .map_err(|e| {
                    AppError::SshKeyError(format!("SSH key authentication failed: {}", e))
                })?;

            if !result.success() {
                return Err(AppError::SshKeyError(
                    "SSH key authentication failed".into(),
                ));
            }
        }
        SshAuthMethod::Agent => {
            let mut agent =
                russh::keys::agent::client::AgentClient::connect_env()
                    .await
                    .map_err(|e| {
                        AppError::SshAuthFailed(format!(
                            "SSH agent connection failed: {}. Make sure ssh-agent is running and has keys loaded.",
                            e
                        ))
                    })?;

            let identities = agent.request_identities().await.map_err(|e| {
                AppError::SshAuthFailed(format!(
                    "SSH agent failed to list identities: {}",
                    e
                ))
            })?;

            if identities.is_empty() {
                return Err(AppError::SshAuthFailed(
                    "SSH agent has no keys loaded. Add keys with ssh-add.".into(),
                ));
            }

            let mut authenticated = false;
            for identity in &identities {
                match session
                    .authenticate_publickey_with(user, identity.clone(), None, &mut agent)
                    .await
                {
                    Ok(result) if result.success() => {
                        authenticated = true;
                        break;
                    }
                    _ => continue,
                }
            }

            if !authenticated {
                return Err(AppError::SshAuthFailed(format!(
                    "SSH agent authentication failed: none of the {} agent keys were accepted by the server.",
                    identities.len()
                )));
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Async port forwarding with session multiplexing
// ---------------------------------------------------------------------------

/// Maximum concurrent client connections per tunnel (prevents resource exhaustion)
const MAX_CONCURRENT_CLIENTS: usize = 50;

/// Run the port forwarding proxy — creates ONE SSH session and multiplexes channels.
///
/// Key improvement over ssh2: the `Handle` is shared across all client
/// connections instead of re-authenticating per connection.
#[allow(clippy::too_many_arguments)]
async fn run_port_forward(
    local_port: u16,
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    auth: &SshAuthMethod,
    remote_host: &str,
    remote_port: u16,
    mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
    mut startup_tx: Option<tokio::sync::oneshot::Sender<Result<()>>>,
) -> Result<()> {
    // Create a single SSH session for all channels
    let session = match create_ssh_session(ssh_host, ssh_port, ssh_user, auth).await {
        Ok(s) => s,
        Err(e) => {
            if let Some(tx) = startup_tx.take() {
                let _ = tx.send(Err(AppError::SshTunnelError(e.to_string())));
            }
            return Err(e);
        }
    };

    let listener = match TcpListener::bind(format!("127.0.0.1:{}", local_port)).await {
        Ok(listener) => listener,
        Err(err) => {
            let message = format!("Failed to bind local port: {}", err);
            if let Some(tx) = startup_tx.take() {
                let _ = tx.send(Err(AppError::SshTunnelError(message.clone())));
            }
            return Err(AppError::SshTunnelError(message));
        }
    };

    tracing::info!(
        "SSH tunnel listening on 127.0.0.1:{} -> {}@{}:{} -> {}:{}",
        local_port,
        ssh_user,
        ssh_host,
        ssh_port,
        remote_host,
        remote_port
    );

    if let Some(tx) = startup_tx.take() {
        let _ = tx.send(Ok(()));
    }

    // Track spawned client handlers to prevent memory leak
    let mut client_handles: Vec<task::JoinHandle<()>> = Vec::new();

    loop {
        // Clean up finished client handlers
        client_handles.retain(|h| !h.is_finished());

        tokio::select! {
            _ = &mut shutdown_rx => {
                tracing::info!(
                    "SSH tunnel shutting down, aborting {} client handlers",
                    client_handles.len()
                );
                for handle in client_handles.drain(..) {
                    handle.abort();
                }
                return Ok(());
            }
            result = listener.accept() => {
                match result {
                    Ok((local_stream, addr)) => {
                        // Enforce connection limit to prevent DoS
                        if client_handles.len() >= MAX_CONCURRENT_CLIENTS {
                            tracing::warn!(
                                "SSH tunnel at max capacity ({}), rejecting connection from {}",
                                MAX_CONCURRENT_CLIENTS,
                                addr
                            );
                            drop(local_stream);
                            continue;
                        }

                        tracing::debug!(
                            "Accepted connection from {} ({}/{})",
                            addr,
                            client_handles.len() + 1,
                            MAX_CONCURRENT_CLIENTS
                        );

                        // Open channel through shared session (no re-auth!)
                        let channel = match session
                            .channel_open_direct_tcpip(
                                remote_host,
                                remote_port as u32,
                                addr.ip().to_string(),
                                addr.port() as u32,
                            )
                            .await
                        {
                            Ok(ch) => ch,
                            Err(e) => {
                                tracing::error!(
                                    "Failed to open SSH channel to {}:{}: {}",
                                    remote_host, remote_port, e
                                );
                                // If the session is dead, stop accepting
                                if session.is_closed() {
                                    tracing::error!("SSH session is dead, shutting down tunnel");
                                    for handle in client_handles.drain(..) {
                                        handle.abort();
                                    }
                                    return Err(AppError::SshTunnelError(
                                        "SSH session disconnected".into(),
                                    ));
                                }
                                continue;
                            }
                        };

                        let handle = tokio::spawn(async move {
                            if let Err(e) = handle_client_async(local_stream, channel).await {
                                tracing::debug!("Client connection closed: {}", e);
                            }
                        });
                        client_handles.push(handle);
                    }
                    Err(e) => {
                        tracing::error!("Failed to accept connection: {}", e);
                    }
                }
            }
        }
    }
}

/// Handle a single client connection through the SSH tunnel channel.
///
/// Replaces the old 60-line busy-wait copy loop with async bidirectional copy.
async fn handle_client_async(
    mut local_stream: tokio::net::TcpStream,
    channel: russh::Channel<client::Msg>,
) -> Result<()> {
    let mut channel_stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut local_stream, &mut channel_stream)
        .await
        .map_err(|e| AppError::SshTunnelError(format!("Tunnel I/O error: {}", e)))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/// Verify SSH connection (for testing)
pub async fn verify_connection(config: &SshTunnelConfig) -> Result<()> {
    let config = with_ssh_config_overrides(config);

    // Validate auth method early (fail-fast for missing key files)
    validate_auth_method(&config.auth)?;

    let ssh_host = config.host.trim().to_string();
    let ssh_port = if config.port == 0 { 22 } else { config.port };
    let ssh_user = config.user.trim().to_string();

    let session = create_ssh_session(&ssh_host, ssh_port, &ssh_user, &config.auth).await?;
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "en")
        .await;

    Ok(())
}
