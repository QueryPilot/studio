//! MongoDB-specific types

use serde::{Deserialize, Serialize};

/// MongoDB connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoConnectionConfig {
    pub hosts: Vec<HostPort>,
    pub database: Option<String>,
    pub auth_source: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub replica_set: Option<String>,
    pub ssl: bool,
    pub connection_string: Option<String>,
    /// Use mongodb+srv:// DNS seed list (Atlas)
    #[serde(default)]
    pub srv: bool,
    /// Force single-node connection (testing)
    #[serde(default)]
    pub direct_connection: bool,
    /// Application name for Atlas monitoring
    pub app_name: Option<String>,
    /// Authentication mechanism
    pub auth_mechanism: Option<MongoAuthMechanism>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostPort {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MongoAuthMechanism {
    #[serde(rename = "SCRAM-SHA-256")]
    ScramSha256,
    #[serde(rename = "SCRAM-SHA-1")]
    ScramSha1,
    #[serde(rename = "MONGODB-X509")]
    MongoDbX509,
    #[serde(rename = "MONGODB-AWS")]
    MongoDbAws,
}

impl Default for MongoConnectionConfig {
    fn default() -> Self {
        Self {
            hosts: vec![HostPort {
                host: "localhost".to_string(),
                port: 27017,
            }],
            database: None,
            auth_source: None,
            username: None,
            password: None,
            replica_set: None,
            ssl: false,
            connection_string: None,
            srv: false,
            direct_connection: false,
            app_name: None,
            auth_mechanism: None,
        }
    }
}

impl HostPort {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
        }
    }
}
