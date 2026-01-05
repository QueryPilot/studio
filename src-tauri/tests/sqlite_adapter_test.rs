//! Integration tests for SQLite adapter
//!
//! Tests the SqliteAdapter's ability to connect, query, and handle SQLite data types.
//!
//! Uses an in-memory database for testing.

use query_pilot::adapters::sqlite::SqliteAdapter;
use query_pilot::core::adapter::DbAdapter;
use query_pilot::types::{ConnectionProfile, DbType};

/// Create a test connection profile for in-memory SQLite
fn test_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test-sqlite".to_string(),
        name: "Test SQLite".to_string(),
        db_type: DbType::SQLite,
        host: "".to_string(),
        port: 0,
        database: ":memory:".to_string(), // In-memory database
        username: "".to_string(),
        password: None,
        ssl_mode: None,
        ssl_config: None,
        ssh_tunnel: None,
        bastion: None,
        options: std::collections::HashMap::new(),
        group: None,
    }
}

#[tokio::test]
async fn test_sqlite_connect() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    let result = adapter.connect(&profile).await;
    assert!(result.is_ok(), "Failed to connect: {:?}", result.err());

    assert!(adapter.is_connected().await);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_sqlite_test_connection() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter.test_connection().await;
    assert!(result.is_ok(), "Test connection failed: {:?}", result.err());

    let test_result = result.unwrap();
    assert!(test_result.success);
    assert!(test_result.version.is_some());
    assert!(test_result.version.as_ref().unwrap().contains("SQLite"));

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_sqlite_simple_query() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter.query("SELECT 1 AS num, 'hello' AS greeting").await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert_eq!(query_result.columns.len(), 2);
    assert_eq!(query_result.rows.len(), 1);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_sqlite_numeric_types() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query("SELECT 42 AS int_val, 3.14 AS float_val, 999999999999 AS bigint_val")
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert_eq!(query_result.columns.len(), 3);
    assert_eq!(query_result.rows.len(), 1);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_sqlite_create_and_query_table() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Create a table
    let create_result = adapter
        .execute("CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT, value REAL)")
        .await;
    assert!(create_result.is_ok(), "Create failed: {:?}", create_result.err());

    // Insert rows
    let insert1 = adapter
        .execute("INSERT INTO test_table (name, value) VALUES ('one', 1.0)")
        .await;
    assert!(insert1.is_ok());

    let insert2 = adapter
        .execute("INSERT INTO test_table (name, value) VALUES ('two', 2.0)")
        .await;
    assert!(insert2.is_ok());

    // Query rows
    let query_result = adapter.query("SELECT * FROM test_table ORDER BY id").await;
    assert!(query_result.is_ok());

    let result = query_result.unwrap();
    assert_eq!(result.rows.len(), 2);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_sqlite_execute() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Create a table
    adapter
        .execute("CREATE TABLE test_exec (id INTEGER, name TEXT)")
        .await
        .unwrap();

    // Insert a row
    let insert_result = adapter
        .execute("INSERT INTO test_exec (id, name) VALUES (1, 'test')")
        .await;
    assert!(insert_result.is_ok(), "Insert failed: {:?}", insert_result.err());
    assert_eq!(insert_result.unwrap(), 1);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_sqlite_null_handling() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter.query("SELECT NULL AS null_val").await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert!(query_result.rows[0][0].is_null());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_sqlite_blob_handling() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Create table with BLOB column
    adapter
        .execute("CREATE TABLE blob_test (id INTEGER, data BLOB)")
        .await
        .unwrap();

    // Insert binary data
    adapter
        .execute("INSERT INTO blob_test VALUES (1, X'48454C4C4F')")
        .await
        .unwrap();

    // Query blob
    let result = adapter.query("SELECT * FROM blob_test").await;
    assert!(result.is_ok());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_sqlite_pragma() {
    let mut adapter = SqliteAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter.query("PRAGMA table_info('sqlite_master')").await;
    assert!(result.is_ok(), "PRAGMA failed: {:?}", result.err());

    adapter.disconnect().await.unwrap();
}

