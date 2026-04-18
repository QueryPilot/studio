// Vault encryption/decryption tests
// Note: The vault module uses ChaCha20Poly1305 encryption and integrates with OS keychain

use crate::types::ConnectionProfile;
use std::collections::HashMap;

#[test]
fn test_connection_profile_serialization() {
    use crate::types::DbType;

    let connection = ConnectionProfile {
        id: "test-1".to_string(),
        name: "Test DB".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "testdb".to_string(),
        username: "testuser".to_string(),
        password: Some("password123".to_string()),
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
    };

    // Test that connection profiles can be serialized (required for vault storage)
    let json = serde_json::to_string(&connection).unwrap();
    let deserialized: ConnectionProfile = serde_json::from_str(&json).unwrap();

    assert_eq!(connection.id, deserialized.id);
    assert_eq!(connection.name, deserialized.name);
    assert_eq!(connection.db_type, deserialized.db_type);
}

#[test]
fn test_multiple_connections_serialization() {
    use crate::types::DbType;

    let connections = vec![
        ConnectionProfile {
            id: "pg-1".to_string(),
            name: "PostgreSQL".to_string(),
            db_type: DbType::PostgreSQL,
            host: "localhost".to_string(),
            port: 5432,
            database: "postgres".to_string(),
            username: "postgres".to_string(),
            password: Some("pass1".to_string()),
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
        },
        ConnectionProfile {
            id: "mysql-1".to_string(),
            name: "MySQL".to_string(),
            db_type: DbType::MySQL,
            host: "localhost".to_string(),
            port: 3306,
            database: "mydb".to_string(),
            username: "root".to_string(),
            password: Some("pass2".to_string()),
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
        },
    ];

    // Test serializing multiple connections
    let json = serde_json::to_string(&connections).unwrap();
    let deserialized: Vec<ConnectionProfile> = serde_json::from_str(&json).unwrap();

    assert_eq!(connections.len(), deserialized.len());
    assert_eq!(connections[0].db_type, DbType::PostgreSQL);
    assert_eq!(connections[1].db_type, DbType::MySQL);
}

#[test]
fn test_connection_with_options() {
    use crate::types::DbType;

    let mut options = HashMap::new();
    options.insert("application_name".to_string(), "query-pilot".to_string());
    options.insert("connect_timeout".to_string(), "30".to_string());

    let connection = ConnectionProfile {
        id: "test-1".to_string(),
        name: "Test DB".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "testdb".to_string(),
        username: "user".to_string(),
        password: None,
        ssl_mode: None,
        ssl_config: None,
        ssh_tunnel: None,
        bastion: None,
        tunnel_profile_id: None,
        tunnel_inline: None,
        tunnel_remote_host: None,
        tunnel_remote_port: None,
        options: options.clone(),
        group: None,
        safe_mode: None,
        pooler_mode: None,
        databases: vec![],
        default_schema: None,
        trino_catalogs: None,
        trino_schema_filters: None,
    };

    // Verify options are preserved in serialization
    let json = serde_json::to_string(&connection).unwrap();
    let deserialized: ConnectionProfile = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.options.len(), 2);
    assert_eq!(
        deserialized.options.get("application_name"),
        Some(&"query-pilot".to_string())
    );
}

#[test]
fn test_empty_connections_list() {
    let connections: Vec<ConnectionProfile> = vec![];

    let json = serde_json::to_string(&connections).unwrap();
    let deserialized: Vec<ConnectionProfile> = serde_json::from_str(&json).unwrap();

    assert_eq!(connections.len(), deserialized.len());
    assert!(deserialized.is_empty());
}

#[test]
fn test_connection_password_handling() {
    use crate::types::DbType;

    // With password
    let with_password = ConnectionProfile {
        id: "test-1".to_string(),
        name: "With Password".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "db".to_string(),
        username: "user".to_string(),
        password: Some("secret".to_string()),
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
    };

    // Without password
    let without_password = ConnectionProfile {
        id: "test-2".to_string(),
        name: "Without Password".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "db".to_string(),
        username: "user".to_string(),
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
    };

    assert!(with_password.password.is_some());
    assert!(without_password.password.is_none());
}

#[test]
fn test_connection_profile_pooler_mode_round_trip() {
    use crate::types::DbType;

    let connection = ConnectionProfile {
        id: "pg-pooler".to_string(),
        name: "Pooler".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "postgres".to_string(),
        username: "postgres".to_string(),
        password: Some("secret".to_string()),
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
        pooler_mode: Some(true),
        databases: vec![],
        default_schema: None,
        trino_catalogs: None,
        trino_schema_filters: None,
    };

    let json = serde_json::to_string(&connection).unwrap();
    let deserialized: ConnectionProfile = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.pooler_mode, Some(true));
}

#[test]
fn test_connection_profile_debug_redacts_uri_and_password() {
    use crate::types::DbType;

    let connection = ConnectionProfile {
        id: "debug-redaction".to_string(),
        name: "Debug Redaction".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "postgres://user:secret@example.com/app".to_string(),
        username: "postgres".to_string(),
        password: Some("secret".to_string()),
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
        pooler_mode: Some(true),
        databases: vec![],
        default_schema: None,
        trino_catalogs: None,
        trino_schema_filters: None,
    };

    let debug_output = format!("{:?}", connection);

    assert!(!debug_output.contains("secret"));
    assert!(!debug_output.contains("postgres://user:secret@example.com/app"));
    assert!(debug_output.contains("<redacted-uri>"));
}
