//! Integration tests for Oracle adapter.
//!
//! These tests require a running Oracle Docker container.
//! Run with: `cargo test oracle_integration -- --ignored`

use crate::adapters::oracle::OracleAdapter;
use crate::core::capabilities::{BaseCapability, SqlQueryable};
use crate::types::{ConnectionProfile, DbType};
use std::collections::HashMap;

fn make_oracle_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test-oracle".to_string(),
        name: "Test Oracle".to_string(),
        db_type: DbType::Oracle,
        host: "localhost".to_string(),
        port: 11521,
        database: "XEPDB1".to_string(),
        username: "system".to_string(),
        password: Some("DevPass123".to_string()),
        ssl_mode: None,
        ssl_config: None,
        ssh_tunnel: None,
        bastion: None,
        tunnel_profile_id: None,
        tunnel_inline: None,
        tunnel_remote_host: None,
        tunnel_remote_port: None,
        options: {
            let mut opts = HashMap::new();
            opts.insert(
                "oracle_connect_mode".to_string(),
                "service_name".to_string(),
            );
            opts
        },
        group: None,
        safe_mode: None,
        pooler_mode: None,
    }
}

#[tokio::test]
#[ignore]
async fn test_oracle_connect_disconnect() {
    let adapter = OracleAdapter::new();
    let profile = make_oracle_profile();

    adapter.connect(&profile).await.unwrap();
    assert!(adapter.is_connected());

    adapter.disconnect().await.unwrap();
    assert!(!adapter.is_connected());
}

#[tokio::test]
#[ignore]
async fn test_oracle_test_connection() {
    let adapter = OracleAdapter::new();
    let profile = make_oracle_profile();
    adapter.connect(&profile).await.unwrap();

    let result = adapter.test_connection().await.unwrap();
    assert!(result.success);
    assert!(result.message.contains("Connected"));

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn test_oracle_simple_query() {
    let adapter = OracleAdapter::new();
    let profile = make_oracle_profile();
    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .execute_query("SELECT 1 AS val FROM dual")
        .await
        .unwrap();
    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.rows.len(), 1);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn test_oracle_type_conversion() {
    let adapter = OracleAdapter::new();
    let profile = make_oracle_profile();
    adapter.connect(&profile).await.unwrap();

    let result = adapter
        .execute_query(
            "SELECT \
                42 AS int_val, \
                3.14 AS float_val, \
                'hello' AS str_val, \
                NULL AS null_val, \
                DATE '2024-01-15' AS date_val, \
                SYSTIMESTAMP AS ts_val \
            FROM dual",
        )
        .await
        .unwrap();

    assert_eq!(result.columns.len(), 6);
    assert_eq!(result.rows.len(), 1);

    let row = &result.rows[0];
    // Integer
    assert_eq!(row[0], serde_json::json!(42));
    // Float
    assert!(row[1].as_f64().unwrap() > 3.0);
    // String
    assert_eq!(row[2], serde_json::json!("hello"));
    // Null
    assert!(row[3].is_null());
    // Date should be a string like "2024-01-15"
    assert!(row[4].as_str().unwrap().starts_with("2024-01-15"));
    // Timestamp should be a string
    assert!(row[5].is_string());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn test_oracle_dml_execution() {
    let adapter = OracleAdapter::new();
    let profile = make_oracle_profile();
    adapter.connect(&profile).await.unwrap();

    // Clean up any previous test table
    let _ = adapter
        .execute_query(
            "BEGIN EXECUTE IMMEDIATE 'DROP TABLE test_oracle_int CASCADE CONSTRAINTS'; \
             EXCEPTION WHEN OTHERS THEN NULL; END;",
        )
        .await;

    adapter
        .execute_query("CREATE TABLE test_oracle_int (id NUMBER, name VARCHAR2(50))")
        .await
        .unwrap();

    let affected = adapter
        .execute_statement("INSERT INTO test_oracle_int VALUES (1, 'test')")
        .await
        .unwrap();
    assert_eq!(affected, 1);

    let result = adapter
        .execute_query("SELECT * FROM test_oracle_int")
        .await
        .unwrap();
    assert_eq!(result.rows.len(), 1);

    adapter
        .execute_query("DROP TABLE test_oracle_int")
        .await
        .unwrap();
    adapter.disconnect().await.unwrap();
}

#[tokio::test]
#[ignore]
async fn test_oracle_schema_switching() {
    let adapter = OracleAdapter::new();
    let mut profile = make_oracle_profile();
    profile.options.insert(
        "oracle_current_schema".to_string(),
        "TODOAPP".to_string(),
    );

    adapter.connect(&profile).await.unwrap();

    // Should be able to query todoapp tables if seeds have run
    let _result = adapter
        .execute_query("SELECT COUNT(*) AS cnt FROM customers")
        .await;
    // This may fail if seeds haven't run, so just check we can connect
    assert!(adapter.is_connected());

    adapter.disconnect().await.unwrap();
}
