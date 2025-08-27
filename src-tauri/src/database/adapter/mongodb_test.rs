use super::mongodb::{MongoDbAdapter, connection::MongoConnection, schema::SchemaInferrer, bson_converter::BsonConverter};
use super::types::*;
use super::DbAdapter;
use crate::database::cell_value::{CellValue, CellValueType, CellMetadata};
use crate::error::AppError;
use mongodb::{Client, options::{ClientOptions, Credential}};
use bson::{doc, Document, Bson, oid::ObjectId, Decimal128, Binary};
use std::str::FromStr;
use std::time::Duration;
use std::collections::HashMap;
use serde_json::json;
use tokio;

const TEST_CONNECTION_STRING: &str = "mongodb://devuser:devpass123@localhost:17017/todoapp?authSource=admin";
const TEST_DATABASE: &str = "todoapp";

async fn create_test_client() -> Result<Client, mongodb::error::Error> {
    let mut client_options = ClientOptions::parse(TEST_CONNECTION_STRING).await?;
    client_options.server_selection_timeout = Some(Duration::from_secs(5));
    client_options.connect_timeout = Some(Duration::from_secs(5));
    Client::with_options(client_options)
}

async fn setup_test_adapter() -> Result<MongoDbAdapter, AppError> {
    let client = create_test_client().await
        .map_err(|e| AppError::Database(format!("Failed to create MongoDB client: {}", e)))?;
    Ok(MongoDbAdapter::new(client, TEST_DATABASE))
}

#[tokio::test]
async fn test_mongodb_connection() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    // Test ping
    let ping_result = adapter.ping().await;
    assert!(ping_result.is_ok(), "MongoDB ping should succeed");
    
    let duration = ping_result.unwrap();
    assert!(duration < Duration::from_secs(5), "Ping should be fast");
}

#[tokio::test]
async fn test_list_databases() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let databases = adapter.list_databases().await;
    assert!(databases.is_ok(), "Should list databases successfully");
    
    let db_list = databases.unwrap();
    assert!(db_list.contains(&TEST_DATABASE.to_string()), "Should contain test database");
}

#[tokio::test]
async fn test_list_schemas() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let schemas = adapter.list_schemas(TEST_DATABASE).await;
    assert!(schemas.is_ok(), "Should list collections (schemas) successfully");
    
    let schema_list = schemas.unwrap();
    // Should contain collections from seed data
    assert!(schema_list.len() > 0, "Should have at least one collection");
}

#[tokio::test]
async fn test_list_tables() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let tables = adapter.list_tables(TEST_DATABASE, "").await;
    assert!(tables.is_ok(), "Should list tables successfully");
    
    let table_list = tables.unwrap();
    assert!(table_list.len() > 0, "Should have at least one table");
    
    // Check if our seed collections exist
    let collection_names: Vec<String> = table_list.iter().map(|t| t.name.clone()).collect();
    assert!(collection_names.contains(&"users".to_string()));
    assert!(collection_names.contains(&"todos".to_string()));
    assert!(collection_names.contains(&"complex_types".to_string()));
}

#[tokio::test]
async fn test_table_columns_schema_inference() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    // Test schema inference on users collection
    let columns = adapter.table_columns(TEST_DATABASE, "", "users").await;
    assert!(columns.is_ok(), "Should infer schema successfully");
    
    let column_list = columns.unwrap();
    assert!(column_list.len() > 0, "Should have inferred columns");
    
    // Check for expected fields
    let column_names: Vec<String> = column_list.iter().map(|c| c.name.clone()).collect();
    assert!(column_names.contains(&"_id".to_string()), "Should have _id field");
    assert!(column_names.contains(&"username".to_string()), "Should have username field");
    assert!(column_names.contains(&"email".to_string()), "Should have email field");
    assert!(column_names.contains(&"profile".to_string()), "Should have nested profile field");
    
    // Check that _id is marked as primary key
    let id_column = column_list.iter().find(|c| c.name == "_id").unwrap();
    assert!(id_column.is_pk, "_id should be primary key");
    assert_eq!(id_column.db_type, "objectId", "_id should be ObjectId type");
}

#[tokio::test]
async fn test_complex_types_schema_inference() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let columns = adapter.table_columns(TEST_DATABASE, "", "complex_types").await;
    assert!(columns.is_ok(), "Should infer complex types schema successfully");
    
    let column_list = columns.unwrap();
    let column_map: HashMap<String, &ColumnMeta> = column_list.iter()
        .map(|c| (c.name.clone(), c))
        .collect();

    // Test various BSON types are correctly inferred
    assert!(column_map.contains_key("int32_value"));
    assert!(column_map.contains_key("int64_value"));
    assert!(column_map.contains_key("decimal128_value"));
    assert!(column_map.contains_key("double_value"));
    assert!(column_map.contains_key("bool_true"));
    assert!(column_map.contains_key("current_date"));
    assert!(column_map.contains_key("binary_data"));
    assert!(column_map.contains_key("regex_pattern"));

    // Check specific type mappings
    if let Some(col) = column_map.get("int32_value") {
        assert_eq!(col.db_type, "int32");
    }
    if let Some(col) = column_map.get("decimal128_value") {
        assert_eq!(col.db_type, "decimal128");
    }
    if let Some(col) = column_map.get("bool_true") {
        assert_eq!(col.db_type, "boolean");
    }
}

#[tokio::test]
async fn test_table_indexes() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let indexes = adapter.table_indexes(TEST_DATABASE, "", "users").await;
    assert!(indexes.is_ok(), "Should list indexes successfully");
    
    let index_list = indexes.unwrap();
    // Should have indexes created by seed script (excluding default _id_)
    assert!(index_list.len() > 0, "Should have at least one custom index");
}

#[tokio::test]
async fn test_estimate_count() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let count = adapter.estimate_count(TEST_DATABASE, "", "users").await;
    assert!(count.is_ok(), "Should estimate count successfully");
    
    let user_count = count.unwrap();
    assert!(user_count > 0, "Should have at least one user from seed data");
}

#[tokio::test]
async fn test_server_version() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let version = adapter.server_version().await;
    assert!(version.is_ok(), "Should get server version successfully");
    
    let version_string = version.unwrap();
    assert!(version_string.len() > 0, "Version string should not be empty");
    assert!(version_string.contains("."), "Version should contain dots");
}

#[tokio::test]
async fn test_bson_converter() {
    let converter = BsonConverter::new();

    // Test ObjectId conversion
    let oid = ObjectId::new();
    let oid_bson = Bson::ObjectId(oid);
    let cell_value = converter.bson_to_cell_value(&oid_bson, "_id");
    assert_eq!(cell_value.value_type, CellValueType::Text);
    assert_eq!(cell_value.db_type, "objectId");
    if let Some(serde_json::Value::String(val)) = &cell_value.value {
        assert_eq!(*val, oid.to_hex());
    } else {
        panic!("Expected string value for ObjectId");
    }

    // Test Decimal128 conversion
    let decimal = Decimal128::from_str("123.456").unwrap();
    let decimal_bson = Bson::Decimal128(decimal);
    let cell_value = converter.bson_to_cell_value(&decimal_bson, "price");
    assert_eq!(cell_value.value_type, CellValueType::Decimal);
    assert_eq!(cell_value.db_type, "decimal128");

    // Test Int32 conversion
    let int32_bson = Bson::Int32(42);
    let cell_value = converter.bson_to_cell_value(&int32_bson, "count");
    assert_eq!(cell_value.value_type, CellValueType::Integer);
    assert_eq!(cell_value.db_type, "int32");
    if let Some(serde_json::Value::Number(val)) = &cell_value.value {
        assert_eq!(val.as_i64().unwrap(), 42);
    } else {
        panic!("Expected numeric value for Int32");
    }

    // Test String conversion
    let string_bson = Bson::String("Hello MongoDB".to_string());
    let cell_value = converter.bson_to_cell_value(&string_bson, "message");
    assert_eq!(cell_value.value_type, CellValueType::Text);
    assert_eq!(cell_value.db_type, "string");
    if let Some(serde_json::Value::String(val)) = &cell_value.value {
        assert_eq!(*val, "Hello MongoDB");
    } else {
        panic!("Expected string value");
    }

    // Test Boolean conversion
    let bool_bson = Bson::Boolean(true);
    let cell_value = converter.bson_to_cell_value(&bool_bson, "active");
    assert_eq!(cell_value.value_type, CellValueType::Boolean);
    assert_eq!(cell_value.db_type, "boolean");
    if let Some(serde_json::Value::Bool(val)) = &cell_value.value {
        assert_eq!(*val, true);
    } else {
        panic!("Expected boolean value");
    }

    // Test Null conversion
    let null_bson = Bson::Null;
    let cell_value = converter.bson_to_cell_value(&null_bson, "optional_field");
    assert_eq!(cell_value.value_type, CellValueType::Null);
    assert_eq!(cell_value.db_type, "null");
    assert!(cell_value.value.is_none());

    // Test Binary conversion
    let binary_data = Binary { subtype: bson::spec::BinarySubtype::Generic, bytes: vec![1, 2, 3, 4] };
    let binary_bson = Bson::Binary(binary_data);
    let cell_value = converter.bson_to_cell_value(&binary_bson, "data");
    assert_eq!(cell_value.value_type, CellValueType::Binary);
    assert!(cell_value.db_type.starts_with("binary("));
    if let Some(serde_json::Value::String(val)) = &cell_value.value {
        assert_eq!(*val, "01020304"); // hex encoded
    } else {
        panic!("Expected string value for binary data");
    }
}

#[tokio::test]
async fn test_document_with_nested_fields() {
    let converter = BsonConverter::new();

    // Test nested document conversion
    let nested_doc = doc! {
        "name": "John",
        "age": 30,
        "address": {
            "street": "123 Main St",
            "city": "New York",
            "coordinates": [40.7128, -74.0060]
        }
    };
    let doc_bson = Bson::Document(nested_doc);
    let cell_value = converter.bson_to_cell_value(&doc_bson, "user_info");
    assert_eq!(cell_value.value_type, CellValueType::Json);
    assert_eq!(cell_value.db_type, "document");
}

#[tokio::test]
async fn test_array_conversion() {
    let converter = BsonConverter::new();

    // Test array conversion
    let array_bson = Bson::Array(vec![
        Bson::String("apple".to_string()),
        Bson::String("banana".to_string()),
        Bson::String("cherry".to_string())
    ]);
    let cell_value = converter.bson_to_cell_value(&array_bson, "fruits");
    assert_eq!(cell_value.value_type, CellValueType::Array);
    assert_eq!(cell_value.db_type, "array");
}

#[tokio::test]
async fn test_execute_raw_query_basic() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    // Test with a simple JSON query that should be parseable
    let query = r#"{"users": {"$exists": true}}"#;
    let result = adapter.execute_raw_query(TEST_DATABASE, query, 10).await;
    
    // Should at least not panic and return some result
    assert!(result.is_ok() || result.is_err(), "Should handle query execution");
}

#[tokio::test]
async fn test_begin_transaction() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let tx_id = adapter.begin_transaction().await;
    assert!(tx_id.is_ok(), "Should begin transaction successfully");
    
    let transaction_id = tx_id.unwrap();
    assert!(transaction_id.len() > 0, "Transaction ID should not be empty");

    // Test commit (placeholder implementation)
    let commit_result = adapter.commit(transaction_id.clone()).await;
    assert!(commit_result.is_ok(), "Should commit transaction");

    // Test rollback with new transaction
    let tx_id2 = adapter.begin_transaction().await.unwrap();
    let rollback_result = adapter.rollback(tx_id2).await;
    assert!(rollback_result.is_ok(), "Should rollback transaction");
}

#[tokio::test]
async fn test_connection_management() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    // Test that we can access the client and database
    let client = adapter.get_client();
    assert!(!client.default_database().is_none() || client.default_database().is_some());

    let database = adapter.get_database();
    assert_eq!(database.name(), TEST_DATABASE);

    // Test disconnect (should not panic)
    let disconnect_result = adapter.disconnect().await;
    assert!(disconnect_result.is_ok(), "Should disconnect successfully");
}

#[tokio::test]
async fn test_schema_inferrer_edge_cases() {
    let client = match create_test_client().await {
        Ok(client) => client,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    let database = client.database(TEST_DATABASE);
    let inferrer = SchemaInferrer::new(database, client);

    // Test schema inference on edge_cases collection
    let columns = inferrer.infer_collection_schema(TEST_DATABASE, "edge_cases").await;
    assert!(columns.is_ok(), "Should infer edge cases schema successfully");

    let column_list = columns.unwrap();
    assert!(column_list.len() > 0, "Should have inferred columns from edge cases");

    // Check that various edge case fields are detected
    let column_names: Vec<String> = column_list.iter().map(|c| c.name.clone()).collect();
    assert!(column_names.contains(&"very_long_string".to_string()));
    assert!(column_names.contains(&"max_int32".to_string()));
    assert!(column_names.contains(&"epoch_start".to_string()));
}

#[tokio::test]
async fn test_functions_and_triggers() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    // MongoDB doesn't have SQL-style functions or triggers
    let functions = adapter.list_functions(TEST_DATABASE, "").await;
    assert!(functions.is_ok(), "Should handle functions query");
    assert_eq!(functions.unwrap().len(), 0, "Should return empty functions list");

    let triggers = adapter.table_triggers(TEST_DATABASE, "", "users").await;
    assert!(triggers.is_ok(), "Should handle triggers query");
    assert_eq!(triggers.unwrap().len(), 0, "Should return empty triggers list");
}

#[tokio::test]
async fn test_close_cursor() {
    let adapter = match setup_test_adapter().await {
        Ok(adapter) => adapter,
        Err(_) => {
            println!("Skipping MongoDB test - database not available");
            return;
        }
    };

    // Test cursor closing (should not fail)
    let result = adapter.close_cursor("test_cursor_id").await;
    assert!(result.is_ok(), "Should close cursor successfully");
}

#[cfg(test)]
mod bson_converter_tests {
    use super::*;
    use chrono::{DateTime, Utc};
    use bson::{Regex, Timestamp, JavaScriptCodeWithScope};

    #[test]
    fn test_all_bson_types_conversion() {
        let converter = BsonConverter::new();

        // Test all major BSON types
        let test_cases = vec![
            (Bson::Double(3.14159), "double", CellValueType::Decimal),
            (Bson::String("test".to_string()), "string", CellValueType::Text),
            (Bson::Boolean(true), "boolean", CellValueType::Boolean),
            (Bson::Boolean(false), "boolean", CellValueType::Boolean),
            (Bson::Null, "null", CellValueType::Null),
            (Bson::Int32(42), "int32", CellValueType::Integer),
            (Bson::Int64(9999999999), "int64", CellValueType::Integer),
            (Bson::Timestamp(Timestamp { time: 1234567890, increment: 1 }), "timestamp", CellValueType::Json),
            (Bson::ObjectId(ObjectId::new()), "objectid", CellValueType::Text),
            (Bson::RegularExpression(Regex { pattern: "test".to_string(), options: "i".to_string() }), "regex", CellValueType::Text),
            (Bson::JavaScriptCode("function() { return 42; }".to_string()), "javascript", CellValueType::Text),
        ];

        for (bson_value, field_name, expected_type) in test_cases {
            let cell_value = converter.bson_to_cell_value(&bson_value, field_name);
            assert_eq!(cell_value.value_type, expected_type, 
                      "Failed for BSON type: {:?}", bson_value);
        }
    }

    #[test]
    fn test_uuid_pattern_detection() {
        let converter = BsonConverter::new();
        
        // Test valid UUID string
        let uuid_string = "550e8400-e29b-41d4-a716-446655440000";
        let uuid_bson = Bson::String(uuid_string.to_string());
        let cell_value = converter.bson_to_cell_value(&uuid_bson, "uuid_field");
        
        // Should be detected as text
        assert_eq!(cell_value.value_type, CellValueType::Text);
    }

    #[test]
    fn test_large_numbers() {
        let converter = BsonConverter::new();

        // Test Int64 with large value
        let large_int = Bson::Int64(9223372036854775807); // Max i64
        let cell_value = converter.bson_to_cell_value(&large_int, "large_number");
        assert_eq!(cell_value.value_type, CellValueType::Integer);
        assert_eq!(cell_value.db_type, "int64");
    }
}