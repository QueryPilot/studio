use std::fs; // needed for reset_vault_vault
use std::sync::{Arc, LazyLock};
use std::time::Instant;

// Precompiled regexes for SQL parsing (compiled once at startup)
static LIMIT_REGEX: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i)\bLIMIT\s+(\d+)").expect("LIMIT regex is valid"));
static BLOCK_COMMENT_REGEX: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"/\*.*?\*/").expect("block comment regex is valid"));
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

use crate::core::ConnectionManager;
use crate::ssh;
use crate::state::AppState;
use crate::types::*;
use serde::Serialize;
use serde_json::Value as JsonValue;
use tokio_postgres::Row;

/// Extract clean error message from PostgreSQL error
fn extract_db_error_message(e: &tokio_postgres::Error) -> String {
    // Try to get the DbError with the message
    if let Some(db_err) = e.as_db_error() {
        // Return just the message, optionally with detail/hint
        let mut msg = db_err.message().to_string();

        if let Some(detail) = db_err.detail() {
            msg.push_str(&format!("\nDetail: {}", detail));
        }

        if let Some(hint) = db_err.hint() {
            msg.push_str(&format!("\nHint: {}", hint));
        }

        // Add helpful hint for multiple commands error
        if msg.contains("cannot insert multiple commands into a prepared statement") {
            msg.push_str("\n\nTip: To execute multiple statements:");
            msg.push_str("\n  • Place your cursor on one statement and press Cmd/Ctrl+Enter");
            msg.push_str("\n  • Or execute them one at a time");
        }

        return msg;
    }

    // Fallback to Display format for non-DB errors
    e.to_string()
}

/// Cancel a running PostgreSQL query by backend PID
/// Spawns a background task to avoid blocking the current operation
fn spawn_cancel_backend_query(pool: deadpool_postgres::Pool, backend_pid: i32) {
    tokio::spawn(async move {
        if let Ok(cancel_conn) = pool.get().await {
            let cancel_sql = format!("SELECT pg_cancel_backend({})", backend_pid);
            match cancel_conn.execute(&cancel_sql, &[]).await {
                Ok(_) => tracing::info!("  ✅ Successfully cancelled backend query (PID: {})", backend_pid),
                Err(e) => tracing::warn!("  ⚠️  Failed to cancel backend PID {}: {}", backend_pid, e),
            }
        }
    });
}

#[derive(Serialize)]
pub struct SshTestResult {
    pub success: bool,
    pub latency_ms: u64,
}

#[tauri::command]
pub async fn connect(
    profile: ConnectionProfile,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionInfo, String> {
    let conn_id = manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ConnectionInfo {
        id: conn_id,
        db_type: profile.db_type,
        database: profile.database,
        version: None,
    })
}

#[tauri::command]
pub async fn test_ssh_connection(
    config: SshTunnelConfig,
    app_state: State<'_, AppState>,
) -> std::result::Result<SshTestResult, String> {
    if !app_state
        .ssh_test_rate_limiter
        .check_rate_limit(&config.host)
        .await
    {
        return Err("Too many SSH test attempts. Please wait before trying again.".to_string());
    }

    let start = Instant::now();
    let verify_future = ssh::verify_connection(&config);

    timeout(Duration::from_secs(10), verify_future)
        .await
        .map_err(|_| "SSH connection test timed out after 10 seconds".to_string())?
        .map_err(|e| e.to_string())?;

    Ok(SshTestResult {
        success: true,
        latency_ms: start.elapsed().as_millis() as u64,
    })
}

#[derive(Serialize)]
pub struct OAuthTokenStatus {
    pub has_token: bool,
    pub provider: String,
}

#[tauri::command]
pub async fn start_oauth_flow(provider: OAuthProvider) -> std::result::Result<String, String> {
    // TODO: Implement device code flow
    // For now, return instruction message
    let provider_name = match &provider {
        OAuthProvider::Microsoft => "Microsoft Entra ID",
        OAuthProvider::Google => "Google",
        OAuthProvider::Okta => "Okta",
        OAuthProvider::Auth0 => "Auth0",
        OAuthProvider::Keycloak => "Keycloak",
        OAuthProvider::Generic { name, .. } => name.as_str(),
    };

    Ok(format!(
        "OAuth flow for {} is not yet implemented. Please configure via AWS CLI for now.",
        provider_name
    ))
}

#[tauri::command]
pub async fn get_oauth_token_status(
    provider: OAuthProvider,
) -> std::result::Result<OAuthTokenStatus, String> {
    use crate::aws::oauth;

    let has_token = oauth::get_oauth_token(&provider)
        .await
        .map_err(|e| e.to_string())?
        .is_some();

    let provider_name = match &provider {
        OAuthProvider::Microsoft => "Microsoft",
        OAuthProvider::Google => "Google",
        OAuthProvider::Okta => "Okta",
        OAuthProvider::Auth0 => "Auth0",
        OAuthProvider::Keycloak => "Keycloak",
        OAuthProvider::Generic { name, .. } => name.as_str(),
    };

    Ok(OAuthTokenStatus {
        has_token,
        provider: provider_name.to_string(),
    })
}

#[tauri::command]
pub async fn clear_oauth_token(provider: OAuthProvider) -> std::result::Result<(), String> {
    use crate::aws::oauth;

    oauth::delete_oauth_token(&provider)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// AZURE AD SAML AUTHENTICATION COMMANDS
// ============================================================================

/// Generate Azure AD SAML login URL for federated AWS authentication
#[tauri::command]
pub fn get_azure_ad_login_url(config: AzureAdSamlConfig) -> std::result::Result<String, String> {
    use crate::aws::saml;
    saml::create_saml_login_url(&config).map_err(|e| e.to_string())
}

/// Get AWS SAML endpoints for navigation interception
#[tauri::command]
pub fn get_aws_saml_endpoints() -> Vec<String> {
    use crate::aws::saml;
    saml::get_aws_saml_endpoints()
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[derive(Serialize)]
pub struct SamlRoleInfo {
    pub role_arn: String,
    pub principal_arn: String,
    pub account_id: String,
    pub role_name: String,
}

/// Parse SAML response to extract available AWS roles
#[tauri::command]
pub fn parse_saml_roles(saml_response: String) -> std::result::Result<Vec<SamlRoleInfo>, String> {
    use crate::aws::saml;

    let roles = saml::parse_saml_roles(&saml_response).map_err(|e| e.to_string())?;

    Ok(roles
        .into_iter()
        .map(|r| {
            // Extract account ID and role name from ARN
            // Format: arn:aws:iam::123456789012:role/RoleName
            let parts: Vec<&str> = r.role_arn.split(':').collect();
            let account_id = parts.get(4).unwrap_or(&"").to_string();
            let role_name = r.role_arn.split('/').last().unwrap_or("").to_string();

            SamlRoleInfo {
                role_arn: r.role_arn,
                principal_arn: r.principal_arn,
                account_id,
                role_name,
            }
        })
        .collect())
}

#[derive(Serialize)]
pub struct SamlCredentialsResult {
    pub access_key_id: String,
    pub expiration_secs: Option<u64>,
    pub role_arn: String,
}

/// Exchange SAML assertion for AWS credentials via STS AssumeRoleWithSAML
#[tauri::command]
pub async fn assume_role_with_saml(
    saml_response: String,
    role_arn: String,
    principal_arn: String,
    duration_hours: Option<u8>,
    region: String,
    connection_id: String,
) -> std::result::Result<SamlCredentialsResult, String> {
    use crate::aws::{credentials, saml};

    let role = saml::SamlRole {
        role_arn: role_arn.clone(),
        principal_arn,
    };

    let duration = duration_hours.unwrap_or(1);

    let result = saml::assume_role_with_saml(&saml_response, &role, duration, &region)
        .await
        .map_err(|e| e.to_string())?;

    // Cache credentials for this connection
    let cached = credentials::CachedCredentials::from_aws_credentials(
        &result.credentials,
        result.role_arn.clone(),
        region,
        result.expiration,
    );

    credentials::store_credentials(&connection_id, &cached)
        .await
        .map_err(|e| e.to_string())?;

    Ok(SamlCredentialsResult {
        access_key_id: cached.access_key_id,
        expiration_secs: cached.expiration_secs,
        role_arn: result.role_arn,
    })
}

#[derive(Serialize)]
pub struct CredentialsStatus {
    pub has_credentials: bool,
    pub is_valid: bool,
    pub expiration_secs: Option<u64>,
    pub seconds_until_expiration: Option<i64>,
    pub role_arn: Option<String>,
}

/// Check if valid AWS credentials exist for a connection
#[tauri::command]
pub async fn get_aws_credentials_status(
    connection_id: String,
) -> std::result::Result<CredentialsStatus, String> {
    use crate::aws::credentials;

    match credentials::get_credentials(&connection_id).await {
        Ok(Some(creds)) => {
            let is_valid = !creds.is_expired_or_expiring();
            Ok(CredentialsStatus {
                has_credentials: true,
                is_valid,
                expiration_secs: creds.expiration_secs,
                seconds_until_expiration: creds.seconds_until_expiration(),
                role_arn: Some(creds.role_arn),
            })
        }
        Ok(None) => Ok(CredentialsStatus {
            has_credentials: false,
            is_valid: false,
            expiration_secs: None,
            seconds_until_expiration: None,
            role_arn: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

/// Clear cached AWS credentials for a connection
#[tauri::command]
pub async fn clear_aws_credentials(connection_id: String) -> std::result::Result<(), String> {
    use crate::aws::credentials;
    credentials::delete_credentials(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// JavaScript to inject into SAML auth window for intercepting form submissions
/// NOTE: window.__TAURI__ is NOT available on external URLs, so we use URL navigation
/// to pass the SAML response back to the Rust side via on_navigation callback.
const SAML_INTERCEPT_SCRIPT: &str = r#"
(function() {
    // AWS SAML endpoints to intercept
    const AWS_SAML_ENDPOINTS = [
        'https://signin.aws.amazon.com/saml',
        'https://signin.amazonaws-us-gov.com/saml',
        'https://signin.amazonaws.cn/saml'
    ];

    // Check if URL is an AWS SAML endpoint
    function isAwsSamlEndpoint(url) {
        return AWS_SAML_ENDPOINTS.some(endpoint => url.startsWith(endpoint));
    }

    // Send SAML response via custom URL navigation (works without Tauri IPC)
    function sendSamlResponse(samlResponse, relayState) {
        console.log('[SAML] Captured response, redirecting to callback URL');
        // URL-encode the base64 SAML response (it may contain + and / characters)
        const encoded = encodeURIComponent(samlResponse);
        const relay = encodeURIComponent(relayState || '');
        // Navigate to custom scheme URL - Rust intercepts this in on_navigation
        // The querypilot:// scheme is registered via tauri-plugin-deep-link
        window.location.href = 'querypilot://saml/callback?response=' + encoded + '&relay=' + relay;
    }

    // Override form.submit() IMMEDIATELY before any scripts run
    const originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
        const action = this.action || window.location.href;
        if (isAwsSamlEndpoint(action)) {
            const samlInput = this.querySelector('input[name="SAMLResponse"]');
            const relayStateInput = this.querySelector('input[name="RelayState"]');

            if (samlInput && samlInput.value) {
                console.log('[SAML] Intercepted form.submit() to AWS endpoint');
                sendSamlResponse(samlInput.value, relayStateInput ? relayStateInput.value : '');
                return; // Don't call original submit
            }
        }
        return originalSubmit.call(this);
    };

    // Also watch for forms via MutationObserver (catches dynamically added forms)
    const observer = new MutationObserver(function(mutations) {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if the added node is a form or contains forms
                    const forms = node.tagName === 'FORM' ? [node] : node.querySelectorAll ? node.querySelectorAll('form') : [];
                    for (const form of forms) {
                        const action = form.action || '';
                        if (isAwsSamlEndpoint(action)) {
                            const samlInput = form.querySelector('input[name="SAMLResponse"]');
                            if (samlInput && samlInput.value) {
                                console.log('[SAML] Found SAML form via MutationObserver');
                                const relayStateInput = form.querySelector('input[name="RelayState"]');
                                sendSamlResponse(samlInput.value, relayStateInput ? relayStateInput.value : '');
                                return;
                            }
                        }
                    }
                }
            }
        }
    });

    // Start observing as soon as possible
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    // Intercept form submissions via event listener
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form.tagName !== 'FORM') return;

        const action = form.action || window.location.href;
        if (!isAwsSamlEndpoint(action)) return;

        const samlInput = form.querySelector('input[name="SAMLResponse"]');
        const relayStateInput = form.querySelector('input[name="RelayState"]');

        if (samlInput && samlInput.value) {
            console.log('[SAML] Intercepted submit event to AWS endpoint');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            sendSamlResponse(samlInput.value, relayStateInput ? relayStateInput.value : '');
            return false;
        }
    }, true); // Use capture phase to catch it first

    // Check if there's already a SAML form on the page (in case script loads after form)
    document.addEventListener('DOMContentLoaded', function() {
        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            const action = form.action || '';
            if (isAwsSamlEndpoint(action)) {
                const samlInput = form.querySelector('input[name="SAMLResponse"]');
                if (samlInput && samlInput.value) {
                    console.log('[SAML] Found existing SAML form on DOMContentLoaded');
                    const relayStateInput = form.querySelector('input[name="RelayState"]');
                    sendSamlResponse(samlInput.value, relayStateInput ? relayStateInput.value : '');
                    return;
                }
            }
        }
    });

    console.log('[SAML] Intercept script loaded and ready');
})();
"#;

/// Open a SAML authentication window and capture the SAML response
///
/// This command creates a webview window that:
/// 1. Navigates to the Azure AD login URL
/// 2. Injects JavaScript to intercept form submissions to AWS SAML endpoints
/// 3. Captures the SAMLResponse via custom URL scheme (devdb-saml://callback)
/// 4. Emits the response via Tauri events
#[tauri::command]
pub async fn open_saml_auth_window(
    app: AppHandle,
    config: AzureAdSamlConfig,
) -> std::result::Result<(), String> {
    use crate::aws::saml;
    use oauth2::url::Url;
    use tauri::Emitter;
    use tauri::WebviewUrl;
    use tauri::WebviewWindowBuilder;

    tracing::info!("[SAML] Opening auth window for Azure AD");

    // Generate Azure AD login URL
    let login_url = saml::create_saml_login_url(&config).map_err(|e| e.to_string())?;
    tracing::info!("[SAML] Generated login URL");

    // Create unique window label
    let window_label = format!(
        "saml-auth-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    // Parse the URL
    let url: Url = login_url
        .parse()
        .map_err(|e: oauth2::url::ParseError| e.to_string())?;

    // Create the webview window with SAML interception
    // Note: Must run in blocking context due to Windows WebView2 requirements
    let handle = app.clone();
    let label_for_close = window_label.clone();

    tokio::task::spawn_blocking(move || {
        let handle_for_nav = handle.clone();
        let label_for_nav = label_for_close.clone();

        WebviewWindowBuilder::new(&handle, &label_for_close, WebviewUrl::External(url))
            .title("Azure AD Sign In")
            .inner_size(500.0, 700.0)
            .center()
            .resizable(true)
            .minimizable(false)
            .maximizable(false)
            .closable(true)
            .focused(true)
            // Inject the SAML interception script
            .initialization_script(SAML_INTERCEPT_SCRIPT)
            // Intercept navigation to capture SAML callback
            .on_navigation(move |nav_url| {
                let url_str = nav_url.as_str();

                // Check for our SAML callback URL (custom scheme registered via deep-link plugin)
                if url_str.starts_with("querypilot://saml/callback") {
                    tracing::info!("[SAML] Intercepted callback URL");

                    // Parse the SAML response from URL query params
                    if let Ok(parsed) = oauth2::url::Url::parse(url_str) {
                        let mut saml_response: Option<String> = None;
                        let mut relay_state: Option<String> = None;

                        for (key, value) in parsed.query_pairs() {
                            match key.as_ref() {
                                "response" => saml_response = Some(value.to_string()),
                                "relay" => relay_state = Some(value.to_string()),
                                _ => {}
                            }
                        }

                        if let Some(response) = saml_response {
                            tracing::info!("[SAML] Extracted SAML response, emitting event");

                            // Emit the SAML response event
                            let payload = serde_json::json!({
                                "samlResponse": response,
                                "relayState": relay_state.unwrap_or_default()
                            });

                            if let Err(e) = handle_for_nav.emit("saml-response-captured", payload) {
                                tracing::error!("[SAML] Failed to emit event: {}", e);
                            }

                            // Close the auth window
                            if let Some(window) = handle_for_nav.get_webview_window(&label_for_nav)
                            {
                                let _ = window.close();
                            }
                        }
                    }

                    // Block navigation to the custom URL
                    return false;
                }

                // Allow all other navigation (Azure AD login flow)
                true
            })
            .build()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
    .map(|_| {
        tracing::info!("[SAML] Auth window opened successfully");
    })
}

#[tauri::command]
pub async fn disconnect(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    manager
        .disconnect(&conn_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn switch_database(
    conn_id: String,
    new_database: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    tracing::info!(
        "Switching connection {} to database: {}",
        conn_id,
        new_database
    );

    // Get current connection profile
    let mut profile = manager
        .get_stored_profile(&conn_id)
        .ok_or_else(|| format!("Connection {} not found", conn_id))?;

    // Disconnect current connection
    manager
        .disconnect(&conn_id)
        .await
        .map_err(|e| e.to_string())?;

    // Update profile with new database
    profile.database = new_database.clone();

    // Reconnect with new database
    manager
        .get_or_create_connection(&profile)
        .await
        .map_err(|e| e.to_string())?;

    // Verify we're connected to the correct database
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found after reconnect".to_string())?;

    let result = conn
        .adapter
        .query("SELECT current_database()")
        .await
        .map_err(|e| e.to_string())?;

    if let Some(row) = result.rows.first() {
        if let Some(cell) = row.first() {
            let current_db = cell.to_string();
            if current_db != new_database {
                return Err(format!(
                    "Database verification failed: expected {}, got {}",
                    new_database, current_db
                ));
            }
        }
    }

    tracing::info!("Successfully switched to database: {}", new_database);
    Ok(())
}

#[tauri::command]
pub async fn disconnect_all(
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    manager.disconnect_all().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionTestResult, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    conn.adapter
        .test_connection()
        .await
        .map_err(|e| e.to_string())
}

// NOTE: Introspection commands (get_databases, get_schemas, get_tables, etc.) have been
// removed. The frontend now uses IntrospectionService which generates dialect-specific SQL
// and executes via the `query` command. See: src/services/introspectionService.ts

#[derive(Debug, Serialize)]
pub struct TypeInfo {
    pub type_name: String,
    pub type_category: String,
    pub enum_values: Option<Vec<String>>,
    pub base_type: Option<String>,
}

/// Validate PostgreSQL identifier to prevent SQL injection
/// Valid identifiers: alphanumeric, underscore, dollar sign, starting with letter or underscore
fn is_valid_pg_identifier(s: &str) -> bool {
    if s.is_empty() || s.len() > 128 {
        return false;
    }
    let first = s.chars().next().unwrap();
    if !first.is_ascii_alphabetic() && first != '_' {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

#[tauri::command]
pub async fn get_type_info(
    conn_id: String,
    type_name: String,
    schema: Option<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TypeInfo, String> {
    // Validate inputs to prevent SQL injection
    if !is_valid_pg_identifier(&type_name) {
        return Err(format!("Invalid type name: {}", type_name));
    }
    let schema = schema.unwrap_or_else(|| "public".to_string());
    if !is_valid_pg_identifier(&schema) {
        return Err(format!("Invalid schema name: {}", schema));
    }

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    // For PostgreSQL, query type information
    if matches!(conn.profile.db_type, DbType::PostgreSQL) {
        // Safe to use format! after validation - identifiers are alphanumeric only
        let query_sql = format!(
            "SELECT \
                t.typname as type_name, \
                t.typtype as type_category, \
                CASE WHEN t.typtype = 'e' THEN ( \
                    SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) \
                    FROM pg_enum e WHERE e.enumtypid = t.oid \
                ) ELSE NULL END as enum_values, \
                CASE WHEN t.typtype = 'd' THEN \
                    pg_catalog.format_type(t.typbasetype, t.typtypmod) \
                ELSE NULL END as base_type \
            FROM pg_type t \
            JOIN pg_namespace n ON t.typnamespace = n.oid \
            WHERE t.typname = '{}' AND n.nspname = '{}'",
            type_name, schema
        );

        // Use direct query instead of cursor
        let result = conn
            .adapter
            .query(&query_sql)
            .await
            .map_err(|e| e.to_string())?;

        if result.rows.is_empty() {
            return Err(format!(
                "Type '{}' not found in schema '{}'",
                type_name, schema
            ));
        }

        let row = &result.rows[0];
        let type_category = if let Some(cat_value) = &row.get(1).and_then(|v| {
            let s = v.to_string();
            if !s.is_empty() {
                s.chars().next()
            } else {
                None
            }
        }) {
            match cat_value {
                'e' => "enum",
                'd' => "domain",
                'c' => "composite",
                'b' => "base",
                'r' => "range",
                'm' => "multirange",
                _ => "unknown",
            }
        } else {
            "unknown"
        };

        let enum_values = row.get(2).and_then(|v| {
            let s = v.to_string();
            if !s.is_empty() {
                Some(s.split(',').map(|s| s.to_string()).collect())
            } else {
                None
            }
        });

        let base_type = row.get(3).map(|v| v.to_string());

        Ok(TypeInfo {
            type_name: type_name.clone(),
            type_category: type_category.to_string(),
            enum_values,
            base_type,
        })
    } else {
        Err("get_type_info is only supported for PostgreSQL".to_string())
    }
}

/// Execute a SQL query and return results (for introspection queries)
/// This is a simpler alternative to stream_query for small result sets
#[tauri::command]
pub async fn query(
    conn_id: String,
    sql: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<crate::types::QueryResult, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    conn.adapter.query(&sql).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection_health(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<ConnectionHealth, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    // Test the connection
    let test_result = conn
        .adapter
        .test_connection()
        .await
        .map_err(|e| e.to_string())?;

    Ok(ConnectionHealth {
        connection_id: conn_id,
        status: if test_result.success {
            "ready".to_string()
        } else {
            "error".to_string()
        },
        healthy: test_result.success,
        rtt_ms: None,
        error: if !test_result.success {
            Some(test_result.message)
        } else {
            None
        },
    })
}

#[tauri::command]
pub async fn ping(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<u64, String> {
    use std::time::Instant;

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;

    let start = Instant::now();
    let is_connected = conn.adapter.is_connected().await;
    let elapsed = start.elapsed().as_millis() as u64;

    if is_connected {
        Ok(elapsed)
    } else {
        Err("Connection is not active".to_string())
    }
}

/// Extract LIMIT value from SQL query (simple regex-based parser)
fn extract_limit_from_sql(sql: &str) -> Option<usize> {
    // Use precompiled LIMIT_REGEX for performance
    let caps = LIMIT_REGEX.captures(sql)?;
    caps.get(1)?.as_str().parse::<usize>().ok()
}

/// Check if SQL query is a SELECT statement (or returns rows like EXPLAIN)
fn is_select_query(sql: &str) -> bool {
    // Trim whitespace and comments, get first significant SQL keyword
    let trimmed = sql.trim();

    // Remove leading comments (-- and /* */)
    let without_comments = trimmed
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");

    // Remove block comments (use precompiled regex for performance)
    let cleaned = BLOCK_COMMENT_REGEX.replace_all(&without_comments, "");

    // Get first word (ignoring WITH for CTEs)
    let first_keyword = cleaned
        .trim()
        .split_whitespace()
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .to_uppercase();

    // Check if it's a SELECT or starts with WITH (CTE that typically ends in SELECT)
        matches!(
        first_keyword.as_str(),
        "SELECT" | "WITH" | "EXPLAIN" | "TABLE" | "VALUES" | "SHOW"
    )
}

/// Execute query with TRUE streaming (rows arrive as they're fetched from PostgreSQL)
/// Check if SQL contains multiple statements (simple heuristic)
fn is_multi_statement_query(sql: &str) -> bool {
    // Count semicolons that are likely statement terminators
    // This is a simple check - ignore semicolons in strings/comments for now
    let trimmed = sql.trim();

    // Check for transaction control keywords followed by semicolon
    let sql_upper = trimmed.to_uppercase();
    if sql_upper.contains("BEGIN;")
        || sql_upper.contains("COMMIT;")
        || sql_upper.contains("ROLLBACK;")
    {
        return true;
    }

    // Count semicolons (simple check - may have false positives but that's okay)
    let semicolon_count = trimmed.matches(';').count();

    // If there's more than one semicolon, or one semicolon not at the end, it's multi-statement
    if semicolon_count > 1 {
        return true;
    }

    if semicolon_count == 1 && !trimmed.trim_end().ends_with(';') {
        return true;
    }

    false
}

async fn execute_single_fetch_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    use futures::StreamExt;

    // Try to get FastPostgresQueryExecutor
    let executor = conn
        .adapter
        .as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
        .and_then(|adapter| adapter.get_query_executor())
        .ok_or_else(|| "Fast query executor not available".to_string())?;

    // Get pool for raw streaming
    let pool = executor.get_pool();

    // Check if this is a SELECT query (needs streaming) or mutation (needs execute)
    // Queries with RETURNING clause also return rows, so treat them like SELECT
    let is_select = is_select_query(sql);
    let has_returning = sql.to_uppercase().contains(" RETURNING ");

    // Get connection from pool FIRST
    let conn_start = std::time::Instant::now();
    let pool_conn = pool
        .get()
        .await
        .map_err(|e| format!("Failed to get connection from pool: {}", e))?;
    let conn_elapsed = conn_start.elapsed().as_millis();
    tracing::info!("  ⏱ Got connection from pool: {}ms", conn_elapsed);

    // Get backend PID for cancellation (query it since we're using pooled connections)
    let pid_row = pool_conn
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .map_err(|e| format!("Failed to get backend PID: {}", e))?;
    let backend_pid: i32 = pid_row.get(0);
    tracing::info!(
        "  🔍 Query running on PostgreSQL backend PID: {}",
        backend_pid
    );

    // Check if this is a multi-statement query (transactions, multiple commands)
    if is_multi_statement_query(sql) {
        tracing::info!("  🔀 Detected multi-statement query, using simple_query protocol");

        // Use simple_query for multi-statement support (no prepared statements)
        let simple_start = std::time::Instant::now();
        pool_conn.batch_execute(sql).await.map_err(|e| {
            tracing::error!("❌ batch_execute failed: {:?}", e);
            extract_db_error_message(&e)
        })?;
        let exec_elapsed = simple_start.elapsed().as_millis();
        tracing::info!("  ⏱ Executed multi-statement batch: {}ms", exec_elapsed);

        // For batch execution, we don't have row results to stream
        // Send empty column set and success message
        let _ = metadata_channel.send(StreamMessage::Started {
            columns: vec![],
            estimated_rows: Some(0),
        });

        let _ = metadata_channel.send(StreamMessage::Success {
            total_rows: 0,
            execution_time_ms: exec_elapsed as u64,
            cursor_setup_ms: None,
            total_streaming_ms: Some(exec_elapsed as u64),
            fetch_count: None,
            network_ms: Some(0),
            conversion_ms: Some(0),
            ipc_send_ms: Some(0),
        });

        return Ok(());
    }

    // For non-SELECT queries (UPDATE, INSERT, DELETE, etc.) without RETURNING,
    // use execute to get affected rows count. Queries with RETURNING need streaming.
    if !is_select && !has_returning {
        tracing::info!("  🔀 Non-SELECT query, using execute() for affected rows count");

        let exec_start = std::time::Instant::now();
        let rows_affected = pool_conn.execute(sql, &[]).await.map_err(|e| {
            tracing::error!("❌ execute failed: {:?}", e);
            extract_db_error_message(&e)
        })?;
        let exec_elapsed = exec_start.elapsed().as_millis();

        tracing::info!(
            "  ⏱ Executed mutation: {}ms, {} rows affected",
            exec_elapsed,
            rows_affected
        );

        // Send empty columns (no result set for mutations without RETURNING)
        let _ = metadata_channel.send(StreamMessage::Started {
            columns: vec![],
            estimated_rows: Some(rows_affected as i64),
        });

        let _ = metadata_channel.send(StreamMessage::Success {
            total_rows: rows_affected as usize,
            execution_time_ms: exec_elapsed as u64,
            cursor_setup_ms: None,
            total_streaming_ms: Some(exec_elapsed as u64),
            fetch_count: None,
            network_ms: Some(exec_elapsed as u64),
            conversion_ms: Some(0),
            ipc_send_ms: Some(0),
        });

        return Ok(());
    }

    // PREPARE statement - this is where the slowness happens on remote connections!
    let prepare_start = std::time::Instant::now();
    let stmt = pool_conn.prepare(&sql).await.map_err(|e| {
        // Log the full error details for debugging
        tracing::error!("❌ PREPARE failed: {:?}", e);
        // Return clean error message
        extract_db_error_message(&e)
    })?;
    let prepare_elapsed = prepare_start.elapsed().as_millis();
    tracing::info!("  ⏱ PREPARE statement: {}ms ⚠️", prepare_elapsed);

    // Execute query with prepared statement
    // NOTE: Table name resolution removed for performance - was adding ~100-150ms overhead
    // Frontend can resolve table names lazily if needed via separate introspection
    let query_start = std::time::Instant::now();
    let row_stream = pool_conn
        .query_raw(&stmt, std::iter::empty::<i32>())
        .await
        .map_err(|e| {
            tracing::error!("❌ query_raw failed: {:?}", e);
            extract_db_error_message(&e)
        })?;
    let exec_elapsed = query_start.elapsed().as_millis();
    tracing::info!("  ⏱ Started query_raw: {}ms", exec_elapsed);

    let columns = stmt
        .columns()
        .iter()
        .map(|col| crate::types::ColumnMeta {
            name: col.name().to_string(),
            table_name: None, // Lazy resolution - avoids blocking pg_class query
            data_type: crate::adapters::postgres::types::PostgresTypeConverter::type_to_cell_type(
                col.type_(),
            ),
            nullable: true,
            primary_key: false,
            db_type: col.type_().name().to_string(),
            type_oid: Some(col.type_().oid()),
            default_value: None,
            comment: None,
            enum_values: None,
            type_category: None,
            precision: None,
            scale: None,
        })
        .collect::<Vec<_>>();

    // Send column metadata immediately
    let _ = metadata_channel.send(StreamMessage::Started {
        columns: columns.clone(),
        estimated_rows: None,
    });

    let mut row_stream = Box::pin(row_stream);

    tracing::info!("TRUE STREAMING: Query executing, rows will arrive progressively...");

    let mut total_rows = 0;
    let mut row_buffer: Vec<Row> = Vec::new(); // Row buffer for micro-batching
    let mut json_buffer: Vec<Vec<JsonValue>> = Vec::new(); // Converted rows ready for MsgPack
    // OPTIMIZATION: Use parallel converter + micro-batches for faster CPU-bound conversion

    // Incremental batch sizes: start small for instant feedback, then go big
    const FIRST_BATCH_SIZE: usize = 32; // Ultra-fast first render (~4ms IPC)
    const SECOND_BATCH_SIZE: usize = 512; // Quick second batch (~25ms IPC)
    const LARGE_BATCH_SIZE: usize = 3072; // Slightly larger to reduce batch count without big stalls
    const MICRO_BATCH_SIZE: usize = 256; // Parallel conversion chunk size

    let mut first_row_elapsed_ms: Option<u64> = None;

    // Performance tracking
    let mut conversion_time_ms = 0u64;
    let mut send_time_ms = 0u64;
    let mut send_count = 0usize;

    // Dynamic batch sizing - determines when to send based on rows seen
    let get_send_threshold = |rows_sent: usize| -> usize {
        if rows_sent == 0 {
            FIRST_BATCH_SIZE // First batch: 32 rows for instant feedback
        } else if rows_sent == FIRST_BATCH_SIZE {
            SECOND_BATCH_SIZE // Second batch: 512 rows
        } else {
            LARGE_BATCH_SIZE // Rest: 2048 rows for efficiency
        }
    };

    let mut rows_sent = 0usize;

    // Stream rows as they arrive from PostgreSQL
    // Track iterations for periodic cancellation checks (every 100 rows)
    let mut check_interval = 0u32;

    while let Some(row_result) = row_stream.next().await {
        // CRITICAL: Check for cancellation periodically (every 100 rows)
        // This ensures we detect cancellation even if no batches have been sent yet
        check_interval += 1;
        if check_interval % 100 == 0 {
            // Attempt to send to data channel - if it fails, user cancelled
            if data_channel
                .send(tauri::ipc::Response::new(vec![]))
                .is_err()
            {
                tracing::info!("  ⚠️  Channel closed during row fetch (user cancelled early)");
                tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
                spawn_cancel_backend_query(pool.clone(), backend_pid);

                let _ = metadata_channel.send(StreamMessage::Interrupted {
                    resumable: false,
                    message: "Query cancelled by user".to_string(),
                });
                return Err("Query cancelled by user".to_string());
            }
        }

        match row_result {
            Ok(row) => {
                // Mark when first row arrives
                if first_row_elapsed_ms.is_none() {
                    let elapsed = query_start.elapsed().as_millis() as u64;
                    first_row_elapsed_ms = Some(elapsed);
                    tracing::info!("  ⏱ First row arrived: {}ms", elapsed);
                }

                row_buffer.push(row);
                total_rows += 1;

                // Parallel micro-batch conversion to JSON values.
                // Convert eagerly when either the micro batch is full OR we're ready to send.
                let current_threshold = get_send_threshold(rows_sent);
                let pending_total = json_buffer.len() + row_buffer.len();
                if !row_buffer.is_empty()
                    && (row_buffer.len() >= MICRO_BATCH_SIZE
                        || pending_total >= current_threshold)
                {
                    let convert_start = std::time::Instant::now();
                    let converted =
                        crate::adapters::postgres::fast_converter::FastPostgresConverter::rows_to_json(
                            &row_buffer,
                        )
                        .map_err(|e| e.to_string())?;
                    conversion_time_ms += convert_start.elapsed().as_millis() as u64;
                    json_buffer.extend(converted);
                    row_buffer.clear();
                }

                // Send chunk to frontend when output buffer reaches dynamic threshold
                if json_buffer.len() >= current_threshold {
                    let batch_size = json_buffer.len();

                    // Serialize to MessagePack
                    let serialize_start = std::time::Instant::now();
                    let rows_msgpack = match rmp_serde::to_vec(&json_buffer) {
                        Ok(bytes) => bytes,
                        Err(e) => {
                            tracing::error!("MessagePack serialization failed: {}", e);
                            let _ = metadata_channel.send(StreamMessage::Error {
                                code: "SERIALIZATION_ERROR".to_string(),
                                message: format!("Failed to serialize rows: {}", e),
                            });
                            return Err(format!("MessagePack serialization failed: {}", e));
                        }
                    };
                    conversion_time_ms += serialize_start.elapsed().as_millis() as u64;

                    // Send raw binary via Response
                    let send_start = std::time::Instant::now();
                    let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
                    json_buffer.clear();
                    send_time_ms += send_start.elapsed().as_millis() as u64;
                    send_count += 1;
                    rows_sent += batch_size;

                    // Check if channel closed (user cancelled) - stop streaming early
                    if send_result.is_err() {
                        tracing::info!(
                            "  ⚠️  Channel closed (user cancelled), stopping stream early"
                        );
                        tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);

                        // Cancel the running query in PostgreSQL
                        spawn_cancel_backend_query(pool.clone(), backend_pid);

                        let _ = metadata_channel.send(StreamMessage::Interrupted {
                            resumable: false,
                            message: "Query cancelled by user".to_string(),
                        });
                        return Err("Query cancelled by user".to_string());
                    }
                }
            }
            Err(e) => {
                let _ = metadata_channel.send(StreamMessage::Error {
                    code: "FETCH_ERROR".to_string(),
                    message: e.to_string(),
                });
                return Err(e.to_string());
            }
        }
    }

    // Convert any remaining buffered rows, then send
    if !row_buffer.is_empty() {
        let convert_start = std::time::Instant::now();
        let converted =
            crate::adapters::postgres::fast_converter::FastPostgresConverter::rows_to_json(
                &row_buffer,
            )
            .map_err(|e| e.to_string())?;
        conversion_time_ms += convert_start.elapsed().as_millis() as u64;
        json_buffer.extend(converted);
        row_buffer.clear();
    }

    if !json_buffer.is_empty() {
        let batch_size = json_buffer.len();
        let _offset = total_rows - batch_size;

        let serialize_start = std::time::Instant::now();
        let rows_msgpack = match rmp_serde::to_vec(&json_buffer) {
            Ok(bytes) => bytes,
            Err(e) => {
                tracing::error!("MessagePack serialization failed for final batch: {}", e);
                let _ = metadata_channel.send(StreamMessage::Error {
                    code: "SERIALIZATION_ERROR".to_string(),
                    message: format!("Failed to serialize rows: {}", e),
                });
                return Err(format!("MessagePack serialization failed: {}", e));
            }
        };
        conversion_time_ms += serialize_start.elapsed().as_millis() as u64;

        // Send raw binary via Response (ZERO serialization overhead!)
        let send_start = std::time::Instant::now();
        let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
        send_time_ms += send_start.elapsed().as_millis() as u64;
        send_count += 1;

        // Check if channel closed (user cancelled) - stop streaming early
        if send_result.is_err() {
            tracing::info!("  ⚠️  Channel closed (user cancelled), stopping stream early");
            tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);

            // Cancel the running query in PostgreSQL
            spawn_cancel_backend_query(pool.clone(), backend_pid);

            let _ = metadata_channel.send(StreamMessage::Interrupted {
                resumable: false,
                message: "Query cancelled by user".to_string(),
            });
            return Err("Query cancelled by user".to_string());
        }
    }

    let total_time = query_start.elapsed().as_millis() as u64;
    let first_row_ms = first_row_elapsed_ms.unwrap_or(0);

    // NOTE: send_time_ms shows queue time only (channel.send is non-blocking)
    // Real IPC overhead is async/overlapped with conversion & network time
    // Exclude send_time_ms from "network" to avoid misattributing IPC queue time
    let network_time_ms = total_time.saturating_sub(conversion_time_ms + send_time_ms);

    tracing::info!("==========================================");
    tracing::info!("TRUE STREAMING COMPLETE: {} rows", total_rows);
    tracing::info!("  First row: {}ms", first_row_ms);
    tracing::info!("  Total time: {}ms", total_time);
    tracing::info!(
        "  Rows/sec: {:.0}",
        (total_rows as f64 / total_time as f64) * 1000.0
    );
    tracing::info!("  ┌─ Performance Breakdown:");
    tracing::info!(
        "  │  Network/DB: {}ms ({:.1}%)",
        network_time_ms,
        (network_time_ms as f64 / total_time as f64) * 100.0
    );
    tracing::info!(
        "  │  Conversion+Serialization: {}ms ({:.1}%)",
        conversion_time_ms,
        (conversion_time_ms as f64 / total_time as f64) * 100.0
    );
    tracing::info!(
        "  │  IPC: Overlapped/async ({}ms queue, {} batches)",
        send_time_ms,
        send_count
    );
    tracing::info!(
        "  └─ Batch sizes: 32→512→4096 (incremental) | Direct Row→MsgPack (zero JSON alloc)"
    );
    tracing::info!("==========================================");

    // CRITICAL: Check if channel was closed before sending success
    // User might have cancelled while we were processing the last batch
    let test_send = metadata_channel.send(StreamMessage::Success {
        total_rows,
        execution_time_ms: total_time,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_time),
        fetch_count: Some(send_count as u64),
        network_ms: Some(network_time_ms),
        conversion_ms: Some(conversion_time_ms),
        ipc_send_ms: Some(send_time_ms),
    });

    // If channel closed, it means user cancelled - don't return success
    if test_send.is_err() {
        tracing::info!("  ⚠️  Channel closed before sending success (user cancelled)");
        tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);

        // Cancel the running query in PostgreSQL (might already be done, but be safe)
        spawn_cancel_backend_query(pool.clone(), backend_pid);

        return Err("Query cancelled by user".to_string());
    }

    Ok(())
}

/// Stream query results with smart limit detection
/// Automatically applies LIMIT if query doesn't have one (unless user disabled it)
#[tauri::command]
pub async fn stream_query(
    conn_id: String,
    tab_id: String,
    sql: String,
    _batch_size: Option<usize>,
    user_limit_preference: Option<usize>,
    metadata_channel: tauri::ipc::Channel<StreamMessage>,
    data_channel: tauri::ipc::Channel<tauri::ipc::Response>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<(), String> {
    // Use composite key for tab-specific connection (transaction isolation)
    let connection_key = format!("{}:{}", conn_id, tab_id);

    let conn = manager
        .get_connection_with_retry(&connection_key, 3)
        .await
        .map_err(|e| e.to_string())?;

    // Check if query is a SELECT statement
    let is_select = is_select_query(&sql);

    // Check if query has LIMIT clause
    let has_limit = extract_limit_from_sql(&sql).is_some();

    // Apply smart limit only if:
    // 1. Query is a SELECT statement (not INSERT/UPDATE/DELETE/CREATE/etc.)
    // 2. Query doesn't have LIMIT
    // 3. User has a preference set (Some(limit)) - if None, user chose "No limit"
    let applied_limit = if is_select && !has_limit {
        user_limit_preference // Returns Some(limit) or None based on user preference
    } else {
        None
    };

    // Apply limit if needed
    let final_sql = if let Some(limit) = applied_limit {
        format!("{} LIMIT {}", sql.trim().trim_end_matches(';'), limit)
    } else {
        sql.clone()
    };

    // Send metadata about limit application before starting query
    if let Some(limit) = applied_limit {
        let _ = metadata_channel.send(StreamMessage::LimitApplied {
            original_sql: sql.clone(),
            applied_limit: limit,
        });
    }

    tracing::info!("==========================================");
    tracing::info!("FAST PATH (query_raw streaming)");
    tracing::info!("  connection_key: {}", connection_key);
    tracing::info!("  sql: {}", final_sql);
    if let Some(limit) = applied_limit {
        tracing::info!("Auto-applied LIMIT {} (SELECT query)", limit);
    } else if !is_select {
        tracing::info!("No auto-limit (not a SELECT query)");
    } else if !has_limit {
        tracing::info!("No auto-limit (user preference: no limit)");
    }
    tracing::info!("==========================================");

    execute_single_fetch_stream(&final_sql, &metadata_channel, &data_channel, &conn).await
}

// ============================================================================
// DDL Commands (DEPRECATED - use execute_sql with frontend dialect instead)
// ============================================================================
// The following commands have been removed:
// - create_index, drop_index, rename_index
// - alter_table_add_column, alter_table_drop_column, alter_table_modify_column, alter_table_rename_column
// - alter_table_add_foreign_key, alter_table_drop_foreign_key
// - create_trigger, drop_trigger, enable_disable_trigger
//
// Use the new execute_sql / execute_sql_batch commands with frontend dialect SQL generation instead.
// See: src/dialects/ for the TypeScript dialect system.

// ============================================================================
// vault maintenance helpers
// ============================================================================

#[tauri::command]
pub async fn reset_vault_vault(app_handle: AppHandle) -> std::result::Result<(), String> {
    let data_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let vault_path = data_dir.join("vault.hold");
    let salt_path = data_dir.join("salt.txt");

    if vault_path.exists() {
        if let Err(err) = fs::remove_file(&vault_path) {
            tracing::warn!(
                "Failed to remove vault vault file {}: {}",
                vault_path.display(),
                err
            );
        } else {
            tracing::info!("Removed vault vault file at {}", vault_path.display());
        }
    }

    if salt_path.exists() {
        if let Err(err) = fs::remove_file(&salt_path) {
            tracing::warn!(
                "Failed to remove vault salt file {}: {}",
                salt_path.display(),
                err
            );
        } else {
            tracing::info!("Removed vault salt file at {}", salt_path.display());
        }
    }

    if let Err(err) = crate::keychain::delete_vault_password() {
        tracing::warn!("Failed to delete vault password from keychain: {}", err);
    }

    Ok(())
}

// ============================================================================
// CRUD TRANSACTION COMMAND
// ============================================================================

/// Execute a batch of CRUD commands in a single transaction
///
/// All commands are executed sequentially within a BEGIN...COMMIT transaction.
/// On error, the entire transaction is rolled back.
///
/// Security: Uses parameterized queries to prevent SQL injection
/// Performance: Executes all commands in a single database transaction
#[tauri::command]
pub async fn execute_crud_transaction(
    conn_id: String,
    transaction: CrudTransaction,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<TransactionResult, String> {
    tracing::info!("🔵 execute_crud_transaction called");
    tracing::info!("  conn_id: {}", conn_id);
    tracing::info!("  transaction.id: {}", transaction.id);
    tracing::info!(
        "  transaction.commands.len(): {}",
        transaction.commands.len()
    );
    tracing::info!(
        "  transaction.rollback_on_error: {}",
        transaction.rollback_on_error
    );

    if !transaction.commands.is_empty() {
        let first_cmd = &transaction.commands[0];
        tracing::info!("  First command:");
        tracing::info!("    id: {}", first_cmd.id);
        tracing::info!("    operation_type: {}", first_cmd.operation_type);
        tracing::info!("    target: {:?}", first_cmd.target);
        tracing::info!("    payload: {}", first_cmd.payload);
    }

    // Get connection and adapter
    let conn = manager.get_connection(&conn_id).ok_or_else(|| {
        tracing::error!("❌ Connection {} not found", conn_id);
        format!("Connection {} not found", conn_id)
    })?;

    tracing::info!("✅ Connection found, executing transaction...");

    // Execute transaction via CRUD executor
    crate::crud::executor::execute_crud_transaction(&*conn.adapter, transaction)
        .await
        .map_err(|e| {
            tracing::error!("❌ CRUD transaction failed: {}", e);
            e.to_string()
        })
}

// ========================================
// Generic SQL Execution Commands
// ========================================
// These commands allow the frontend to execute SQL directly.
// SQL generation is handled by frontend dialects (src/dialects/).

/// Execute a single SQL statement and return the number of affected rows.
/// This is the primary command for DDL operations (CREATE, ALTER, DROP).
/// The frontend generates dialect-specific SQL and sends it here for execution.
#[tauri::command]
pub async fn execute_sql(
    conn_id: String,
    sql: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<u64, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    conn.adapter.execute(&sql).await.map_err(|e| e.to_string())
}

/// Execute multiple SQL statements in sequence.
/// Returns the total number of affected rows.
/// All statements are executed in the same connection context.
#[tauri::command]
pub async fn execute_sql_batch(
    conn_id: String,
    statements: Vec<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> std::result::Result<Vec<u64>, String> {
    let conn = manager
        .get_connection(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    let mut results = Vec::with_capacity(statements.len());
    for sql in statements {
        let affected = conn
            .adapter
            .execute(&sql)
            .await
            .map_err(|e| e.to_string())?;
        results.push(affected);
    }
    Ok(results)
}

// ========================================
// Window State / Connection Tracking Commands
// ========================================
// NOTE: Window tracking now uses BroadcastChannel API on the frontend
// These Tauri commands have been removed and replaced with web-based tracking
