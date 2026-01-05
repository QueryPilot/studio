//! Integration tests for SQL Server adapter
//!
//! Tests the MssqlAdapter's ability to connect, query, and handle SQL Server data types.
//!
//! Requires Docker SQL Server running (make docker-up):
//! - Host: localhost:11434
//! - User: sa
//! - Password: DevPass123
//! - Database: todoapp

use query_pilot::adapters::mssql::MssqlAdapter;
use query_pilot::core::adapter::DbAdapter;
use query_pilot::types::{ConnectionProfile, DbType, SslMode};

/// Check if SQL Server is available for testing
fn mssql_available() -> bool {
    std::net::TcpStream::connect("127.0.0.1:11434").is_ok()
}

/// Create a test connection profile
fn test_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test-mssql".to_string(),
        name: "Test SQL Server".to_string(),
        db_type: DbType::SQLServer,
        host: "127.0.0.1".to_string(),
        port: 11434,
        database: "todoapp".to_string(),
        username: "sa".to_string(),
        password: Some("DevPass123".to_string()),
        ssl_mode: Some(SslMode::Disable),
        ssl_config: None,
        ssh_tunnel: None,
        bastion: None,
        options: std::collections::HashMap::new(),
        group: None,
    }
}

#[tokio::test]
async fn test_mssql_connect() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    let result = adapter.connect(&profile).await;
    assert!(result.is_ok(), "Failed to connect: {:?}", result.err());

    assert!(adapter.is_connected().await);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mssql_test_connection() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
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
async fn test_mssql_simple_query() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
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
async fn test_mssql_numeric_types() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query("SELECT 42 AS int_val, 3.14 AS float_val, CAST(999999999999 AS BIGINT) AS bigint_val")
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert_eq!(query_result.columns.len(), 3);
    assert_eq!(query_result.rows.len(), 1);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mssql_date_types() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query("SELECT GETDATE() AS now_val, CAST(GETDATE() AS DATE) AS date_val, CAST(GETDATE() AS TIME) AS time_val")
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert_eq!(query_result.columns.len(), 3);
    assert_eq!(query_result.rows.len(), 1);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mssql_execute() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Create a temporary table
    let create_result = adapter
        .execute("CREATE TABLE #test_exec (id INT, name NVARCHAR(50))")
        .await;
    assert!(create_result.is_ok(), "Create failed: {:?}", create_result.err());

    // Insert a row
    let insert_result = adapter
        .execute("INSERT INTO #test_exec (id, name) VALUES (1, 'test')")
        .await;
    assert!(insert_result.is_ok(), "Insert failed: {:?}", insert_result.err());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mssql_null_handling() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter.query("SELECT NULL AS null_val").await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert!(query_result.rows[0][0].is_null());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mssql_uniqueidentifier() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter.query("SELECT NEWID() AS guid_val").await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert_eq!(query_result.rows.len(), 1);

    adapter.disconnect().await.unwrap();
}

