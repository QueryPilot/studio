//! Document database commands (MongoDB, etc.)
//!
//! Commands for document-oriented databases like MongoDB.
//! Includes CRUD operations, aggregation, streaming, and index management.

use std::sync::Arc;
use std::time::Instant;
use tauri::State;

use crate::adapters::mongodb::{
    BsonMsgPackEncoder, MongoCursorToken, MongoDocumentPage, MongoSchemaSample,
};
use crate::core::capabilities::FindOptions;
use crate::core::ConnectionManager;
use crate::types::*;

// ============================================================================
// MongoDB CRUD Commands
// ============================================================================

/// List all databases in MongoDB
#[tauri::command]
pub async fn mongo_list_databases(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<crate::core::capabilities::DatabaseInfo>, String> {
    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo.list_databases().await.map_err(|e| e.to_string())
}

/// List collections in the current MongoDB database
#[tauri::command]
pub async fn mongo_list_collections(
    conn_id: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<crate::core::capabilities::CollectionInfo>, String> {
    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo.list_collections().await.map_err(|e| e.to_string())
}

/// Find documents in a MongoDB collection
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn mongo_find_documents(
    conn_id: String,
    collection: String,
    filter: serde_json::Value,
    skip: Option<u64>,
    limit: Option<u64>,
    sort: Option<serde_json::Value>,
    projection: Option<serde_json::Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<serde_json::Value>, String> {
    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    let options = FindOptions {
        skip,
        limit: limit.or(Some(100)),
        sort,
        projection,
    };

    mongo
        .find_documents(&collection, filter, options)
        .await
        .map_err(|e| e.to_string())
}

/// Insert a document into a MongoDB collection
#[tauri::command]
pub async fn mongo_insert_document(
    conn_id: String,
    collection: String,
    document: serde_json::Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<crate::core::capabilities::InsertResult, String> {
    // Safe mode guard
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        crate::core::safe_mode::OperationKind::Insert,
        "Insert",
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo
        .insert_document(&collection, document)
        .await
        .map_err(|e| e.to_string())
}

/// Update a document in a MongoDB collection
#[tauri::command]
pub async fn mongo_update_document(
    conn_id: String,
    collection: String,
    filter: serde_json::Value,
    update: serde_json::Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<crate::core::capabilities::UpdateResult, String> {
    // Safe mode guard
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        crate::core::safe_mode::OperationKind::Update,
        "Update",
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo
        .update_document(&collection, filter, update)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a document from a MongoDB collection
#[tauri::command]
pub async fn mongo_delete_document(
    conn_id: String,
    collection: String,
    filter: serde_json::Value,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<crate::core::capabilities::DeleteResult, String> {
    // Safe mode guard
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        crate::core::safe_mode::OperationKind::Delete,
        "Delete",
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo
        .delete_document(&collection, filter)
        .await
        .map_err(|e| e.to_string())
}

/// Run an aggregation pipeline on a MongoDB collection
#[tauri::command]
pub async fn mongo_aggregate(
    conn_id: String,
    collection: String,
    pipeline: Vec<serde_json::Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<serde_json::Value>, String> {
    // Safe mode guard: check for $out / $merge stages that write data
    let op_kind = crate::core::safe_mode::classify_aggregation_pipeline(&pipeline);
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        op_kind,
        &format!("{:?}", op_kind),
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo
        .aggregate(&collection, pipeline)
        .await
        .map_err(|e| e.to_string())
}

/// Count documents in a MongoDB collection
#[tauri::command]
pub async fn mongo_count_documents(
    conn_id: String,
    collection: String,
    filter: Option<serde_json::Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo
        .count_documents(&collection, filter)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// MongoDB Index Commands
// ============================================================================

/// List indexes for a MongoDB collection
#[tauri::command]
pub async fn mongo_list_indexes(
    conn_id: String,
    collection: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<serde_json::Value>, String> {
    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo
        .list_indexes(&collection)
        .await
        .map_err(|e| e.to_string())
}

/// Create an index on a MongoDB collection
#[tauri::command]
pub async fn mongo_create_index(
    conn_id: String,
    collection: String,
    keys: serde_json::Value,
    options: Option<serde_json::Value>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
    // Safe mode guard
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        crate::core::safe_mode::OperationKind::Ddl,
        "CreateIndex",
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo
        .create_index(&collection, keys, options)
        .await
        .map_err(|e| e.to_string())
}

/// Drop an index from a MongoDB collection
#[tauri::command]
pub async fn mongo_drop_index(
    conn_id: String,
    collection: String,
    index_name: String,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    // Safe mode guard
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        crate::core::safe_mode::OperationKind::Ddl,
        "DropIndex",
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    mongo
        .drop_index(&collection, &index_name)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// MongoDB Streaming Commands
// ============================================================================

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn mongo_find_documents_stream(
    conn_id: String,
    collection: String,
    filter: serde_json::Value,
    skip: Option<u64>,
    limit: Option<u64>,
    sort: Option<serde_json::Value>,
    projection: Option<serde_json::Value>,
    batch_size: Option<usize>,
    metadata_channel: tauri::ipc::Channel<DocumentStreamMessage>,
    data_channel: tauri::ipc::Channel<tauri::ipc::Response>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
    let start = Instant::now();
    let batch_size = batch_size.unwrap_or(100);

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    let estimated_count = mongo
        .count_documents(&collection, Some(filter.clone()))
        .await
        .ok();

    metadata_channel
        .send(DocumentStreamMessage::Started {
            collection: collection.clone(),
            estimated_count,
        })
        .map_err(|e| e.to_string())?;

    let options = FindOptions {
        skip,
        limit,
        sort,
        projection,
    };

    let documents = mongo
        .find_documents(&collection, filter, options)
        .await
        .map_err(|e| e.to_string())?;

    let mut encoder = BsonMsgPackEncoder::new();
    let total_documents = documents.len();

    // Critical: Current implementation buffers entire result set in memory before chunking.
    // This is not true streaming - true cursor streaming is deferred to future work.
    // For now, enforce a size limit to prevent memory exhaustion.
    const MAX_STREAMING_DOCUMENTS: usize = 100_000;
    if total_documents > MAX_STREAMING_DOCUMENTS {
        return Err(format!(
            "Result set too large for streaming: {} documents exceeds limit of {}. \
            Use a filter or limit to reduce the result set size.",
            total_documents, MAX_STREAMING_DOCUMENTS
        ));
    }

    if total_documents > 10_000 {
        tracing::warn!(
            "Large result set ({} documents) being buffered in memory. \
            True cursor streaming is not yet implemented.",
            total_documents
        );
    }

    for chunk in documents.chunks(batch_size) {
        // Convert each document with proper error handling instead of silently dropping failures
        let bson_docs: Vec<bson::Document> = chunk
            .iter()
            .enumerate()
            .map(|(i, v)| {
                bson::to_document(v).map_err(|e| {
                    format!("Failed to convert document at index {} to BSON: {}", i, e)
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let encoded = encoder
            .encode_batch(&bson_docs)
            .map_err(|e| e.to_string())?;

        data_channel
            .send(tauri::ipc::Response::new(encoded))
            .map_err(|e| e.to_string())?;
    }

    let execution_time_ms = start.elapsed().as_millis() as u64;

    metadata_channel
        .send(DocumentStreamMessage::Success {
            total_documents,
            execution_time_ms,
        })
        .map_err(|e| e.to_string())?;

    // Trailing sentinel empty buffer. Consumers ignore zero-length payloads.
    let _ = data_channel.send(tauri::ipc::Response::new(vec![]));

    Ok(())
}

// ============================================================================
// Paradigm-Level Document Execute Command
// ============================================================================

/// Operation enum for document database commands (MongoDB, etc.)
/// This provides a unified IPC interface instead of per-command functions.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DocumentOperation {
    Find {
        collection: String,
        filter: serde_json::Value,
        #[serde(flatten)]
        options: FindOptions,
    },
    #[serde(alias = "find_page")]
    FindPage {
        collection: String,
        filter: serde_json::Value,
        #[serde(flatten)]
        options: FindOptions,
        cursor: Option<MongoCursorToken>,
    },
    Insert {
        collection: String,
        document: serde_json::Value,
    },
    InsertMany {
        collection: String,
        documents: Vec<serde_json::Value>,
    },
    Update {
        collection: String,
        filter: serde_json::Value,
        update: serde_json::Value,
    },
    Delete {
        collection: String,
        filter: serde_json::Value,
    },
    Aggregate {
        collection: String,
        pipeline: Vec<serde_json::Value>,
    },
    Count {
        collection: String,
        filter: Option<serde_json::Value>,
    },
    #[serde(alias = "sample_schema")]
    SampleSchema {
        collection: String,
        filter: Option<serde_json::Value>,
        sample_size: Option<u64>,
        max_depth: Option<u8>,
    },
    ListCollections,
    RunCommand {
        command: serde_json::Value,
    },
}

/// Result enum for document operations
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum DocumentResult {
    Documents(Vec<serde_json::Value>),
    DocumentPage(MongoDocumentPage),
    Insert(crate::core::capabilities::InsertResult),
    InsertMany(crate::core::capabilities::InsertManyResult),
    Update(crate::core::capabilities::UpdateResult),
    Delete(crate::core::capabilities::DeleteResult),
    Count(u64),
    SchemaSample(MongoSchemaSample),
    Collections(Vec<crate::core::capabilities::CollectionInfo>),
    Command(serde_json::Value),
}

/// Execute a document database operation (MongoDB, etc.)
/// This is a paradigm-level command that routes to the appropriate trait method.
///
/// The optional `database` parameter allows targeting a specific database
/// without modifying the adapter's default database state. When omitted,
/// the adapter's current database is used.
#[tauri::command]
pub async fn document_execute(
    conn_id: String,
    operation: DocumentOperation,
    database: Option<String>,
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<DocumentResult, String> {
    #[allow(unused_imports)]
    use crate::core::capabilities::DocumentQueryable;

    // Safe mode guard (synchronous lookup — no DashMap lock held across await)
    let op_kind = crate::core::safe_mode::classify_document_op(&operation);
    crate::core::safe_mode::check_safe_mode(
        manager.get_safe_mode(&conn_id),
        op_kind,
        &format!("{:?}", operation),
    )?;

    let adapter = manager
        .borrow_adapter_with_retry(&conn_id, 3)
        .await
        .map_err(|e| e.to_string())?;
    let mongo = adapter
        .as_mongo()
        .ok_or_else(|| "Not a MongoDB connection".to_string())?;

    // When a database override is provided, resolve a standalone Database handle
    // that does NOT modify the adapter's shared state.
    let db_override = match &database {
        Some(name) => Some(
            mongo
                .resolve_db(Some(name))
                .await
                .map_err(|e| e.to_string())?,
        ),
        None => None,
    };

    match operation {
        DocumentOperation::Find {
            collection,
            filter,
            options,
        } => {
            let docs = mongo
                .find_documents(&collection, filter, options)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Documents(docs))
        }
        DocumentOperation::FindPage {
            collection,
            filter,
            options,
            cursor,
        } => {
            let page = mongo
                .find_documents_page(&collection, filter, options, cursor)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::DocumentPage(page))
        }
        DocumentOperation::Insert {
            collection,
            document,
        } => {
            let result = if let Some(ref db) = db_override {
                mongo
                    .insert_document_on_db(db, &collection, document)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                mongo
                    .insert_document(&collection, document)
                    .await
                    .map_err(|e| e.to_string())?
            };
            Ok(DocumentResult::Insert(result))
        }
        DocumentOperation::InsertMany {
            collection,
            documents,
        } => {
            let result = mongo
                .insert_documents(&collection, documents)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::InsertMany(result))
        }
        DocumentOperation::Update {
            collection,
            filter,
            update,
        } => {
            let result = mongo
                .update_document(&collection, filter, update)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Update(result))
        }
        DocumentOperation::Delete { collection, filter } => {
            let result = mongo
                .delete_document(&collection, filter)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Delete(result))
        }
        DocumentOperation::Aggregate {
            collection,
            pipeline,
        } => {
            let docs = mongo
                .aggregate(&collection, pipeline)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Documents(docs))
        }
        DocumentOperation::Count { collection, filter } => {
            let count = mongo
                .count_documents(&collection, filter)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::Count(count))
        }
        DocumentOperation::SampleSchema {
            collection,
            filter,
            sample_size,
            max_depth,
        } => {
            let result = mongo
                .sample_collection_schema(
                    &collection,
                    filter,
                    sample_size.unwrap_or(500),
                    max_depth.unwrap_or(3),
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(DocumentResult::SchemaSample(result))
        }
        DocumentOperation::ListCollections => {
            let collections = if let Some(ref db) = db_override {
                mongo
                    .list_collections_on_db(db)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                mongo.list_collections().await.map_err(|e| e.to_string())?
            };
            Ok(DocumentResult::Collections(collections))
        }
        DocumentOperation::RunCommand { command } => {
            let result = if let Some(ref db) = db_override {
                mongo
                    .run_command_on_db(db, command)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                mongo
                    .run_command(command)
                    .await
                    .map_err(|e| e.to_string())?
            };
            Ok(DocumentResult::Command(result))
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
    fn test_document_operation_serialization() {
        let op = DocumentOperation::ListCollections;
        let json = serde_json::to_string(&op).unwrap();
        assert!(json.contains("listCollections"));

        let op2 = DocumentOperation::Find {
            collection: "users".to_string(),
            filter: serde_json::json!({"name": "test"}),
            options: FindOptions::default(),
        };
        let json2 = serde_json::to_string(&op2).unwrap();
        assert!(json2.contains("find"));
        assert!(json2.contains("users"));
    }

    #[test]
    fn test_document_result_serialization() {
        let result = DocumentResult::Count(42);
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("count"));
        assert!(json.contains("42"));
    }
}
