//! Azure AD SAML authentication module for AWS federated access.
//!
//! This module implements the SAML 2.0 authentication flow with Azure AD:
//! 1. Generate SAML AuthnRequest and redirect user to Azure AD login
//! 2. Capture SAML response after successful authentication
//! 3. Exchange SAML assertion for AWS temporary credentials via STS AssumeRoleWithSAML

use std::io::Write;
use std::time::{Duration, SystemTime};

use aws_config::BehaviorVersion;
use aws_credential_types::Credentials as AwsCredentials;
use aws_sdk_sts::Client as StsClient;
use aws_types::region::Region;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use flate2::write::DeflateEncoder;
use flate2::Compression;
use quick_xml::events::Event;
use quick_xml::Reader;
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::types::AzureAdSamlConfig;

/// AWS SAML endpoints
const AWS_SAML_ENDPOINT: &str = "https://signin.aws.amazon.com/saml";
const AWS_SAML_GOVCLOUD_ENDPOINT: &str = "https://signin.amazonaws-us-gov.com/saml";
const AWS_SAML_CHINA_ENDPOINT: &str = "https://signin.amazonaws.cn/saml";

/// Azure AD login endpoint template
const AZURE_AD_SAML_URL_TEMPLATE: &str = "https://login.microsoftonline.com/{tenant_id}/saml2";

/// Role/Principal pair parsed from SAML response
#[derive(Debug, Clone)]
pub struct SamlRole {
    pub role_arn: String,
    pub principal_arn: String,
}

/// Result of SAML authentication flow
#[derive(Debug, Clone)]
pub struct SamlAuthResult {
    pub credentials: AwsCredentials,
    pub role_arn: String,
    pub expiration: Option<SystemTime>,
}

/// Generate Azure AD SAML login URL with encoded SAML AuthnRequest
pub fn create_saml_login_url(config: &AzureAdSamlConfig) -> Result<String> {
    let request_id = format!("_qp_{}", Uuid::new_v4().to_string().replace('-', ""));
    let issue_instant = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    // Determine AWS SAML endpoint based on app_id_uri
    let assertion_consumer_service_url = if config.app_id_uri.contains("amazonaws-us-gov") {
        AWS_SAML_GOVCLOUD_ENDPOINT
    } else if config.app_id_uri.contains("amazonaws.cn") {
        AWS_SAML_CHINA_ENDPOINT
    } else {
        AWS_SAML_ENDPOINT
    };

    // Build SAML AuthnRequest XML
    let saml_request = format!(
        r#"<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="{request_id}" Version="2.0" IssueInstant="{issue_instant}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" AssertionConsumerServiceURL="{assertion_consumer_service_url}"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">{app_id_uri}</saml:Issuer><samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"/></samlp:AuthnRequest>"#,
        request_id = request_id,
        issue_instant = issue_instant,
        assertion_consumer_service_url = assertion_consumer_service_url,
        app_id_uri = config.app_id_uri
    );

    // Deflate (zlib) the SAML request
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(saml_request.as_bytes())
        .map_err(|e| AppError::Internal(format!("Failed to deflate SAML request: {e}")))?;
    let deflated = encoder
        .finish()
        .map_err(|e| AppError::Internal(format!("Failed to finish deflate: {e}")))?;

    // Base64 encode
    let encoded = BASE64_STANDARD.encode(&deflated);

    // URL encode
    let url_encoded = urlencoding::encode(&encoded);

    // Build Azure AD login URL
    let login_url = format!(
        "{}?SAMLRequest={}",
        AZURE_AD_SAML_URL_TEMPLATE.replace("{tenant_id}", &config.tenant_id),
        url_encoded
    );

    Ok(login_url)
}

/// Parse roles from SAML response
/// The SAML assertion contains AWS role ARNs in the format:
/// arn:aws:iam::ACCOUNT:role/ROLENAME,arn:aws:iam::ACCOUNT:saml-provider/PROVIDERNAME
pub fn parse_saml_roles(saml_response: &str) -> Result<Vec<SamlRole>> {
    // Decode base64 SAML response
    let decoded = BASE64_STANDARD
        .decode(saml_response)
        .map_err(|e| AppError::Internal(format!("Failed to decode SAML response: {e}")))?;

    let xml = String::from_utf8(decoded)
        .map_err(|e| AppError::Internal(format!("Invalid UTF-8 in SAML response: {e}")))?;

    let mut roles = Vec::new();
    let mut reader = Reader::from_str(&xml);

    let mut in_role_attribute = false;
    let mut capture_value = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = e.local_name();
                if name.as_ref() == b"Attribute" {
                    // Check if this is the Role attribute
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"Name" {
                            let value = attr.unescape_value().unwrap_or_default();
                            if value.contains("SAML/Attributes/Role") {
                                in_role_attribute = true;
                            }
                        }
                    }
                } else if name.as_ref() == b"AttributeValue" && in_role_attribute {
                    capture_value = true;
                }
            }
            Ok(Event::Text(e)) => {
                if capture_value {
                    let text = e
                        .unescape()
                        .map_err(|err| AppError::Internal(format!("XML unescape error: {err}")))?
                        .to_string();
                    // Parse role/principal pair: "roleArn,principalArn"
                    if let Some((role_arn, principal_arn)) = parse_role_principal_pair(&text) {
                        roles.push(SamlRole {
                            role_arn,
                            principal_arn,
                        });
                    }
                    capture_value = false;
                }
            }
            Ok(Event::End(e)) => {
                if e.local_name().as_ref() == b"Attribute" {
                    in_role_attribute = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::Internal(format!("Error parsing SAML XML: {e}")));
            }
            _ => {}
        }
    }

    if roles.is_empty() {
        return Err(AppError::Internal(
            "No AWS roles found in SAML response. Check your Azure AD SAML configuration.".into(),
        ));
    }

    Ok(roles)
}

/// Parse a role/principal pair from SAML attribute value
/// Format: "arn:aws:iam::123456789012:role/MyRole,arn:aws:iam::123456789012:saml-provider/MyProvider"
fn parse_role_principal_pair(value: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = value.split(',').collect();
    if parts.len() != 2 {
        return None;
    }

    let (first, second) = (parts[0].trim(), parts[1].trim());

    // Determine which is role and which is principal
    if first.contains(":role/") && second.contains(":saml-provider/") {
        Some((first.to_string(), second.to_string()))
    } else if second.contains(":role/") && first.contains(":saml-provider/") {
        Some((second.to_string(), first.to_string()))
    } else {
        None
    }
}

/// Exchange SAML assertion for AWS temporary credentials via STS AssumeRoleWithSAML
pub async fn assume_role_with_saml(
    saml_assertion: &str,
    role: &SamlRole,
    duration_hours: u8,
    region: &str,
) -> Result<SamlAuthResult> {
    // Validate duration (1-12 hours)
    let duration_hours = duration_hours.clamp(1, 12);
    let duration_seconds = (duration_hours as i32) * 60 * 60;

    // Create STS client without credentials (SAML doesn't need pre-existing creds)
    let config = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(region.to_string()))
        .no_credentials()
        .load()
        .await;

    let sts = StsClient::new(&config);

    let response = sts
        .assume_role_with_saml()
        .principal_arn(&role.principal_arn)
        .role_arn(&role.role_arn)
        .saml_assertion(saml_assertion)
        .duration_seconds(duration_seconds)
        .send()
        .await
        .map_err(|e| AppError::SshAuthFailed(format!("STS AssumeRoleWithSAML failed: {e}")))?;

    let sts_credentials = response
        .credentials()
        .ok_or_else(|| AppError::SshAuthFailed("STS response missing credentials".into()))?;

    let access_key = sts_credentials.access_key_id().to_string();
    let secret_key = sts_credentials.secret_access_key().to_string();
    let session_token = sts_credentials.session_token();
    let session_token_opt = if session_token.is_empty() {
        None
    } else {
        Some(session_token.to_string())
    };

    let expiration_dt = sts_credentials.expiration();
    let expiration = if expiration_dt.secs() >= 0 {
        let secs = expiration_dt.secs() as u64;
        let nanos = expiration_dt.subsec_nanos() as u64;
        Some(SystemTime::UNIX_EPOCH + Duration::from_secs(secs) + Duration::from_nanos(nanos))
    } else {
        None
    };

    let credentials = AwsCredentials::new(
        access_key,
        secret_key,
        session_token_opt,
        expiration,
        "assume-role-with-saml",
    );

    Ok(SamlAuthResult {
        credentials,
        role_arn: role.role_arn.clone(),
        expiration,
    })
}

/// Get the AWS SAML endpoint URL for intercepting navigation
pub fn get_aws_saml_endpoints() -> Vec<&'static str> {
    vec![
        AWS_SAML_ENDPOINT,
        AWS_SAML_GOVCLOUD_ENDPOINT,
        AWS_SAML_CHINA_ENDPOINT,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_role_principal_pair() {
        let value = "arn:aws:iam::123456789012:role/MyRole,arn:aws:iam::123456789012:saml-provider/MyProvider";
        let result = parse_role_principal_pair(value);
        assert!(result.is_some());
        let (role, principal) = result.unwrap();
        assert_eq!(role, "arn:aws:iam::123456789012:role/MyRole");
        assert_eq!(
            principal,
            "arn:aws:iam::123456789012:saml-provider/MyProvider"
        );
    }

    #[test]
    fn test_parse_role_principal_pair_reversed() {
        let value = "arn:aws:iam::123456789012:saml-provider/MyProvider,arn:aws:iam::123456789012:role/MyRole";
        let result = parse_role_principal_pair(value);
        assert!(result.is_some());
        let (role, principal) = result.unwrap();
        assert_eq!(role, "arn:aws:iam::123456789012:role/MyRole");
        assert_eq!(
            principal,
            "arn:aws:iam::123456789012:saml-provider/MyProvider"
        );
    }

    #[test]
    fn test_create_saml_login_url() {
        let config = AzureAdSamlConfig {
            tenant_id: "test-tenant-id".to_string(),
            app_id_uri: "https://signin.aws.amazon.com/saml".to_string(),
            default_role_arn: None,
            duration_hours: Some(1),
        };

        let url = create_saml_login_url(&config).unwrap();
        assert!(
            url.starts_with("https://login.microsoftonline.com/test-tenant-id/saml2?SAMLRequest=")
        );
    }
}
