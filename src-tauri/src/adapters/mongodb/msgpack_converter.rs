//! MongoDB BSON to MessagePack encoder for high-performance streaming
//!
//! Converts MongoDB BSON documents directly to MessagePack format for efficient
//! IPC streaming. Follows the same pattern as `postgres/direct_msgpack.rs`.

use crate::error::{AppError, Result};
use bson::{Bson, Document};

/// MongoDB BSON to MessagePack encoder
///
/// Encodes BSON documents to MessagePack bytes for streaming via IPC channels.
pub struct BsonMsgPackEncoder {
    estimated_doc_size: usize,
}

impl BsonMsgPackEncoder {
    pub fn new() -> Self {
        Self {
            estimated_doc_size: 256,
        }
    }

    /// Encode a batch of BSON documents to MessagePack bytes
    pub fn encode_batch(&mut self, documents: &[Document]) -> Result<Vec<u8>> {
        let bson_values: Vec<Bson> = documents
            .iter()
            .map(|d| Bson::Document(d.clone()))
            .collect();
        let encoded = rmp_serde::to_vec(&bson_values)
            .map_err(|e| AppError::Internal(format!("MessagePack encoding failed: {}", e)))?;

        if !documents.is_empty() {
            self.estimated_doc_size = encoded.len() / documents.len();
        }

        Ok(encoded)
    }
}

impl Default for BsonMsgPackEncoder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::doc;

    #[test]
    fn encodes_bson_documents_to_msgpack() {
        // Arrange: Create test documents
        let docs = vec![
            doc! { "_id": 1, "name": "Alice", "active": true },
            doc! { "_id": 2, "name": "Bob", "active": false },
        ];

        // Act: Encode to MessagePack
        let mut encoder = BsonMsgPackEncoder::new();
        let encoded = encoder
            .encode_batch(&docs)
            .expect("encoding should succeed");

        // Assert: Verify we got valid MessagePack bytes
        assert!(!encoded.is_empty(), "encoded bytes should not be empty");

        // Decode and verify roundtrip
        let decoded: Vec<bson::Bson> =
            rmp_serde::from_slice(&encoded).expect("should decode as MessagePack");

        assert_eq!(decoded.len(), 2, "should have 2 documents");

        // Verify first document structure
        if let bson::Bson::Document(doc) = &decoded[0] {
            assert_eq!(doc.get_i32("_id").unwrap(), 1);
            assert_eq!(doc.get_str("name").unwrap(), "Alice");
            assert_eq!(doc.get_bool("active").unwrap(), true);
        } else {
            panic!("Expected Document, got {:?}", decoded[0]);
        }
    }

    #[test]
    fn encodes_empty_batch() {
        let docs: Vec<Document> = vec![];
        let mut encoder = BsonMsgPackEncoder::new();
        let encoded = encoder
            .encode_batch(&docs)
            .expect("encoding should succeed");

        // Should encode as empty array
        let decoded: Vec<bson::Bson> =
            rmp_serde::from_slice(&encoded).expect("should decode as MessagePack");
        assert!(decoded.is_empty());
    }

    #[test]
    fn encodes_nested_documents() {
        let docs = vec![doc! {
            "_id": 1,
            "user": {
                "name": "Alice",
                "address": {
                    "city": "NYC",
                    "zip": "10001"
                }
            },
            "tags": ["rust", "mongodb"]
        }];

        let mut encoder = BsonMsgPackEncoder::new();
        let encoded = encoder
            .encode_batch(&docs)
            .expect("encoding should succeed");

        let decoded: Vec<bson::Bson> =
            rmp_serde::from_slice(&encoded).expect("should decode as MessagePack");

        assert_eq!(decoded.len(), 1);
        if let bson::Bson::Document(doc) = &decoded[0] {
            let user = doc.get_document("user").unwrap();
            assert_eq!(user.get_str("name").unwrap(), "Alice");

            let address = user.get_document("address").unwrap();
            assert_eq!(address.get_str("city").unwrap(), "NYC");

            let tags = doc.get_array("tags").unwrap();
            assert_eq!(tags.len(), 2);
        } else {
            panic!("Expected Document");
        }
    }
}
