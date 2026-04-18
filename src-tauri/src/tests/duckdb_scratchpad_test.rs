use crate::adapters::duckdb::{
    DuckDbAdapter, DuckDbAddFileRequest, DuckDbColumnDefinition, DuckDbManagedObjectLineage,
    DuckDbReplaceManagedObjectRequest,
};
use crate::core::backup_capability::{BackupCapable, BackupConfig, BackupProgress};
use crate::core::capabilities::{BaseCapability, SqlQueryable};
use crate::error::AppError;
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
        tunnel_profile_id: None,
        tunnel_inline: None,
        tunnel_remote_host: None,
        tunnel_remote_port: None,
        options: HashMap::new(),
        group: None,
        safe_mode: None,
        pooler_mode: None,
        databases: vec![],
        default_schema: None,
        trino_catalogs: None,
        trino_schema_filters: None,
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
async fn duckdb_is_connected_returns_false_after_disconnect() {
    let dir = std::env::temp_dir().join(format!("qp_duckdb_health_{}", uuid::Uuid::new_v4()));
    let adapter = DuckDbAdapter::new();
    let profile = test_profile(dir.to_str().unwrap());
    adapter.connect(&profile).await.unwrap();

    assert!(adapter.is_connected());
    assert!(adapter.ping().await);

    adapter.disconnect().await.unwrap();
    assert!(!adapter.is_connected());
    assert!(!adapter.ping().await);

    let _ = std::fs::remove_dir_all(&dir);
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

#[tokio::test]
async fn duckdb_backup_binary_creates_valid_copy() {
    let (adapter, db_path) = connected_adapter().await;

    // Create test data
    adapter
        .execute_query("CREATE TABLE test_backup(id INTEGER, name TEXT)")
        .await
        .expect("create table");
    adapter
        .execute_query("INSERT INTO test_backup VALUES (1, 'Alice'), (2, 'Bob')")
        .await
        .expect("insert data");

    // Run binary backup
    let backup_path = temp_path("backup.duckdb");
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);

    adapter
        .execute_backup(
            BackupConfig {
                destination_path: backup_path
                    .to_str()
                    .expect("backup path should be valid UTF-8")
                    .to_string(),
                format: "binary".to_string(),
                selected_objects: None,
                options: json!({}),
            },
            tx,
        )
        .await
        .expect("binary backup");

    // Verify we got progress messages including Completed
    let mut got_completed = false;
    while let Ok(msg) = rx.try_recv() {
        if matches!(msg, BackupProgress::Completed { .. }) {
            got_completed = true;
        }
    }
    assert!(got_completed, "should receive Completed progress message");

    // Open the backup file with a new adapter and verify data
    let backup_adapter = DuckDbAdapter::new();
    backup_adapter
        .connect(&test_profile(
            backup_path
                .to_str()
                .expect("backup path should be valid UTF-8"),
        ))
        .await
        .expect("connect to backup");

    let result = backup_adapter
        .execute_query("SELECT id, name FROM test_backup ORDER BY id")
        .await
        .expect("query backup");
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.rows[0][0], json!(1));
    assert_eq!(result.rows[0][1], json!("Alice"));
    assert_eq!(result.rows[1][0], json!(2));
    assert_eq!(result.rows[1][1], json!("Bob"));

    backup_adapter
        .disconnect()
        .await
        .expect("disconnect backup");
    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_file(&backup_path);
}

#[tokio::test]
async fn duckdb_execute_query_chunked_returns_batches() {
    let dir = std::env::temp_dir().join(format!("qp_duckdb_chunk_{}", uuid::Uuid::new_v4()));
    let adapter = DuckDbAdapter::new();
    let profile = test_profile(dir.to_str().unwrap());
    adapter.connect(&profile).await.unwrap();

    adapter
        .execute_blocking(|conn| {
            conn.execute_batch("CREATE TABLE chunk_test AS SELECT range AS id FROM range(100)")
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            Ok(())
        })
        .await
        .unwrap();

    let (columns, chunks) = adapter
        .execute_query_chunked("SELECT * FROM chunk_test")
        .await
        .unwrap();
    assert_eq!(columns.len(), 1);
    assert_eq!(columns[0].name, "id");
    let total_rows: usize = chunks.iter().map(|c| c.len()).sum();
    assert_eq!(total_rows, 100);
    // First chunk should be 16 rows (first batch size)
    assert_eq!(chunks[0].len(), 16);

    adapter.disconnect().await.unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn duckdb_add_file_imports_parquet() {
    let (adapter, db_path) = connected_adapter().await;

    // Check if parquet extension is available (may not be in offline/CI environments)
    let parquet_available = adapter
        .execute_blocking(|conn| {
            // Try loading parquet; if it fails, the extension isn't available
            match conn.execute_batch("LOAD parquet") {
                Ok(_) => Ok(true),
                Err(_) => Ok(false),
            }
        })
        .await
        .unwrap_or(false);

    if !parquet_available {
        eprintln!("SKIP: parquet extension not available, skipping parquet import test");
        adapter.disconnect().await.expect("disconnect duckdb");
        let _ = fs::remove_file(db_path);
        return;
    }

    let parquet_dir = temp_path("parquet_dir");
    fs::create_dir_all(&parquet_dir).expect("create parquet temp dir");
    let parquet_path = parquet_dir.join("test.parquet");

    // Use DuckDB itself to create a Parquet file
    let parquet_str = parquet_path.to_str().unwrap().to_string();
    adapter
        .execute_blocking(move |conn| {
            conn.execute_batch(&format!(
                "CREATE TABLE src AS SELECT range AS id, 'row_' || range AS name FROM range(50); \
                 COPY src TO '{}' (FORMAT PARQUET); \
                 DROP TABLE src;",
                parquet_str
            ))
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            Ok(())
        })
        .await
        .expect("create parquet file");

    // Import the Parquet file
    let summary = adapter
        .add_file(DuckDbAddFileRequest {
            file_path: parquet_path.to_str().unwrap().to_string(),
            target_schema: Some("main".to_string()),
            target_name: "parquet_import".to_string(),
            source_id: Some("file-parquet-1".to_string()),
        })
        .await
        .expect("add parquet file");

    assert_eq!(summary.target_name, "parquet_import");
    assert_eq!(summary.last_row_count, Some(50));

    let result = adapter
        .execute_query("SELECT COUNT(*) AS cnt FROM main.parquet_import")
        .await
        .expect("count parquet rows");
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0][0], json!(50));

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_dir_all(&parquet_dir);
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_add_file_imports_json() {
    let (adapter, db_path) = connected_adapter().await;
    let json_path = temp_path("input.json");
    fs::write(
        &json_path,
        r#"[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]"#,
    )
    .expect("write json");

    let summary = adapter
        .add_file(DuckDbAddFileRequest {
            file_path: json_path.to_str().unwrap().to_string(),
            target_schema: Some("main".to_string()),
            target_name: "json_import".to_string(),
            source_id: Some("file-json-1".to_string()),
        })
        .await
        .expect("add json file");

    assert_eq!(summary.target_name, "json_import");
    assert_eq!(summary.last_row_count, Some(2));

    let result = adapter
        .execute_query("SELECT COUNT(*) AS cnt FROM main.json_import")
        .await
        .expect("count json rows");
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0][0], json!(2));

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(json_path);
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_execute_statement_returns_affected_rows() {
    let (adapter, db_path) = connected_adapter().await;

    adapter
        .execute_statement("CREATE TABLE stmt_test(id INTEGER, name TEXT)")
        .await
        .expect("create table");

    let inserted = adapter
        .execute_statement("INSERT INTO stmt_test VALUES (1, 'A'), (2, 'B'), (3, 'C')")
        .await
        .expect("insert rows");
    assert_eq!(inserted, 3);

    let deleted = adapter
        .execute_statement("DELETE FROM stmt_test WHERE id > 1")
        .await
        .expect("delete rows");
    assert_eq!(deleted, 2);

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_execute_query_reports_meaningful_error_on_bad_sql() {
    let (adapter, db_path) = connected_adapter().await;

    let result = adapter.execute_query("SELECTT * FROMM nonexistent").await;

    assert!(result.is_err(), "malformed SQL should return an error");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("Parser Error") || err_msg.contains("failed") || err_msg.contains("error"),
        "error message should be meaningful, got: {}",
        err_msg
    );

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
async fn duckdb_connect_replays_non_secret_duckdb_attachments_from_profile() {
    // Regression: streaming queries use `{conn_id}:{tab_id}` as the connection
    // key, so every new tab gets a brand-new DuckDbAdapter. Without replay on
    // connect, queries against attached catalogs hit "Binder Error: Catalog
    // does not exist" even though the base connection has them attached.
    //
    // Verify a freshly connected adapter, given a profile carrying an
    // attachment, ends up with the catalog attached — without the frontend
    // having to call `duckdb_replay_setup`.
    use crate::types::{Attachment, AttachmentKind, DatabaseEntry};

    // Seed a small .duckdb file to attach
    let attached_path = temp_path("attached-seed.duckdb");
    {
        let seeder = DuckDbAdapter::new();
        seeder
            .connect(&test_profile(attached_path.to_str().unwrap()))
            .await
            .expect("seed: connect attached");
        seeder
            .execute_statement("CREATE TABLE things(id INTEGER)")
            .await
            .expect("seed: create table");
        seeder
            .execute_statement("INSERT INTO things VALUES (1), (2), (3)")
            .await
            .expect("seed: insert");
        seeder.disconnect().await.expect("seed: disconnect");
    }

    // Build a profile like the one produced by frontend after an explicit
    // attach — durable attachment persisted on databases[0].attachments.
    let primary_path = temp_path("primary.duckdb");
    let mut profile = test_profile(primary_path.to_str().unwrap());
    profile.databases = vec![DatabaseEntry {
        name: "main".into(),
        visible_schemas: vec!["main".into()],
        attachments: Some(vec![Attachment {
            alias: "seed_attach".into(),
            kind: AttachmentKind::Duckdb,
            uri: attached_path.to_string_lossy().into_owned(),
            read_only: Some(true),
            options: None,
            secret_ref: None,
        }]),
        extensions: None,
        secret_refs: None,
    }];

    // This mimics the per-tab / reaper-reconnect path: a fresh adapter
    // connects, and nothing else calls replay.
    let adapter = DuckDbAdapter::new();
    adapter.connect(&profile).await.expect("connect primary");

    let attached = adapter
        .list_attached_databases()
        .await
        .expect("list attached");
    assert!(
        attached.iter().any(|d| d.database_name == "seed_attach"),
        "expected 'seed_attach' to be auto-replayed on connect, saw: {:?}",
        attached
            .iter()
            .map(|d| &d.database_name)
            .collect::<Vec<_>>()
    );

    // The whole point — queries against the attached catalog must resolve.
    let cap = adapter
        .execute_query("SELECT COUNT(*) AS n FROM \"seed_attach\".\"main\".\"things\"")
        .await
        .expect("query attached catalog");
    let row = cap.rows.first().expect("one row");
    let n = row[0].as_i64().expect("n is int");
    assert_eq!(n, 3, "expected 3 rows from attached things table");

    adapter.disconnect().await.expect("disconnect primary");
    let _ = fs::remove_file(primary_path);
    let _ = fs::remove_file(attached_path);
}

#[tokio::test]
async fn duckdb_replay_is_idempotent_for_already_attached_aliases() {
    // Regression: after connect-time auto-replay attaches a catalog, the
    // frontend's `duckdb_replay_setup` runs the same attachments again.
    // Without idempotency this surfaces "Failed to attach: ..." errors on the
    // attached-db sidebar header even though the catalog is already there.
    use crate::types::{Attachment, AttachmentKind, DatabaseEntry};

    let attached_path = temp_path("replay-seed.duckdb");
    {
        let seeder = DuckDbAdapter::new();
        seeder
            .connect(&test_profile(attached_path.to_str().unwrap()))
            .await
            .expect("seed connect");
        seeder.disconnect().await.expect("seed disconnect");
    }

    let attachment = Attachment {
        alias: "seed_attach".into(),
        kind: AttachmentKind::Duckdb,
        uri: attached_path.to_string_lossy().into_owned(),
        read_only: Some(true),
        options: None,
        secret_ref: None,
    };

    let primary_path = temp_path("replay-primary.duckdb");
    let mut profile = test_profile(primary_path.to_str().unwrap());
    profile.databases = vec![DatabaseEntry {
        name: "main".into(),
        visible_schemas: vec!["main".into()],
        attachments: Some(vec![attachment.clone()]),
        extensions: None,
        secret_refs: None,
    }];

    let adapter = DuckDbAdapter::new();
    adapter.connect(&profile).await.expect("connect primary");

    // Simulate what the frontend does right after `BackendAPI.connect` returns:
    // invoke `duckdb_replay_setup` with the same attachment list. The backend
    // connect-time replay has already attached 'seed_attach' — the second
    // replay must not surface a "Failed to attach" error for it.
    let (runtime, errors) = adapter.replay(None, "conn-id", vec![], vec![attachment]).await;
    assert!(
        errors.is_empty(),
        "second replay should be idempotent, got errors: {:?}",
        errors
    );
    assert!(
        runtime.iter().any(|d| d.name == "seed_attach"),
        "runtime should still report the already-attached catalog"
    );

    adapter.disconnect().await.expect("disconnect");
    let _ = fs::remove_file(primary_path);
    let _ = fs::remove_file(attached_path);
}

#[tokio::test]
async fn duckdb_connect_skips_secret_backed_attachments() {
    // Secret-backed attachments must be replayed by the frontend
    // (`duckdb_replay_setup`) because decrypted secrets live in the vault, not
    // in the backend profile.
    //
    // Using a DuckDB-kind attachment (rather than Postgres) for the secret
    // case gives us a distinguishing signal: if the backend *attempted* the
    // attach instead of skipping, DuckDB would succeed in opening the file
    // and `list_attached_databases()` would include it. We prove skip-not-
    // attempt by pairing it with a companion no-secret DuckDB attachment
    // pointing at the same file — the companion must be replayed so the test
    // isn't merely asserting that replay is broken in general.
    use crate::types::{Attachment, AttachmentKind, DatabaseEntry};

    // Seed a real .duckdb file so a hypothetical attempted ATTACH would
    // actually succeed.
    let seed_path = temp_path("skip-seed.duckdb");
    {
        let seeder = DuckDbAdapter::new();
        seeder
            .connect(&test_profile(seed_path.to_str().unwrap()))
            .await
            .expect("seed connect");
        seeder.disconnect().await.expect("seed disconnect");
    }

    let primary_path = temp_path("primary-secret.duckdb");
    let mut profile = test_profile(primary_path.to_str().unwrap());
    profile.databases = vec![DatabaseEntry {
        name: "main".into(),
        visible_schemas: vec!["main".into()],
        attachments: Some(vec![
            // Should be skipped (secret_ref set).
            Attachment {
                alias: "with_secret".into(),
                kind: AttachmentKind::Duckdb,
                uri: seed_path.to_string_lossy().into_owned(),
                read_only: Some(true),
                options: None,
                secret_ref: Some("some_secret_name".into()),
            },
            // Control: no secret, should be attached.
            Attachment {
                alias: "no_secret".into(),
                kind: AttachmentKind::Duckdb,
                uri: seed_path.to_string_lossy().into_owned(),
                read_only: Some(true),
                options: None,
                secret_ref: None,
            },
        ]),
        extensions: None,
        secret_refs: None,
    }];

    let adapter = DuckDbAdapter::new();
    adapter
        .connect(&profile)
        .await
        .expect("connect should succeed even when a secret-backed attach is skipped");

    let attached = adapter
        .list_attached_databases()
        .await
        .expect("list attached");
    let names: Vec<&str> = attached
        .iter()
        .map(|d| d.database_name.as_str())
        .collect();

    assert!(
        !names.contains(&"with_secret"),
        "secret-backed attachment must NOT be attached by backend; saw {:?}",
        names
    );
    assert!(
        names.contains(&"no_secret"),
        "control (no secret) attachment MUST be attached; saw {:?}",
        names
    );

    adapter.disconnect().await.expect("disconnect");
    let _ = fs::remove_file(primary_path);
    let _ = fs::remove_file(seed_path);
}

#[tokio::test]
async fn duckdb_already_attached_alias_is_case_insensitive() {
    // DuckDB catalog names are case-insensitive — the profile might carry
    // alias "MyDB" while duckdb_databases() reports "mydb" (or vice versa).
    // Our idempotency snapshot must normalise so we don't try to double-
    // attach and surface a spurious "database already exists" error.
    use crate::types::{Attachment, AttachmentKind, DatabaseEntry};

    let seed_path = temp_path("case-seed.duckdb");
    {
        let seeder = DuckDbAdapter::new();
        seeder
            .connect(&test_profile(seed_path.to_str().unwrap()))
            .await
            .expect("seed connect");
        seeder.disconnect().await.expect("seed disconnect");
    }

    let attachment = Attachment {
        alias: "MyDB".into(),
        kind: AttachmentKind::Duckdb,
        uri: seed_path.to_string_lossy().into_owned(),
        read_only: Some(true),
        options: None,
        secret_ref: None,
    };

    let primary_path = temp_path("case-primary.duckdb");
    let mut profile = test_profile(primary_path.to_str().unwrap());
    profile.databases = vec![DatabaseEntry {
        name: "main".into(),
        visible_schemas: vec!["main".into()],
        attachments: Some(vec![attachment.clone()]),
        extensions: None,
        secret_refs: None,
    }];

    let adapter = DuckDbAdapter::new();
    adapter.connect(&profile).await.expect("connect primary");

    // Second replay should skip `MyDB` even though DuckDB reports the catalog
    // lowercased internally.
    let (runtime, errors) = adapter.replay(None, "conn", vec![], vec![attachment]).await;
    assert!(
        errors.is_empty(),
        "case-insensitive skip must suppress double-attach, got: {:?}",
        errors
    );
    assert!(runtime.iter().any(|d| d.name.eq_ignore_ascii_case("MyDB")));

    adapter.disconnect().await.expect("disconnect");
    let _ = fs::remove_file(primary_path);
    let _ = fs::remove_file(seed_path);
}

#[tokio::test]
async fn duckdb_replay_default_visible_schemas_are_kind_aware() {
    // Regression for the previous hardcoded `vec!["main"]` that shoved
    // Postgres catalogs into a non-existent `main` schema, and for the later
    // "empty for non-DuckDB" default that left Postgres/SQLite catalogs
    // collapsed in the sidebar until the user manually pinned a schema.
    // Kinds with a conventional default schema should surface it; kinds whose
    // namespace is data-defined stay empty and rely on discovery.
    use crate::types::AttachmentKind;

    assert_eq!(
        DuckDbAdapter::default_visible_schemas_for(&AttachmentKind::Duckdb),
        vec!["main".to_string()],
    );
    assert_eq!(
        DuckDbAdapter::default_visible_schemas_for(&AttachmentKind::Sqlite),
        vec!["main".to_string()],
    );
    assert_eq!(
        DuckDbAdapter::default_visible_schemas_for(&AttachmentKind::Postgres),
        vec!["public".to_string()],
    );
    for kind in [
        AttachmentKind::Mysql,
        AttachmentKind::Iceberg,
        AttachmentKind::Delta,
        AttachmentKind::Ducklake,
    ] {
        assert!(
            DuckDbAdapter::default_visible_schemas_for(&kind).is_empty(),
            "{:?} should default to empty visible_schemas",
            kind,
        );
    }
}

#[tokio::test]
async fn duckdb_replay_runtime_omits_unprocessed_after_early_break() {
    // When an Extension/Secret step errors, `replay()` breaks before reaching
    // later Attach steps. The runtime list must NOT silently include those
    // unprocessed aliases, because no Attach actually ran for them. Regression
    // for the prior exclusion-based filter that admitted any alias not in
    // `errors`.
    use crate::types::{Attachment, AttachmentKind, DecryptedSecretPayload};
    use std::collections::HashMap;

    let seed_path = temp_path("early-break-seed.duckdb");
    {
        let seeder = DuckDbAdapter::new();
        seeder
            .connect(&test_profile(seed_path.to_str().unwrap()))
            .await
            .expect("seed connect");
        seeder.disconnect().await.expect("seed disconnect");
    }

    let primary_path = temp_path("early-break-primary.duckdb");
    let adapter = DuckDbAdapter::new();
    adapter
        .connect(&test_profile(primary_path.to_str().unwrap()))
        .await
        .expect("connect primary");

    // Force the Secret step to fail by giving the payload an invalid
    // secret_type that `validate_sql_key` rejects. The resulting error breaks
    // the replay loop before the Attach step can run.
    let attachment = Attachment {
        alias: "wont_attach".into(),
        kind: AttachmentKind::Duckdb,
        uri: seed_path.to_string_lossy().into_owned(),
        read_only: None,
        options: None,
        secret_ref: Some("bad_secret".into()),
    };
    let secret = DecryptedSecretPayload {
        name: "bad_secret".into(),
        secret_type: "bad type with space".into(),
        provider: None,
        persistent: false,
        params: HashMap::new(),
    };

    let (runtime, errors) = adapter
        .replay(None, "conn", vec![secret], vec![attachment])
        .await;

    assert!(
        !errors.is_empty(),
        "expected secret issuance failure to produce an error"
    );
    assert!(
        !runtime.iter().any(|d| d.name == "wont_attach"),
        "runtime must omit aliases whose Attach step never ran after early break; got: {:?}",
        runtime.iter().map(|d| &d.name).collect::<Vec<_>>()
    );

    adapter.disconnect().await.expect("disconnect");
    let _ = fs::remove_file(primary_path);
    let _ = fs::remove_file(seed_path);
}

#[tokio::test]
async fn duckdb_list_extensions_returns_core_extensions() {
    let (adapter, db_path) = connected_adapter().await;

    let extensions = adapter.list_extensions().await.expect("list extensions");

    assert!(
        !extensions.is_empty(),
        "extensions list should not be empty"
    );

    let ext_names: Vec<&str> = extensions
        .iter()
        .map(|e| e.extension_name.as_str())
        .collect();
    assert!(
        ext_names.contains(&"json"),
        "json extension should be present, found: {:?}",
        ext_names
    );
    assert!(
        ext_names.contains(&"parquet"),
        "parquet extension should be present, found: {:?}",
        ext_names
    );

    adapter.disconnect().await.expect("disconnect duckdb");
    let _ = fs::remove_file(db_path);
}
