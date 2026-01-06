use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Manager, State};
use tokio::time::{timeout, Duration};

use crate::adapters::postgres::DirectMsgPackEncoder;
use rmp_serde;
use crate::core::ConnectionManager;
use crate::ssh;
use crate::state::AppState;
use crate::types::*;
use serde::Serialize;
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

/// Execute a SQL query and return results directly (Path 1: Direct Query)
///
/// This command is optimized for small result sets (< 1000 rows) and provides a simple
/// invoke-based API. Results are encoded as JSON using SimpleConverter.
///
/// # Use Cases
/// - Schema metadata queries (tables, columns, constraints)
/// - System catalog queries (information_schema, pg_catalog)
/// - AI HTTP server endpoints
/// - Any query with known small result size
///
/// # Performance
/// - Low latency: ~5-10ms overhead
/// - Suitable for up to 1000 rows
/// - Entire result set loaded into memory
///
/// # When NOT to Use
/// For large result sets or user-facing data display, use `execute_query` instead,
/// which provides streaming with MessagePack encoding for 3-5x better performance.
///
/// See: `docs/query-execution-architecture.md` for architecture details.
/// See also: [`execute_query`] for high-performance streaming queries.
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

/// Check if SQL query is a SELECT statement or other query that returns rows
fn is_select_query(sql: &str) -> bool {
    // Trim whitespace and comments, get first significant SQL keyword
    let trimmed = sql.trim();

    // Remove leading comments (-- and /* */)
    let without_comments = trimmed
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");

    // Remove block comments
    let re = regex::Regex::new(r"/\*.*?\*/").unwrap_or_else(|_| regex::Regex::new(r"a^").unwrap());
    let cleaned = re.replace_all(&without_comments, "");

    // Get first word
    let first_keyword = cleaned
        .trim()
        .split_whitespace()
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .to_uppercase();

    // For CTEs (WITH), we need to find the main statement after the CTE definitions
    // WITH ... SELECT returns rows, but WITH ... UPDATE/INSERT/DELETE does not
    if first_keyword == "WITH" {
        return find_main_statement_keyword(&cleaned)
            .map(|kw| matches!(kw.as_str(), "SELECT" | "TABLE" | "VALUES"))
            .unwrap_or(false);
    }

    // Check if it's a query that returns rows:
    // - SELECT: standard select query
    // - EXPLAIN: query plan output (returns rows with plan text)
    // - SHOW: PostgreSQL config/status queries
    // - TABLE: PostgreSQL shorthand for SELECT * FROM
    // - VALUES: literal values as rows
    matches!(
        first_keyword.as_str(),
        "SELECT" | "EXPLAIN" | "SHOW" | "TABLE" | "VALUES"
    )
}

/// Find the main statement keyword in a CTE query (after WITH ... AS (...))
/// Returns the keyword of the main statement (SELECT, INSERT, UPDATE, DELETE)
fn find_main_statement_keyword(sql: &str) -> Option<String> {
    let upper = sql.to_uppercase();

    // Main DML keywords that can follow CTEs
    let keywords = ["SELECT", "INSERT", "UPDATE", "DELETE", "TABLE", "VALUES"];

    // Find the FIRST main statement keyword at depth 0 (after CTE definitions)
    // We need the first one because "INSERT INTO ... SELECT" has SELECT after INSERT
    let mut first_keyword_pos: Option<(usize, &str)> = None;

    for keyword in &keywords {
        let mut search_start = 0;
        while let Some(pos) = upper[search_start..].find(keyword) {
            let abs_pos = search_start + pos;

            // Check if this keyword is at word boundary
            let before_ok = abs_pos == 0
                || !upper.as_bytes()[abs_pos - 1].is_ascii_alphanumeric();
            let after_ok = abs_pos + keyword.len() >= upper.len()
                || !upper.as_bytes()[abs_pos + keyword.len()].is_ascii_alphanumeric();

            if before_ok && after_ok {
                // Count parenthesis depth up to this position
                let depth = sql[..abs_pos].chars().fold(0i32, |d, c| match c {
                    '(' => d + 1,
                    ')' => d - 1,
                    _ => d,
                });

                // Only consider keywords at depth 0 (not inside CTE definitions)
                // Track the FIRST (leftmost) keyword at depth 0
                if depth == 0 {
                    if first_keyword_pos.map_or(true, |(p, _)| abs_pos < p) {
                        first_keyword_pos = Some((abs_pos, keyword));
                    }
                }
            }

            search_start = abs_pos + 1;
        }
    }

    first_keyword_pos.map(|(_, kw)| kw.to_string())
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
    // Dispatch to database-specific streaming implementation
    match conn.profile.db_type {
        DbType::PostgreSQL => {
            execute_postgres_stream(sql, metadata_channel, data_channel, conn).await
        }
        DbType::MySQL | DbType::MariaDB => {
            execute_generic_stream(sql, metadata_channel, data_channel, conn).await
        }
        DbType::SQLite => {
            execute_generic_stream(sql, metadata_channel, data_channel, conn).await
        }
        DbType::SQLServer => {
            execute_generic_stream(sql, metadata_channel, data_channel, conn).await
        }
    }
}

/// Generic streaming implementation using the adapter's query method
/// Works for MySQL, SQLite, and SQL Server
async fn execute_generic_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    let start_time = std::time::Instant::now();
    
    // Use the adapter's query method which works for all database types
    let result = conn.adapter.query(sql).await.map_err(|e| e.to_string())?;
    
    let query_elapsed = start_time.elapsed().as_millis();
    tracing::info!("  ⏱ Query execution: {}ms, {} rows", query_elapsed, result.rows.len());
    
    // Send column metadata
    let _ = metadata_channel.send(StreamMessage::Started {
        columns: result.columns.clone(),
        estimated_rows: Some(result.rows.len() as i64),
    });
    
    // Convert rows to MessagePack and send in batches
    let encode_start = std::time::Instant::now();
    
    // For smaller result sets, send all at once
    if !result.rows.is_empty() {
        // Use rmp_serde to serialize the rows as MessagePack
        let msgpack_data = rmp_serde::to_vec(&result.rows)
            .map_err(|e| format!("Failed to encode rows: {}", e))?;
        
        let _ = data_channel.send(tauri::ipc::Response::new(msgpack_data));
    }
    
    let encode_elapsed = encode_start.elapsed().as_millis();
    let total_elapsed = start_time.elapsed().as_millis();
    
    // Send success message
    let _ = metadata_channel.send(StreamMessage::Success {
        total_rows: result.rows.len(),
        execution_time_ms: total_elapsed as u64,
        cursor_setup_ms: None,
        total_streaming_ms: Some(total_elapsed as u64),
        fetch_count: Some(1),
        network_ms: Some(query_elapsed as u64),
        conversion_ms: Some(encode_elapsed as u64),
        ipc_send_ms: Some(0),
    });
    
    Ok(())
}

/// PostgreSQL-specific streaming implementation with optimized binary protocol
async fn execute_postgres_stream(
    sql: &str,
    metadata_channel: &tauri::ipc::Channel<StreamMessage>,
    data_channel: &tauri::ipc::Channel<tauri::ipc::Response>,
    conn: &crate::core::manager::LiveConnection,
) -> std::result::Result<(), String> {
    use futures::StreamExt;

    // Get pool from PostgresAdapter
    let pool = conn
        .adapter
        .as_any()
        .downcast_ref::<crate::adapters::postgres::PostgresAdapter>()
        .and_then(|adapter| adapter.get_pool())
        .ok_or_else(|| "PostgreSQL pool not available".to_string())?;

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

    // Check if this is a multi-statement query (transactions, multiple commands)
    // Do this BEFORE getting backend PID since batch_execute doesn't need it
    if is_multi_statement_query(sql) {
        tracing::info!("  🔀 Detected multi-statement query, using simple_query protocol");

        // Reset any pending failed transaction state before executing
        // This handles cases where a previous operation failed and left the connection dirty
        if let Err(e) = pool_conn.batch_execute("ROLLBACK").await {
            tracing::debug!("  ℹ️ ROLLBACK before batch (expected if no active transaction): {}", e);
        }

        // Use simple_query for multi-statement support (no prepared statements)
        let simple_start = std::time::Instant::now();
        let batch_result = pool_conn.batch_execute(sql).await;

        if let Err(e) = &batch_result {
            tracing::error!("❌ batch_execute failed: {:?}", e);
            // ROLLBACK to clean up the failed transaction and reset connection state
            if let Err(rollback_err) = pool_conn.batch_execute("ROLLBACK").await {
                tracing::debug!("  ℹ️ ROLLBACK after failure (may already be rolled back): {}", rollback_err);
            }
            return Err(extract_db_error_message(e));
        }
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

        // Reset any pending failed transaction state before executing
        if let Err(e) = pool_conn.batch_execute("ROLLBACK").await {
            tracing::debug!("  ℹ️ ROLLBACK before execute (expected if no active transaction): {}", e);
        }

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

    // Get backend PID for cancellation (only needed for SELECT queries that stream)
    // Query it since we're using pooled connections
    let backend_pid: i32 = match pool_conn
        .query_one("SELECT pg_backend_pid()", &[])
        .await
    {
        Ok(row) => {
            let pid: i32 = row.get(0);
            tracing::info!("  🔍 Query running on PostgreSQL backend PID: {}", pid);
            pid
        }
        Err(e) => {
            tracing::warn!("  ⚠️ Could not get backend PID (cancellation disabled): {}", e);
            0 // Use 0 as sentinel - cancellation won't work but query will proceed
        }
    };

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

    // Extract column metadata from prepared statement
    let columns = stmt
        .columns()
        .iter()
        .map(|col| crate::types::ColumnMeta {
            name: col.name().to_string(),
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
    let mut row_buffer: Vec<Row> = Vec::new(); // Row buffer for batch conversion

    // Progressive batch sizes: start tiny for instant feedback, scale up
    const BATCH_SIZES: [usize; 5] = [16, 64, 256, 1024, 2048];

    // Initialize encoder lazily (need column types from first row)
    let mut encoder: Option<DirectMsgPackEncoder> = None;

    let mut first_row_elapsed_ms: Option<u64> = None;

    // Performance tracking
    let mut conversion_time_ms = 0u64;
    let mut send_time_ms = 0u64;
    let mut send_count = 0usize;

    // Dynamic batch sizing - progressive increase for faster first render
    let mut batch_index = 0usize;

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

                // Cancel the running query in PostgreSQL (only if we have a valid PID)
                if backend_pid > 0 {
                    tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
                    let cancel_pool = pool.clone();
                    tokio::spawn(async move {
                        if let Ok(cancel_conn) = cancel_pool.get().await {
                            let cancel_sql = format!("SELECT pg_cancel_backend({})", backend_pid);
                            match cancel_conn.execute(&cancel_sql, &[]).await {
                                Ok(_) => tracing::info!("  ✅ Successfully cancelled backend query"),
                                Err(e) => tracing::warn!("  ⚠️  Failed to cancel backend: {}", e),
                            }
                        }
                    });
                }

                let _ = metadata_channel.send(StreamMessage::Interrupted {
                    resumable: false,
                    message: "Query cancelled by user".to_string(),
                });
                return Err("Query cancelled by user".to_string());
            }
        }

        match row_result {
            Ok(row) => {
                // Mark when first row arrives and initialize encoder
                if first_row_elapsed_ms.is_none() {
                    let elapsed = query_start.elapsed().as_millis() as u64;
                    first_row_elapsed_ms = Some(elapsed);
                    tracing::info!("  ⏱ First row arrived: {}ms", elapsed);

                    // Initialize encoder with column types from first row
                    encoder = Some(DirectMsgPackEncoder::from_row(&row));
                }

                row_buffer.push(row);
                total_rows += 1;

                // Send chunk to frontend when buffer reaches current batch size
                let current_threshold = BATCH_SIZES[batch_index.min(BATCH_SIZES.len() - 1)];
                if row_buffer.len() >= current_threshold {
                    let _batch_size = row_buffer.len();

                    // Direct encode to MessagePack (no JSON intermediate!)
                    let convert_start = std::time::Instant::now();
                    let rows_msgpack = encoder
                        .as_ref()
                        .unwrap()
                        .encode_batch(&row_buffer)
                        .unwrap_or_else(|_| Vec::new());
                    conversion_time_ms += convert_start.elapsed().as_millis() as u64;
                    row_buffer.clear();
                    batch_index += 1;

                    // Send raw binary via Response (ZERO serialization overhead!)
                    let send_start = std::time::Instant::now();
                    let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
                    send_time_ms += send_start.elapsed().as_millis() as u64;
                    send_count += 1;

                    // Check if channel closed (user cancelled) - stop streaming early
                    if send_result.is_err() {
                        tracing::info!(
                            "  ⚠️  Channel closed (user cancelled), stopping stream early"
                        );

                        // Cancel the running query in PostgreSQL (only if we have a valid PID)
                        if backend_pid > 0 {
                            tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
                            let cancel_pool = pool.clone();
                            tokio::spawn(async move {
                                if let Ok(cancel_conn) = cancel_pool.get().await {
                                    let cancel_sql =
                                        format!("SELECT pg_cancel_backend({})", backend_pid);
                                    match cancel_conn.execute(&cancel_sql, &[]).await {
                                        Ok(_) => {
                                            tracing::info!("  ✅ Successfully cancelled backend query")
                                        }
                                        Err(e) => {
                                            tracing::warn!("  ⚠️  Failed to cancel backend: {}", e)
                                        }
                                    }
                                }
                            });
                        }

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

    // Send any remaining rows directly
    if !row_buffer.is_empty() {
        if let Some(ref enc) = encoder {
            // Direct encode to MessagePack (no JSON intermediate!)
            let convert_start = std::time::Instant::now();
            let rows_msgpack = enc.encode_batch(&row_buffer).unwrap_or_else(|_| Vec::new());
            conversion_time_ms += convert_start.elapsed().as_millis() as u64;

            // Send raw binary via Response
            let send_start = std::time::Instant::now();
            let send_result = data_channel.send(tauri::ipc::Response::new(rows_msgpack));
            send_time_ms += send_start.elapsed().as_millis() as u64;
            send_count += 1;

            // Check if channel closed (user cancelled)
            if send_result.is_err() {
                tracing::info!("  ⚠️  Channel closed (user cancelled), stopping stream early");

                // Cancel the running query in PostgreSQL (only if we have a valid PID)
                if backend_pid > 0 {
                    tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
                    let cancel_pool = pool.clone();
                    tokio::spawn(async move {
                        if let Ok(cancel_conn) = cancel_pool.get().await {
                            let cancel_sql = format!("SELECT pg_cancel_backend({})", backend_pid);
                            match cancel_conn.execute(&cancel_sql, &[]).await {
                                Ok(_) => tracing::info!("  ✅ Successfully cancelled backend query"),
                                Err(e) => tracing::warn!("  ⚠️  Failed to cancel backend: {}", e),
                            }
                        }
                    });
                }

                let _ = metadata_channel.send(StreamMessage::Interrupted {
                    resumable: false,
                    message: "Query cancelled by user".to_string(),
                });
                return Err("Query cancelled by user".to_string());
            }
        }
    }

    let total_time = query_start.elapsed().as_millis() as u64;
    let first_row_ms = first_row_elapsed_ms.unwrap_or(0);

    // NOTE: send_time_ms shows queue time only (channel.send is non-blocking)
    // Real IPC overhead is async/overlapped with conversion & network time
    let network_time_ms = total_time.saturating_sub(conversion_time_ms);

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
        "  │  IPC: Overlapped/async ({}ms queue, {} batches) - Response bypasses JSON!",
        send_time_ms,
        send_count
    );
    tracing::info!(
        "  └─ Batch sizes: 16→64→256→1024→2048 (progressive) | Format: direct msgpack"
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

        // Cancel the running query in PostgreSQL (only if we have a valid PID)
        if backend_pid > 0 {
            tracing::info!("  🛑 Cancelling PostgreSQL backend PID: {}", backend_pid);
            let cancel_pool = pool.clone();
            tokio::spawn(async move {
                if let Ok(cancel_conn) = cancel_pool.get().await {
                    let cancel_sql = format!("SELECT pg_cancel_backend({})", backend_pid);
                    let _ = cancel_conn.execute(&cancel_sql, &[]).await;
                }
            });
        }

        return Err("Query cancelled by user".to_string());
    }

    Ok(())
}

/// Execute query with high-performance streaming (Path 2: Streaming Query)
///
/// This command is optimized for large result sets and provides progressive rendering
/// via IPC channels. Results are encoded as MessagePack using DirectMsgPackEncoder.
///
/// # Use Cases
/// - Data grids and table browsing (any size, optimized for 1K+ rows)
/// - User-written queries with unknown result sizes
/// - Operations requiring progressive rendering
/// - Queries that need cancellation support
///
/// # Performance
/// - Initial setup: ~50ms (IPC channels + cursor)
/// - Throughput: 3-5x faster than JSON for large datasets
/// - Streaming: Progressive batches (16-2048 rows)
/// - Memory: Bounded regardless of result size
/// - Cancellable: Can be interrupted mid-stream
///
/// # Architecture
/// Results are streamed via two IPC channels:
/// - `metadata_channel`: Column metadata and status updates
/// - `data_channel`: MessagePack-encoded row batches
///
/// The frontend uses `queryStreamClient` to consume these streams and provide
/// progressive rendering with cancellation support.
///
/// # When NOT to Use
/// For small metadata queries (< 1000 rows), use `query` instead for lower latency
/// and simpler API.
///
/// See: `docs/query-execution-architecture.md` for architecture details.
/// See also: [`query`] for simple direct queries.
#[tauri::command]
pub async fn execute_query(
    conn_id: String,
    tab_id: String,
    sql: String,
    _batch_size: Option<usize>,
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

    tracing::info!("==========================================");
    tracing::info!("FAST PATH (query_raw streaming)");
    tracing::info!("  connection_key: {}", connection_key);
    tracing::info!("  sql: {}", sql);
    tracing::info!("==========================================");

    execute_single_fetch_stream(&sql, &metadata_channel, &data_channel, &conn).await
}

// ============================================================================
// DDL Operations
// ============================================================================
// DDL operations (CREATE, ALTER, DROP) are handled via execute_query with
// frontend adapter SQL generation. See: src/adapters/ for the TypeScript adapter system.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_select_query_simple_select() {
        assert!(is_select_query("SELECT * FROM users"));
        assert!(is_select_query("select id from users"));
        assert!(is_select_query("  SELECT * FROM users  "));
    }

    #[test]
    fn test_is_select_query_mutations() {
        assert!(!is_select_query("UPDATE users SET name = 'test'"));
        assert!(!is_select_query("INSERT INTO users (name) VALUES ('test')"));
        assert!(!is_select_query("DELETE FROM users WHERE id = 1"));
    }

    #[test]
    fn test_is_select_query_cte_with_select() {
        let sql = "WITH cte AS (SELECT id FROM users) SELECT * FROM cte";
        assert!(is_select_query(sql));
    }

    #[test]
    fn test_is_select_query_cte_with_update() {
        let sql = r#"
            WITH mismatch AS (
                SELECT s.id, s.code FROM sales s
            )
            UPDATE campaigns SET code = m.code FROM mismatch m WHERE id = m.id
        "#;
        assert!(!is_select_query(sql));
    }

    #[test]
    fn test_is_select_query_cte_with_insert() {
        let sql = "WITH data AS (SELECT 1 as id) INSERT INTO users (id) SELECT id FROM data";
        assert!(!is_select_query(sql));
    }

    #[test]
    fn test_is_select_query_cte_with_delete() {
        let sql = "WITH old AS (SELECT id FROM users WHERE age > 100) DELETE FROM users WHERE id IN (SELECT id FROM old)";
        assert!(!is_select_query(sql));
    }

    #[test]
    fn test_is_select_query_explain() {
        assert!(is_select_query("EXPLAIN SELECT * FROM users"));
        assert!(is_select_query("EXPLAIN ANALYZE SELECT * FROM users"));
    }

    #[test]
    fn test_is_select_query_show() {
        assert!(is_select_query("SHOW search_path"));
        assert!(is_select_query("SHOW ALL"));
    }

    #[test]
    fn test_find_main_statement_keyword() {
        assert_eq!(
            find_main_statement_keyword("WITH cte AS (SELECT 1) SELECT * FROM cte"),
            Some("SELECT".to_string())
        );
        assert_eq!(
            find_main_statement_keyword("WITH cte AS (SELECT 1) UPDATE t SET x = 1"),
            Some("UPDATE".to_string())
        );
        assert_eq!(
            find_main_statement_keyword("WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte"),
            Some("INSERT".to_string())
        );
    }
}
