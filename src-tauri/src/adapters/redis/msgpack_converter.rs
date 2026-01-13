//! Redis data to MessagePack encoder for high-performance streaming
//!
//! Converts Redis scan results and key-value data directly to MessagePack format
//! for efficient IPC streaming.

use crate::core::capabilities::{KeyInfo, ScanResult};
use crate::error::{AppError, Result};

/// Redis data to MessagePack encoder
pub struct RedisMsgPackEncoder {
    estimated_key_size: usize,
}

impl RedisMsgPackEncoder {
    pub fn new() -> Self {
        Self {
            estimated_key_size: 128,
        }
    }

    pub fn encode_scan_result(&mut self, result: &ScanResult) -> Result<Vec<u8>> {
        rmp_serde::to_vec(result)
            .map_err(|e| AppError::Internal(format!("MessagePack encoding failed: {}", e)))
    }

    pub fn encode_keys(&mut self, keys: &[KeyInfo]) -> Result<Vec<u8>> {
        let encoded = rmp_serde::to_vec(keys)
            .map_err(|e| AppError::Internal(format!("MessagePack encoding failed: {}", e)))?;
        
        if !keys.is_empty() {
            self.estimated_key_size = encoded.len() / keys.len();
        }
        
        Ok(encoded)
    }
}

impl Default for RedisMsgPackEncoder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::capabilities::RedisType;

    #[test]
    fn encodes_scan_result_to_msgpack() {
        let scan_result = ScanResult {
            cursor: 42,
            keys: vec![
                KeyInfo {
                    key: "user:1".to_string(),
                    key_type: RedisType::String,
                    ttl: -1,
                    size_bytes: Some(128),
                },
                KeyInfo {
                    key: "user:2".to_string(),
                    key_type: RedisType::Hash,
                    ttl: 3600,
                    size_bytes: Some(512),
                },
            ],
        };

        let mut encoder = RedisMsgPackEncoder::new();
        let encoded = encoder
            .encode_scan_result(&scan_result)
            .expect("encoding should succeed");

        assert!(!encoded.is_empty());

        let decoded: ScanResult =
            rmp_serde::from_slice(&encoded).expect("should decode as MessagePack");

        assert_eq!(decoded.cursor, 42);
        assert_eq!(decoded.keys.len(), 2);
        assert_eq!(decoded.keys[0].key, "user:1");
        assert_eq!(decoded.keys[1].key_type, RedisType::Hash);
    }

    #[test]
    fn encodes_empty_scan_result() {
        let scan_result = ScanResult {
            cursor: 0,
            keys: vec![],
        };

        let mut encoder = RedisMsgPackEncoder::new();
        let encoded = encoder
            .encode_scan_result(&scan_result)
            .expect("encoding should succeed");

        let decoded: ScanResult =
            rmp_serde::from_slice(&encoded).expect("should decode as MessagePack");

        assert_eq!(decoded.cursor, 0);
        assert!(decoded.keys.is_empty());
    }

    #[test]
    fn encodes_keys_batch_to_msgpack() {
        let keys = vec![
            KeyInfo {
                key: "session:abc".to_string(),
                key_type: RedisType::String,
                ttl: 1800,
                size_bytes: Some(256),
            },
            KeyInfo {
                key: "cache:xyz".to_string(),
                key_type: RedisType::List,
                ttl: -1,
                size_bytes: None,
            },
        ];

        let mut encoder = RedisMsgPackEncoder::new();
        let encoded = encoder.encode_keys(&keys).expect("encoding should succeed");

        assert!(!encoded.is_empty());

        let decoded: Vec<KeyInfo> =
            rmp_serde::from_slice(&encoded).expect("should decode as MessagePack");

        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].key, "session:abc");
        assert_eq!(decoded[1].key_type, RedisType::List);
    }
}
