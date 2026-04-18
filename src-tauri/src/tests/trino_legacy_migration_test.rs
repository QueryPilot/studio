//! Phase 4 tests: Trino legacy-field migration (read-compat and serialization).

use crate::types::{ConnectionProfile, DatabaseEntry, DbType};
use std::collections::HashMap;

fn make_trino_profile_minimal() -> ConnectionProfile {
    ConnectionProfile {
        id: "t1".to_string(),
        name: "prod".to_string(),
        db_type: DbType::Trino,
        host: "h".to_string(),
        port: 8080,
        database: "hive".to_string(),
        username: "u".to_string(),
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

#[test]
fn trino_profile_with_legacy_fields_deserializes_into_databases() {
    // Fixture: a v2 profile written before Phase 4 that still carries
    // legacy trino_catalogs / trino_schema_filters next to a (possibly
    // stub) databases[] from Phase 1.
    let json = r#"{
        "id":"abc","name":"prod","db_type":"Trino",
        "host":"localhost","port":8080,"database":"hive","username":"u",
        "options":{},
        "databases":[
            {"name":"hive","visible_schemas":["default"]}
        ],
        "trino_catalogs":["hive","iceberg"],
        "trino_schema_filters":"{\"hive\":[\"default\",\"logs\"],\"iceberg\":[\"analytics\"]}"
    }"#;
    let profile: ConnectionProfile = serde_json::from_str(json).unwrap();
    assert_eq!(profile.db_type, DbType::Trino);
    // Legacy fields still parse (read-compat retained):
    assert_eq!(
        profile.trino_catalogs.as_deref(),
        Some(&["hive".to_string(), "iceberg".to_string()][..])
    );
    // databases[] also parsed from the JSON:
    assert!(profile.databases.iter().any(|d| d.name == "hive"));
}

#[test]
fn profile_serializes_without_legacy_fields_when_none() {
    let mut profile = make_trino_profile_minimal();
    profile.db_type = DbType::Trino;
    profile.databases = vec![DatabaseEntry {
        name: "hive".to_string(),
        visible_schemas: vec!["default".to_string()],
        attachments: None,
        extensions: None,
        secret_refs: None,
    }];
    profile.trino_catalogs = None;
    profile.trino_schema_filters = None;

    let bytes = serde_json::to_string(&profile).unwrap();
    assert!(!bytes.contains("trino_catalogs"), "bytes: {bytes}");
    assert!(!bytes.contains("trino_schema_filters"), "bytes: {bytes}");
    assert!(bytes.contains("\"databases\""), "bytes: {bytes}");
}

#[test]
fn fixture_v2_trino_profile_with_legacy_fields_maps_to_two_databases() {
    // The Rust side is pure-parse; full "legacy strip" only happens on the
    // frontend. This test guards the parse contract:
    let raw = r#"{
        "id":"t1","name":"prod","db_type":"Trino","host":"h","port":8080,
        "database":"hive","username":"u","options":{},
        "databases":[],
        "trino_catalogs":["hive","iceberg"],
        "trino_schema_filters":"{\"hive\":[\"default\"]}"
    }"#;
    let profile: ConnectionProfile = serde_json::from_str(raw).unwrap();
    assert_eq!(profile.trino_catalogs.as_ref().unwrap().len(), 2);
}

#[test]
fn trino_adapter_methods_read_from_databases() {
    use crate::adapters::trino::TrinoAdapter;

    let mut profile = make_trino_profile_minimal();
    profile.databases = vec![
        DatabaseEntry {
            name: "hive".to_string(),
            visible_schemas: vec!["default".to_string(), "logs".to_string()],
            attachments: None,
            extensions: None,
            secret_refs: None,
        },
        DatabaseEntry {
            name: "iceberg".to_string(),
            visible_schemas: vec!["analytics".to_string()],
            attachments: None,
            extensions: None,
            secret_refs: None,
        },
    ];

    let adapter = TrinoAdapter::new();
    let catalogs = adapter.visible_catalogs(&profile);
    assert_eq!(catalogs, vec!["hive", "iceberg"]);

    let filters = adapter.schema_filters(&profile);
    assert_eq!(
        filters.get("hive").unwrap().as_slice(),
        &["default".to_string(), "logs".to_string()]
    );
    assert_eq!(
        filters.get("iceberg").unwrap().as_slice(),
        &["analytics".to_string()]
    );
}
