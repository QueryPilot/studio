use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, SystemTime};

use aws_config::BehaviorVersion;
use aws_credential_types::{provider::ProvideCredentials, Credentials as AwsCredentials};
use aws_sdk_ssm::Client as SsmClient;
use aws_types::{region::Region, SdkConfig as AwsSdkConfig};
use serde_json::json;
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokio::process::{Child, Command};
use tokio::time::sleep;

use crate::aws::oauth;
use crate::error::{AppError, Result};
use crate::ssh::{allocate_local_port, is_port_listening};
use crate::types::{AwsAuthMethod, AwsSsmConfig};

pub struct SsmTunnel {
    session_id: String,
    local_port: u16,
    process: Option<Child>,
    client: SsmClient,
}

impl SsmTunnel {
    pub async fn establish(app_handle: &AppHandle, config: &AwsSsmConfig) -> Result<Self> {
        let aws_config = load_sdk_config(&config.auth, &config.region).await?;
        let credentials_provider = aws_config.credentials_provider().ok_or_else(|| {
            AppError::SshAuthFailed("AWS credentials provider is not configured.".into())
        })?;
        let credentials = credentials_provider
            .provide_credentials()
            .await
            .map_err(|err| {
                AppError::SshAuthFailed(format!("Failed to resolve AWS credentials: {err}"))
            })?;

        let ssm_client = SsmClient::new(&aws_config);
        let local_port = allocate_local_port().map_err(|err| {
            AppError::SshTunnelError(format!("Failed to reserve local port: {err}"))
        })?;

        let session = ssm_client
            .start_session()
            .target(&config.target_id)
            .document_name("AWS-StartPortForwardingSessionToRemoteHost")
            .parameters("host", vec![config.remote_host.clone()])
            .parameters("portNumber", vec![config.remote_port.to_string()])
            .parameters("localPortNumber", vec![local_port.to_string()])
            .send()
            .await
            .map_err(|err| {
                AppError::SshTunnelError(format!("Failed to start SSM session: {err}"))
            })?;

        let session_id = session
            .session_id()
            .ok_or_else(|| AppError::SshTunnelError("SSM response missing session_id".into()))?
            .to_string();
        let stream_url = session
            .stream_url()
            .ok_or_else(|| AppError::SshTunnelError("SSM response missing stream_url".into()))?
            .to_string();
        let token_value = session
            .token_value()
            .ok_or_else(|| AppError::SshTunnelError("SSM response missing token_value".into()))?
            .to_string();

        let plugin_path = resolve_plugin_path(app_handle)?;

        let params = json!({
            "SessionId": session_id,
            "StreamUrl": stream_url,
            "TokenValue": token_value,
        })
        .to_string();

        let mut command = Command::new(&plugin_path);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .arg(params)
            .arg(&config.region)
            .arg("StartSession")
            .arg("");

        command.env("AWS_ACCESS_KEY_ID", credentials.access_key_id());
        command.env("AWS_SECRET_ACCESS_KEY", credentials.secret_access_key());
        if let Some(token) = credentials.session_token() {
            if !token.is_empty() {
                command.env("AWS_SESSION_TOKEN", token);
            }
        }
        command.env("AWS_DEFAULT_REGION", &config.region);
        command.env("AWS_REGION", &config.region);

        let mut child = command.spawn().map_err(|err| {
            AppError::SshTunnelError(format!("Failed to launch session-manager-plugin: {err}"))
        })?;

        // Wait for the local port to begin listening (max 5 seconds)
        for _ in 0..20 {
            if is_port_listening(local_port).await {
                return Ok(Self {
                    session_id,
                    local_port,
                    process: Some(child),
                    client: ssm_client,
                });
            }
            sleep(Duration::from_millis(250)).await;
        }

        let _ = child.kill().await;
        Err(AppError::SshTunnelError(
            "SSM tunnel failed to become ready within 5 seconds".into(),
        ))
    }

    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    pub async fn close(mut self) -> Result<()> {
        if let Some(mut process) = self.process.take() {
            let _ = process.kill().await;
            let _ = process.wait().await;
        }

        if let Err(err) = self
            .client
            .terminate_session()
            .session_id(&self.session_id)
            .send()
            .await
        {
            tracing::warn!(
                "Failed to terminate SSM session {}: {}",
                self.session_id,
                err
            );
        }

        Ok(())
    }
}

impl Drop for SsmTunnel {
    fn drop(&mut self) {
        if let Some(mut process) = self.process.take() {
            tokio::spawn(async move {
                let _ = process.kill().await;
                let _ = process.wait().await;
            });
        }
    }
}

async fn load_sdk_config(auth: &AwsAuthMethod, region: &str) -> Result<AwsSdkConfig> {
    let region = Region::new(region.to_string());

    match auth {
        AwsAuthMethod::AwsProfile { profile_name } => {
            Ok(aws_config::defaults(BehaviorVersion::latest())
                .region(region)
                .profile_name(profile_name)
                .load()
                .await)
        }
        AwsAuthMethod::OAuthFederated(oauth_config) => {
            let token = oauth::get_oauth_token(&oauth_config.provider)
                .await?
                .ok_or_else(|| {
                    AppError::SshAuthFailed(
                        "OAuth token not found. Authenticate with your identity provider first."
                            .into(),
                    )
                })?;

            let base = aws_config::defaults(BehaviorVersion::latest())
                .region(region.clone())
                .load()
                .await;

            let sts = aws_sdk_sts::Client::new(&base);
            let assumed = sts
                .assume_role_with_web_identity()
                .role_arn(&oauth_config.assume_role_arn)
                .role_session_name("query-pilot-ssm")
                .web_identity_token(token)
                .send()
                .await
                .map_err(|err| AppError::SshAuthFailed(format!("Failed to assume role: {err}")))?;

            let credentials = assumed.credentials().ok_or_else(|| {
                AppError::SshAuthFailed("STS response missing credentials.".into())
            })?;

            let access_key = credentials.access_key_id().to_string();
            let secret_key = credentials.secret_access_key().to_string();
            let session_token_str = credentials.session_token();
            let session_token = if session_token_str.is_empty() {
                None
            } else {
                Some(session_token_str.to_string())
            };
            let expiration_dt = credentials.expiration();
            let expiration = if expiration_dt.secs() >= 0 {
                let secs = expiration_dt.secs() as u64;
                let nanos = expiration_dt.subsec_nanos() as u64;
                Some(
                    SystemTime::UNIX_EPOCH
                        + Duration::from_secs(secs)
                        + Duration::from_nanos(nanos),
                )
            } else {
                None
            };

            let provider = AwsCredentials::new(
                access_key,
                secret_key,
                session_token,
                expiration,
                "assume-role-web-identity",
            );

            Ok(aws_config::defaults(BehaviorVersion::latest())
                .region(region)
                .credentials_provider(provider)
                .load()
                .await)
        }
        _ => Err(AppError::Unsupported(
            "AWS auth method not yet supported for SSM tunneling.".into(),
        )),
    }
}

fn resolve_plugin_path(app_handle: &AppHandle) -> Result<PathBuf> {
    const CANDIDATES: &[&str] = &[
        "session-manager-plugin",
        "session-manager-plugin-aarch64-apple-darwin",
        "session-manager-plugin-x86_64-apple-darwin",
        "session-manager-plugin-x86_64-unknown-linux-gnu",
        "session-manager-plugin-x86_64-pc-windows-msvc.exe",
    ];

    for candidate in CANDIDATES {
        if let Ok(path) = app_handle
            .path()
            .resolve(candidate, BaseDirectory::Resource)
        {
            if path.exists() {
                return Ok(path);
            }
        }
    }

    Err(AppError::Internal(
        "session-manager-plugin not found in application bundle.".into(),
    ))
}
