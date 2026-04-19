#[test]
fn duckdb_set_search_path_sql_shape() {
    use crate::adapters::duckdb::search_path::build_set_search_path_sql;
    // DuckDB requires a single scalar string, not a Postgres-style identifier list.
    let sql = build_set_search_path_sql(&["main".into(), "reporting".into()]);
    assert_eq!(sql, "SET search_path = 'main,reporting'");
    assert_eq!(build_set_search_path_sql(&[]), "");
}

// ── Phase 3: DuckDB persistence tests ────────────────────────────────────────

#[test]
fn build_create_secret_sql_uses_space_separated_kv() {
    use crate::adapters::duckdb::adapter::DuckDbAdapter;
    use crate::types::DecryptedSecretPayload;
    use std::collections::HashMap;
    let payload = DecryptedSecretPayload {
        name: "my_s3".into(),
        secret_type: "s3".into(),
        provider: Some("config".into()),
        persistent: false,
        params: HashMap::from([
            ("KEY_ID".into(), "AKIA...".into()),
            ("SECRET".into(), "xxx".into()),
            ("REGION".into(), "us-east-1".into()),
        ]),
    };
    let sql = DuckDbAdapter::build_create_secret_sql(&payload).unwrap();
    // Space-separated KEY 'value' pairs, NOT comma-joined.
    assert!(
        sql.starts_with("CREATE OR REPLACE SECRET \"my_s3\" ("),
        "sql: {sql}"
    );
    assert!(sql.contains("TYPE S3"), "sql: {sql}");
    assert!(sql.contains("PROVIDER 'config'"), "sql: {sql}");
    assert!(sql.contains("KEY_ID 'AKIA...'"), "sql: {sql}");
    assert!(sql.contains("SECRET 'xxx'"), "sql: {sql}");
    assert!(sql.contains("REGION 'us-east-1'"), "sql: {sql}");
    // No commas between KV pairs.
    let inside = sql.split_once('(').unwrap().1.rsplit_once(')').unwrap().0;
    assert!(
        !inside.contains(','),
        "inside paren must be space-separated: {inside}"
    );
}

#[test]
fn build_drop_secret_sql_branches_on_persistent() {
    use crate::adapters::duckdb::adapter::DuckDbAdapter;
    assert_eq!(
        DuckDbAdapter::build_drop_secret_sql("my_s3", true).unwrap(),
        "DROP PERSISTENT SECRET \"my_s3\""
    );
    assert_eq!(
        DuckDbAdapter::build_drop_secret_sql("my_s3", false).unwrap(),
        "DROP SECRET \"my_s3\""
    );
}

#[test]
fn build_attach_sql_postgres_with_secret_and_read_only() {
    use crate::adapters::duckdb::adapter::DuckDbAdapter;
    use crate::types::{Attachment, AttachmentKind};
    let att = Attachment {
        alias: "pg".into(),
        kind: AttachmentKind::Postgres,
        uri: "host=x dbname=y".into(),
        read_only: Some(true),
        options: None,
        secret_ref: Some("pg_secret".into()),
    };
    let sql = DuckDbAdapter::build_attach_sql(&att, Some("pg_secret")).unwrap();
    assert!(sql.contains("SECRET \"pg_secret\""), "sql={sql}");
    assert!(sql.contains("READ_ONLY"), "sql={sql}");
    assert!(sql.contains("TYPE POSTGRES"), "sql={sql}");
}

#[test]
fn build_attach_sql_iceberg_with_catalog_uri() {
    use crate::adapters::duckdb::adapter::DuckDbAdapter;
    use crate::types::{Attachment, AttachmentKind};
    let att = Attachment {
        alias: "lake".into(),
        kind: AttachmentKind::Iceberg,
        uri: "s3://b/ice".into(),
        read_only: None,
        options: Some(std::collections::HashMap::from([(
            "CATALOG_URI".into(),
            "http://rest/".into(),
        )])),
        secret_ref: None,
    };
    let sql = DuckDbAdapter::build_attach_sql(&att, None).unwrap();
    assert!(sql.contains("TYPE ICEBERG"), "sql={sql}");
    assert!(sql.contains("CATALOG_URI 'http://rest/'"), "sql={sql}");
}

#[test]
fn replay_plan_orders_ext_secret_attach() {
    use crate::adapters::duckdb::adapter::DuckDbAdapter;
    use crate::types::{Attachment, AttachmentKind, DecryptedSecretPayload};
    use std::collections::HashMap;
    let secrets = vec![DecryptedSecretPayload {
        name: "my_s3".into(),
        secret_type: "s3".into(),
        provider: None,
        persistent: false,
        params: HashMap::new(),
    }];
    let attachments = vec![
        Attachment {
            alias: "lake".into(),
            kind: AttachmentKind::Iceberg,
            uri: "s3://b/ice".into(),
            read_only: None,
            options: None,
            secret_ref: Some("my_s3".into()),
        },
        Attachment {
            alias: "local".into(),
            kind: AttachmentKind::Duckdb,
            uri: "/tmp/local.duckdb".into(),
            read_only: None,
            options: None,
            secret_ref: None,
        },
    ];
    let steps = DuckDbAdapter::replay_plan(&secrets, &attachments);
    // Order: extensions (iceberg for first attachment), then secrets, then attaches
    use crate::adapters::duckdb::adapter::ReplayStep;
    let labels: Vec<String> = steps
        .iter()
        .map(|s| match s {
            ReplayStep::Extension(n) => format!("ext:{n}"),
            ReplayStep::Secret(n) => format!("sec:{n}"),
            ReplayStep::Attach(n) => format!("att:{n}"),
        })
        .collect();
    // First step must be extension for iceberg
    assert!(
        labels.contains(&"ext:iceberg".to_string()),
        "labels: {labels:?}"
    );
    // Secret before attach
    let sec_pos = labels.iter().position(|l| l == "sec:my_s3").unwrap();
    let att_pos = labels.iter().position(|l| l == "att:lake").unwrap();
    assert!(
        sec_pos < att_pos,
        "secret must come before attach: {labels:?}"
    );
    // Duckdb kind needs no extension
    assert!(
        !labels.iter().any(|l| l.starts_with("ext:duckdb")),
        "duckdb should not add extension"
    );
}

#[test]
fn replay_plan_deduplicates_extensions() {
    use crate::adapters::duckdb::adapter::{DuckDbAdapter, ReplayStep};
    use crate::types::{Attachment, AttachmentKind, DecryptedSecretPayload};
    // Two iceberg attachments → only one iceberg extension step
    let attachments = vec![
        Attachment {
            alias: "a".into(),
            kind: AttachmentKind::Iceberg,
            uri: "s3://a".into(),
            read_only: None,
            options: None,
            secret_ref: None,
        },
        Attachment {
            alias: "b".into(),
            kind: AttachmentKind::Iceberg,
            uri: "s3://b".into(),
            read_only: None,
            options: None,
            secret_ref: None,
        },
    ];
    let steps = DuckDbAdapter::replay_plan(&[] as &[DecryptedSecretPayload], &attachments);
    let ext_count = steps
        .iter()
        .filter(|s| matches!(s, ReplayStep::Extension(_)))
        .count();
    assert_eq!(
        ext_count,
        1,
        "should deduplicate iceberg extension: {steps:?}",
        steps = steps
            .iter()
            .map(|s| match s {
                ReplayStep::Extension(n) => format!("ext:{n}"),
                ReplayStep::Secret(n) => format!("sec:{n}"),
                ReplayStep::Attach(n) => format!("att:{n}"),
            })
            .collect::<Vec<_>>()
    );
}
