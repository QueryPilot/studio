pub mod azure_ad;
pub mod env_creds;
pub mod static_creds;

use crate::tunnel::AwsCredentials;
use crate::types::AuthProvider;
use anyhow::Result;
use dashmap::DashMap;
use std::sync::Arc;

pub struct AuthManager {
    cache: Arc<DashMap<String, AwsCredentials>>,
}

impl AuthManager {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(DashMap::new()),
        }
    }

    pub async fn get_credentials(
        &self,
        auth_profile_id: &str,
        provider: &AuthProvider,
    ) -> Result<Option<AwsCredentials>> {
        // Check cache
        if let Some(creds) = self.cache.get(auth_profile_id) {
            if !creds.expires_within(chrono::Duration::minutes(5)) {
                return Ok(Some(creds.clone()));
            }
        }

        match provider {
            AuthProvider::StaticAwsCredentials {
                access_key_id,
                secret_access_key,
                region,
            } => {
                let creds =
                    static_creds::get_credentials(access_key_id, secret_access_key, region);
                self.cache
                    .insert(auth_profile_id.to_string(), creds.clone());
                Ok(Some(creds))
            }
            AuthProvider::EnvironmentAwsCredentials { region } => {
                let creds = env_creds::get_credentials(region.as_deref())?;
                self.cache
                    .insert(auth_profile_id.to_string(), creds.clone());
                Ok(Some(creds))
            }
            AuthProvider::AzureAdSaml { .. } => {
                // Azure AD requires interactive webview login — return None to signal frontend
                Ok(None)
            }
        }
    }

    pub fn store_credentials(&self, auth_profile_id: &str, creds: AwsCredentials) {
        self.cache.insert(auth_profile_id.to_string(), creds);
    }

    pub fn get_cached_credentials(&self, auth_profile_id: &str) -> Option<AwsCredentials> {
        self.cache.get(auth_profile_id).map(|c| c.clone())
    }

    pub fn invalidate(&self, auth_profile_id: &str) {
        self.cache.remove(auth_profile_id);
    }

    pub fn has_valid_credentials(&self, auth_profile_id: &str) -> bool {
        self.cache
            .get(auth_profile_id)
            .map(|c| !c.is_expired())
            .unwrap_or(false)
    }
}
