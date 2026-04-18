//! Round-trip tests that a v1-shaped profile JSON still deserializes into
//! the v2 Rust struct (fields default to empty). Frontend owns the
//! synthesis of databases[]; backend just needs to tolerate either shape.

use crate::types::ConnectionProfile;

#[test]
fn v1_profile_without_databases_deserializes_with_empty_vec() {
    let v1_json = r#"{
        "id":"c1","name":"t","db_type":"PostgreSQL","host":"h","port":5432,
        "database":"mydb","username":"u","password":null,"ssl_mode":null,
        "ssl_config":null,"ssh_tunnel":null,"options":{},
        "default_schema":"reporting"
    }"#;
    let p: ConnectionProfile = serde_json::from_str(v1_json).expect("v1 must still parse");
    assert!(p.databases.is_empty());
    assert_eq!(p.default_schema.as_deref(), Some("reporting"));
}

#[test]
fn v2_profile_with_databases_round_trips() {
    let v2_json = r#"{
        "id":"c1","name":"t","db_type":"PostgreSQL","host":"h","port":5432,
        "database":"mydb","username":"u","password":null,"ssl_mode":null,
        "ssl_config":null,"ssh_tunnel":null,"options":{},
        "databases":[{"name":"mydb","visible_schemas":["public","reporting"]}]
    }"#;
    let p: ConnectionProfile = serde_json::from_str(v2_json).expect("v2 must parse");
    assert_eq!(p.databases.len(), 1);
    assert_eq!(p.databases[0].visible_schemas, vec!["public", "reporting"]);
}
