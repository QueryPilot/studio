//! Integration tests for MySQL adapter
//!
//! Tests the MySqlAdapter's ability to connect, query, and handle MySQL data types.
//!
//! Requires Docker MySQL running (make docker-up):
//! - Host: localhost:13306
//! - User: devuser
//! - Password: devpass123
//! - Database: todoapp

use query_pilot::adapters::mysql::MySqlAdapter;
use query_pilot::core::adapter::DbAdapter;
use query_pilot::types::{ConnectionProfile, DbType, SslMode};

/// Check if MySQL is available for testing
fn mysql_available() -> bool {
    std::net::TcpStream::connect("127.0.0.1:13306").is_ok()
}

/// Create a test connection profile
fn test_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test-mysql".to_string(),
        name: "Test MySQL".to_string(),
        db_type: DbType::MySQL,
        host: "127.0.0.1".to_string(),
        port: 13306,
        database: "todoapp".to_string(),
        username: "devuser".to_string(),
        password: Some("devpass123".to_string()),
        ssl_mode: Some(SslMode::Disable),
        ssl_config: None,
        ssh_tunnel: None,
        bastion: None,
        options: std::collections::HashMap::new(),
        group: None,
    }
}

use serde_json::Value as JsonValue;

fn json_str<'a>(value: &'a JsonValue) -> &'a str {
    value.as_str().expect("Expected string value")
}

#[tokio::test]
async fn test_mysql_connect() {
    if !mysql_available() {
        eprintln!("Skipping test: MySQL not available");
        return;
    }

    let mut adapter = MySqlAdapter::new();
    let profile = test_profile();

    let result = adapter.connect(&profile).await;
    assert!(result.is_ok(), "Failed to connect: {:?}", result.err());

    assert!(adapter.is_connected().await);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mysql_test_connection() {
    if !mysql_available() {
        eprintln!("Skipping test: MySQL not available");
        return;
    }

    let mut adapter = MySqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter.test_connection().await;
    assert!(result.is_ok(), "Test connection failed: {:?}", result.err());

    let test_result = result.unwrap();
    assert!(test_result.success);
    assert!(test_result.version.is_some());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mysql_simple_query() {
    if !mysql_available() {
        eprintln!("Skipping test: MySQL not available");
        return;
    }

    let mut adapter = MySqlAdapter::new();
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
async fn test_mysql_numeric_types() {
    if !mysql_available() {
        eprintln!("Skipping test: MySQL not available");
        return;
    }

    let mut adapter = MySqlAdapter::new();
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
async fn test_mysql_date_types() {
    if !mysql_available() {
        eprintln!("Skipping test: MySQL not available");
        return;
    }

    let mut adapter = MySqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query("SELECT NOW() AS now_val, CURDATE() AS date_val, CURTIME() AS time_val")
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert_eq!(query_result.columns.len(), 3);
    assert_eq!(query_result.rows.len(), 1);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mysql_execute() {
    if !mysql_available() {
        eprintln!("Skipping test: MySQL not available");
        return;
    }

    let mut adapter = MySqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Use a simple SELECT statement to test execute
    // (Temporary tables in MySQL require different handling)
    let result = adapter
        .execute("SELECT 1")
        .await;
    assert!(result.is_ok(), "Execute failed: {:?}", result.err());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mysql_null_handling() {
    if !mysql_available() {
        eprintln!("Skipping test: MySQL not available");
        return;
    }

    let mut adapter = MySqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter.query("SELECT NULL AS null_val").await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert!(query_result.rows[0][0].is_null());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mysql_advanced_types() {
    if !mysql_available() {
        eprintln!("Skipping test: MySQL not available");
        return;
    }

    let mut adapter = MySqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query(
            "SELECT 
                CAST('{\"key\": \"value\"}' AS JSON) as json_val,
                UUID() as uuid_val,
                b'101' | b'010' as bit_val,
                CONCAT('a', 'b') as string_func,
                CAST('2023-01-01 12:00:00' AS DATETIME) as datetime_val
            ",
        )
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    let row = &query_result.rows[0];

    // JSON
    // MySQL adapter might return JSON as string or object
    if row[0].is_string() {
        assert!(json_str(&row[0]).contains("key"));
    } else {
        assert_eq!(row[0]["key"], "value");
    }

    // UUID (returns string)
    assert!(!json_str(&row[1]).is_empty());
    
    // Bit usually returns integer or binary string
    assert!(!row[2].is_null());
    
    // String func
    assert_eq!(json_str(&row[3]), "ab");

    adapter.disconnect().await.unwrap();
}

