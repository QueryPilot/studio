#[cfg(test)]
mod mysql_integration_tests {
    use devdb_studio_lib::database::adapter::{mysql::MySqlAdapter, DbAdapter};
    use sqlx::mysql::MySqlPoolOptions;
    use std::time::Duration;

    #[tokio::test]
    async fn test_mysql_connection_and_operations() {
        // MySQL connection details from docker-compose
        let database_url = "mysql://devuser:devpass123@localhost:13306/todoapp";
        
        // Create MySQL pool
        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(10))
            .connect(database_url)
            .await
            .expect("Failed to create MySQL pool");
        
        // Create adapter
        let adapter = MySqlAdapter::new(pool);
        
        // Test ping
        let ping_result = adapter.ping().await;
        assert!(ping_result.is_ok(), "Ping should succeed");
        let duration = ping_result.unwrap();
        assert!(duration.as_millis() < 100, "Ping should be fast");
        
        // Test server version
        let version = adapter.server_version().await;
        assert!(version.is_ok(), "Should get server version");
        let version_str = version.unwrap();
        assert!(version_str.contains("8.") || version_str.contains("5."), "Should be MySQL 5.x or 8.x");
        
        // Test list databases
        let databases = adapter.list_databases().await;
        assert!(databases.is_ok(), "Should list databases");
        let db_list = databases.unwrap();
        assert!(db_list.contains(&"todoapp".to_string()), "Should contain todoapp database");
        
        // Test list tables
        let tables = adapter.list_tables("todoapp", "todoapp").await;
        assert!(tables.is_ok(), "Should list tables");
        let table_list = tables.unwrap();
        assert!(!table_list.is_empty(), "Should have tables");
        assert!(table_list.iter().any(|t| t.name == "todos"), "Should have todos table");
        
        // Test table columns
        let columns = adapter.table_columns("todoapp", "todoapp", "todos").await;
        assert!(columns.is_ok(), "Should get columns");
        let column_list = columns.unwrap();
        assert!(!column_list.is_empty(), "Should have columns");
        assert!(column_list.iter().any(|c| c.name == "id"), "Should have id column");
        
        // Test estimate count
        let count = adapter.estimate_count("todoapp", "todoapp", "todos").await;
        assert!(count.is_ok(), "Should estimate count");
        let row_count = count.unwrap();
        assert!(row_count >= 0, "Count should be non-negative");
        
        // Test disconnect
        let disconnect = adapter.disconnect().await;
        assert!(disconnect.is_ok(), "Should disconnect cleanly");
        
        println!("✅ All MySQL integration tests passed!");
    }
}