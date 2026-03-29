pub mod auth;

use chrono::{DateTime, Utc};

/// AWS credentials obtained from any auth provider.
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

/// Local endpoint after a tunnel is established.
#[derive(Debug, Clone)]
pub struct TunnelEndpoint {
    pub local_host: String,
    pub local_port: u16,
}
