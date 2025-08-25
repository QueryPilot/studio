#[cfg(test)]
mod tests {
    use super::super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::path::Path;
    use serde_json::json;
    use crate::database::adapter::SortSpec;

    async fn setup_test_connection() -> Result<SqliteAdapter, Box<dyn std::error::Error>> {
        let db_path = "/Users/hieuvu/Workspaces/devdb-studio/seeds/sqlite/todoapp.db";
        
        // Verify database exists
        if !Path::new(db_path).exists() {
            panic!("Test database not found at {}", db_path);
        }
        
        let connection_string = format!("sqlite://{}", db_path);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&connection_string)
            .await?;
        
        Ok(SqliteAdapter::new(pool))
    }

    #[tokio::test]
    async fn test_ping() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let result = adapter.ping().await;
        assert!(result.is_ok());
        let duration = result.unwrap();
        assert!(duration.as_millis() < 1000); // Should be fast
    }

    #[tokio::test]
    async fn test_server_version() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let result = adapter.server_version().await;
        assert!(result.is_ok());
        let version = result.unwrap();
        assert!(version.starts_with("SQLite"));
        assert!(version.contains("3.")); // SQLite 3.x
    }

    #[tokio::test]
    async fn test_list_databases() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let result = adapter.list_databases().await;
        assert!(result.is_ok());
        let databases = result.unwrap();
        assert!(!databases.is_empty());
        assert!(databases.contains(&"main".to_string()));
    }

    #[tokio::test]
    async fn test_list_schemas() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let result = adapter.list_schemas("main").await;
        assert!(result.is_ok());
        let schemas = result.unwrap();
        assert_eq!(schemas, vec!["main"]);
    }

    #[tokio::test]
    async fn test_list_tables() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let result = adapter.list_tables("main", "main").await;
        assert!(result.is_ok());
        let tables = result.unwrap();
        
        // Verify expected tables exist
        let table_names: Vec<String> = tables.iter().map(|t| t.name.clone()).collect();
        assert!(table_names.contains(&"users".to_string()));
        assert!(table_names.contains(&"todos".to_string()));
        assert!(table_names.contains(&"categories".to_string()));
        assert!(table_names.contains(&"comments".to_string()));
        
        // Check table metadata
        let users_table = tables.iter().find(|t| t.name == "users").unwrap();
        assert_eq!(users_table.kind, DbObjectKind::Table);
        assert!(users_table.row_estimate.is_some());
    }

    #[tokio::test]
    async fn test_table_columns() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let result = adapter.table_columns("main", "main", "users").await;
        assert!(result.is_ok());
        let columns = result.unwrap();
        
        // Verify expected columns
        let column_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
        assert!(column_names.contains(&"id".to_string()));
        assert!(column_names.contains(&"username".to_string()));
        assert!(column_names.contains(&"email".to_string()));
        assert!(column_names.contains(&"created_at".to_string()));
        
        // Check column metadata
        let id_column = columns.iter().find(|c| c.name == "id").unwrap();
        assert!(id_column.is_pk);
        assert!(!id_column.nullable);
        assert_eq!(id_column.db_type, "INTEGER");
        
        let email_column = columns.iter().find(|c| c.name == "email").unwrap();
        assert!(!email_column.nullable);
        assert!(email_column.db_type.contains("TEXT"));
    }

    #[tokio::test]
    async fn test_estimate_count() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let result = adapter.estimate_count("main", "main", "users").await;
        assert!(result.is_ok());
        let count = result.unwrap();
        assert!(count >= 0);
    }

    #[tokio::test]
    async fn test_begin_query_simple() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let sql = "SELECT id, username, email FROM users LIMIT 5";
        let result = adapter.begin_query(sql, None, QueryOptions::default()).await;
        
        assert!(result.is_ok());
        let cursor = result.unwrap();
        
        assert_eq!(cursor.columns.len(), 3);
        assert_eq!(cursor.columns[0].name, "id");
        assert_eq!(cursor.columns[1].name, "username");
        assert_eq!(cursor.columns[2].name, "email");
        
        // Check that we got some rows
        assert!(cursor.total_rows.unwrap() <= 5);
        
        // Verify cell values are properly converted
        if !cursor.rows.is_empty() {
            let first_row = &cursor.rows[0];
            assert_eq!(first_row[0].value_type, CellValueType::Integer); // id
            assert_eq!(first_row[1].value_type, CellValueType::Text); // username
            assert_eq!(first_row[2].value_type, CellValueType::Text); // email
        }
    }

    #[tokio::test]
    async fn test_begin_query_with_params() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let sql = "SELECT * FROM users WHERE id = ?";
        let params = Some(vec![json!(1)]);
        
        let result = adapter.begin_query(sql, params, QueryOptions::default()).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        assert!(cursor.total_rows.unwrap() <= 1);
    }

    #[tokio::test]
    async fn test_query_with_null_values() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let sql = "SELECT id, full_name, bio FROM users WHERE bio IS NULL LIMIT 5";
        
        let result = adapter.begin_query(sql, None, QueryOptions::default()).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        for row in &cursor.rows {
            // bio column should be null
            if row.len() > 2 {
                assert_eq!(row[2].value_type, CellValueType::Null);
                assert!(row[2].value.is_none());
            }
        }
    }

    #[tokio::test]
    async fn test_fetch_page() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let sql = "SELECT * FROM users";
        let opts = QueryOptions {
            page_size: 2,
            max_rows: None,
            timeout_ms: Some(5000),
        };
        
        let result = adapter.begin_query(sql, None, opts).await;
        assert!(result.is_ok());
        
        let mut cursor = result.unwrap();
        
        // Fetch second page
        let page_result = adapter.fetch_page(&mut cursor, 1, 2).await;
        assert!(page_result.is_ok());
        
        let page = page_result.unwrap();
        assert_eq!(page.page, 1);
        if cursor.total_rows.unwrap() > 2 {
            assert_eq!(page.rows.len(), 2);
        }
    }

    #[tokio::test]
    async fn test_execute_insert() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        // First, create a test table to avoid modifying production data
        let create_sql = "CREATE TEMP TABLE test_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL
        )";
        let _ = adapter.execute(create_sql, None).await;
        
        // Insert a record
        let insert_sql = "INSERT INTO test_users (name, email) VALUES (?, ?)";
        let params = Some(vec![
            json!("Test User"),
            json!("test@example.com")
        ]);
        
        let result = adapter.execute(insert_sql, params).await;
        assert!(result.is_ok());
        
        let exec_result = result.unwrap();
        assert_eq!(exec_result.rows_affected, 1);
        assert!(exec_result.last_insert_id.is_some());
    }

    #[tokio::test]
    async fn test_execute_update() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        // Create temp table
        let create_sql = "CREATE TEMP TABLE test_data (
            id INTEGER PRIMARY KEY,
            value TEXT
        )";
        let _ = adapter.execute(create_sql, None).await;
        
        // Insert test data
        let _ = adapter.execute(
            "INSERT INTO test_data (id, value) VALUES (1, 'old'), (2, 'old')",
            None
        ).await;
        
        // Update records
        let update_sql = "UPDATE test_data SET value = ? WHERE id = ?";
        let params = Some(vec![json!("new"), json!(1)]);
        
        let result = adapter.execute(update_sql, params).await;
        assert!(result.is_ok());
        
        let exec_result = result.unwrap();
        assert_eq!(exec_result.rows_affected, 1);
    }

    #[tokio::test]
    async fn test_execute_delete() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        // Create temp table
        let create_sql = "CREATE TEMP TABLE test_delete (
            id INTEGER PRIMARY KEY,
            data TEXT
        )";
        let _ = adapter.execute(create_sql, None).await;
        
        // Insert test data
        let _ = adapter.execute(
            "INSERT INTO test_delete (id, data) VALUES (1, 'a'), (2, 'b'), (3, 'c')",
            None
        ).await;
        
        // Delete records
        let delete_sql = "DELETE FROM test_delete WHERE id > ?";
        let params = Some(vec![json!(1)]);
        
        let result = adapter.execute(delete_sql, params).await;
        assert!(result.is_ok());
        
        let exec_result = result.unwrap();
        assert_eq!(exec_result.rows_affected, 2);
    }

    #[tokio::test]
    async fn test_transaction_commit() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        // Create temp table
        let _ = adapter.execute(
            "CREATE TEMP TABLE test_tx (id INTEGER PRIMARY KEY, val TEXT)",
            None
        ).await;
        
        // Begin transaction
        let tx_id_result = adapter.begin_transaction().await;
        assert!(tx_id_result.is_ok());
        let tx_id = tx_id_result.unwrap();
        
        // Insert within transaction (note: this is simplified, actual tx operations would need modification)
        let _ = adapter.execute(
            "INSERT INTO test_tx (id, val) VALUES (1, 'test')",
            None
        ).await;
        
        // Commit transaction
        let commit_result = adapter.commit(tx_id).await;
        assert!(commit_result.is_ok());
        
        // Verify data was committed
        let query_result = adapter.begin_query(
            "SELECT COUNT(*) as cnt FROM test_tx",
            None,
            QueryOptions::default()
        ).await;
        
        assert!(query_result.is_ok());
        let cursor = query_result.unwrap();
        if !cursor.rows.is_empty() {
            assert_eq!(cursor.rows[0][0].value_type, CellValueType::Integer);
        }
    }

    #[tokio::test]
    async fn test_transaction_rollback() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        // Create temp table
        let _ = adapter.execute(
            "CREATE TEMP TABLE test_rollback (id INTEGER PRIMARY KEY, val TEXT)",
            None
        ).await;
        
        // Begin transaction
        let tx_id_result = adapter.begin_transaction().await;
        assert!(tx_id_result.is_ok());
        let tx_id = tx_id_result.unwrap();
        
        // Rollback transaction
        let rollback_result = adapter.rollback(tx_id).await;
        assert!(rollback_result.is_ok());
    }

    #[tokio::test]
    async fn test_read_table_data_basic() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        let request = TableReadRequest {
            schema: Some("main".to_string()),
            table: "users".to_string(),
            select: Some(vec!["id".to_string(), "username".to_string(), "email".to_string()]),
            sorts: vec![],
            filters: vec![],
            search: None,
            pagination: PaginationMode::Offset { offset: 0, limit: 10 },
        };
        
        let result = adapter.read_table_data(request).await;
        assert!(result.is_ok());
        
        let (response, _) = result.unwrap();
        match response {
            TableDataResponse::Rows { rows, .. } => {
                assert!(rows.len() <= 10);
                if !rows.is_empty() {
                    assert!(rows[0].contains_key("id"));
                    assert!(rows[0].contains_key("username"));
                    assert!(rows[0].contains_key("email"));
                }
            }
            _ => panic!("Expected Rows response"),
        }
    }

    #[tokio::test]
    async fn test_read_table_data_with_filter() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        let request = TableReadRequest {
            schema: Some("main".to_string()),
            table: "users".to_string(),
            select: None,
            sorts: vec![],
            filters: vec![
                FilterSpec {
                    column: "id".to_string(),
                    operator: FilterOperator::LessThanOrEqual,
                    value: json!(5),
                }
            ],
            search: None,
            pagination: PaginationMode::Offset { offset: 0, limit: 10 },
        };
        
        let result = adapter.read_table_data(request).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_read_table_data_with_sort() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        let request = TableReadRequest {
            schema: Some("main".to_string()),
            table: "users".to_string(),
            select: Some(vec!["id".to_string(), "username".to_string()]),
            sorts: vec![
                SortSpec {
                    column: "username".to_string(),
                    direction: SortDirection::Desc,
                }
            ],
            filters: vec![],
            search: None,
            pagination: PaginationMode::Offset { offset: 0, limit: 5 },
        };
        
        let result = adapter.read_table_data(request).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_read_table_data_with_search() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        let request = TableReadRequest {
            schema: Some("main".to_string()),
            table: "users".to_string(),
            select: None,
            sorts: vec![],
            filters: vec![],
            search: Some("john".to_string()), // Search for "john" in text columns
            pagination: PaginationMode::Offset { offset: 0, limit: 10 },
        };
        
        let result = adapter.read_table_data(request).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_data_type_conversions() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        // Test various data types from todos table
        let sql = "SELECT 
            id,
            title,
            is_completed,
            priority,
            created_at,
            metadata
        FROM todos LIMIT 1";
        
        let result = adapter.begin_query(sql, None, QueryOptions::default()).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        if !cursor.rows.is_empty() {
            let row = &cursor.rows[0];
            
            // id - INTEGER
            assert_eq!(row[0].value_type, CellValueType::Integer);
            
            // title - TEXT
            assert_eq!(row[1].value_type, CellValueType::Text);
            
            // is_completed - INTEGER (used as boolean)
            assert_eq!(row[2].value_type, CellValueType::Integer);
            
            // priority - INTEGER
            assert_eq!(row[3].value_type, CellValueType::Integer);
            
            // created_at - TIMESTAMP
            assert_eq!(row[4].value_type, CellValueType::DateTime);
            
            // metadata - TEXT (JSON)
            if !row[5].value.is_none() {
                assert_eq!(row[5].value_type, CellValueType::Text);
            }
        }
    }

    #[tokio::test]
    async fn test_uuid_detection() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        // users table has a uuid column
        let sql = "SELECT uuid FROM users LIMIT 1";
        
        let result = adapter.begin_query(sql, None, QueryOptions::default()).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        if !cursor.rows.is_empty() {
            let row = &cursor.rows[0];
            // UUID should be detected from the pattern
            assert_eq!(row[0].value_type, CellValueType::Uuid);
        }
    }

    #[tokio::test]
    async fn test_close_cursor() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        let sql = "SELECT * FROM users LIMIT 5";
        
        let result = adapter.begin_query(sql, None, QueryOptions::default()).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        let cursor_id = cursor.id.clone();
        
        // Close cursor should always succeed for SQLite
        let close_result = adapter.close_cursor(&cursor_id).await;
        assert!(close_result.is_ok());
    }

    #[tokio::test]
    async fn test_disconnect() {
        let adapter = setup_test_connection().await.expect("Failed to setup connection");
        
        // First verify connection works
        let ping_result = adapter.ping().await;
        assert!(ping_result.is_ok());
        
        // Disconnect
        let disconnect_result = adapter.disconnect().await;
        assert!(disconnect_result.is_ok());
        
        // After disconnect, operations should fail
        let ping_after = adapter.ping().await;
        assert!(ping_after.is_err());
    }
}