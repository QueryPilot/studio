//! Redis-specific types

use serde::{Deserialize, Serialize};

/// Redis connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisConnectionConfig {
    pub host: String,
    pub port: u16,
    pub database: u8,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ssl: bool,
    pub connection_string: Option<String>,
    pub mode: RedisMode,
    pub sentinel_master: Option<String>,
    pub sentinel_password: Option<String>,
    pub nodes: Vec<RedisHostPort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisHostPort {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RedisMode {
    Standalone,
    Cluster,
    Sentinel,
}

impl Default for RedisConnectionConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 6379,
            database: 0,
            username: None,
            password: None,
            ssl: false,
            connection_string: None,
            mode: RedisMode::Standalone,
            sentinel_master: None,
            sentinel_password: None,
            nodes: vec![],
        }
    }
}

impl RedisHostPort {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
        }
    }
}
