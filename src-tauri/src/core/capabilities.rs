//! Capability traits for database adapters
//!
//! This module defines the capability-based trait system that allows different
//! database paradigms (SQL, Document, KeyValue) to be handled through a
//! common interface while still supporting paradigm-specific operations.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::error::AppError;
use crate::types::ConnectionProfile;

// ============ Capability Traits ============

/// Base capability - all adapters implement this
#[async_trait]
pub trait BaseCapability: Send + Sync {
    /// Connect to the database using the provided profile
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError>;
    
    /// Disconnect from the database
    async fn disconnect(&self) -> Result<(), AppError>;
    
    /// Test the connection and return status
    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError>;
    
    /// Check if currently connected
    fn is_connected(&self) -> bool;
    
    /// Get the capabilities this adapter supports
    fn get_capabilities(&self) -> Vec<AdapterCapability>;
}

/// SQL databases only
#[async_trait]
pub trait SqlQueryable: BaseCapability {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult, AppError>;
    async fn execute_statement(&self, sql: &str) -> Result<u64, AppError>;
}

/// Document databases (MongoDB, CouchDB, Firestore)
#[async_trait]
pub trait DocumentQueryable: BaseCapability {
    async fn find_documents(
        &self,
        collection: &str,
        filter: Value,
        options: FindOptions,
    ) -> Result<Vec<Value>, AppError>;

    async fn insert_document(
        &self,
        collection: &str,
        doc: Value,
    ) -> Result<InsertResult, AppError>;

    async fn insert_documents(
        &self,
        collection: &str,
        docs: Vec<Value>,
    ) -> Result<InsertManyResult, AppError>;

    async fn update_document(
        &self,
        collection: &str,
        filter: Value,
        update: Value,
    ) -> Result<UpdateResult, AppError>;

    async fn delete_document(
        &self,
        collection: &str,
        filter: Value,
    ) -> Result<DeleteResult, AppError>;

    async fn aggregate(
        &self,
        collection: &str,
        pipeline: Vec<Value>,
    ) -> Result<Vec<Value>, AppError>;

    async fn count_documents(
        &self,
        collection: &str,
        filter: Option<Value>,
    ) -> Result<u64, AppError>;

    async fn list_collections(&self) -> Result<Vec<CollectionInfo>, AppError>;

    async fn run_command(&self, command: Value) -> Result<Value, AppError>;
}

/// Key-value databases (all: Redis, Memcached, etcd)
#[async_trait]
pub trait KeyValueOperable: BaseCapability {
    async fn get_key(&self, key: &str) -> Result<Option<RedisValue>, AppError>;
    async fn set_key(
        &self,
        key: &str,
        value: RedisValue,
        options: SetOptions,
    ) -> Result<(), AppError>;
    async fn delete_keys(&self, keys: &[String]) -> Result<u64, AppError>;
    async fn key_exists(&self, keys: &[String]) -> Result<u64, AppError>;
    async fn scan_keys(
        &self,
        pattern: &str,
        cursor: u64,
        count: u32,
    ) -> Result<ScanResult, AppError>;
    async fn get_key_type(&self, key: &str) -> Result<RedisType, AppError>;
    async fn get_key_ttl(&self, key: &str) -> Result<i64, AppError>;
    async fn set_key_ttl(&self, key: &str, seconds: u64) -> Result<bool, AppError>;
    async fn execute_raw(&self, command: &str, args: &[String]) -> Result<RedisValue, AppError>;
    async fn get_database_size(&self) -> Result<u64, AppError>;
    async fn select_database(&self, index: u8) -> Result<(), AppError>;
    async fn get_server_info(
        &self,
        section: Option<&str>,
    ) -> Result<HashMap<String, String>, AppError>;
    async fn scan_keys_with_previews(
        &self,
        pattern: &str,
        cursor: u64,
        count: u32,
    ) -> Result<ScanResultWithPreviews, AppError>;
}

/// Rich key-value (Redis, Valkey, KeyDB) - extends basic KV
#[async_trait]
pub trait RichKeyValueOperable: KeyValueOperable {
    // Hash
    async fn hash_get_all(&self, key: &str) -> Result<HashMap<String, String>, AppError>;
    async fn hash_set(&self, key: &str, fields: HashMap<String, String>) -> Result<u64, AppError>;
    async fn hash_delete(&self, key: &str, fields: &[String]) -> Result<u64, AppError>;

    // List
    async fn list_range(&self, key: &str, start: i64, stop: i64) -> Result<Vec<String>, AppError>;
    async fn list_push(&self, key: &str, values: &[String], side: ListSide)
        -> Result<u64, AppError>;
    async fn list_len(&self, key: &str) -> Result<u64, AppError>;

    // Set
    async fn set_members(&self, key: &str) -> Result<Vec<String>, AppError>;
    async fn set_add(&self, key: &str, members: &[String]) -> Result<u64, AppError>;
    async fn set_remove(&self, key: &str, members: &[String]) -> Result<u64, AppError>;

    // Sorted Set
    async fn zset_range(
        &self,
        key: &str,
        start: i64,
        stop: i64,
        with_scores: bool,
    ) -> Result<Vec<ZSetMember>, AppError>;
    async fn zset_add(&self, key: &str, members: &[ZSetMember]) -> Result<u64, AppError>;

    // Stream
    async fn stream_range(
        &self,
        key: &str,
        start: &str,
        end: &str,
        count: Option<u32>,
    ) -> Result<Vec<StreamEntry>, AppError>;
    async fn stream_len(&self, key: &str) -> Result<u64, AppError>;
}

// ============ Supporting Types ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityTestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AdapterCapability {
    SqlQueryable,
    DocumentQueryable,
    KeyValueOperable,
    RichKeyValueOperable,
    BackupCapable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityQueryResult {
    pub columns: Vec<CapabilityColumnMeta>,
    pub rows: Vec<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityColumnMeta {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindOptions {
    pub skip: Option<u64>,
    pub limit: Option<u64>,
    pub sort: Option<Value>,
    pub projection: Option<Value>,
}

impl Default for FindOptions {
    fn default() -> Self {
        Self {
            skip: None,
            limit: Some(100),
            sort: None,
            projection: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertResult {
    pub inserted_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertManyResult {
    pub inserted_ids: Vec<String>,
    pub inserted_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub matched_count: u64,
    pub modified_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub deleted_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    pub name: String,
    pub doc_count: Option<u64>,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub table_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub index_type: Option<String>,
}

// ============ Redis-specific types ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum RedisValue {
    Nil,
    String(String),
    Bytes(Vec<u8>),
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Array(Vec<RedisValue>),
    Map(HashMap<String, RedisValue>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RedisType {
    String,
    List,
    Set,
    ZSet,
    Hash,
    Stream,
    Unknown,
}

impl std::fmt::Display for RedisType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RedisType::String => write!(f, "string"),
            RedisType::List => write!(f, "list"),
            RedisType::Set => write!(f, "set"),
            RedisType::ZSet => write!(f, "zset"),
            RedisType::Hash => write!(f, "hash"),
            RedisType::Stream => write!(f, "stream"),
            RedisType::Unknown => write!(f, "unknown"),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetOptions {
    pub ttl_seconds: Option<u64>,
    /// Only set if not exists
    pub nx: bool,
    /// Only set if exists
    pub xx: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub cursor: u64,
    pub keys: Vec<KeyInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    pub key: String,
    pub key_type: RedisType,
    pub ttl: i64,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfoWithPreview {
    pub key: String,
    pub key_type: RedisType,
    pub ttl: i64,
    pub size_bytes: Option<u64>,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResultWithPreviews {
    pub cursor: u64,
    pub keys: Vec<KeyInfoWithPreview>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZSetMember {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEntry {
    pub id: String,
    pub fields: HashMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redis_type_display() {
        assert_eq!(RedisType::String.to_string(), "string");
        assert_eq!(RedisType::List.to_string(), "list");
        assert_eq!(RedisType::ZSet.to_string(), "zset");
    }

    #[test]
    fn test_find_options_default() {
        let opts = FindOptions::default();
        assert_eq!(opts.skip, None);
        assert_eq!(opts.limit, Some(100));
    }

    #[test]
    fn test_set_options_default() {
        let opts = SetOptions::default();
        assert_eq!(opts.ttl_seconds, None);
        assert!(!opts.nx);
        assert!(!opts.xx);
    }

    #[test]
    fn mongodb_adapter_implements_document_queryable() {
        use crate::adapters::MongoDbAdapter;
        fn assert_impl<T: DocumentQueryable>() {}
        assert_impl::<MongoDbAdapter>();
    }

    #[test]
    fn redis_adapter_implements_keyvalue_ops() {
        use crate::adapters::RedisAdapter;
        fn assert_impl<T: KeyValueOperable>() {}
        assert_impl::<RedisAdapter>();
    }

    #[test]
    fn redis_adapter_implements_rich_keyvalue_ops() {
        use crate::adapters::RedisAdapter;
        fn assert_impl<T: RichKeyValueOperable>() {}
        assert_impl::<RedisAdapter>();
    }
}
