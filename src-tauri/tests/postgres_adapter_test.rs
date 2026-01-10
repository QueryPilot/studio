//! Integration tests for PostgreSQL adapter
//!
//! Tests the PostgresAdapter's ability to connect, query, and handle PostgreSQL data types.
//!
//! Requires Docker Postgres running (make docker-up):
//! - Host: localhost:15432
//! - User: devuser
//! - Password: devpass123
//! - Database: todoapp

use query_pilot::adapters::postgres::PostgresAdapter;
use query_pilot::core::adapter::DbAdapter;
use query_pilot::types::{ConnectionProfile, DbType, SslMode};
use serde_json::Value as JsonValue;

/// Check if Postgres is available for testing
fn postgres_available() -> bool {
    std::net::TcpStream::connect("127.0.0.1:15432").is_ok()
}

/// Create a test connection profile
fn test_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test-postgres".to_string(),
        name: "Test Postgres".to_string(),
        db_type: DbType::PostgreSQL,
        host: "127.0.0.1".to_string(),
        port: 15432,
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

fn json_str<'a>(value: &'a JsonValue) -> &'a str {
    value.as_str().expect("Expected string value")
}

#[tokio::test]
async fn test_postgres_connect() {
    if !postgres_available() {
        eprintln!("Skipping test: Postgres not available");
        return;
    }

    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    let result = adapter.connect(&profile).await;
    assert!(result.is_ok(), "Failed to connect: {:?}", result.err());

    assert!(adapter.is_connected().await);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_postgres_basic_types() {
    if !postgres_available() {
        eprintln!("Skipping test: Postgres not available");
        return;
    }

    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();
    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query(
            "SELECT 
                42::integer as int_val,
                3.14::numeric as numeric_val,
                'hello'::text as text_val,
                true::boolean as bool_val,
                decode('DEADBEEF', 'hex') as bytea_val
            ",
        )
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    let row = &query_result.rows[0];

    assert_eq!(row[0].as_i64(), Some(42));
    // Numeric often comes back as string to preserve precision or float
    // Check if it's a number or string representation of a number
    let numeric_str = json_str(&row[1]);
    assert_eq!(numeric_str, "3.14");
    
    assert_eq!(json_str(&row[2]), "hello");
    assert_eq!(row[3].as_bool(), Some(true));
    // Bytea typically returned as hex string or base64 depending on implementation.
    // In SimpleConverter/types, usually string or specialized structure.
    // Based on types.rs, Bytes might be formatted. Let's check it's not null.
    assert!(!row[4].is_null());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_postgres_datetime_types() {
    if !postgres_available() {
        eprintln!("Skipping test: Postgres not available");
        return;
    }

    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();
    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query(
            "SELECT 
                '2023-01-01'::date as date_val,
                '12:00:00'::time as time_val,
                '2023-01-01 12:00:00'::timestamp as timestamp_val,
                '2023-01-01 12:00:00+00'::timestamptz as timestamptz_val,
                '1 year 2 months'::interval as interval_val
            ",
        )
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    let row = &query_result.rows[0];

    assert_eq!(json_str(&row[0]), "2023-01-01");
    // Time/Timestamp formats might vary slightly based on converter, check contains basic parts
    assert!(json_str(&row[1]).contains("12:00:00"));
    assert!(json_str(&row[2]).contains("2023-01-01"));
    assert!(json_str(&row[3]).contains("2023-01-01"));
    assert!(!json_str(&row[4]).is_empty());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_postgres_advanced_types() {
    if !postgres_available() {
        eprintln!("Skipping test: Postgres not available");
        return;
    }

    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();
    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query(
            "SELECT 
                '{\"key\": \"value\"}'::json as json_val,
                '{\"key\": \"value\"}'::jsonb as jsonb_val,
                'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid as uuid_val,
                host('192.168.1.1'::inet) as inet_val,
                ARRAY[1, 2, 3] as array_val,
                '$100.00'::money::text as money_val
            ",
        )
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    let row = &query_result.rows[0];

    // JSON might be returned as object or string depending on converter
    if row[0].is_string() {
         assert!(json_str(&row[0]).contains("key"));
    } else {
         assert_eq!(row[0]["key"], "value");
    }
    
    assert_eq!(json_str(&row[2]), "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    assert_eq!(json_str(&row[3]), "192.168.1.1");
    
    // Arrays usually serialized to JSON array or string
    // SimpleConverter typically does simplistic mapping. 
    // If it's pure JSON array:
    if row[4].is_array() {
        assert_eq!(row[4].get(0).unwrap().as_i64(), Some(1));
    } else {
        // Or string representation "{1,2,3}"
        assert!(json_str(&row[4]).contains('1'));
    }

    // Money
    assert!(json_str(&row[5]).contains("100.00"));

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_postgres_geometric_types() {
    if !postgres_available() {
        eprintln!("Skipping test: Postgres not available");
        return;
    }

    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();
    adapter.connect(&profile).await.unwrap();

    // Just verifying these don't crash and return something non-null
    let result = adapter
        .query(
            "SELECT 
                point(1, 2) as point_val,
                lseg(point(1, 2), point(3, 4)) as lseg_val,
                box(point(1, 2), point(3, 4)) as box_val
            ",
        )
        .await;
    
    assert!(result.is_ok(), "Query failed: {:?}", result.err());
    let query_result = result.unwrap();
    let row = &query_result.rows[0];
    
    assert!(!row[0].is_null());
    assert!(!row[1].is_null());
    assert!(!row[2].is_null());

    adapter.disconnect().await.unwrap();
}
