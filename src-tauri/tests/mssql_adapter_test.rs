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
use serde_json::Value as JsonValue;

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

fn json_i64(value: &JsonValue) -> i64 {
    if let Some(v) = value.as_i64() {
        return v;
    }
    if let Some(s) = value.as_str() {
        return s.parse().expect("Expected numeric string");
    }
    panic!("Expected integer value");
}

fn json_str<'a>(value: &'a JsonValue) -> &'a str {
    value.as_str().expect("Expected string value")
}

fn assert_not_null(value: &JsonValue, label: &str) {
    assert!(!value.is_null(), "Expected non-null value for {}", label);
}

#[tokio::test]
async fn test_mssql_seeded_todos_sample() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query(
            "SELECT TOP 5 \
                id, title, status, priority, tags, custom_fields, xml_data \
                , due_date, due_time, due_datetime \
             FROM todos \
             ORDER BY id",
        )
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert_eq!(query_result.columns.len(), 10);
    assert_eq!(query_result.rows.len(), 5);

    let row = &query_result.rows[0];

    // Title is string
    assert!(!json_str(&row[1]).is_empty());

    // Tags: check for string or array
    let tags = &row[4];
    if !tags.is_null() {
        if tags.is_string() {
            assert!(tags.as_str().unwrap().starts_with('['));
        } else {
            assert!(
                tags.is_array(),
                "Expected tags to be array if not string, got {:?}",
                tags
            );
        }
    }

    // Custom fields: check for string or object
    let custom_fields = &row[5];
    if !custom_fields.is_null() {
        if custom_fields.is_string() {
            assert!(custom_fields.as_str().unwrap().starts_with('{'));
        } else {
            assert!(
                custom_fields.is_object(),
                "Expected custom_fields to be object if not string, got {:?}",
                custom_fields
            );
        }
    }

    // Dates/Times
    assert!(json_str(&row[8]).contains(':'));
    // Datetime might be string or object
    let dt = &row[9];
    if dt.is_string() {
        assert!(dt.as_str().unwrap().contains(':'));
    }

    adapter.disconnect().await.unwrap();
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
        .query(
            "SELECT 42 AS int_val, 3.14 AS float_val, CAST(999999999999 AS BIGINT) AS bigint_val",
        )
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

    let _create_result = adapter
        .execute("CREATE TABLE test_exec_integration (id INT, name NVARCHAR(50))")
        .await;
    // Ignore error if table exists (cleanup might have failed)

    // Insert a row
    let insert_result = adapter
        .execute("INSERT INTO test_exec_integration (id, name) VALUES (1, 'test')")
        .await;
    assert!(
        insert_result.is_ok(),
        "Insert failed: {:?}",
        insert_result.err()
    );

    // Cleanup
    let _ = adapter.execute("DROP TABLE test_exec_integration").await;

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

#[tokio::test]
async fn test_mssql_seeded_counts() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query(
            "SELECT \
                (SELECT COUNT(*) FROM users) AS users_count, \
                (SELECT COUNT(*) FROM categories) AS categories_count, \
                (SELECT COUNT(*) FROM todos) AS todos_count, \
                (SELECT COUNT(*) FROM status_test) AS status_count, \
                (SELECT COUNT(*) FROM numeric_types_test) AS numeric_count",
        )
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    let row = &query_result.rows[0];

    let users_count = json_i64(&row[0]);
    let categories_count = json_i64(&row[1]);
    let todos_count = json_i64(&row[2]);
    let status_count = json_i64(&row[3]);
    let numeric_count = json_i64(&row[4]);

    assert_eq!(users_count, 100);
    assert_eq!(categories_count, 500);
    assert!(todos_count >= 5000);
    assert_eq!(status_count, 3);
    assert_eq!(numeric_count, 3);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mssql_spatial_and_variant_casts() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query(
            "SELECT \
                id, \
                name, \
                location.STAsText() AS location_text, \
                shape.STAsText() AS shape_text, \
                path.ToString() AS path_text, \
                xml_data, \
                CONVERT(NVARCHAR(MAX), variant_data) AS variant_text, \
                guid_data, \
                money_data, \
                small_money, \
                datetime2_data, \
                datetimeoffset_data, \
                binary_data \
             FROM spatial_test \
             ORDER BY id",
        )
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    assert_eq!(query_result.rows.len(), 3);

    let first_row = &query_result.rows[0];
    assert_eq!(json_str(&first_row[1]), "Point in Seattle");
    assert!(json_str(&first_row[2])
        .to_ascii_uppercase()
        .contains("POINT"));
    assert!(json_str(&first_row[3])
        .to_ascii_uppercase()
        .contains("POINT"));
    assert_eq!(json_str(&first_row[4]), "/1/");
    assert!(json_str(&first_row[5]).contains("Test Item"));
    assert_eq!(json_str(&first_row[6]), "Test Variant String");
    assert!(!json_str(&first_row[7]).is_empty());
    assert_not_null(&first_row[8], "money_data");
    assert_not_null(&first_row[9], "small_money");
    assert!(!json_str(&first_row[10]).is_empty());
    let datetimeoffset = json_str(&first_row[11]);
    assert!(datetimeoffset.contains('T'));
    let offset_pos = datetimeoffset
        .rfind('+')
        .or_else(|| datetimeoffset.rfind('-'))
        .unwrap_or(0);
    assert!(offset_pos > 10);
    assert_eq!(json_str(&first_row[12]), "QmluYXJ5IERhdGE=");

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mssql_numeric_types_table() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query(
            "SELECT \
                tiny_int, \
                small_int, \
                medium_int, \
                big_int, \
                decimal_type, \
                numeric_type, \
                float_type, \
                real_type, \
                money_type, \
                small_money_type, \
                bit_type \
             FROM numeric_types_test \
             WHERE id = 1",
        )
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    let row = &query_result.rows[0];

    for (idx, label) in [
        "tiny_int",
        "small_int",
        "medium_int",
        "big_int",
        "decimal_type",
        "numeric_type",
        "float_type",
        "real_type",
        "money_type",
        "small_money_type",
        "bit_type",
    ]
    .iter()
    .enumerate()
    {
        assert_not_null(&row[idx], label);
    }

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_mssql_rowversion_binary() {
    if !mssql_available() {
        eprintln!("Skipping test: SQL Server not available");
        return;
    }

    let mut adapter = MssqlAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .query("SELECT TOP 1 row_version FROM todos ORDER BY id")
        .await;
    assert!(result.is_ok(), "Query failed: {:?}", result.err());

    let query_result = result.unwrap();
    let value = json_str(&query_result.rows[0][0]);
    assert!(!value.is_empty());

    adapter.disconnect().await.unwrap();
}
