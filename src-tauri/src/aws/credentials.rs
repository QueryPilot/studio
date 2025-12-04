//! AWS credentials caching module.
//!
//! Stores temporary AWS credentials in the OS keychain with expiration tracking.
//! Credentials are cached per connection ID to support multiple bastion connections.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use aws_credential_types::Credentials as AwsCredentials;
use serde::{Deserialize, Serialize};
use tokio::task;
use zeroize::Zeroize;

use crate::error::{AppError, Result};

const AWS_CREDENTIALS_KEYCHAIN_SERVICE: &str = "query-pilot-aws-credentials";

/// Buffer time before expiration to trigger refresh (11 minutes, same as authenticate tool)
const REFRESH_BUFFER_SECS: u64 = 11 * 60;

/// Cached AWS credentials with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    /// Unix timestamp in seconds when credentials expire
    pub expiration_secs: Option<u64>,
    /// Role ARN that was assumed
    pub role_arn: String,
    /// Region the credentials are valid for
    pub region: String,
}

impl CachedCredentials {
    /// Create cached credentials from AWS SDK credentials
    pub fn from_aws_credentials(
        creds: &AwsCredentials,
        role_arn: String,
        region: String,
        expiration: Option<SystemTime>,
    ) -> Self {
        let expiration_secs =
            expiration.and_then(|t| t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs()));

        Self {
            access_key_id: creds.access_key_id().to_string(),
            secret_access_key: creds.secret_access_key().to_string(),
            session_token: creds.session_token().map(|s| s.to_string()),
            expiration_secs,
            role_arn,
            region,
        }
    }

    /// Convert to AWS SDK credentials
    pub fn to_aws_credentials(&self) -> AwsCredentials {
        let expiration = self
            .expiration_secs
            .map(|secs| UNIX_EPOCH + Duration::from_secs(secs));

        AwsCredentials::new(
            self.access_key_id.clone(),
            self.secret_access_key.clone(),
            self.session_token.clone(),
            expiration,
            "cached-credentials",
        )
    }

    /// Check if credentials are expired or about to expire
    pub fn is_expired_or_expiring(&self) -> bool {
        match self.expiration_secs {
            Some(exp_secs) => {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                // Consider expired if within REFRESH_BUFFER_SECS of expiration
                now + REFRESH_BUFFER_SECS >= exp_secs
            }
            None => false, // No expiration means never expires
        }
    }

    /// Get time until expiration in seconds
    pub fn seconds_until_expiration(&self) -> Option<i64> {
        self.expiration_secs.map(|exp_secs| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            (exp_secs as i64) - (now as i64)
        })
    }
}

/// Generate keychain key for a connection
fn keychain_key(connection_id: &str) -> String {
    format!("conn:{}", connection_id)
}

/// Store credentials in keychain
pub async fn store_credentials(connection_id: &str, credentials: &CachedCredentials) -> Result<()> {
    let key = keychain_key(connection_id);
    let mut json = serde_json::to_string(credentials)
        .map_err(|e| AppError::Internal(format!("Failed to serialize credentials: {e}")))?;

    task::spawn_blocking(move || -> Result<()> {
        let entry = keyring::Entry::new(AWS_CREDENTIALS_KEYCHAIN_SERVICE, &key)
            .map_err(|e| AppError::Internal(format!("Keychain error: {e}")))?;
        entry
            .set_password(&json)
            .map_err(|e| AppError::Internal(format!("Failed to store credentials: {e}")))?;
        json.zeroize();
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("Keychain task failed: {e}")))??;

    Ok(())
}

/// Retrieve credentials from keychain
pub async fn get_credentials(connection_id: &str) -> Result<Option<CachedCredentials>> {
    let key = keychain_key(connection_id);

    task::spawn_blocking(move || {
        let entry = keyring::Entry::new(AWS_CREDENTIALS_KEYCHAIN_SERVICE, &key)
            .map_err(|e| AppError::Internal(format!("Keychain error: {e}")))?;

        match entry.get_password() {
            Ok(json) => {
                let creds: CachedCredentials = serde_json::from_str(&json)
                    .map_err(|e| AppError::Internal(format!("Failed to parse credentials: {e}")))?;
                Ok(Some(creds))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Internal(format!(
                "Failed to read credentials: {e}"
            ))),
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("Keychain task failed: {e}")))?
}

/// Get valid (non-expired) credentials from keychain
pub async fn get_valid_credentials(connection_id: &str) -> Result<Option<CachedCredentials>> {
    match get_credentials(connection_id).await? {
        Some(creds) if !creds.is_expired_or_expiring() => Ok(Some(creds)),
        _ => Ok(None),
    }
}

/// Delete credentials from keychain
pub async fn delete_credentials(connection_id: &str) -> Result<()> {
    let key = keychain_key(connection_id);

    task::spawn_blocking(move || {
        let entry = keyring::Entry::new(AWS_CREDENTIALS_KEYCHAIN_SERVICE, &key)
            .map_err(|e| AppError::Internal(format!("Keychain error: {e}")))?;

        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Internal(format!(
                "Failed to delete credentials: {e}"
            ))),
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("Keychain task failed: {e}")))??;

    Ok(())
}

/// Check if credentials exist and are valid for a connection
pub async fn has_valid_credentials(connection_id: &str) -> bool {
    get_valid_credentials(connection_id)
        .await
        .ok()
        .flatten()
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_expired_or_expiring() {
        // Credentials expiring in 5 minutes (should be considered expiring)
        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let creds = CachedCredentials {
            access_key_id: "test".to_string(),
            secret_access_key: "test".to_string(),
            session_token: None,
            expiration_secs: Some(now_secs + 300), // 5 minutes from now
            role_arn: "test".to_string(),
            region: "us-east-1".to_string(),
        };

        assert!(creds.is_expired_or_expiring()); // Within 11 minute buffer

        // Credentials expiring in 1 hour (should NOT be considered expiring)
        let creds2 = CachedCredentials {
            expiration_secs: Some(now_secs + 3600), // 1 hour from now
            ..creds.clone()
        };

        assert!(!creds2.is_expired_or_expiring());
    }

    #[test]
    fn test_from_aws_credentials() {
        let aws_creds = AwsCredentials::new(
            "AKIATEST",
            "secret123",
            Some("token456".to_string()),
            Some(UNIX_EPOCH + Duration::from_secs(1700000000)),
            "test",
        );

        let cached = CachedCredentials::from_aws_credentials(
            &aws_creds,
            "arn:aws:iam::123:role/Test".to_string(),
            "us-east-1".to_string(),
            Some(UNIX_EPOCH + Duration::from_secs(1700000000)),
        );

        assert_eq!(cached.access_key_id, "AKIATEST");
        assert_eq!(cached.expiration_secs, Some(1700000000));
    }
}
