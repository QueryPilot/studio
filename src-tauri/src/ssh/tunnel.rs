use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use ssh2::{CheckResult, KnownHostFileKind, Session};
use tokio::sync::Mutex;
use tokio::task;

use crate::error::{AppError, Result};
use crate::types::{SshAuthMethod, SshTunnelConfig};

/// SSH tunnel implementation using ssh2 crate
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

        // Verify we can establish SSH connection
        task::spawn_blocking({
            let ssh_host = ssh_host.clone();
            let ssh_user = ssh_user.clone();
            let auth = auth.clone();
            move || -> Result<()> {
                let mut sess = create_ssh_session(&ssh_host, ssh_port)?;
                authenticate_session(&mut sess, &ssh_user, &auth)?;
                Ok(())
            }
        })
        .await
        .map_err(|e| AppError::SshTunnelError(format!("SSH verification task failed: {}", e)))??;

        // Start port forwarding in background
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let shutdown_rx = Arc::new(Mutex::new(Some(shutdown_rx)));
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

        match tokio::time::timeout(Duration::from_secs(5), startup_rx).await {
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

/// Create and configure SSH session
fn create_ssh_session(host: &str, port: u16) -> Result<Session> {
    let tcp = TcpStream::connect(format!("{}:{}", host, port)).map_err(|e| {
        AppError::SshTunnelError(format!(
            "Failed to connect to SSH host {}:{}: {}",
            host, port, e
        ))
    })?;

    tcp.set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| AppError::SshTunnelError(format!("Failed to set read timeout: {}", e)))?;
    tcp.set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| AppError::SshTunnelError(format!("Failed to set write timeout: {}", e)))?;

    let mut sess = Session::new()
        .map_err(|e| AppError::SshTunnelError(format!("Failed to create SSH session: {}", e)))?;

    sess.set_tcp_stream(tcp);
    sess.set_timeout(30_000); // 30 seconds
    sess.set_compress(true);

    sess.handshake()
        .map_err(|e| AppError::SshAuthFailed(format!("SSH handshake failed: {}", e)))?;

    verify_host_key(&sess, host, port)?;

    Ok(sess)
}

fn verify_host_key(sess: &Session, host: &str, port: u16) -> Result<()> {
    let (host_key, _) = sess.host_key().ok_or_else(|| {
        AppError::SshHostKey("Could not read remote SSH host key after handshake".into())
    })?;

    let mut known_hosts = sess
        .known_hosts()
        .map_err(|e| AppError::SshHostKey(format!("Failed to initialize known_hosts: {}", e)))?;

    let known_host_files = known_hosts_paths();
    if known_host_files.is_empty() {
        return Err(AppError::SshHostKey(
            "No known_hosts file found (set QUERY_PILOT_SSH_KNOWN_HOSTS or create ~/.ssh/known_hosts)".into(),
        ));
    }

    let mut loaded_files = Vec::new();
    for path in known_host_files {
        if !path.exists() {
            continue;
        }
        known_hosts
            .read_file(&path, KnownHostFileKind::OpenSSH)
            .map_err(|e| {
                AppError::SshHostKey(format!(
                    "Failed to read known_hosts file {}: {}",
                    path.display(),
                    e
                ))
            })?;
        loaded_files.push(path);
    }

    if loaded_files.is_empty() {
        return Err(AppError::SshHostKey(
            "No readable known_hosts entries were loaded for host verification".into(),
        ));
    }

    let check_result = known_hosts.check_port(host, port, host_key);
    if matches!(check_result, CheckResult::Match) {
        return Ok(());
    }

    // OpenSSH often stores default-port entries without an explicit port.
    let fallback_result = if port == 22 {
        Some(known_hosts.check(host, host_key))
    } else {
        None
    };

    if matches!(fallback_result, Some(CheckResult::Match)) {
        return Ok(());
    }

    let fingerprint = host_key_fingerprint_sha256(sess);
    let error_message = match check_result {
        CheckResult::Mismatch => format!(
            "Host key mismatch for {}:{} (SHA256:{})",
            host, port, fingerprint
        ),
        CheckResult::NotFound => format!(
            "Host key for {}:{} not found in known_hosts (SHA256:{})",
            host, port, fingerprint
        ),
        CheckResult::Failure => format!(
            "Failed to verify host key for {}:{} against known_hosts (SHA256:{})",
            host, port, fingerprint
        ),
        CheckResult::Match => unreachable!(),
    };

    Err(AppError::SshHostKey(error_message))
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

fn host_key_fingerprint_sha256(sess: &Session) -> String {
    use ssh2::HashType;
    if let Some(hash) = sess.host_key_hash(HashType::Sha256) {
        return base64::engine::general_purpose::STANDARD.encode(hash);
    }
    "unknown".to_string()
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

/// Authenticate SSH session based on auth method
fn authenticate_session(sess: &mut Session, user: &str, auth: &SshAuthMethod) -> Result<()> {
    match auth {
        SshAuthMethod::Password(password) => {
            sess.userauth_password(user, password).map_err(|e| {
                AppError::SshAuthFailed(format!("SSH password authentication failed: {}", e))
            })?;
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

            let passphrase_str = passphrase.as_deref().unwrap_or("");

            sess.userauth_pubkey_file(user, None, key_path, Some(passphrase_str))
                .map_err(|e| {
                    if passphrase.is_some() && !passphrase_str.is_empty() {
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
        }
        SshAuthMethod::Agent => {
            sess.userauth_agent(user).map_err(|e| {
                AppError::SshAuthFailed(format!(
                    "SSH agent authentication failed: {}. Make sure ssh-agent is running and has keys loaded.",
                    e
                ))
            })?;
        }
    }

    if !sess.authenticated() {
        return Err(AppError::SshAuthFailed("SSH authentication failed".into()));
    }

    Ok(())
}

/// Maximum concurrent client connections per tunnel (prevents resource exhaustion)
const MAX_CONCURRENT_CLIENTS: usize = 50;

/// Run the port forwarding proxy with tracked client handlers
async fn run_port_forward(
    local_port: u16,
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    auth: &SshAuthMethod,
    remote_host: &str,
    remote_port: u16,
    shutdown_rx: Arc<Mutex<Option<tokio::sync::oneshot::Receiver<()>>>>,
    mut startup_tx: Option<tokio::sync::oneshot::Sender<Result<()>>>,
) -> Result<()> {
    let listener = match TcpListener::bind(format!("127.0.0.1:{}", local_port)) {
        Ok(listener) => listener,
        Err(err) => {
            let message = format!("Failed to bind local port: {}", err);
            if let Some(tx) = startup_tx.take() {
                let _ = tx.send(Err(AppError::SshTunnelError(message.clone())));
            }
            return Err(AppError::SshTunnelError(message));
        }
    };

    if let Err(err) = listener.set_nonblocking(true) {
        let message = format!("Failed to set non-blocking: {}", err);
        if let Some(tx) = startup_tx.take() {
            let _ = tx.send(Err(AppError::SshTunnelError(message.clone())));
        }
        return Err(AppError::SshTunnelError(message));
    }

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
        // Check for shutdown signal
        {
            let mut rx = shutdown_rx.lock().await;
            if let Some(ref mut receiver) = *rx {
                match receiver.try_recv() {
                    Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                        tracing::info!(
                            "SSH tunnel shutting down, aborting {} client handlers",
                            client_handles.len()
                        );
                        // Abort all client handlers on shutdown
                        for handle in client_handles.drain(..) {
                            handle.abort();
                        }
                        return Ok(());
                    }
                    Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
                }
            }
        }

        // Clean up finished client handlers periodically (every iteration)
        client_handles.retain(|h| !h.is_finished());

        // Accept new connections
        match listener.accept() {
            Ok((client, addr)) => {
                // Enforce connection limit to prevent DoS
                if client_handles.len() >= MAX_CONCURRENT_CLIENTS {
                    tracing::warn!(
                        "SSH tunnel at max capacity ({}), rejecting connection from {}",
                        MAX_CONCURRENT_CLIENTS,
                        addr
                    );
                    drop(client); // Close the connection
                    continue;
                }

                tracing::debug!(
                    "Accepted connection from {} ({}/{})",
                    addr,
                    client_handles.len() + 1,
                    MAX_CONCURRENT_CLIENTS
                );

                let ssh_host = ssh_host.to_string();
                let ssh_user = ssh_user.to_string();
                let auth = auth.clone();
                let remote_host = remote_host.to_string();

                // Track the spawned task handle
                let handle = task::spawn_blocking(move || {
                    if let Err(e) = handle_client(
                        client,
                        &ssh_host,
                        ssh_port,
                        &ssh_user,
                        &auth,
                        &remote_host,
                        remote_port,
                    ) {
                        tracing::error!("Client connection error: {}", e);
                    }
                });
                client_handles.push(handle);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // No connections available, sleep briefly
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => {
                tracing::error!("Failed to accept connection: {}", e);
            }
        }
    }
}

/// Handle a single client connection through SSH tunnel
fn handle_client(
    mut client: TcpStream,
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    auth: &SshAuthMethod,
    remote_host: &str,
    remote_port: u16,
) -> Result<()> {
    // Establish SSH session
    let mut sess = create_ssh_session(ssh_host, ssh_port)?;
    authenticate_session(&mut sess, ssh_user, auth)?;

    // Request port forwarding channel
    let mut channel = sess
        .channel_direct_tcpip(remote_host, remote_port, None)
        .map_err(|e| {
            AppError::SshTunnelError(format!(
                "Failed to open SSH channel to {}:{}: {}",
                remote_host, remote_port, e
            ))
        })?;

    tracing::debug!(
        "Established SSH tunnel: client -> {}:{} -> {}:{}",
        ssh_host,
        ssh_port,
        remote_host,
        remote_port
    );

    // Set client to non-blocking
    client.set_nonblocking(true).map_err(|e| {
        AppError::SshTunnelError(format!("Failed to set client non-blocking: {}", e))
    })?;

    // Bidirectional copy between client and SSH channel
    let mut client_buf = [0u8; 8192];
    let mut channel_buf = [0u8; 8192];
    let mut client_eof = false;
    let mut channel_eof = false;

    loop {
        // Read from client, write to channel
        if !client_eof {
            match client.read(&mut client_buf) {
                Ok(0) => {
                    tracing::debug!("Client closed connection");
                    client_eof = true;
                    let _ = channel.send_eof();
                }
                Ok(n) => {
                    channel.write_all(&client_buf[..n]).map_err(|e| {
                        AppError::SshTunnelError(format!("Failed to write to SSH channel: {}", e))
                    })?;
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => {
                    tracing::debug!("Client read error: {}", e);
                    client_eof = true;
                }
            }
        }

        // Read from channel, write to client
        if !channel_eof {
            match channel.read(&mut channel_buf) {
                Ok(0) => {
                    tracing::debug!("SSH channel closed");
                    channel_eof = true;
                }
                Ok(n) => {
                    client.write_all(&channel_buf[..n]).map_err(|e| {
                        AppError::SshTunnelError(format!("Failed to write to client: {}", e))
                    })?;
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => {
                    tracing::debug!("Channel read error: {}", e);
                    channel_eof = true;
                }
            }
        }

        // Check if channel is EOF
        if channel.eof() && !channel_eof {
            tracing::debug!("SSH channel EOF");
            channel_eof = true;
        }

        // Exit if both sides are closed
        if client_eof && channel_eof {
            break;
        }

        // Small sleep to prevent busy loop
        std::thread::sleep(Duration::from_millis(1));
    }

    let _ = channel.close();
    let _ = channel.wait_close();

    tracing::debug!("Client connection closed");
    Ok(())
}

/// Verify SSH connection (for testing)
pub async fn verify_connection(config: &SshTunnelConfig) -> Result<()> {
    let config = with_ssh_config_overrides(config);

    // Validate auth method early (fail-fast for missing key files)
    validate_auth_method(&config.auth)?;

    task::spawn_blocking({
        let ssh_host = config.host.trim().to_string();
        let ssh_port = if config.port == 0 { 22 } else { config.port };
        let ssh_user = config.user.trim().to_string();
        let auth = config.auth.clone();

        move || -> Result<()> {
            let mut sess = create_ssh_session(&ssh_host, ssh_port)?;
            authenticate_session(&mut sess, &ssh_user, &auth)?;
            Ok(())
        }
    })
    .await
    .map_err(|e| AppError::SshTunnelError(format!("SSH verification task failed: {}", e)))??;

    Ok(())
}
