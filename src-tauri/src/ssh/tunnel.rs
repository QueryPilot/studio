use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use ssh2::Session;
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
    task_handle: Option<task::JoinHandle<()>>,
}

impl SshTunnel {
    pub async fn establish(
        config: &SshTunnelConfig,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Self> {
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

        let task_handle = task::spawn({
            let remote_host_clone = remote_host_str.clone();
            async move {
                if let Err(e) = run_port_forward(
                    local_port,
                    &ssh_host,
                    ssh_port,
                    &ssh_user,
                    &auth,
                    &remote_host_clone,
                    remote_port,
                    shutdown_rx,
                )
                .await
                {
                    tracing::error!("SSH tunnel error: {}", e);
                }
            }
        });

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
            let _ = handle.await;
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

    Ok(sess)
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

/// Run the port forwarding proxy
async fn run_port_forward(
    local_port: u16,
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    auth: &SshAuthMethod,
    remote_host: &str,
    remote_port: u16,
    shutdown_rx: Arc<Mutex<Option<tokio::sync::oneshot::Receiver<()>>>>,
) -> Result<()> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", local_port))
        .map_err(|e| AppError::SshTunnelError(format!("Failed to bind local port: {}", e)))?;

    listener
        .set_nonblocking(true)
        .map_err(|e| AppError::SshTunnelError(format!("Failed to set non-blocking: {}", e)))?;

    tracing::info!(
        "SSH tunnel listening on 127.0.0.1:{} -> {}@{}:{} -> {}:{}",
        local_port,
        ssh_user,
        ssh_host,
        ssh_port,
        remote_host,
        remote_port
    );

    loop {
        // Check for shutdown signal
        {
            let mut rx = shutdown_rx.lock().await;
            if let Some(ref mut receiver) = *rx {
                match receiver.try_recv() {
                    Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                        tracing::info!("SSH tunnel shutting down");
                        return Ok(());
                    }
                    Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
                }
            }
        }

        // Accept new connections
        match listener.accept() {
            Ok((client, addr)) => {
                tracing::debug!("Accepted connection from {}", addr);

                let ssh_host = ssh_host.to_string();
                let ssh_user = ssh_user.to_string();
                let auth = auth.clone();
                let remote_host = remote_host.to_string();

                task::spawn_blocking(move || {
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
