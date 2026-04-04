use crate::tunnel::AwsCredentials;
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Utc};
use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::io::Write;

/// Build the SAML AuthnRequest URL for Azure AD login.
pub fn build_saml_login_url(tenant_id: &str, app_id_uri: &str) -> Result<String> {
    let request_id = format!("_{}", uuid::Uuid::new_v4());
    let instant = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let saml_request = format!(
        r#"<samlp:AuthnRequest xmlns="urn:oasis:names:tc:SAML:2.0:metadata" ID="{id}" Version="2.0" IssueInstant="{instant}" IsPassive="false" AssertionConsumerServiceURL="{app_id}" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">{app_id}</Issuer><samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"/></samlp:AuthnRequest>"#,
        id = request_id,
        instant = instant,
        app_id = app_id_uri,
    );

    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(saml_request.as_bytes())
        .context("Failed to deflate SAML request")?;
    let compressed = encoder.finish().context("Failed to finish deflation")?;
    let encoded = BASE64.encode(&compressed);
    let url_encoded = urlencoding::encode(&encoded);

    Ok(format!(
        "https://login.microsoftonline.com/{tenant_id}/saml2?SAMLRequest={url_encoded}"
    ))
}

/// Parse IAM roles from a base64-encoded SAML response.
/// Returns Vec<(role_arn, principal_arn)>.
pub fn parse_saml_roles(saml_response_b64: &str) -> Result<Vec<(String, String)>> {
    let decoded = BASE64
        .decode(saml_response_b64)
        .context("Invalid base64 in SAML response")?;
    let xml = String::from_utf8(decoded).context("Invalid UTF-8 in SAML response")?;

    let mut roles = Vec::new();
    for line in xml.lines() {
        let trimmed = line.trim();
        if trimmed.contains("arn:aws:iam::")
            && trimmed.contains(":role/")
            && trimmed.contains(":saml-provider/")
        {
            if let Some(start) = trimmed.find('>') {
                if let Some(end) = trimmed[start + 1..].find('<') {
                    let value = &trimmed[start + 1..start + 1 + end];
                    let parts: Vec<&str> = value.split(',').collect();
                    if parts.len() == 2 {
                        let (role_arn, principal_arn) = if parts[0].contains(":role/") {
                            (parts[0].to_string(), parts[1].to_string())
                        } else {
                            (parts[1].to_string(), parts[0].to_string())
                        };
                        roles.push((role_arn, principal_arn));
                    }
                }
            }
        }
    }
    Ok(roles)
}

/// Assume an AWS role using a SAML assertion via STS.
pub async fn assume_role_with_saml(
    saml_response: &str,
    role_arn: &str,
    principal_arn: &str,
    duration_hours: u32,
    region: &str,
) -> Result<AwsCredentials> {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .no_credentials()
        .load()
        .await;

    let sts_client = aws_sdk_sts::Client::new(&config);

    let resp = sts_client
        .assume_role_with_saml()
        .role_arn(role_arn)
        .principal_arn(principal_arn)
        .saml_assertion(saml_response)
        .duration_seconds((duration_hours * 3600) as i32)
        .send()
        .await
        .context("STS AssumeRoleWithSAML failed")?;

    let creds = resp
        .credentials()
        .context("No credentials in STS response")?;

    let expiration = creds.expiration();
    let expires_at = DateTime::<Utc>::from_timestamp(expiration.secs(), expiration.subsec_nanos());

    Ok(AwsCredentials {
        access_key_id: creds.access_key_id().to_string(),
        secret_access_key: creds.secret_access_key().to_string(),
        session_token: Some(creds.session_token().to_string()),
        region: region.to_string(),
        expires_at,
    })
}
