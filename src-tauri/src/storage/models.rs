use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub password: Option<String>,
    pub database: Option<String>,
    pub ssh_private_key: Option<String>,
    pub api_key: Option<String>,
    pub connection_type: String,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Workspace configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub id: Uuid,
    pub name: String,
    pub connection_id: String,
    pub settings: WorkspaceSettings,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Workspace settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSettings {
    pub theme: String,
    pub font_size: i32,
    pub auto_commit: bool,
    pub query_timeout: i32,
    pub max_results: i32,
}

/// Stored credential (for keychain fallback)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCredential {
    pub id: Uuid,
    pub service: String,
    pub account: String,
    pub encrypted_secret: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Query history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistory {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub query_text: String,
    pub execution_time_ms: i64,
    pub rows_affected: Option<i64>,
    pub error_message: Option<String>,
    pub executed_at: DateTime<Utc>,
}

/// Connection metadata (non-sensitive)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionMetadata {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub database: Option<String>,
    pub connection_type: String,
    pub last_connected: Option<DateTime<Utc>>,
    pub favorite: bool,
    pub color: Option<String>,
    pub tags: Vec<String>,
}

/// Secure connection configuration for frontend communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureConnectionConfig {
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub password: Option<String>,
    pub database: Option<String>,
    pub connection_type: String,
}