use std::time::Duration;

use oauth2::basic::BasicClient;
use oauth2::{AuthUrl, ClientId, DeviceAuthorizationUrl, TokenUrl};
use tokio::task;
use zeroize::Zeroize;

use crate::error::{AppError, Result};
use crate::types::{OAuthConfig, OAuthProvider};

const AWS_OAUTH_KEYCHAIN_SERVICE: &str = "query-pilot-aws-oauth";

fn provider_identifier(provider: &OAuthProvider) -> String {
    match provider {
        OAuthProvider::Microsoft => "microsoft".to_string(),
        OAuthProvider::Google => "google".to_string(),
        OAuthProvider::Okta => "okta".to_string(),
        OAuthProvider::Auth0 => "auth0".to_string(),
        OAuthProvider::Keycloak => "keycloak".to_string(),
        OAuthProvider::Generic { name, .. } => format!("generic:{}", name),
    }
}

pub async fn store_oauth_token(provider: &OAuthProvider, token: &str) -> Result<()> {
    let key = provider_identifier(provider);
    let secret = token.to_string();
    task::spawn_blocking(move || -> Result<()> {
        let mut secret = secret;
        let entry = keyring::Entry::new(AWS_OAUTH_KEYCHAIN_SERVICE, &key)
            .map_err(|err| AppError::Internal(format!("Keychain error: {err}")))?;
        entry
            .set_password(&secret)
            .map_err(|err| AppError::Internal(format!("Failed storing token: {err}")))?;
        secret.zeroize();
        Ok(())
    })
    .await
    .map_err(|err| AppError::Internal(format!("Failed to spawn keychain task: {err}")))??;

    Ok(())
}

pub async fn get_oauth_token(provider: &OAuthProvider) -> Result<Option<String>> {
    let key = provider_identifier(provider);
    task::spawn_blocking(move || {
        let entry = keyring::Entry::new(AWS_OAUTH_KEYCHAIN_SERVICE, &key)
            .map_err(|err| AppError::Internal(format!("Keychain error: {err}")))?;
        match entry.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(AppError::Internal(format!("Failed to read token: {err}"))),
        }
    })
    .await
    .map_err(|err| AppError::Internal(format!("Failed to spawn keychain task: {err}")))?
}

pub async fn delete_oauth_token(provider: &OAuthProvider) -> Result<()> {
    let key = provider_identifier(provider);
    task::spawn_blocking(move || {
        let entry = keyring::Entry::new(AWS_OAUTH_KEYCHAIN_SERVICE, &key)
            .map_err(|err| AppError::Internal(format!("Keychain error: {err}")))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(other) => Err(AppError::Internal(format!(
                "Failed to delete token: {other}"
            ))),
        }
    })
    .await
    .map_err(|err| AppError::Internal(format!("Failed to spawn keychain task: {err}")))??;

    Ok(())
}

pub async fn start_device_authorization(_config: &OAuthConfig) -> Result<()> {
    Err(AppError::Unsupported(
        "Device authorization flow not implemented yet.".into(),
    ))
}

pub async fn poll_device_authorization(_config: &OAuthConfig, _interval: Duration) -> Result<()> {
    Err(AppError::Unsupported(
        "Device authorization polling not implemented yet.".into(),
    ))
}

pub fn build_oauth_client(config: &OAuthConfig) -> Result<BasicClient> {
    match &config.provider {
        OAuthProvider::Microsoft => {
            let auth_url = AuthUrl::new(
                "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".to_string(),
            )
            .map_err(|err| AppError::Internal(format!("Invalid auth URL: {err}")))?;
            let token_url = TokenUrl::new(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token".to_string(),
            )
            .map_err(|err| AppError::Internal(format!("Invalid token URL: {err}")))?;
            let device_url = DeviceAuthorizationUrl::new(
                "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode".to_string(),
            )
            .map_err(|err| AppError::Internal(format!("Invalid device URL: {err}")))?;

            Ok(BasicClient::new(
                ClientId::new(config.client_id.clone()),
                None,
                auth_url,
                Some(token_url),
            )
            .set_device_authorization_url(device_url))
        }
        OAuthProvider::Generic {
            auth_url,
            token_url,
            ..
        } => {
            let auth_url = AuthUrl::new(auth_url.clone())
                .map_err(|err| AppError::Internal(format!("Invalid auth URL: {err}")))?;
            let token_url = TokenUrl::new(token_url.clone())
                .map_err(|err| AppError::Internal(format!("Invalid token URL: {err}")))?;
            Ok(BasicClient::new(
                ClientId::new(config.client_id.clone()),
                None,
                auth_url,
                Some(token_url),
            ))
        }
        _ => Err(AppError::Unsupported(
            "OAuth provider not yet supported.".into(),
        )),
    }
}
