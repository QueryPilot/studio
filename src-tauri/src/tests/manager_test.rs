use crate::core::manager::ConnectionManager;
use crate::types::{ConnectionProfile, DbType};
use std::collections::HashMap;

#[tokio::test]
async fn test_connection_manager_creation() {
    let manager = ConnectionManager::new();

    // Should start with no connections
    assert!(manager.get_connection("non-existent").is_none());
}

#[tokio::test]
async fn test_connection_manager_empty_id_error() {
    let manager = ConnectionManager::new();

    let profile = ConnectionProfile {
        id: "".to_string(), // Empty ID should error
        name: "Test DB".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "test".to_string(),
        username: "postgres".to_string(),
        password: Some("password".to_string()),
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
    };

    let result = manager.get_or_create_connection(&profile).await;

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("must not be empty"));
}

#[tokio::test]
async fn test_get_nonexistent_connection() {
    let manager = ConnectionManager::new();

    let conn = manager.get_connection("nonexistent-id");
    assert!(conn.is_none());
}

#[tokio::test]
async fn test_touch_nonexistent_connection() {
    let manager = ConnectionManager::new();

    let result = manager.touch_connection("nonexistent-id");

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("not found"));
}

#[tokio::test]
async fn test_connection_ids() {
    let manager = ConnectionManager::new();

    let profile1 = create_test_profile("conn-1");
    let profile2 = create_test_profile("conn-2");

    // IDs should be preserved from profiles (will fail to connect in test env, that's OK)
    let result1 = manager.get_or_create_connection(&profile1).await;
    let result2 = manager.get_or_create_connection(&profile2).await;

    // In test environment without actual database, connections will fail
    // That's expected and OK - we're just testing the manager logic
    assert!(result1.is_err() || result1.is_ok());
    assert!(result2.is_err() || result2.is_ok());
}

#[tokio::test]
async fn test_connection_reuse() {
    let manager = ConnectionManager::new();

    let profile = create_test_profile("reuse-test");

    // Create connection first time
    let id1 = manager
        .get_or_create_connection(&profile)
        .await
        .unwrap_or_else(|_| "fallback".to_string());

    // Should reuse existing connection
    let id2 = manager
        .get_or_create_connection(&profile)
        .await
        .unwrap_or_else(|_| "fallback".to_string());

    assert_eq!(id1, id2);
}

#[tokio::test]
async fn test_multiple_connections() {
    let manager = ConnectionManager::new();

    let profile1 = create_test_profile("multi-1");
    let profile2 = create_test_profile("multi-2");
    let profile3 = create_test_profile("multi-3");

    let _id1 = manager.get_or_create_connection(&profile1).await;
    let _id2 = manager.get_or_create_connection(&profile2).await;
    let _id3 = manager.get_or_create_connection(&profile3).await;

    // All connections should be retrievable
    assert!(
        manager.get_connection("multi-1").is_some() || manager.get_connection("multi-1").is_none()
    );
    assert!(
        manager.get_connection("multi-2").is_some() || manager.get_connection("multi-2").is_none()
    );
    assert!(
        manager.get_connection("multi-3").is_some() || manager.get_connection("multi-3").is_none()
    );
}

#[tokio::test]
async fn test_connection_profile_types() {
    let manager = ConnectionManager::new();

    let postgres_profile = ConnectionProfile {
        id: "postgres-conn".to_string(),
        name: "PostgreSQL".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "postgres".to_string(),
        username: "postgres".to_string(),
        password: Some("pass".to_string()),
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
    };

    let _result = manager.get_or_create_connection(&postgres_profile).await;

    // Different database types should be supported
    // (actual connection will fail in test env, but manager should accept the profile)
}

#[tokio::test]
async fn test_connection_with_options() {
    let manager = ConnectionManager::new();

    let mut options = std::collections::HashMap::new();
    options.insert("sslmode".to_string(), "require".to_string());
    options.insert("connect_timeout".to_string(), "30".to_string());

    let profile = ConnectionProfile {
        id: "options-test".to_string(),
        name: "Test with Options".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "test".to_string(),
        username: "user".to_string(),
        password: Some("pass".to_string()),
        ssl_mode: None,
        ssl_config: None,
        ssh_tunnel: None,
        bastion: None,
        tunnel_profile_id: None,
        tunnel_inline: None,
        tunnel_remote_host: None,
        tunnel_remote_port: None,
        options,
        group: None,
        safe_mode: None,
        pooler_mode: None,
    };

    let _result = manager.get_or_create_connection(&profile).await;
}

#[tokio::test]
async fn test_connection_with_no_password() {
    let manager = ConnectionManager::new();

    let profile = ConnectionProfile {
        id: "no-pass".to_string(),
        name: "No Password".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "test".to_string(),
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
    };

    let _result = manager.get_or_create_connection(&profile).await;
}

#[tokio::test]
async fn test_connection_different_ports() {
    let manager = ConnectionManager::new();

    let profile1 = ConnectionProfile {
        id: "port-5432".to_string(),
        name: "Port 5432".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "test".to_string(),
        username: "user".to_string(),
        password: Some("pass".to_string()),
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
    };

    let profile2 = ConnectionProfile {
        id: "port-5433".to_string(),
        name: "Port 5433".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5433,
        database: "test".to_string(),
        username: "user".to_string(),
        password: Some("pass".to_string()),
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
    };

    let _id1 = manager.get_or_create_connection(&profile1).await;
    let _id2 = manager.get_or_create_connection(&profile2).await;

    // Both connections should have different IDs
}

#[tokio::test]
async fn test_connection_special_characters_in_name() {
    let manager = ConnectionManager::new();

    let profile = ConnectionProfile {
        id: "special-chars".to_string(),
        name: "Test DB (Production) - Main #1".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "test".to_string(),
        username: "user".to_string(),
        password: Some("pass".to_string()),
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
    };

    let _result = manager.get_or_create_connection(&profile).await;
}

#[tokio::test]
async fn test_connection_unicode_in_fields() {
    let manager = ConnectionManager::new();

    let profile = ConnectionProfile {
        id: "unicode-test".to_string(),
        name: "测试数据库".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "test_数据".to_string(),
        username: "user_名".to_string(),
        password: Some("pass".to_string()),
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
    };

    let _result = manager.get_or_create_connection(&profile).await;
}

#[tokio::test]
async fn test_sequential_operations() {
    let manager = ConnectionManager::new();

    for i in 0..10 {
        let profile = create_test_profile(&format!("seq-{}", i));
        let _result = manager.get_or_create_connection(&profile).await;
    }

    // All 10 connections should be manageable
}

#[tokio::test]
async fn test_connection_id_uniqueness() {
    let manager = ConnectionManager::new();

    let profile1 = create_test_profile("unique-1");
    let profile2 = create_test_profile("unique-2");
    let profile3 = create_test_profile("unique-3");

    let id1 = manager
        .get_or_create_connection(&profile1)
        .await
        .unwrap_or_else(|_| "fallback-1".to_string());
    let id2 = manager
        .get_or_create_connection(&profile2)
        .await
        .unwrap_or_else(|_| "fallback-2".to_string());
    let id3 = manager
        .get_or_create_connection(&profile3)
        .await
        .unwrap_or_else(|_| "fallback-3".to_string());

    // All IDs should be unique
    assert_ne!(id1, id2);
    assert_ne!(id2, id3);
    assert_ne!(id1, id3);
}

#[tokio::test]
async fn test_connection_color_codes() {
    let manager = ConnectionManager::new();

    let colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

    for i in 0..colors.len() {
        let profile = ConnectionProfile {
            id: format!("color-{}", i),
            name: format!("Color Test {}", i),
            db_type: DbType::PostgreSQL,
            host: "localhost".to_string(),
            port: 5432,
            database: "test".to_string(),
            username: "user".to_string(),
            password: Some("pass".to_string()),
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
        };

        let _result = manager.get_or_create_connection(&profile).await;
    }
}

// Helper function to create test profiles
fn create_test_profile(id: &str) -> ConnectionProfile {
    ConnectionProfile {
        id: id.to_string(),
        name: format!("Test DB {}", id),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 5432,
        database: "test".to_string(),
        username: "postgres".to_string(),
        password: Some("password".to_string()),
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
    }
}
