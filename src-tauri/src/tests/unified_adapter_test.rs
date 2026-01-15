//! Tests for the Unified Adapter architecture.
//!
//! These tests verify that the UnifiedAdapter struct works correctly with
//! all database types and provides the expected paradigm-specific access.

use crate::adapters::mongodb::MongoDbAdapter;
use crate::adapters::mssql::MssqlAdapter;
use crate::adapters::mysql::MySqlAdapter;
use crate::adapters::postgres::PostgresAdapter;
use crate::adapters::redis::RedisAdapter;
use crate::adapters::sqlite::SqliteAdapter;
use crate::core::manager::UnifiedAdapter;
use crate::types::DbType;

// ============================================================================
// UnifiedAdapter Construction Tests
// ============================================================================

#[test]
fn test_unified_adapter_postgres_construction() {
    let adapter = PostgresAdapter::new();
    let unified = UnifiedAdapter::postgres(adapter);

    assert_eq!(unified.db_type(), DbType::PostgreSQL);
    assert!(unified.as_sql().is_some(), "PostgreSQL should be SqlQueryable");
    assert!(unified.as_document().is_none(), "PostgreSQL should not be DocumentQueryable");
    assert!(unified.as_keyvalue().is_none(), "PostgreSQL should not be RichKeyValueOperable");
    assert!(unified.as_postgres().is_some(), "Should have concrete PostgresAdapter access");
}

#[test]
fn test_unified_adapter_mysql_construction() {
    let adapter = MySqlAdapter::new();
    let unified = UnifiedAdapter::mysql(adapter, DbType::MySQL);

    assert_eq!(unified.db_type(), DbType::MySQL);
    assert!(unified.as_sql().is_some(), "MySQL should be SqlQueryable");
    assert!(unified.as_document().is_none(), "MySQL should not be DocumentQueryable");
    assert!(unified.as_keyvalue().is_none(), "MySQL should not be RichKeyValueOperable");
}

#[test]
fn test_unified_adapter_mariadb_construction() {
    let adapter = MySqlAdapter::new();
    let unified = UnifiedAdapter::mysql(adapter, DbType::MariaDB);

    assert_eq!(unified.db_type(), DbType::MariaDB);
    assert!(unified.as_sql().is_some(), "MariaDB should be SqlQueryable");
}

#[test]
fn test_unified_adapter_sqlite_construction() {
    let adapter = SqliteAdapter::new();
    let unified = UnifiedAdapter::sqlite(adapter);

    assert_eq!(unified.db_type(), DbType::SQLite);
    assert!(unified.as_sql().is_some(), "SQLite should be SqlQueryable");
    assert!(unified.as_document().is_none(), "SQLite should not be DocumentQueryable");
    assert!(unified.as_keyvalue().is_none(), "SQLite should not be RichKeyValueOperable");
}

#[test]
fn test_unified_adapter_mssql_construction() {
    let adapter = MssqlAdapter::new();
    let unified = UnifiedAdapter::mssql(adapter);

    assert_eq!(unified.db_type(), DbType::SQLServer);
    assert!(unified.as_sql().is_some(), "SQL Server should be SqlQueryable");
    assert!(unified.as_document().is_none(), "SQL Server should not be DocumentQueryable");
    assert!(unified.as_keyvalue().is_none(), "SQL Server should not be RichKeyValueOperable");
}

#[test]
fn test_unified_adapter_mongodb_construction() {
    let adapter = MongoDbAdapter::new();
    let unified = UnifiedAdapter::mongodb(adapter);

    assert_eq!(unified.db_type(), DbType::MongoDB);
    assert!(unified.as_sql().is_none(), "MongoDB should not be SqlQueryable");
    assert!(unified.as_document().is_some(), "MongoDB should be DocumentQueryable");
    assert!(unified.as_keyvalue().is_none(), "MongoDB should not be RichKeyValueOperable");
    assert!(unified.as_mongo().is_some(), "Should have concrete MongoDbAdapter access");
}

#[test]
fn test_unified_adapter_redis_construction() {
    let adapter = RedisAdapter::new();
    let unified = UnifiedAdapter::redis(adapter);

    assert_eq!(unified.db_type(), DbType::Redis);
    assert!(unified.as_sql().is_none(), "Redis should not be SqlQueryable");
    assert!(unified.as_document().is_none(), "Redis should not be DocumentQueryable");
    assert!(unified.as_keyvalue().is_some(), "Redis should be RichKeyValueOperable");
    assert!(unified.as_redis().is_some(), "Should have concrete RedisAdapter access");
}

// ============================================================================
// Paradigm Coverage Tests
// ============================================================================

#[test]
fn test_all_db_types_have_unified_adapter_support() {
    // Ensure all DbType variants can be wrapped in UnifiedAdapter
    // This test documents which adapters support which paradigms

    let db_types_and_paradigms = [
        (DbType::PostgreSQL, "sql"),
        (DbType::MySQL, "sql"),
        (DbType::MariaDB, "sql"),
        (DbType::SQLite, "sql"),
        (DbType::SQLServer, "sql"),
        (DbType::MongoDB, "document"),
        (DbType::Redis, "keyvalue"),
    ];

    for (db_type, expected_paradigm) in db_types_and_paradigms {
        match (db_type, expected_paradigm) {
            (DbType::PostgreSQL, "sql") => {
                let unified = UnifiedAdapter::postgres(PostgresAdapter::new());
                assert!(unified.as_sql().is_some());
            }
            (DbType::MySQL, "sql") => {
                let unified = UnifiedAdapter::mysql(MySqlAdapter::new(), DbType::MySQL);
                assert!(unified.as_sql().is_some());
            }
            (DbType::MariaDB, "sql") => {
                let unified = UnifiedAdapter::mysql(MySqlAdapter::new(), DbType::MariaDB);
                assert!(unified.as_sql().is_some());
            }
            (DbType::SQLite, "sql") => {
                let unified = UnifiedAdapter::sqlite(SqliteAdapter::new());
                assert!(unified.as_sql().is_some());
            }
            (DbType::SQLServer, "sql") => {
                let unified = UnifiedAdapter::mssql(MssqlAdapter::new());
                assert!(unified.as_sql().is_some());
            }
            (DbType::MongoDB, "document") => {
                let unified = UnifiedAdapter::mongodb(MongoDbAdapter::new());
                assert!(unified.as_document().is_some());
            }
            (DbType::Redis, "keyvalue") => {
                let unified = UnifiedAdapter::redis(RedisAdapter::new());
                assert!(unified.as_keyvalue().is_some());
            }
            _ => panic!("Unexpected db_type and paradigm combination"),
        }
    }
}

// ============================================================================
// Send/Sync Safety Tests
// ============================================================================

fn assert_send<T: Send>() {}
fn assert_sync<T: Sync>() {}

#[test]
fn test_unified_adapter_is_send() {
    assert_send::<UnifiedAdapter>();
}

#[test]
fn test_unified_adapter_is_sync() {
    assert_sync::<UnifiedAdapter>();
}

// ============================================================================
// BaseCapability Delegation Tests
// ============================================================================

#[test]
fn test_unified_adapter_is_not_connected_initially() {
    let adapter = PostgresAdapter::new();
    let unified = UnifiedAdapter::postgres(adapter);

    // Before connect(), adapter should not be connected
    assert!(!unified.is_connected());
}

#[test]
fn test_unified_adapter_mongodb_is_not_connected_initially() {
    let adapter = MongoDbAdapter::new();
    let unified = UnifiedAdapter::mongodb(adapter);

    assert!(!unified.is_connected());
}

#[test]
fn test_unified_adapter_redis_is_not_connected_initially() {
    let adapter = RedisAdapter::new();
    let unified = UnifiedAdapter::redis(adapter);

    assert!(!unified.is_connected());
}
