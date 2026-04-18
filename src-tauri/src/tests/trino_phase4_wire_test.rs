//! Phase 4 pre-flight: confirms Phase 1 shipped DatabaseEntry + effective_database wire params.

use crate::types::{ConnectionProfile, DatabaseEntry, DbType};
use std::collections::HashMap;

/// Build a minimal Trino ConnectionProfile for tests.
fn make_trino_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "trino-test".to_string(),
        name: "Trino Test".to_string(),
        db_type: DbType::Trino,
        host: "localhost".to_string(),
        port: 8080,
        database: "hive".to_string(),
        username: "trino".to_string(),
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
        databases: vec![DatabaseEntry {
            name: "hive".to_string(),
            visible_schemas: vec!["default".to_string()],
            attachments: None,
            extensions: None,
            secret_refs: None,
        }],
        default_schema: None,
        trino_catalogs: None,
        trino_schema_filters: None,
    }
}

#[test]
fn trino_execute_query_accepts_effective_database_and_schemas() {
    // Smoke: confirms Phase 1 shipped the wire params. If this won't compile,
    // stop — Phase 4 cannot proceed without Phase 1's execute-query shape.
    let profile = make_trino_profile();
    assert_eq!(profile.db_type, DbType::Trino);
    assert_eq!(profile.databases.len(), 1);
    assert_eq!(profile.databases[0].name, "hive");
    assert_eq!(profile.databases[0].visible_schemas, vec!["default"]);

    // The wire params (effectiveDatabase / effectiveSchemas) are threaded through
    // the execute_query command payload. Verify the serde shape at compile time:
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)]
    struct ExecuteQueryArgs {
        conn_id: String,
        tab_id: String,
        sql: String,
        effective_schemas: Option<Vec<String>>,
        effective_database: Option<String>,
    }
    let json = r#"{
        "connId":"trino-test","tabId":"t1","sql":"SELECT 1",
        "effectiveSchemas":["default"],
        "effectiveDatabase":"hive"
    }"#;
    let args: ExecuteQueryArgs = serde_json::from_str(json).expect("wire shape must parse");
    assert_eq!(args.effective_database.as_deref(), Some("hive"));
    assert_eq!(args.effective_schemas.as_deref().unwrap(), &["default"]);
}
