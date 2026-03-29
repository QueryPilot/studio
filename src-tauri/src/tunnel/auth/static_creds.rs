use crate::tunnel::AwsCredentials;

pub fn get_credentials(
    access_key_id: &str,
    secret_access_key: &str,
    region: &str,
) -> AwsCredentials {
    AwsCredentials {
        access_key_id: access_key_id.to_string(),
        secret_access_key: secret_access_key.to_string(),
        session_token: None,
        region: region.to_string(),
        expires_at: None,
    }
}
