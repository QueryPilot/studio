//! Key-value database commands (Redis, etc.)
//!
//! Commands for key-value stores like Redis.
//! Includes basic operations, hash/list/set/zset/stream operations, and streaming.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::State;

use crate::adapters::redis::RedisMsgPackEncoder;
use crate::core::capabilities::{KeyValueOperable, RichKeyValueOperable};
use crate::core::ConnectionManager;
use crate::types::*;

// ============================================================================
// Redis Basic Commands
// ============================================================================

/// Get a string value from Redis
#[tauri::command]
pub async fn redis_get(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Option<String>, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter.get_string(&key).await.map_err(|e| e.to_string())
}

/// Set a string value in Redis
#[tauri::command]
pub async fn redis_set(
    conn_id: String,
    key: String,
    value: String,
    ttl_seconds: Option<u64>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter
        .set_string(&key, &value, ttl_seconds)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a key from Redis
#[tauri::command]
pub async fn redis_delete(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter.delete_key(&key).await.map_err(|e| e.to_string())
}

/// Get TTL of a key in Redis
#[tauri::command]
pub async fn redis_ttl(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter.key_ttl(&key).await.map_err(|e| e.to_string())
}

/// Set TTL on a key in Redis
#[tauri::command]
pub async fn redis_expire(
    conn_id: String,
    key: String,
    seconds: u64,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter
        .set_key_ttl(&key, seconds)
        .await
        .map_err(|e| e.to_string())
}

/// Check if a key exists in Redis
#[tauri::command]
pub async fn redis_exists(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter.key_exists(&key).await.map_err(|e| e.to_string())
}

/// Get database size (number of keys)
#[tauri::command]
pub async fn redis_dbsize(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter.dbsize().await.map_err(|e| e.to_string())
}

/// Get server info
#[tauri::command]
pub async fn redis_info(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter
        .get_server_info_raw()
        .await
        .map_err(|e| e.to_string())
}

/// Get key type
#[tauri::command]
pub async fn redis_type(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter.key_type(&key).await.map_err(|e| e.to_string())
}

// ============================================================================
// Redis Hash Commands
// ============================================================================

/// Get all hash fields and values
#[tauri::command]
pub async fn redis_hgetall(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<HashMap<String, String>, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter.hash_get_all(&key).await.map_err(|e| e.to_string())
}

/// Set a hash field
#[tauri::command]
pub async fn redis_hset(
    conn_id: String,
    key: String,
    field: String,
    value: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter
        .hash_set_field(&key, &field, &value)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Redis List Commands
// ============================================================================

/// Get list range
#[tauri::command]
pub async fn redis_lrange(
    conn_id: String,
    key: String,
    start: i64,
    stop: i64,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<String>, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter
        .list_range(&key, start, stop)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Redis Set Commands
// ============================================================================

/// Get set members
#[tauri::command]
pub async fn redis_smembers(
    conn_id: String,
    key: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<String>, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    adapter.set_members(&key).await.map_err(|e| e.to_string())
}

// ============================================================================
// Redis Streaming Commands
// ============================================================================

#[tauri::command]
pub async fn redis_scan_stream(
    conn_id: String,
    pattern: String,
    count: Option<u32>,
    metadata_channel: tauri::ipc::Channel<KeyValueStreamMessage>,
    data_channel: tauri::ipc::Channel<tauri::ipc::Response>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let start = Instant::now();
    let count_per_scan = count.unwrap_or(100);

    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    let estimated_keys = adapter.dbsize().await.ok();

    metadata_channel
        .send(KeyValueStreamMessage::Started {
            pattern: pattern.clone(),
            estimated_keys,
        })
        .map_err(|e| e.to_string())?;

    let mut encoder = RedisMsgPackEncoder::new();
    let mut cursor: u64 = 0;
    let mut total_keys = 0;

    loop {
        let scan_result = adapter
            .scan_keys(&pattern, cursor, count_per_scan)
            .await
            .map_err(|e| e.to_string())?;

        if !scan_result.keys.is_empty() {
            let encoded = encoder
                .encode_keys(&scan_result.keys)
                .map_err(|e| e.to_string())?;

            data_channel
                .send(tauri::ipc::Response::new(encoded))
                .map_err(|e| e.to_string())?;

            total_keys += scan_result.keys.len();
        }

        metadata_channel
            .send(KeyValueStreamMessage::Progress {
                cursor: scan_result.cursor,
                keys_so_far: total_keys,
            })
            .map_err(|e| e.to_string())?;

        cursor = scan_result.cursor;
        if cursor == 0 {
            break;
        }
    }

    let execution_time_ms = start.elapsed().as_millis() as u64;

    metadata_channel
        .send(KeyValueStreamMessage::Success {
            total_keys,
            execution_time_ms,
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================================
// Paradigm-Level KeyValue Execute Command
// ============================================================================

/// Operation enum for key-value database commands (Redis, etc.)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum KeyValueOperation {
    // Basic operations
    Get {
        key: String,
    },
    Set {
        key: String,
        value: crate::core::capabilities::RedisValue,
        #[serde(default)]
        options: crate::core::capabilities::SetOptions,
    },
    Delete {
        keys: Vec<String>,
    },
    Exists {
        keys: Vec<String>,
    },
    Scan {
        pattern: String,
        cursor: u64,
        count: u32,
    },
    Type {
        key: String,
    },
    Ttl {
        key: String,
    },
    SetTtl {
        key: String,
        seconds: u64,
    },
    ExecuteRaw {
        command: String,
        args: Vec<String>,
    },
    DbSize,
    SelectDb {
        index: u8,
    },
    ServerInfo {
        section: Option<String>,
    },
    // Rich operations - Hash
    HashGetAll {
        key: String,
    },
    HashSet {
        key: String,
        fields: HashMap<String, String>,
    },
    HashDelete {
        key: String,
        fields: Vec<String>,
    },
    // Rich operations - List
    ListRange {
        key: String,
        start: i64,
        stop: i64,
    },
    ListPush {
        key: String,
        values: Vec<String>,
        side: crate::core::capabilities::ListSide,
    },
    ListLen {
        key: String,
    },
    // Rich operations - Set
    SetMembers {
        key: String,
    },
    SetAdd {
        key: String,
        members: Vec<String>,
    },
    SetRemove {
        key: String,
        members: Vec<String>,
    },
    // Rich operations - Sorted Set
    ZSetRange {
        key: String,
        start: i64,
        stop: i64,
        with_scores: bool,
    },
    ZSetAdd {
        key: String,
        members: Vec<crate::core::capabilities::ZSetMember>,
    },
    // Rich operations - Stream
    StreamRange {
        key: String,
        start: String,
        end: String,
        count: Option<u32>,
    },
    StreamLen {
        key: String,
    },
}

/// Result enum for key-value operations
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum KeyValueResult {
    Value(Option<crate::core::capabilities::RedisValue>),
    Ok,
    Count(u64),
    Bool(bool),
    Scan(crate::core::capabilities::ScanResult),
    KeyType(crate::core::capabilities::RedisType),
    Ttl(i64),
    ServerInfo(HashMap<String, String>),
    // Rich results
    Hash(HashMap<String, String>),
    List(Vec<String>),
    Set(Vec<String>),
    ZSet(Vec<crate::core::capabilities::ZSetMember>),
    Stream(Vec<crate::core::capabilities::StreamEntry>),
}

/// Execute a key-value database operation (Redis, etc.)
/// This is a paradigm-level command that routes to the appropriate trait method.
#[tauri::command]
pub async fn keyvalue_execute(
    conn_id: String,
    operation: KeyValueOperation,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<KeyValueResult, String> {
    let conn = manager
        .get_connection_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let adapter = conn
        .adapter
        .as_redis()
        .ok_or_else(|| "Not a Redis connection".to_string())?;

    match operation {
        // Basic operations
        KeyValueOperation::Get { key } => {
            let value = adapter.get_key(&key).await.map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Value(value))
        }
        KeyValueOperation::Set {
            key,
            value,
            options,
        } => {
            adapter
                .set_key(&key, value, options)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Ok)
        }
        KeyValueOperation::Delete { keys } => {
            let count = adapter
                .delete_keys(&keys)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        KeyValueOperation::Exists { keys } => {
            let count = KeyValueOperable::key_exists(adapter, &keys)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        KeyValueOperation::Scan {
            pattern,
            cursor,
            count,
        } => {
            let result = adapter
                .scan_keys(&pattern, cursor, count)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Scan(result))
        }
        KeyValueOperation::Type { key } => {
            let key_type = adapter
                .get_key_type(&key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::KeyType(key_type))
        }
        KeyValueOperation::Ttl { key } => {
            let ttl = adapter
                .get_key_ttl(&key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Ttl(ttl))
        }
        KeyValueOperation::SetTtl { key, seconds } => {
            let success = adapter
                .set_key_ttl(&key, seconds)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Bool(success))
        }
        KeyValueOperation::ExecuteRaw { command, args } => {
            let value = adapter
                .execute_raw(&command, &args)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Value(Some(value)))
        }
        KeyValueOperation::DbSize => {
            let size = adapter
                .get_database_size()
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(size))
        }
        KeyValueOperation::SelectDb { index } => {
            adapter
                .select_database(index)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Ok)
        }
        KeyValueOperation::ServerInfo { section } => {
            let info = adapter
                .get_server_info(section.as_deref())
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::ServerInfo(info))
        }
        // Rich operations - Hash
        KeyValueOperation::HashGetAll { key } => {
            let hash = adapter
                .hash_get_all(&key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Hash(hash))
        }
        KeyValueOperation::HashSet { key, fields } => {
            let count = adapter
                .hash_set(&key, fields)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        KeyValueOperation::HashDelete { key, fields } => {
            let count = adapter
                .hash_delete(&key, &fields)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        // Rich operations - List
        KeyValueOperation::ListRange { key, start, stop } => {
            let list = adapter
                .list_range(&key, start, stop)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::List(list))
        }
        KeyValueOperation::ListPush { key, values, side } => {
            let count = adapter
                .list_push(&key, &values, side)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        KeyValueOperation::ListLen { key } => {
            let len = adapter.list_len(&key).await.map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(len))
        }
        // Rich operations - Set
        KeyValueOperation::SetMembers { key } => {
            let members = adapter
                .set_members(&key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Set(members))
        }
        KeyValueOperation::SetAdd { key, members } => {
            let count = RichKeyValueOperable::set_add(adapter, &key, &members)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        KeyValueOperation::SetRemove { key, members } => {
            let count = RichKeyValueOperable::set_remove(adapter, &key, &members)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        // Rich operations - Sorted Set
        KeyValueOperation::ZSetRange {
            key,
            start,
            stop,
            with_scores,
        } => {
            let members = adapter
                .zset_range(&key, start, stop, with_scores)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::ZSet(members))
        }
        KeyValueOperation::ZSetAdd { key, members } => {
            let count = RichKeyValueOperable::zset_add(adapter, &key, &members)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(count))
        }
        // Rich operations - Stream
        KeyValueOperation::StreamRange {
            key,
            start,
            end,
            count,
        } => {
            let entries = adapter
                .stream_range(&key, &start, &end, count)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Stream(entries))
        }
        KeyValueOperation::StreamLen { key } => {
            let len = adapter.stream_len(&key).await.map_err(|e| e.to_string())?;
            Ok(KeyValueResult::Count(len))
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyvalue_operation_serialization() {
        let op = KeyValueOperation::DbSize;
        let json = serde_json::to_string(&op).unwrap();
        assert!(json.contains("dbSize"));

        let op2 = KeyValueOperation::Get {
            key: "test_key".to_string(),
        };
        let json2 = serde_json::to_string(&op2).unwrap();
        assert!(json2.contains("get"));
        assert!(json2.contains("test_key"));
    }

    #[test]
    fn test_keyvalue_result_serialization() {
        let result = KeyValueResult::Count(100);
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("count"));
        assert!(json.contains("100"));
    }
}
