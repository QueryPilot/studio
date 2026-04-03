pub mod auth;
pub mod ssh;
pub mod ssm;

use crate::ssh::SshTunnel;
use crate::types::{AuthProfile, AuthProvider, InlineTunnelConfig, TunnelProfile, TunnelType};
use anyhow::{Context, Result};
use auth::AuthManager;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock as TokioRwLock;

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

const MAX_SAML_CAPTURE_REQUEST_BYTES: usize = 2 * 1024 * 1024;

struct SamlCaptureRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

async fn run_saml_capture_server(
    listener: tokio::net::TcpListener,
    expected_profile_id: String,
    saml_tx: tokio::sync::oneshot::Sender<String>,
    mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<()> {
    let saml_tx = Arc::new(tokio::sync::Mutex::new(Some(saml_tx)));

    loop {
        tokio::select! {
            _ = &mut shutdown_rx => break,
            accept_result = listener.accept() => {
                let (mut socket, _) = match accept_result {
                    Ok(conn) => conn,
                    Err(err) => {
                        tracing::warn!("Failed accepting SAML capture connection: {}", err);
                        continue;
                    }
                };

                if let Err(err) = handle_saml_capture_connection(
                    &mut socket,
                    &expected_profile_id,
                    &saml_tx,
                ).await {
                    tracing::debug!("Failed handling SAML capture request: {}", err);
                }
            }
        }
    }

    Ok(())
}

async fn handle_saml_capture_connection(
    socket: &mut tokio::net::TcpStream,
    expected_profile_id: &str,
    saml_tx: &Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>>>,
) -> Result<()> {
    let request = read_saml_capture_request(socket).await?;
    tracing::warn!(
        "SAML capture HTTP request: {} {} ({} bytes)",
        request.method,
        request.path,
        request.body.len()
    );

    if !request.path.starts_with("/saml") {
        return write_saml_capture_response(
            socket,
            404,
            "Not Found",
            "application/json",
            r#"{"error":"not_found"}"#,
        )
        .await;
    }

    match request.method.as_str() {
        "OPTIONS" => write_saml_capture_response(socket, 204, "No Content", "text/plain", "").await?,
        "POST" => {
            if let Some(saml_response) = extract_saml_response(&request.body, expected_profile_id) {
                tracing::warn!(
                    "Captured SAML response for profile '{}' ({} bytes)",
                    expected_profile_id,
                    saml_response.len()
                );
                if let Some(sender) = saml_tx.lock().await.take() {
                    let _ = sender.send(saml_response);
                }

                write_saml_capture_response(
                    socket,
                    200,
                    "OK",
                    "application/json",
                    r#"{"ok":true}"#,
                )
                .await?;
            } else {
                write_saml_capture_response(
                    socket,
                    400,
                    "Bad Request",
                    "application/json",
                    r#"{"error":"missing_saml_response"}"#,
                )
                .await?;
            }
        }
        _ => {
            write_saml_capture_response(
                socket,
                405,
                "Method Not Allowed",
                "application/json",
                r#"{"error":"method_not_allowed"}"#,
            )
            .await?;
        }
    }

    Ok(())
}

async fn read_saml_capture_request(socket: &mut tokio::net::TcpStream) -> Result<SamlCaptureRequest> {
    let mut buffer = Vec::with_capacity(8192);
    let mut chunk = [0_u8; 4096];
    let mut header_end = None;

    loop {
        let bytes_read = socket.read(&mut chunk).await.context("Failed reading SAML capture request")?;
        if bytes_read == 0 {
            anyhow::bail!("SAML capture connection closed before request completed");
        }

        buffer.extend_from_slice(&chunk[..bytes_read]);
        if buffer.len() > MAX_SAML_CAPTURE_REQUEST_BYTES {
            anyhow::bail!("SAML capture request exceeded max size");
        }

        if header_end.is_none() {
            header_end = find_http_header_end(&buffer);
        }

        if let Some(headers_len) = header_end {
            let headers_bytes = &buffer[..headers_len];
            let headers = std::str::from_utf8(headers_bytes).context("SAML capture headers are not UTF-8")?;
            let mut lines = headers.split("\r\n");
            let request_line = lines.next().context("Missing HTTP request line")?;
            let mut parts = request_line.split_whitespace();
            let method = parts.next().unwrap_or_default().to_string();
            let path = parts.next().unwrap_or_default().to_string();
            if method.is_empty() || path.is_empty() {
                anyhow::bail!("Invalid HTTP request line: {}", request_line);
            }

            let content_length = lines
                .clone()
                .filter_map(|line| line.split_once(':'))
                .find_map(|(name, value)| {
                    if name.trim().eq_ignore_ascii_case("content-length") {
                        value.trim().parse::<usize>().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(0);

            let is_chunked = lines
                .filter_map(|line| line.split_once(':'))
                .any(|(name, value)| {
                    name.trim().eq_ignore_ascii_case("transfer-encoding")
                        && value.to_ascii_lowercase().contains("chunked")
                });

            if content_length > MAX_SAML_CAPTURE_REQUEST_BYTES {
                anyhow::bail!("SAML capture request body exceeded max size");
            }

            let body_start = headers_len + 4;
            let mut raw_body = buffer[body_start..].to_vec();

            if content_length > 0 {
                while raw_body.len() < content_length {
                    let bytes_read = socket.read(&mut chunk).await.context("Failed reading SAML capture body")?;
                    if bytes_read == 0 {
                        anyhow::bail!("SAML capture body truncated");
                    }
                    raw_body.extend_from_slice(&chunk[..bytes_read]);
                    if raw_body.len() > MAX_SAML_CAPTURE_REQUEST_BYTES {
                        anyhow::bail!("SAML capture request exceeded max size");
                    }
                }
                raw_body.truncate(content_length);
            } else if is_chunked {
                loop {
                    if let Some(decoded) = decode_chunked_body(&raw_body) {
                        raw_body = decoded;
                        break;
                    }
                    let bytes_read = socket.read(&mut chunk).await.context("Failed reading chunked SAML capture body")?;
                    if bytes_read == 0 {
                        anyhow::bail!("SAML capture chunked body truncated");
                    }
                    raw_body.extend_from_slice(&chunk[..bytes_read]);
                    if raw_body.len() > MAX_SAML_CAPTURE_REQUEST_BYTES {
                        anyhow::bail!("SAML capture request exceeded max size");
                    }
                }
            } else if raw_body.is_empty() && request_line.starts_with("POST ") {
                // Some clients omit Content-Length and close after body; best-effort read.
                loop {
                    match tokio::time::timeout(std::time::Duration::from_millis(100), socket.read(&mut chunk)).await {
                        Ok(Ok(0)) => break,
                        Ok(Ok(bytes_read)) => {
                            raw_body.extend_from_slice(&chunk[..bytes_read]);
                            if raw_body.len() > MAX_SAML_CAPTURE_REQUEST_BYTES {
                                anyhow::bail!("SAML capture request exceeded max size");
                            }
                        }
                        Ok(Err(err)) => return Err(err).context("Failed reading trailing SAML capture body"),
                        Err(_) => break,
                    }
                }
            }

            if raw_body.len() > MAX_SAML_CAPTURE_REQUEST_BYTES {
                anyhow::bail!("SAML capture request exceeded max size");
            }

            return Ok(SamlCaptureRequest {
                method,
                path,
                body: raw_body,
            });
        }
    }
}

fn decode_chunked_body(raw: &[u8]) -> Option<Vec<u8>> {
    let mut pos = 0_usize;
    let mut decoded = Vec::with_capacity(raw.len());

    loop {
        let line_end = find_crlf(raw, pos)?;
        let size_line = std::str::from_utf8(&raw[pos..line_end]).ok()?;
        let size_hex = size_line.split(';').next()?.trim();
        let chunk_size = usize::from_str_radix(size_hex, 16).ok()?;
        pos = line_end + 2;

        if raw.len() < pos + chunk_size + 2 {
            return None;
        }

        if chunk_size > 0 {
            decoded.extend_from_slice(&raw[pos..pos + chunk_size]);
        }

        pos += chunk_size;
        if &raw[pos..pos + 2] != b"\r\n" {
            return None;
        }
        pos += 2;

        if chunk_size == 0 {
            // Accept no trailers (\r\n) or trailers terminated by \r\n\r\n.
            if raw.len() >= pos + 2 && &raw[pos..pos + 2] == b"\r\n" {
                return Some(decoded);
            }
            if let Some(trailer_end) = find_header_terminator_from(raw, pos) {
                let _ = trailer_end;
                return Some(decoded);
            }
            return None;
        }
    }
}

fn find_crlf(data: &[u8], start: usize) -> Option<usize> {
    let rel = data.get(start..)?.windows(2).position(|window| window == b"\r\n")?;
    Some(start + rel)
}

fn find_header_terminator_from(data: &[u8], start: usize) -> Option<usize> {
    let rel = data.get(start..)?.windows(4).position(|window| window == b"\r\n\r\n")?;
    Some(start + rel + 4)
}

fn find_http_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn extract_saml_response(body: &[u8], expected_profile_id: &str) -> Option<String> {
    let body_str = std::str::from_utf8(body).ok()?.trim();
    if body_str.is_empty() {
        return None;
    }

    if body_str.starts_with('{') {
        let payload: serde_json::Value = match serde_json::from_str(body_str) {
            Ok(v) => v,
            Err(err) => {
                tracing::debug!("Invalid JSON in SAML capture request: {}", err);
                return None;
            }
        };

        let saml_response = payload
            .get("samlResponse")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())?;

        if let Some(profile_id) = payload.get("authProfileId").and_then(|v| v.as_str()) {
            if profile_id != expected_profile_id {
                tracing::warn!(
                    "Ignoring SAML response for unexpected auth profile: {}",
                    profile_id
                );
                return None;
            }
        }

        return Some(saml_response.to_string());
    }

    Some(body_str.to_string())
}

async fn write_saml_capture_response(
    socket: &mut tokio::net::TcpStream,
    status_code: u16,
    status_text: &str,
    content_type: &str,
    body: &str,
) -> Result<()> {
    let response = format!(
        "HTTP/1.1 {status_code} {status_text}\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type\r\n\
Access-Control-Allow-Private-Network: true\r\n\
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers\r\n\
Content-Type: {content_type}\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\
\r\n\
{body}",
        body.len()
    );

    socket.write_all(response.as_bytes()).await.context("Failed writing SAML capture response")?;
    let _ = socket.shutdown().await;
    Ok(())
}

// ── Tunnel Manager ───────────────────────────────────────────

pub struct TunnelManager {
    tunnels: Arc<DashMap<String, ManagedTunnelEntry>>,
    pub auth_manager: Arc<AuthManager>,
    tunnel_profiles: TokioRwLock<Vec<TunnelProfile>>,
    auth_profiles: TokioRwLock<Vec<AuthProfile>>,
    app_handle: TokioRwLock<Option<AppHandle>>,
}

impl TunnelManager {
    pub fn new(auth_manager: Arc<AuthManager>) -> Self {
        Self {
            tunnels: Arc::new(DashMap::new()),
            auth_manager,
            tunnel_profiles: TokioRwLock::new(Vec::new()),
            auth_profiles: TokioRwLock::new(Vec::new()),
            app_handle: TokioRwLock::new(None),
        }
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        let mut h = self.app_handle.write().await;
        *h = Some(handle);
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
    /// For Azure AD SAML, opens a webview and waits for the user to complete login.
    pub async fn resolve_auth(&self, auth_profile_id: &str, tunnel_region: Option<&str>) -> Result<()> {
        if self.auth_manager.has_valid_credentials(auth_profile_id) {
            return Ok(());
        }
        let profile = self.get_auth_profile(auth_profile_id).await
            .context(format!("Auth profile '{}' not found. Please sync profiles from Settings.", auth_profile_id))?;

        // For non-interactive providers, just get credentials directly
        let result = self.auth_manager.get_credentials(auth_profile_id, &profile.provider).await?;
        if result.is_some() {
            return Ok(());
        }

        // Azure AD SAML — needs interactive webview login
        if let AuthProvider::AzureAdSaml {
            ref tenant_id,
            ref app_id_uri,
            session_duration_hours,
            ref default_role_arn,
            ..
        } = profile.provider
        {
            let app = {
                let guard = self.app_handle.read().await;
                guard.as_ref().context("App handle not set — cannot open auth webview")?.clone()
            };

            // Build login URL
            let login_url = auth::azure_ad::build_saml_login_url(tenant_id, app_id_uri)?;

            // Open webview
            let label = format!("auth-{}", &auth_profile_id[..8.min(auth_profile_id.len())]);
            if let Some(existing) = app.get_webview_window(&label) {
                let _ = existing.close();
            }

            let parsed_url: tauri::Url = login_url.parse()
                .map_err(|e| anyhow::anyhow!("Invalid SAML URL: {}", e))?;

            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .context("Failed to start local SAML capture server")?;
            let saml_capture_port = listener
                .local_addr()
                .context("Failed to get SAML capture server address")?
                .port();
            tracing::warn!(
                "Started local SAML capture server for profile '{}' on 127.0.0.1:{}",
                auth_profile_id,
                saml_capture_port
            );

            let expected_id = auth_profile_id.to_string();
            let (saml_tx, saml_rx) = tokio::sync::oneshot::channel::<String>();
            let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
            let server_task = tokio::spawn(async move {
                if let Err(err) = run_saml_capture_server(listener, expected_id, saml_tx, shutdown_rx).await {
                    tracing::warn!("SAML capture server stopped with error: {}", err);
                }
            });

            let profile_id_json = serde_json::to_string(auth_profile_id).unwrap_or_default();
            let init_script = format!(
                r#"
                (function() {{
                    if (window.__QP_SAML_HOOK_INSTALLED__) {{
                        return;
                    }}
                    window.__QP_SAML_HOOK_INSTALLED__ = true;
                    var _pid = {pid_json};
                    var _endpoint = 'http://127.0.0.1:{port}/saml';
                    var _sendState = 'idle'; // idle | sending | sent
                    var _cachedSaml = null;
                    console.error('[SAML capture] injector active on', window.location.href);

                    function _withTimeout(promise, ms) {{
                        return Promise.race([
                            promise,
                            new Promise(function(_, reject) {{
                                setTimeout(function() {{ reject(new Error('timeout')); }}, ms);
                            }}),
                        ]);
                    }}

                    function _sendJson(samlValue) {{
                        return fetch(_endpoint, {{
                            method: 'POST',
                            headers: {{ 'Content-Type': 'application/json' }},
                            keepalive: true,
                            body: JSON.stringify({{ authProfileId: _pid, samlResponse: samlValue }}),
                        }}).then(function(resp) {{
                            if (!resp.ok) {{
                                throw new Error('http_status_' + resp.status);
                            }}
                        }});
                    }}

                    function _sendText(samlValue) {{
                        return fetch(_endpoint, {{
                            method: 'POST',
                            headers: {{ 'Content-Type': 'text/plain;charset=UTF-8' }},
                            keepalive: true,
                            mode: 'no-cors',
                            body: samlValue,
                        }}).then(function() {{}});
                    }}

                    function _sendBeacon(samlValue) {{
                        if (!navigator.sendBeacon) {{
                            return Promise.reject(new Error('sendBeacon_unavailable'));
                        }}
                        var ok = navigator.sendBeacon(
                            _endpoint,
                            new Blob([samlValue], {{ type: 'text/plain' }})
                        );
                        if (!ok) {{
                            return Promise.reject(new Error('sendBeacon_failed'));
                        }}
                        return Promise.resolve();
                    }}

                    function _postSaml(samlValue) {{
                        if (!samlValue) {{ return; }}
                        _cachedSaml = samlValue;
                        if (_sendState === 'sent' || _sendState === 'sending') {{ return; }}
                        _sendState = 'sending';

                        _withTimeout(_sendJson(samlValue), 500)
                            .catch(function(err) {{
                                console.error('[SAML capture] JSON POST failed', err);
                                return _withTimeout(_sendText(samlValue), 500);
                            }})
                            .catch(function(err) {{
                                console.error('[SAML capture] text POST failed', err);
                                return _sendBeacon(samlValue);
                            }})
                            .then(function() {{
                                _sendState = 'sent';
                                console.error('[SAML capture] delivered');
                            }})
                            .catch(function(err) {{
                                _sendState = 'idle';
                                console.error('[SAML capture] all transports failed', err);
                            }});
                    }}

                    function _trySend(root) {{
                        var el = (root || document).querySelector('input[name="SAMLResponse"]');
                        if (el && el.value) {{
                            console.error('[SAML capture] found SAMLResponse input');
                            _postSaml(el.value);
                            return true;
                        }}
                        return false;
                    }}

                    // 1. Intercept HTMLFormElement.prototype.submit — catches auto-submit scripts
                    var _origSubmit = HTMLFormElement.prototype.submit;
                    HTMLFormElement.prototype.submit = function() {{
                        var si = this.querySelector('input[name="SAMLResponse"]');
                        if (si && si.value) {{
                            _postSaml(si.value);
                            var form = this;
                            setTimeout(function() {{ _origSubmit.call(form); }}, 120);
                            return;
                        }}
                        return _origSubmit.call(this);
                    }};

                    // 2. Intercept submit events (requestSubmit / user submit)
                    document.addEventListener('submit', function(ev) {{
                        if (ev.target && ev.target.tagName === 'FORM') {{
                            var si = ev.target.querySelector('input[name="SAMLResponse"]');
                            if (si && si.value) {{ _postSaml(si.value); }}
                        }}
                    }}, true);

                    // 3. MutationObserver fallback for dynamically injected forms
                    var _obs = new MutationObserver(function() {{
                        if (_trySend()) {{ _obs.disconnect(); }}
                    }});
                    _obs.observe(document.documentElement, {{ childList: true, subtree: true }});

                    // 4. Check immediately and on load
                    _trySend();
                    window.addEventListener('load', function() {{ _trySend(); }});
                    var _pollCount = 0;
                    var _poller = setInterval(function() {{
                        if (_sendState === 'sent' || _pollCount > 100) {{
                            clearInterval(_poller);
                            return;
                        }}
                        if (_trySend()) {{
                            clearInterval(_poller);
                            return;
                        }}
                        _pollCount += 1;
                    }}, 200);
                    window.addEventListener('beforeunload', function() {{
                        if (_cachedSaml && _sendState !== 'sent' && navigator.sendBeacon) {{
                            navigator.sendBeacon(
                                _endpoint,
                                new Blob([_cachedSaml], {{ type: 'text/plain' }})
                            );
                        }}
                    }});
                }})();
                "#,
                pid_json = profile_id_json,
                port = saml_capture_port
            );

            use tauri::{WebviewUrl, WebviewWindowBuilder};
            let init_script_for_page_load = std::sync::Arc::new(init_script.clone());
            WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
                .title("Authenticate — Azure AD")
                .inner_size(500.0, 700.0)
                .center()
                .initialization_script(&init_script)
                .on_page_load({
                    let init_script_for_page_load = std::sync::Arc::clone(&init_script_for_page_load);
                    move |webview, payload| {
                        tracing::warn!("Auth webview navigated to {}", payload.url());
                        if let Err(err) = webview.eval(init_script_for_page_load.as_str()) {
                            tracing::warn!("Failed to evaluate SAML hook on page load: {}", err);
                        }
                    }
                })
                .build()
                .map_err(|e| anyhow::anyhow!("Failed to open auth window: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(300),
                saml_rx,
            ).await;

            let _ = shutdown_tx.send(());
            if let Err(err) = server_task.await {
                tracing::warn!("Failed joining SAML capture server task: {}", err);
            }

            let saml_response = result
                .map_err(|_| anyhow::anyhow!(
                    "Azure AD login timed out (5 minutes): no SAMLResponse captured on http://127.0.0.1:{}/saml",
                    saml_capture_port
                ))?
                .map_err(|_| anyhow::anyhow!("Auth webview was closed before completing login"))?;

            // Close the webview
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.close();
            }

            // Parse roles and pick one
            let roles = auth::azure_ad::parse_saml_roles(&saml_response)?;
            let (role_arn, principal_arn) = if roles.is_empty() {
                anyhow::bail!("No IAM roles found in SAML response");
            } else if roles.len() == 1 {
                roles[0].clone()
            } else if let Some(ref default_arn) = default_role_arn {
                roles.iter()
                    .find(|(r, _)| r == default_arn)
                    .cloned()
                    .unwrap_or_else(|| roles[0].clone())
            } else {
                // TODO: show role picker dialog — for now use first role
                tracing::warn!("Multiple roles found, using first: {}", roles[0].0);
                roles[0].clone()
            };

            // Use the region from the SSM tunnel config, or fall back to a default
            let region = tunnel_region.unwrap_or("ap-southeast-2");

            // Assume role
            let creds = auth::azure_ad::assume_role_with_saml(
                &saml_response,
                &role_arn,
                &principal_arn,
                session_duration_hours,
                region,
            )
            .await?;

            self.auth_manager.store_credentials(auth_profile_id, creds);
            return Ok(());
        }

        anyhow::bail!("Unsupported auth provider");
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
                    let tunnel_region = match &resolved.tunnel_type {
                        TunnelType::SsmBastion { region, .. } => Some(region.as_str()),
                        _ => None,
                    };
                    self.resolve_auth(auth_id, tunnel_region).await?;
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
