use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use super::types::{TrinoColumn, TrinoQueryResponse};
use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityColumnMeta, CapabilityQueryResult,
    CapabilityTestResult, SqlQueryable,
};
use crate::error::AppError;
use crate::types::ConnectionProfile;

const TRINO_SOURCE: &str = "QueryPilot";

const ALLOWED_OPTIONS: &[&str] = &[
    "trino.source",
    "trino.client_tags",
    "trino.trace_token",
    "trino.session_properties",
    "trino.roles",
    "trino.extra_credentials",
    "trino.extra_headers",
    "trino.access_token",
    "trino.request_timeout_secs",
    "trino.query_timeout_secs",
    "default_schema",
];

pub struct TrinoAdapter {
    client: RwLock<Option<Client>>,
    base_url: RwLock<Option<String>>,
    connected: AtomicBool,
    username: RwLock<String>,
    catalog: RwLock<Option<String>>,
    schema: RwLock<Option<String>>,
    options: RwLock<HashMap<String, String>>,
}

impl TrinoAdapter {
    pub fn new() -> Self {
        Self {
            client: RwLock::new(None),
            base_url: RwLock::new(None),
            connected: AtomicBool::new(false),
            username: RwLock::new(String::new()),
            catalog: RwLock::new(None),
            schema: RwLock::new(None),
            options: RwLock::new(HashMap::new()),
        }
    }

    fn validate_options(options: &HashMap<String, String>) -> Result<(), AppError> {
        for key in options.keys() {
            if !ALLOWED_OPTIONS.contains(&key.as_str()) {
                return Err(AppError::InvalidInput(format!(
                    "Unknown Trino option '{}'. Allowed: {}",
                    key,
                    ALLOWED_OPTIONS.join(", ")
                )));
            }
        }

        if let Some(extra_headers) = options.get("trino.extra_headers") {
            for header in extra_headers.split(',') {
                let header_name = header.split(':').next().unwrap_or("").trim();
                if header_name
                    .to_lowercase()
                    .starts_with("x-trino-")
                {
                    return Err(AppError::InvalidInput(format!(
                        "Cannot set protocol-reserved header '{}' via trino.extra_headers",
                        header_name
                    )));
                }
            }
        }

        Ok(())
    }

    /// Snapshot connection state for use in HTTP requests.
    /// Clones all values so RwLock guards are dropped before any await.
    async fn snapshot_state(
        &self,
    ) -> Result<(Client, String, String, Option<String>, Option<String>, HashMap<String, String>), AppError>
    {
        let client = self.client.read().await.clone()
            .ok_or_else(|| AppError::ConnectionClosed("Not connected to Trino".into()))?;
        let base_url = self.base_url.read().await.clone()
            .ok_or_else(|| AppError::ConnectionClosed("No base URL configured".into()))?;
        let username = self.username.read().await.clone();
        let catalog = self.catalog.read().await.clone();
        let schema = self.schema.read().await.clone();
        let options = self.options.read().await.clone();
        Ok((client, base_url, username, catalog, schema, options))
    }

    /// Apply common auth/session headers from options to a request builder.
    fn apply_headers(
        mut request: reqwest::RequestBuilder,
        username: &str,
        catalog: &Option<String>,
        schema: &Option<String>,
        options: &HashMap<String, String>,
    ) -> reqwest::RequestBuilder {
        request = request.header("X-Trino-User", username);

        let source = options
            .get("trino.source")
            .cloned()
            .unwrap_or_else(|| TRINO_SOURCE.to_string());
        request = request.header("X-Trino-Source", source);

        if let Some(cat) = catalog.as_deref() {
            request = request.header("X-Trino-Catalog", cat);
        }
        if let Some(sch) = schema.as_deref() {
            request = request.header("X-Trino-Schema", sch);
        }
        if let Some(token) = options.get("trino.access_token") {
            request = request.header("Authorization", format!("Bearer {}", token));
        }
        if let Some(tags) = options.get("trino.client_tags") {
            request = request.header("X-Trino-Client-Tags", tags.as_str());
        }
        if let Some(trace) = options.get("trino.trace_token") {
            request = request.header("X-Trino-Trace-Token", trace.as_str());
        }
        if let Some(session) = options.get("trino.session_properties") {
            request = request.header("X-Trino-Session", session.as_str());
        }
        if let Some(roles) = options.get("trino.roles") {
            request = request.header("X-Trino-Role", roles.as_str());
        }
        if let Some(creds) = options.get("trino.extra_credentials") {
            request = request.header("X-Trino-Extra-Credential", creds.as_str());
        }
        if let Some(extra_headers) = options.get("trino.extra_headers") {
            for header in extra_headers.split(',') {
                if let Some((name, value)) = header.split_once(':') {
                    request = request.header(name.trim(), value.trim());
                }
            }
        }
        request
    }

    fn parse_response(resp: TrinoQueryResponse) -> Result<TrinoQueryResponse, AppError> {
        if let Some(ref err) = resp.error {
            return Err(AppError::DatabaseError(format!(
                "{} ({}): {}",
                err.error_name, err.error_type, err.message
            )));
        }
        Ok(resp)
    }

    async fn submit_query(&self, sql: &str) -> Result<TrinoQueryResponse, AppError> {
        let (client, base_url, username, catalog, schema, options) =
            self.snapshot_state().await?;

        let url = format!("{}/v1/statement", base_url);
        let request = client.post(&url).body(sql.to_string());
        let request = Self::apply_headers(request, &username, &catalog, &schema, &options);

        let response = request
            .send()
            .await
            .map_err(|e| AppError::Driver(format!("Trino HTTP request failed: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".into());
            return Err(AppError::Driver(format!(
                "Trino returned HTTP {}: {}",
                status, body
            )));
        }

        let resp: TrinoQueryResponse = response
            .json()
            .await
            .map_err(|e| AppError::Driver(format!("Failed to parse Trino response: {}", e)))?;

        Self::parse_response(resp)
    }

    /// Execute a query and collect all pages of results.
    /// Safety: capped at MAX_RESULT_ROWS to prevent OOM on unbounded queries.
    async fn execute_full_query(
        &self,
        sql: &str,
    ) -> Result<(Vec<TrinoColumn>, Vec<Vec<serde_json::Value>>), AppError> {
        const MAX_RESULT_ROWS: usize = 5_000_000;

        let mut resp = self.submit_query(sql).await?;
        let mut columns: Option<Vec<TrinoColumn>> = resp.columns;
        let mut all_rows: Vec<Vec<serde_json::Value>> = resp.data.unwrap_or_default();

        // Snapshot connection state once before the polling loop to avoid
        // acquiring 6 RwLock read locks on every follow-up request.
        let (client, _base_url, username, catalog, schema, options) =
            self.snapshot_state().await?;

        let query_timeout: Duration = options
            .get("trino.query_timeout_secs")
            .and_then(|v| v.parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or(Duration::from_secs(300));

        let start = Instant::now();
        // Exponential backoff for polling: start at 5ms, double each empty poll, cap at 100ms.
        // Fast queries (< 10ms execution) get results within 1-2 polls at 5ms each.
        // Slow queries gradually back off to avoid hammering the server.
        let mut poll_delay_ms: u64 = 5;

        while let Some(next_uri) = resp.next_uri {
            if start.elapsed() > query_timeout {
                let _ = self.cancel_query(&next_uri).await;
                return Err(AppError::Timeout(format!(
                    "Trino query exceeded {}s timeout",
                    query_timeout.as_secs()
                )));
            }

            if all_rows.len() > MAX_RESULT_ROWS {
                let _ = self.cancel_query(&next_uri).await;
                return Err(AppError::Internal(format!(
                    "Trino query exceeded {} row safety limit. Use LIMIT to constrain results.",
                    MAX_RESULT_ROWS
                )));
            }

            resp = self
                .follow_next_uri_with_client(&client, &username, &catalog, &schema, &options, &next_uri)
                .await?;

            if resp.data.is_none() {
                // Still queued/planning — back off before next poll
                tokio::time::sleep(Duration::from_millis(poll_delay_ms)).await;
                poll_delay_ms = (poll_delay_ms * 2).min(100);
            } else {
                // Data is flowing — reset delay and follow nextUri immediately
                poll_delay_ms = 5;
            }

            if columns.is_none() {
                columns = resp.columns;
            }
            if let Some(data) = resp.data {
                all_rows.extend(data);
            }
        }

        Ok((columns.unwrap_or_default(), all_rows))
    }

    /// Like `follow_next_uri` but uses a pre-snapshotted client to avoid
    /// repeated RwLock acquisitions in the polling loop.
    async fn follow_next_uri_with_client(
        &self,
        client: &Client,
        username: &str,
        catalog: &Option<String>,
        schema: &Option<String>,
        options: &HashMap<String, String>,
        next_uri: &str,
    ) -> Result<TrinoQueryResponse, AppError> {
        let request = client.get(next_uri);
        let request = Self::apply_headers(request, username, catalog, schema, options);

        let response = request
            .send()
            .await
            .map_err(|e| AppError::Driver(format!("Trino follow-up request failed: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".into());
            return Err(AppError::Driver(format!(
                "Trino returned HTTP {}: {}",
                status, body
            )));
        }

        let resp: TrinoQueryResponse = response
            .json()
            .await
            .map_err(|e| AppError::Driver(format!("Failed to parse Trino response: {}", e)))?;

        Self::parse_response(resp)
    }

    async fn cancel_query(&self, next_uri: &str) -> Result<(), AppError> {
        if let Ok((client, _base_url, username, catalog, schema, options)) =
            self.snapshot_state().await
        {
            let request = client.delete(next_uri);
            let request =
                Self::apply_headers(request, &username, &catalog, &schema, &options);
            let _ = request.send().await;
        }
        Ok(())
    }

    async fn clear_state(&self) {
        *self.client.write().await = None;
        *self.base_url.write().await = None;
        *self.username.write().await = String::new();
        *self.catalog.write().await = None;
        *self.schema.write().await = None;
        *self.options.write().await = HashMap::new();
    }
}

impl Default for TrinoAdapter {
    fn default() -> Self {
        Self::new()
    }
}

fn map_trino_type(type_name: &str) -> String {
    let lower = type_name.to_lowercase();
    let base = lower.split('(').next().unwrap_or(&lower).trim();

    match base {
        "boolean" => "boolean",
        "tinyint" | "smallint" | "integer" | "int" | "bigint" => "integer",
        "real" | "double" | "decimal" => "decimal",
        "varchar" | "char" => "varchar",
        "varbinary" => "varbinary",
        "date" => "date",
        "time" | "time with time zone" => "time",
        "timestamp" | "timestamp with time zone" => "timestamp",
        "json" => "json",
        "uuid" => "uuid",
        "ipaddress" => "varchar",
        "array" => "array",
        "map" | "row" => "json",
        _ => "varchar",
    }
    .to_string()
}

#[async_trait]
impl BaseCapability for TrinoAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        Self::validate_options(&profile.options)?;

        let use_ssl = matches!(
            profile.ssl_mode,
            Some(crate::types::SslMode::Require)
                | Some(crate::types::SslMode::VerifyCa)
                | Some(crate::types::SslMode::VerifyFull)
        );

        let scheme = if use_ssl { "https" } else { "http" };
        let host = if profile.host.trim().is_empty() {
            "localhost"
        } else {
            profile.host.trim()
        };
        let port = if profile.port == 0 { 8080 } else { profile.port };
        let base_url = format!("{}://{}:{}", scheme, host, port);

        let request_timeout: Duration = profile
            .options
            .get("trino.request_timeout_secs")
            .and_then(|v| v.parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or(Duration::from_secs(30));

        let client = Client::builder()
            .timeout(request_timeout)
            .connect_timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(4)
            .build()
            .map_err(|e| AppError::Driver(format!("Failed to create HTTP client: {}", e)))?;

        let username = if profile.username.trim().is_empty() {
            "trino".to_string()
        } else {
            profile.username.trim().to_string()
        };

        let catalog = if profile.database.trim().is_empty() {
            None
        } else {
            Some(profile.database.trim().to_string())
        };

        let schema = profile
            .options
            .get("default_schema")
            .map(String::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from);

        *self.client.write().await = Some(client);
        *self.base_url.write().await = Some(base_url);
        *self.username.write().await = username;
        *self.catalog.write().await = catalog;
        *self.schema.write().await = schema;
        *self.options.write().await = profile.options.clone();

        // Verify connectivity — roll back state on failure
        match self.execute_full_query("SELECT 1 AS _ping").await {
            Ok((_, rows)) if rows.is_empty() => {
                self.clear_state().await;
                return Err(AppError::Driver(
                    "Trino connection test returned no results".into(),
                ));
            }
            Err(e) => {
                self.clear_state().await;
                return Err(e);
            }
            Ok(_) => {}
        }

        self.connected.store(true, Ordering::SeqCst);
        Ok(())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.connected.store(false, Ordering::SeqCst);
        self.clear_state().await;
        Ok(())
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let start = Instant::now();
        let (_, rows) = self.execute_full_query("SELECT version() AS version").await?;
        let latency = start.elapsed().as_millis() as u64;

        let version = rows
            .first()
            .and_then(|row| row.first())
            .and_then(|v| v.as_str())
            .map(String::from);

        Ok(CapabilityTestResult {
            success: true,
            message: "Connected to Trino".into(),
            latency_ms: Some(latency),
            server_version: version,
        })
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![AdapterCapability::SqlQueryable]
    }
}

#[async_trait]
impl SqlQueryable for TrinoAdapter {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError> {
        let (trino_cols, rows) = self.execute_full_query(sql).await?;

        let columns: Vec<CapabilityColumnMeta> = trino_cols
            .iter()
            .map(|col| CapabilityColumnMeta {
                name: col.name.clone(),
                data_type: map_trino_type(&col.type_name),
            })
            .collect();

        Ok(CapabilityQueryResult { columns, rows })
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError> {
        let (_, rows) = self.execute_full_query(sql).await?;
        Ok(rows.len() as u64)
    }
}
