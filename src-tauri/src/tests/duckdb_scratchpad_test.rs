use crate::adapters::duckdb::{
    DuckDbAdapter, DuckDbAddFileRequest, DuckDbColumnDefinition, DuckDbManagedObjectLineage,
    DuckDbReplaceManagedObjectRequest,
};
use crate::core::capabilities::{BaseCapability, SqlQueryable};
use crate::types::{ConnectionProfile, DbType};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

fn temp_path(suffix: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "query-pilot-duckdb-test-{}-{}",
        uuid::Uuid::new_v4(),
        suffix
    ));
    path
}

fn test_profile(database: &str) -> ConnectionProfile {
    ConnectionProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: "DuckDB Test".to_string(),
        db_type: DbType::DuckDB,
        host: String::new(),
        port: 0,
        database: database.to_string(),
        username: String::new(),
        password: None,
        ssl_mode: None,
        ssl_config: None,
        ssh_tunnel: None,
        bastion: None,
        options: HashMap::new(),
        group: None,
        safe_mode: None,
    }
}

async fn connected_adapter() -> (DuckDbAdapter, PathBuf) {
    let db_path = temp_path("scratchpad.duckdb");
    let adapter = DuckDbAdapter::new();
    adapter
        .connect(&test_profile(
            db_path
                .to_str()
                .expect("temp scratchpad path should be valid UTF-8"),
        ))
        .await
        .expect("connect duckdb scratchpad");
    (adapter, db_path)
}

#[tokio::test]
async fn duckdb_scratchpad_replace_managed_object_registers_lineage() {
    let (adapter, db_path) = connected_adapter().await;

    let summary = adapter
        .replace_managed_object(DuckDbReplaceManagedObjectRequest {
            target_schema: "main".to_string(),
            target_name: "users_snapshot".to_string(),
            object_kind: "sql_snapshot".to_string(),
            source_id: "source-users".to_string(),
            source_kind: "sql_table".to_string(),
            source_connection_id: Some("pg-prod".to_string()),
            source_spec: json!({
                "schema": "public",
                "table": "users",
            }),
            columns: vec![
                DuckDbColumnDefinition {
                    name: "id".to_string(),
                    duckdb_type: "BIGINT".to_string(),
                },
                DuckDbColumnDefinition {
                    name: "name".to_string(),
                    duckdb_type: "TEXT".to_string(),
                },
            ],
            rows: vec![vec![json!(1), json!("Ada")], vec![json!(2), json!("Grace")]],
        })
        .await
        .expect("replace managed object");

    assert_eq!(summary.target_schema, "main");
    assert_eq!(summary.target_name, "users_snapshot");
    assert_eq!(summary.last_row_count, Some(2));
    assert_eq!(summary.last_refresh_status.as_deref(), Some("success"));

    let result = adapter
        .execute_query("SELECT id, name FROM main.users_snapshot ORDER BY id")
        .await
        .expect("query users_snapshot");
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.rows[0][0], json!(1));
    assert_eq!(result.rows[0][1], json!("Ada"));

    let managed = adapter
        .list_managed_objects()
        .await
        .expect("list managed objects");
    assert_eq!(managed.len(), 1);
    assert_eq!(managed[0].target_name, "users_snapshot");

    let lineage = adapter
        .get_object_lineage("main".to_string(), "users_snapshot".to_string())
        .await
        .expect("get lineage")
        .expect("lineage should exist");
    assert_eq!(
        lineage,
        DuckDbManagedObjectLineage {
            target_schema: "main".to_string(),
            target_name: "users_snapshot".to_string(),
            object_kind: "sql_snapshot".to_string(),
            source_id: "source-users".to_string(),
            source_kind: "sql_table".to_string(),
            source_connection_id: Some("pg-prod".to_string()),
            source_spec: json!({
                "schema": "public",
                "table": "users",
            }),
            last_refresh_status: Some("success".to_string()),
            last_refresh_at: lineage.last_refresh_at.clone(),
            last_row_count: Some(2),
            last_error: None,
        }
    );

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_scratchpad_replace_failure_keeps_previous_target_data() {
    let (adapter, db_path) = connected_adapter().await;

    adapter
        .replace_managed_object(DuckDbReplaceManagedObjectRequest {
            target_schema: "main".to_string(),
            target_name: "events_snapshot".to_string(),
            object_kind: "sql_snapshot".to_string(),
            source_id: "source-events".to_string(),
            source_kind: "sql_table".to_string(),
            source_connection_id: Some("pg-prod".to_string()),
            source_spec: json!({
                "schema": "analytics",
                "table": "events",
            }),
            columns: vec![DuckDbColumnDefinition {
                name: "event_id".to_string(),
                duckdb_type: "BIGINT".to_string(),
            }],
            rows: vec![vec![json!(7)]],
        })
        .await
        .expect("seed managed object");

    let error = adapter
        .replace_managed_object(DuckDbReplaceManagedObjectRequest {
            target_schema: "main".to_string(),
            target_name: "events_snapshot".to_string(),
            object_kind: "sql_snapshot".to_string(),
            source_id: "source-events".to_string(),
            source_kind: "sql_table".to_string(),
            source_connection_id: Some("pg-prod".to_string()),
            source_spec: json!({
                "schema": "analytics",
                "table": "events",
            }),
            columns: vec![DuckDbColumnDefinition {
                name: "event_id".to_string(),
                duckdb_type: "BIGINT".to_string(),
            }],
            rows: vec![vec![json!("not-a-number")]],
        })
        .await
        .expect_err("replace should fail for incompatible row values");

    assert!(error.to_string().contains("event_id") || error.to_string().contains("BIGINT"));

    let result = adapter
        .execute_query("SELECT event_id FROM main.events_snapshot")
        .await
        .expect("query old snapshot");
    assert_eq!(result.rows, vec![vec![json!(7)]]);

    let lineage = adapter
        .get_object_lineage("main".to_string(), "events_snapshot".to_string())
        .await
        .expect("get failed lineage")
        .expect("lineage should exist after failed refresh");
    assert_eq!(lineage.last_row_count, Some(1));
    assert_eq!(lineage.last_refresh_status.as_deref(), Some("failed"));
    assert!(lineage.last_error.is_some());

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_scratchpad_replace_failure_preserves_previous_lineage_when_source_changes() {
    let (adapter, db_path) = connected_adapter().await;

    adapter
        .replace_managed_object(DuckDbReplaceManagedObjectRequest {
            target_schema: "main".to_string(),
            target_name: "events_snapshot".to_string(),
            object_kind: "sql_snapshot".to_string(),
            source_id: "source-events-v1".to_string(),
            source_kind: "sql_table".to_string(),
            source_connection_id: Some("pg-prod".to_string()),
            source_spec: json!({
                "schema": "analytics",
                "table": "events_v1",
            }),
            columns: vec![DuckDbColumnDefinition {
                name: "event_id".to_string(),
                duckdb_type: "BIGINT".to_string(),
            }],
            rows: vec![vec![json!(7)]],
        })
        .await
        .expect("seed managed object");

    adapter
        .replace_managed_object(DuckDbReplaceManagedObjectRequest {
            target_schema: "main".to_string(),
            target_name: "events_snapshot".to_string(),
            object_kind: "sql_snapshot".to_string(),
            source_id: "source-events-v2".to_string(),
            source_kind: "sql_table".to_string(),
            source_connection_id: Some("pg-staging".to_string()),
            source_spec: json!({
                "schema": "analytics",
                "table": "events_v2",
            }),
            columns: vec![DuckDbColumnDefinition {
                name: "event_id".to_string(),
                duckdb_type: "BIGINT".to_string(),
            }],
            rows: vec![vec![json!("not-a-number")]],
        })
        .await
        .expect_err("replace should fail for incompatible row values");

    let lineage = adapter
        .get_object_lineage("main".to_string(), "events_snapshot".to_string())
        .await
        .expect("get failed lineage")
        .expect("lineage should exist after failed refresh");
    assert_eq!(lineage.source_id, "source-events-v1");
    assert_eq!(lineage.source_connection_id.as_deref(), Some("pg-prod"));
    assert_eq!(
        lineage.source_spec,
        json!({
            "schema": "analytics",
            "table": "events_v1",
        })
    );
    assert_eq!(lineage.last_row_count, Some(1));
    assert_eq!(lineage.last_refresh_status.as_deref(), Some("failed"));
    assert!(lineage.last_error.is_some());

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_scratchpad_add_file_imports_csv_and_tracks_source() {
    let (adapter, db_path) = connected_adapter().await;
    let csv_path = temp_path("input.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n2,Grace\n").expect("write csv");

    let summary = adapter
        .add_file(DuckDbAddFileRequest {
            file_path: csv_path
                .to_str()
                .expect("csv path should be valid UTF-8")
                .to_string(),
            target_schema: Some("main".to_string()),
            target_name: "imported_users".to_string(),
            source_id: Some("file-import-1".to_string()),
        })
        .await
        .expect("add file");

    assert_eq!(summary.target_name, "imported_users");
    assert_eq!(summary.last_row_count, Some(2));

    let result = adapter
        .execute_query("SELECT id, name FROM main.imported_users ORDER BY id")
        .await
        .expect("query imported file");
    assert_eq!(result.rows.len(), 2);

    let lineage = adapter
        .get_object_lineage("main".to_string(), "imported_users".to_string())
        .await
        .expect("get import lineage")
        .expect("lineage should exist");
    assert_eq!(lineage.source_kind, "file");
    assert_eq!(lineage.source_spec["filePath"], json!(csv_path));
    assert_eq!(lineage.source_spec["format"], json!("csv"));

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(csv_path);
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_execute_query_reports_column_types_and_stringifies_large_bigints() {
    let (adapter, db_path) = connected_adapter().await;

    let result = adapter
        .execute_query(
            "SELECT \
                CAST(9223372036854775807 AS BIGINT) AS big_id, \
                TIMESTAMP '2026-03-23 12:34:56' AS created_at, \
                DATE '2026-03-23' AS created_on",
        )
        .await
        .expect("query typed values");

    assert_eq!(result.columns.len(), 3);
    assert_eq!(result.columns[0].name, "big_id");
    assert_eq!(result.columns[0].data_type, "BIGINT");
    assert_eq!(result.columns[1].data_type, "TIMESTAMP");
    assert_eq!(result.columns[2].data_type, "DATE");

    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0][0], json!("9223372036854775807"));

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_complex_types_serialize_to_proper_json() {
    let (adapter, db_path) = connected_adapter().await;

    // Create a table with complex DuckDB types
    adapter
        .execute_query(
            "CREATE TABLE complex_types AS SELECT
                [1, 2, 3] AS int_list,
                ['a', 'b', 'c'] AS str_list,
                {'name': 'Alice', 'age': 30} AS person_struct,
                MAP {'key1': 'val1', 'key2': 'val2'} AS str_map,
                [{'x': 1, 'y': 2}, {'x': 3, 'y': 4}] AS nested_list_of_structs,
                NULL::INT[] AS null_list",
        )
        .await
        .expect("create complex_types table");

    let result = adapter
        .execute_query("SELECT * FROM complex_types")
        .await
        .expect("query complex_types");

    assert_eq!(result.rows.len(), 1);
    let row = &result.rows[0];

    // int_list: [1, 2, 3]
    assert_eq!(row[0], json!([1, 2, 3]));

    // str_list: ['a', 'b', 'c']
    assert_eq!(row[1], json!(["a", "b", "c"]));

    // person_struct: {'name': 'Alice', 'age': 30}
    assert_eq!(row[2], json!({"name": "Alice", "age": 30}));

    // str_map: {'key1': 'val1', 'key2': 'val2'}
    assert_eq!(row[3], json!({"key1": "val1", "key2": "val2"}));

    // nested_list_of_structs: [{'x': 1, 'y': 2}, {'x': 3, 'y': 4}]
    assert_eq!(row[4], json!([{"x": 1, "y": 2}, {"x": 3, "y": 4}]));

    // null_list: NULL
    assert_eq!(row[5], json!(null));

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_is_multi_statement_handles_edge_cases() {
    // These should NOT be detected as multi-statement:
    assert!(!DuckDbAdapter::is_multi_statement_pub(
        "SELECT begin_date FROM t"
    ));
    assert!(!DuckDbAdapter::is_multi_statement_pub(
        "SELECT * FROM t WHERE name = 'BEGIN'"
    ));
    assert!(!DuckDbAdapter::is_multi_statement_pub("SELECT 1"));
    assert!(!DuckDbAdapter::is_multi_statement_pub(
        "INSERT INTO t(x) VALUES (1)"
    ));

    // These SHOULD be detected as multi-statement:
    assert!(DuckDbAdapter::is_multi_statement_pub(
        "BEGIN; INSERT INTO t(x) VALUES (1); COMMIT;"
    ));
    assert!(DuckDbAdapter::is_multi_statement_pub(
        "BEGIN TRANSACTION; SELECT 1; COMMIT;"
    ));
    assert!(DuckDbAdapter::is_multi_statement_pub("SELECT 1; SELECT 2;"));
    assert!(DuckDbAdapter::is_multi_statement_pub(
        "CREATE TABLE t(x INT); INSERT INTO t VALUES (1);"
    ));
}
