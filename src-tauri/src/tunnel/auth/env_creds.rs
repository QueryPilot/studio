use crate::tunnel::AwsCredentials;
use anyhow::{Context, Result};

pub fn get_credentials(region_override: Option<&str>) -> Result<AwsCredentials> {
    let access_key_id =
        std::env::var("AWS_ACCESS_KEY_ID").context("AWS_ACCESS_KEY_ID not set in environment")?;
    let secret_access_key = std::env::var("AWS_SECRET_ACCESS_KEY")
        .context("AWS_SECRET_ACCESS_KEY not set in environment")?;
    let session_token = std::env::var("AWS_SESSION_TOKEN").ok();
    let region = region_override
        .map(|r| r.to_string())
        .or_else(|| std::env::var("AWS_DEFAULT_REGION").ok())
        .or_else(|| std::env::var("AWS_REGION").ok())
        .unwrap_or_else(|| "us-east-1".to_string());

    Ok(AwsCredentials {
        access_key_id,
        secret_access_key,
        session_token,
        region,
        expires_at: None,
    })
}
