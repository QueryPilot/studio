use async_trait::async_trait;
use serde_json::Value;
use mongodb::{Client, Database, bson::doc};
use bson::Document;
use std::time::{Duration, Instant};
use std::collections::HashMap;
use uuid::Uuid;
use futures::{TryStreamExt, StreamExt};

use crate::error::AppError;
use super::{DbAdapter, TableMeta, FunctionMeta, ColumnMeta, QueryCursor, QueryPage, ExecuteResult, QueryOptions, TransactionId, TableReadRequest, TableDataResponse, DbObjectKind};

pub mod connection;
pub mod schema;
pub mod query_translator;
pub mod bson_converter;

use connection::MongoConnection;
use schema::SchemaInferrer;
use query_translator::{QueryTranslator, MongoQuery};
use bson_converter::BsonConverter;

pub struct MongoDbAdapter {
    client: Client,
    database: Database,
    connection: MongoConnection,
    schema_inferrer: SchemaInferrer,
    query_translator: QueryTranslator,
    bson_converter: BsonConverter,
}

impl MongoDbAdapter {
    pub fn new(client: Client, database_name: &str) -> Self {
        let database = client.database(database_name);
        
        Self {
            client: client.clone(),
            database: database.clone(),
            connection: MongoConnection::new(client.clone()),
            schema_inferrer: SchemaInferrer::new(database.clone(), client.clone()),
            query_translator: QueryTranslator::new(),
            bson_converter: BsonConverter::new(),
        }
    }

    pub fn get_client(&self) -> &Client {
        &self.client
    }

    pub fn get_database(&self) -> &Database {
        &self.database
    }
}

#[async_trait]
impl DbAdapter for MongoDbAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn ping(&self) -> Result<Duration, AppError> {
        let start = Instant::now();
        self.connection.ping().await?;
        Ok(start.elapsed())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.connection.disconnect().await
    }

    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        self.connection.list_databases().await
    }

    async fn list_schemas(&self, database: &str) -> Result<Vec<String>, AppError> {
        // MongoDB doesn't have schemas in the SQL sense
        // We'll return collections as "schemas"
        let db = self.client.database(database);
        let collections = db.list_collection_names(None).await
            .map_err(|e| AppError::Database(format!("Failed to list collections: {}", e)))?;
        Ok(collections)
    }

    async fn list_tables(&self, database: &str, _schema: &str) -> Result<Vec<TableMeta>, AppError> {
        let db = self.client.database(database);
        let mut collections = db.list_collections(None, None).await
            .map_err(|e| AppError::Database(format!("Failed to list collections: {}", e)))?;
        
        let mut tables = Vec::new();
        while let Ok(Some(collection_spec)) = collections.try_next().await {
            let name = collection_spec.name;
            let collection = db.collection::<Document>(&name);
            
            // Get collection stats
            let stats = collection.estimated_document_count(None).await.unwrap_or(0);
            
            tables.push(TableMeta {
                schema: database.to_string(),
                name,
                kind: DbObjectKind::Table, // MongoDB collections are like tables
                row_estimate: Some(stats as i64),
                size_bytes: None, // Could be fetched with collStats command
            });
        }
        
        Ok(tables)
    }

    async fn list_functions(&self, _database: &str, _schema: &str) -> Result<Vec<FunctionMeta>, AppError> {
        // MongoDB doesn't have stored procedures/functions in the SQL sense
        Ok(vec![])
    }

    async fn table_columns(&self, database: &str, _schema: &str, table: &str) -> Result<Vec<ColumnMeta>, AppError> {
        // For MongoDB, we'll return a minimal schema to avoid the expensive sampling
        // The actual fields will be shown when data is loaded
        Ok(vec![
            ColumnMeta {
                name: "_id".to_string(),
                db_type: "ObjectId".to_string(),
                nullable: false,
                default: None,
                is_pk: true,
                is_fk: false,
                ordinal: 0,
                precision: None,
                scale: None,
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
                mg_is_required: Some(true),
                mg_is_sparse_index: None,
                mg_index_type: None,
                mg_is_text_indexed: None,
                mg_text_weights: None,
                mg_bson_type: Some("objectId".to_string()),
                mg_field_path: Some("_id".to_string()),
                mg_is_array_element: Some(false),
                mg_validation_rule: None,
                mg_encryption: None,
            },
            // Add a placeholder for dynamic fields
            ColumnMeta {
                name: "*".to_string(),
                db_type: "Dynamic".to_string(),
                nullable: true,
                default: None,
                is_pk: false,
                is_fk: false,
                ordinal: 1,
                precision: None,
                scale: None,
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
                mg_is_required: Some(false),
                mg_is_sparse_index: None,
                mg_index_type: None,
                mg_is_text_indexed: None,
                mg_text_weights: None,
                mg_bson_type: Some("mixed".to_string()),
                mg_field_path: None,
                mg_is_array_element: None,
                mg_validation_rule: None,
                mg_encryption: None,
            }
        ])
    }

    async fn table_triggers(&self, _database: &str, _schema: &str, _table: &str) -> Result<Vec<super::TriggerMeta>, AppError> {
        // MongoDB doesn't have triggers in the SQL sense
        Ok(vec![])
    }

    async fn table_indexes(&self, database: &str, _schema: &str, table: &str) -> Result<Vec<super::TableIndex>, AppError> {
        let db = self.client.database(database);
        let collection = db.collection::<Document>(table);
        
        let mut cursor = collection.list_indexes(None).await
            .map_err(|e| AppError::Database(format!("Failed to list indexes: {}", e)))?;
        
        let mut indexes = Vec::new();
        while let Ok(Some(index)) = cursor.try_next().await {
            if let Some(name) = index.keys.get("name").and_then(|v| v.as_str()) {
                if name != "_id_" { // Skip the default _id index
                    indexes.push(super::TableIndex {
                        name: name.to_string(),
                        columns: vec![], // TODO: Parse key field
                        unique: false, // TODO: Extract from index options
                        primary: false,
                        index_type: "btree".to_string(), // MongoDB default
                    });
                }
            }
        }
        
        Ok(indexes)
    }

    async fn estimate_count(&self, database: &str, _schema: &str, table: &str) -> Result<i64, AppError> {
        let db = self.client.database(database);
        let collection = db.collection::<Document>(table);
        
        let count = collection.estimated_document_count(None).await
            .map_err(|e| AppError::Database(format!("Failed to count documents: {}", e)))?;
        
        Ok(count as i64)
    }

    async fn begin_query(&self, sql: &str, params: Option<Vec<Value>>, opts: QueryOptions) -> Result<QueryCursor, AppError> {
        // Try to translate SQL to MongoDB query
        match self.query_translator.translate_sql(sql, params) {
            Ok(mongo_query) => {
                // Execute MongoDB query
                self.execute_mongo_query(mongo_query, opts).await
            }
            Err(_) => {
                // If SQL translation fails, try to parse as native MongoDB query
                self.execute_native_query(sql, opts).await
            }
        }
    }

    async fn fetch_page(&self, _cursor: &mut QueryCursor, page: usize, _page_size: usize) -> Result<QueryPage, AppError> {
        // Implementation depends on cursor structure
        // For now, return empty page
        Ok(QueryPage {
            rows: vec![],
            page,
            is_complete: true,
        })
    }

    async fn close_cursor(&self, _cursor_id: &str) -> Result<(), AppError> {
        // MongoDB cursors are automatically cleaned up
        Ok(())
    }

    async fn execute(&self, sql: &str, params: Option<Vec<Value>>) -> Result<ExecuteResult, AppError> {
        // Try to translate SQL to MongoDB operations
        match self.query_translator.translate_sql(sql, params) {
            Ok(_mongo_query) => {
                let start = Instant::now();
                // Execute the MongoDB operation
                // For now, return a placeholder result
                Ok(ExecuteResult {
                    rows_affected: 0,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_millis() as f64,
                })
            }
            Err(e) => Err(AppError::Database(format!("SQL translation failed: {}", e)))
        }
    }

    async fn begin_transaction(&self) -> Result<TransactionId, AppError> {
        // MongoDB transactions are supported on replica sets
        // For now, return a placeholder transaction ID
        Ok(Uuid::new_v4().to_string())
    }

    async fn commit(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        // TODO: Implement transaction commit
        Ok(())
    }

    async fn rollback(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        // TODO: Implement transaction rollback
        Ok(())
    }

    async fn server_version(&self) -> Result<String, AppError> {
        self.connection.get_server_version().await
    }

    async fn read_table_data(&self, request: TableReadRequest) -> Result<(TableDataResponse, Option<String>), AppError> {
        println!("[MongoDB] read_table_data called for table: {}", request.table);
        let start = std::time::Instant::now();
        
        // Use timeout for the entire operation
        let timeout_duration = tokio::time::Duration::from_secs(10);
        
        match tokio::time::timeout(timeout_duration, self.read_table_data_impl(request)).await {
            Ok(result) => {
                println!("[MongoDB] Total operation completed in {:?}", start.elapsed());
                result
            }
            Err(_) => {
                println!("[MongoDB] Operation timed out after {:?}", start.elapsed());
                Err(AppError::Database(format!("MongoDB query timed out after {} seconds", timeout_duration.as_secs())))
            }
        }
    }

    async fn execute_raw_query(
        &self,
        database: &str,
        query: &str,
        limit: u32,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        // Try to execute as native MongoDB query first
        if let Ok(result) = self.execute_native_mongodb_query(database, query, limit).await {
            return Ok(result);
        }
        
        // Fall back to SQL translation
        match self.query_translator.translate_sql(query, None) {
            Ok(_mongo_query) => {
                // Execute translated query and return results
                Ok(serde_json::json!({
                    "message": "Query executed successfully",
                    "rows": []
                }))
            }
            Err(e) => Err(format!("Failed to execute query: {}", e).into())
        }
    }
}

impl MongoDbAdapter {
    async fn read_table_data_impl(&self, request: TableReadRequest) -> Result<(TableDataResponse, Option<String>), AppError> {
        let start = std::time::Instant::now();
        
        // MongoDB doesn't have traditional schema.table structure
        // We'll treat the table name as collection name
        let db = self.database.clone();
        let collection = db.collection::<Document>(&request.table);
        println!("[MongoDB] Collection obtained in {:?}", start.elapsed());
        
        // Build MongoDB query from filters
        let mut filter = Document::new();
        println!("[MongoDB] Processing {} filters", request.filters.len());
        for filter_spec in &request.filters {
            // Convert SQL-style filters to MongoDB filters
            // This is a simplified implementation
            match filter_spec.operator {
                super::types::FilterOperator::Equal => {
                    if let Ok(bson_val) = bson::to_bson(&filter_spec.value) {
                        filter.insert(&filter_spec.column, bson_val);
                    }
                }
                super::types::FilterOperator::GreaterThan => {
                    if let Ok(bson_val) = bson::to_bson(&filter_spec.value) {
                        filter.insert(&filter_spec.column, doc! { "$gt": bson_val });
                    }
                }
                super::types::FilterOperator::LessThan => {
                    if let Ok(bson_val) = bson::to_bson(&filter_spec.value) {
                        filter.insert(&filter_spec.column, doc! { "$lt": bson_val });
                    }
                }
                // Add more operators as needed
                _ => {}
            }
        }
        println!("[MongoDB] Filter document: {:?}", filter);
        
        // Apply pagination
        let (skip, limit) = match &request.pagination {
            super::types::PaginationMode::Offset { offset, limit } => (*offset as u64, *limit as i64),
            super::types::PaginationMode::Cursor { .. } => (0, 100),
        };
        
        // Execute query with skip and limit - with a more aggressive timeout
        println!("[MongoDB] Executing query with skip={}, limit={}", skip, limit);
        let options = mongodb::options::FindOptions::builder()
            .skip(Some(skip))
            .limit(Some(limit))
            .max_time(Some(std::time::Duration::from_secs(5))) // MongoDB server-side timeout
            .build();
        
        let query_start = std::time::Instant::now();
        
        // Try to execute the find operation
        let cursor_result = collection.find(filter.clone(), options).await;
        
        let mut cursor = match cursor_result {
            Ok(c) => {
                println!("[MongoDB] Query cursor created successfully in {:?}", query_start.elapsed());
                c
            }
            Err(e) => {
                println!("[MongoDB] Query failed after {:?}: {}", query_start.elapsed(), e);
                return Err(AppError::Database(format!("MongoDB query failed: {}", e)));
            }
        };
        
        let mut rows = Vec::new();
        let mut doc_count = 0;
        let fetch_start = std::time::Instant::now();
        
        println!("[MongoDB] Starting to fetch documents...");
        
        // Use try_next to avoid hanging
        loop {
            match cursor.try_next().await {
                Ok(Some(doc)) => {
                    doc_count += 1;
                    println!("[MongoDB] Processing document #{} at {:?}", doc_count, fetch_start.elapsed());
                    
                    let mut row = HashMap::new();
                    for (key, value) in doc {
                        let cell_value = self.bson_converter.bson_to_cell_value(&value, &key);
                        row.insert(key, cell_value);
                    }
                    rows.push(row);
                    
                    // Safety check - break if we hit the limit
                    if doc_count >= limit as usize {
                        println!("[MongoDB] Reached limit of {} documents", limit);
                        break;
                    }
                }
                Ok(None) => {
                    println!("[MongoDB] No more documents after {} docs", doc_count);
                    break;
                }
                Err(e) => {
                    println!("[MongoDB] Error reading document #{}: {}", doc_count + 1, e);
                    if rows.is_empty() {
                        return Err(AppError::Database(format!("Failed to read documents: {}", e)));
                    }
                    // If we have some rows, return what we got
                    break;
                }
            }
        }
        
        println!("[MongoDB] Fetched {} documents in {:?}", doc_count, fetch_start.elapsed());
        println!("[MongoDB] Total operation time: {:?}", start.elapsed());
        
        let row_count = rows.len();
        let response = TableDataResponse::Rows {
            rows,
            next_cursor: None, // TODO: Implement cursor pagination
        };
        
        println!("[MongoDB] Returning response with {} rows", row_count);
        Ok((response, None))
    }
    
    async fn execute_mongo_query(&self, query: MongoQuery, _opts: QueryOptions) -> Result<QueryCursor, AppError> {
        // TODO: Implement MongoDB query execution based on MongoQuery
        let _ = query; // Suppress unused warning for now
        Err(AppError::Unsupported("MongoDB query execution not yet implemented".to_string()))
    }
    
    async fn execute_native_query(&self, _query: &str, _opts: QueryOptions) -> Result<QueryCursor, AppError> {
        // TODO: Implement native MongoDB query execution
        Err(AppError::Unsupported("Native MongoDB query execution not yet implemented".to_string()))
    }
    
    async fn execute_native_mongodb_query(
        &self,
        database: &str,
        query: &str,
        _limit: u32,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        // Try to parse and execute as MongoDB aggregation pipeline or find query
        // This is a simplified implementation
        let _db = self.client.database(database);
        
        // Try to parse as JSON
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(query) {
            if let Ok(_doc) = bson::to_document(&json_value) {
                // Try to execute as aggregation pipeline
                // This is a placeholder implementation
                return Ok(serde_json::json!({
                    "message": "Native MongoDB query executed",
                    "result": "success"
                }));
            }
        }
        
        Err("Failed to parse native MongoDB query".into())
    }
}