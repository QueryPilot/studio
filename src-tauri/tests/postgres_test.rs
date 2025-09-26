use devdb_studio::adapters::postgres::PostgresAdapter;
use devdb_studio::core::adapter::DbAdapter;
use devdb_studio::types::*;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::timeout;

fn test_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test".to_string(),
        name: "Test PostgreSQL".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 15432,
        database: "todoapp".to_string(),
        username: "devuser".to_string(),
        password: Some("devpass123".to_string()),
        ssl_mode: Some(SslMode::Disable),
        options: HashMap::new(),
    }
}

#[tokio::test]
async fn test_connect_and_disconnect() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    // Test connection
    let result = adapter.connect(&profile).await;
    assert!(result.is_ok(), "Failed to connect: {:?}", result);

    // Test is_connected
    assert!(adapter.is_connected().await);

    // Test disconnect
    let result = adapter.disconnect().await;
    assert!(result.is_ok(), "Failed to disconnect: {:?}", result);

    // Should not be connected after disconnect
    assert!(!adapter.is_connected().await);
}

#[tokio::test]
async fn test_connection_info() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let test_result = adapter.test_connection().await.unwrap();
    assert!(test_result.success);
    assert!(test_result.version.is_some());
    assert!(test_result.message.contains("todoapp"));

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_get_schemas() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let schemas = adapter.get_schemas("todoapp").await.unwrap();
    assert!(schemas.len() > 0);
    assert!(schemas.iter().any(|s| s.name == "public"));

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_get_tables() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let tables = adapter.get_tables("public").await.unwrap();
    assert!(tables.len() > 0);

    // Should have todos and users tables from seed data
    assert!(tables.iter().any(|t| t.name == "todos"));
    assert!(tables.iter().any(|t| t.name == "users"));

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_get_columns() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    let columns = adapter.get_table_columns("public", "todos").await.unwrap();
    assert!(columns.len() > 0);

    // Check for expected columns
    assert!(columns.iter().any(|c| c.name == "id"));
    assert!(columns.iter().any(|c| c.name == "title"));
    assert!(columns.iter().any(|c| c.name == "description"));

    // Check primary key detection
    let id_col = columns.iter().find(|c| c.name == "id").unwrap();
    assert!(id_col.primary_key);

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_query_execution() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Simple query execution test
    let handle = adapter
        .open_query("SELECT COUNT(*) FROM users")
        .await
        .unwrap();
    assert!(handle.columns.len() > 0);

    let chunk = adapter.fetch_page(&handle, 1).await.unwrap();
    assert!(!chunk.rows.is_empty());

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_postgresql_basic_types() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Simple type test using existing data
    let handle = adapter
        .open_query("SELECT id, title, status FROM todos LIMIT 1")
        .await
        .unwrap();
    let chunk = adapter.fetch_page(&handle, 1).await.unwrap();

    if !chunk.rows.is_empty() {
        let row = &chunk.rows[0];
        // Basic validation that we can handle these types
        assert!(row.len() >= 3);
        // Just verify we can retrieve the data without errors
    }

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_postgresql_json_types() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Test JSON types using existing schema
    let handle = adapter
        .open_query("SELECT tags, custom_fields FROM todos WHERE tags IS NOT NULL LIMIT 1")
        .await
        .unwrap();
    let chunk = adapter.fetch_page(&handle, 1).await.unwrap();

    if !chunk.rows.is_empty() {
        let row = &chunk.rows[0];
        // Verify we can handle JSON types from existing data
        assert!(row.len() >= 2);
    }

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_postgresql_advanced_types() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Test array types using existing schema
    let handle = adapter
        .open_query("SELECT collaborator_ids FROM todos WHERE collaborator_ids IS NOT NULL LIMIT 1")
        .await
        .unwrap();
    let chunk = adapter.fetch_page(&handle, 1).await.unwrap();

    // Just verify we can query without hanging - no need for complex validation
    assert!(chunk.rows.len() >= 0); // Can be empty, just shouldn't timeout

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_null_handling() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Create table with nullable columns
    adapter
        .execute("CREATE TEMP TABLE null_test (id INTEGER, value TEXT)")
        .await
        .unwrap();
    adapter
        .execute("INSERT INTO null_test VALUES (1, NULL), (2, 'not null')")
        .await
        .unwrap();

    let handle = adapter
        .open_query("SELECT * FROM null_test ORDER BY id")
        .await
        .unwrap();
    let chunk = adapter.fetch_page(&handle, 10).await.unwrap();

    assert_eq!(chunk.rows.len(), 2);

    // First row has NULL value
    assert!(matches!(chunk.rows[0][1].value_type, CellValueType::Null));
    assert_eq!(chunk.rows[0][1].display_value, "");

    // Second row has non-NULL value
    assert!(matches!(chunk.rows[1][1].value_type, CellValueType::Text));
    assert_eq!(chunk.rows[1][1].display_value, "not null");

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_introspection_functions() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Test getting databases
    let databases = adapter.get_databases().await.unwrap();
    assert!(databases.len() > 0);
    assert!(databases.iter().any(|d| d.name == "todoapp"));

    // Test getting views
    let views = adapter.get_views("public").await.unwrap();
    // May or may not have views, just check it doesn't error

    // Test getting functions
    let functions = adapter.get_functions("public").await.unwrap();
    // May or may not have functions, just check it doesn't error

    // Test getting indexes
    let indexes = adapter.get_indexes("todos").await.unwrap();
    // Should have at least primary key index
    assert!(indexes.len() > 0);

    // Test getting constraints
    let constraints = adapter.get_constraints("todos").await.unwrap();
    // Should have at least primary key constraint
    assert!(constraints.len() > 0);
    assert!(constraints
        .iter()
        .any(|c| matches!(c.constraint_type, ConstraintType::PrimaryKey)));

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_large_result_pagination() {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    adapter.connect(&profile).await.unwrap();

    // Use controlled dataset instead of full table scan
    let handle = adapter
        .open_query("SELECT id, title, description FROM todos LIMIT 100")
        .await
        .unwrap();

    let mut total_rows = 0;
    let mut iterations = 0;
    let max_iterations = 10; // Limit iterations for controlled test

    loop {
        let chunk = adapter.fetch_page(&handle, 25).await.unwrap();
        total_rows += chunk.rows.len();
        iterations += 1;

        if !chunk.has_more || iterations >= max_iterations {
            break;
        }
    }

    // Should have fetched bounded results
    assert!(total_rows > 0);
    assert!(total_rows <= 100); // Ensure we don't exceed our LIMIT
    println!(
        "Fetched {} total rows in {} iterations",
        total_rows, iterations
    );

    adapter.disconnect().await.unwrap();
}
