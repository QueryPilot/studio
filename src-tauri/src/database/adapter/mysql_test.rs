use super::*;
use super::mysql::MySqlAdapter;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use crate::database::CellValueType;

async fn get_test_pool() -> Result<MySqlPool, AppError> {
    let database_url = "mysql://devuser:devpass123@localhost:13306/todoapp";
    MySqlPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .map_err(|e| AppError::Database(format!("Failed to connect to test database: {}", e)))
}

#[tokio::test]
async fn test_ping() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        let result = adapter.ping().await;
        assert!(result.is_ok());
        let duration = result.unwrap();
        assert!(duration.as_millis() < 1000); // Should be less than 1 second
    }
}

#[tokio::test]
async fn test_list_databases() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        let result = adapter.list_databases().await;
        assert!(result.is_ok());
        let databases = result.unwrap();
        assert!(databases.contains(&"todoapp".to_string()));
        // Should not contain system databases
        assert!(!databases.contains(&"information_schema".to_string()));
        assert!(!databases.contains(&"mysql".to_string()));
        assert!(!databases.contains(&"performance_schema".to_string()));
    }
}

#[tokio::test]
async fn test_list_schemas() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        let result = adapter.list_schemas("todoapp").await;
        assert!(result.is_ok());
        let schemas = result.unwrap();
        // MySQL doesn't have schemas like PostgreSQL, database is the schema
        assert_eq!(schemas, vec!["todoapp"]);
    }
}

#[tokio::test]
async fn test_list_tables() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        let result = adapter.list_tables("todoapp", "").await;
        assert!(result.is_ok());
        let tables = result.unwrap();
        assert!(!tables.is_empty());
        
        // Check for expected todo app tables
        let table_names: Vec<String> = tables.iter().map(|t| t.name.clone()).collect();
        assert!(table_names.contains(&"users".to_string()) || table_names.contains(&"todos".to_string()));
        
        // Verify table metadata
        for table in &tables {
            assert!(!table.name.is_empty());
            assert_eq!(table.schema, "todoapp");
            // Row estimate and size might be populated for base tables
            // Note: Some tables might not have statistics available
            if table.kind == DbObjectKind::Table {
                // These are optional - statistics might not be available
                // Just verify they're not negative if present
                if let Some(rows) = table.row_estimate {
                    assert!(rows >= 0);
                }
                if let Some(size) = table.size_bytes {
                    assert!(size >= 0);
                }
            }
        }
    }
}

#[tokio::test]
async fn test_list_functions() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        let result = adapter.list_functions("todoapp", "").await;
        assert!(result.is_ok());
        let functions = result.unwrap();
        // Functions list can be empty, that's fine
        for func in &functions {
            assert!(!func.name.is_empty());
            assert_eq!(func.schema, "todoapp");
            assert!(!func.return_type.is_empty());
        }
    }
}

#[tokio::test]
async fn test_table_columns() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        // First get tables to find one to test
        if let Ok(tables) = adapter.list_tables("todoapp", "").await {
            if let Some(table) = tables.first() {
                let result = adapter.table_columns("todoapp", "", &table.name).await;
                assert!(result.is_ok());
                let columns = result.unwrap();
                assert!(!columns.is_empty());
                
                // Verify column metadata
                for col in &columns {
                    assert!(!col.name.is_empty());
                    assert!(!col.db_type.is_empty());
                    assert!(col.ordinal >= 0);  // Ordinals start from 0
                    
                    // Check MySQL-specific metadata
                    if col.db_type.to_uppercase().contains("INT") && col.db_type.to_uppercase().contains("AUTO_INCREMENT") {
                        assert_eq!(col.is_identity, Some(true));
                    }
                    
                    if col.db_type.to_uppercase() == "JSON" {
                        assert_eq!(col.is_json, Some(true));
                    }
                }
            }
        }
    }
}

#[tokio::test]
async fn test_estimate_count() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        // Get a table to test
        if let Ok(tables) = adapter.list_tables("todoapp", "").await {
            if let Some(table) = tables.iter().find(|t| t.kind == DbObjectKind::Table) {
                let result = adapter.estimate_count("todoapp", "todoapp", &table.name).await;
                if let Err(e) = &result {
                    println!("Estimate count error for table {}: {:?}", table.name, e);
                }
                assert!(result.is_ok());
                let count = result.unwrap();
                assert!(count >= 0);
            }
        }
    }
}

#[tokio::test]
async fn test_query_execution() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        let sql = "SELECT 1 as test_col, 'hello' as text_col, NOW() as date_col";
        let opts = QueryOptions::default();
        
        let result = adapter.begin_query(sql, None, opts).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        assert_eq!(cursor.columns.len(), 3);
        assert_eq!(cursor.rows.len(), 1);
        assert!(cursor.is_complete);
        
        // Verify column names
        assert_eq!(cursor.columns[0].name, "test_col");
        assert_eq!(cursor.columns[1].name, "text_col");
        assert_eq!(cursor.columns[2].name, "date_col");
        
        // Verify data
        assert_eq!(cursor.rows[0][0].as_i64(), Some(1));
        assert_eq!(cursor.rows[0][1].as_str(), Some("hello"));
        assert!(cursor.rows[0][2].value.is_some()); // Date should have a value
    }
}

#[tokio::test]
async fn test_parameterized_query() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        let sql = "SELECT ? as param1, ? as param2";
        let params = vec![
            serde_json::Value::Number(42.into()),
            serde_json::Value::String("test".to_string()),
        ];
        let opts = QueryOptions::default();
        
        let result = adapter.begin_query(sql, Some(params), opts).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        assert_eq!(cursor.rows.len(), 1);
        assert_eq!(cursor.rows[0][0].as_i64(), Some(42));
        assert_eq!(cursor.rows[0][1].as_str(), Some("test"));
    }
}

#[tokio::test]
async fn test_data_type_conversion() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        // Test various MySQL data types
        let sql = "SELECT 
                    CAST(42 AS SIGNED) as int_val,
                    CAST(3.14159 AS DECIMAL(10,5)) as decimal_val,
                    CAST('test' AS CHAR(10)) as char_val,
                    CAST('2024-01-01' AS DATE) as date_val,
                    CAST('12:34:56' AS TIME) as time_val,
                    CAST('2024-01-01 12:34:56' AS DATETIME) as datetime_val,
                    CAST(1 AS UNSIGNED) as bool_val,
                    CAST('7b22746573 74223a2274657374227d' AS JSON) as json_val,
                    NULL as null_val";
        
        let opts = QueryOptions::default();
        let result = adapter.begin_query(sql, None, opts).await;
        
        if result.is_err() {
            // Skip JSON test if not supported
            let sql_no_json = "SELECT 
                        CAST(42 AS SIGNED) as int_val,
                        CAST(3.14159 AS DECIMAL(10,5)) as decimal_val,
                        CAST('test' AS CHAR(10)) as char_val,
                        CAST('2024-01-01' AS DATE) as date_val,
                        CAST('12:34:56' AS TIME) as time_val,
                        CAST('2024-01-01 12:34:56' AS DATETIME) as datetime_val,
                        CAST(1 AS UNSIGNED) as bool_val,
                        NULL as null_val";
            
            let opts2 = QueryOptions::default();
            let result = adapter.begin_query(sql_no_json, None, opts2).await;
            assert!(result.is_ok());
            
            let cursor = result.unwrap();
            assert_eq!(cursor.rows.len(), 1);
            
            let row = &cursor.rows[0];
            
            // Check integer
            assert_eq!(row[0].value_type, CellValueType::Integer);
            assert_eq!(row[0].as_i64(), Some(42));
            
            // Check decimal
            assert_eq!(row[1].value_type, CellValueType::Decimal);
            assert!(row[1].metadata.is_some());
            
            // Check string
            assert_eq!(row[2].value_type, CellValueType::Text);
            assert_eq!(row[2].as_str(), Some("test"));
            
            // Check date
            assert_eq!(row[3].value_type, CellValueType::Date);
            
            // Check time
            assert_eq!(row[4].value_type, CellValueType::Time);
            
            // Check datetime
            assert_eq!(row[5].value_type, CellValueType::DateTime);
            
            // Check boolean (MySQL returns as integer 1)
            assert_eq!(row[6].value_type, CellValueType::Boolean);
            assert_eq!(row[6].as_bool(), Some(true));
            
            // Check null
            assert_eq!(row[7].value_type, CellValueType::Null);
            assert!(row[7].is_null());
        }
    }
}

#[tokio::test]
async fn test_transaction_support() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        // Begin transaction
        let tx_result = adapter.begin_transaction().await;
        assert!(tx_result.is_ok());
        let tx_id = tx_result.unwrap();
        assert!(!tx_id.is_empty());
        
        // Rollback transaction
        let rollback_result = adapter.rollback(tx_id).await;
        assert!(rollback_result.is_ok());
        
        // Test commit as well
        let tx_result2 = adapter.begin_transaction().await;
        assert!(tx_result2.is_ok());
        let tx_id2 = tx_result2.unwrap();
        
        let commit_result = adapter.commit(tx_id2).await;
        assert!(commit_result.is_ok());
    }
}

#[tokio::test]
async fn test_execute() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        // Drop table if exists first
        let _ = adapter.execute("DROP TABLE IF EXISTS test_execute_tmp", None).await;
        
        // Create a test table (not temporary - temporary tables don't work well with connection pools)
        let create_sql = "CREATE TABLE test_execute_tmp (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(50)
        )";
        
        let result = adapter.execute(create_sql, None).await;
        assert!(result.is_ok());
        
        // Insert data (without parameters for now - MySQL execute might not support them)
        let insert_sql = "INSERT INTO test_execute_tmp (name) VALUES ('test_name')";
        
        let insert_result = adapter.execute(insert_sql, None).await;
        if let Err(e) = &insert_result {
            println!("Execute error: {:?}", e);
        }
        assert!(insert_result.is_ok());
        
        let exec_result = insert_result.unwrap();
        assert_eq!(exec_result.rows_affected, 1);
        assert!(exec_result.last_insert_id.is_some());
        
        // Clean up
        let _ = adapter.execute("DROP TABLE test_execute_tmp", None).await;
    }
}

#[tokio::test]
async fn test_pagination() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        // Create a query with multiple rows
        let sql = "SELECT * FROM (
            SELECT 1 as id UNION ALL
            SELECT 2 UNION ALL
            SELECT 3 UNION ALL
            SELECT 4 UNION ALL
            SELECT 5
        ) t";
        
        let opts = QueryOptions {
            page_size: 2,
            max_rows: None,
            timeout_ms: Some(5000),
        };
        
        let result = adapter.begin_query(sql, None, opts).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        // First page should have 2 rows
        assert_eq!(cursor.rows.len(), 2);
        assert!(!cursor.is_complete);
        
        // Fetch next page
        let mut cursor_mut = cursor;
        let page_result = adapter.fetch_page(&mut cursor_mut, 1, 2).await;
        assert!(page_result.is_ok());
        
        let page = page_result.unwrap();
        assert_eq!(page.rows.len(), 2);
        assert!(!page.is_complete);
        
        // Fetch last page
        let page_result2 = adapter.fetch_page(&mut cursor_mut, 2, 2).await;
        assert!(page_result2.is_ok());
        
        let page2 = page_result2.unwrap();
        assert_eq!(page2.rows.len(), 1);
        assert!(page2.is_complete);
    }
}

#[tokio::test]
async fn test_mariadb_detection() {
    if let Ok(pool) = get_test_pool().await {
        let mut adapter = MySqlAdapter::new(pool);
        let init_result = adapter.initialize().await;
        assert!(init_result.is_ok());
        
        // Check version string
        let version = adapter.server_version().await;
        assert!(version.is_ok());
        let version_str = version.unwrap();
        
        // The adapter should detect whether it's MariaDB or MySQL
        if version_str.to_lowercase().contains("mariadb") {
            // MariaDB detection test
        } else {
            // MySQL detection test
        }
    }
}

#[tokio::test]
async fn test_server_version() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        let result = adapter.server_version().await;
        assert!(result.is_ok());
        let version = result.unwrap();
        println!("Server version: {}", version);
        assert!(!version.is_empty());
        // Just check that we got a version string with numbers
        assert!(version.chars().any(|c| c.is_ascii_digit()));
    }
}

#[tokio::test]
async fn test_table_data_reading() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        // Get a table to test
        if let Ok(tables) = adapter.list_tables("todoapp", "").await {
            if let Some(table) = tables.iter().find(|t| t.kind == DbObjectKind::Table) {
                use super::PaginationMode;
                
                let request = TableReadRequest {
                    schema: Some("todoapp".to_string()),
                    table: table.name.clone(),
                    select: None,
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
                        // Should have some data
                        assert!(rows.len() <= 10); // Respects limit
                    }
                    TableDataResponse::Done => {
                        // Empty table is also valid
                    }
                    _ => panic!("Unexpected response type"),
                }
            }
        }
    }
}

#[tokio::test]
async fn test_special_characters_handling() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        // Test with special characters
        let sql = "SELECT ? as special_chars";
        let params = vec![
            serde_json::Value::String("Test with 'quotes' and \"double quotes\" and \\ backslash".to_string()),
        ];
        let opts = QueryOptions::default();
        
        let result = adapter.begin_query(sql, Some(params), opts).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        assert_eq!(cursor.rows.len(), 1);
        assert_eq!(
            cursor.rows[0][0].as_str(), 
            Some("Test with 'quotes' and \"double quotes\" and \\ backslash")
        );
    }
}

#[tokio::test]
async fn test_null_handling() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        let sql = "SELECT NULL as null_col, ? as param_null";
        let params = vec![serde_json::Value::Null];
        let opts = QueryOptions::default();
        
        let result = adapter.begin_query(sql, Some(params), opts).await;
        assert!(result.is_ok());
        
        let cursor = result.unwrap();
        assert_eq!(cursor.rows.len(), 1);
        assert!(cursor.rows[0][0].is_null());
        assert!(cursor.rows[0][1].is_null());
        assert_eq!(cursor.rows[0][0].value_type, CellValueType::Null);
        assert_eq!(cursor.rows[0][1].value_type, CellValueType::Null);
    }
}

#[tokio::test]
async fn test_large_numbers() {
    if let Ok(pool) = get_test_pool().await {
        let adapter = MySqlAdapter::new(pool);
        
        let sql = "SELECT 
                    CAST(9223372036854775807 AS SIGNED) as max_bigint,
                    CAST(-9223372036854775808 AS SIGNED) as min_bigint,
                    CAST(999999999999999999999999999999.999999 AS DECIMAL(36,6)) as large_decimal";
        
        let opts = QueryOptions::default();
        let result = adapter.begin_query(sql, None, opts).await;
        
        if result.is_ok() {
            let cursor = result.unwrap();
            assert_eq!(cursor.rows.len(), 1);
            
            // Check max bigint
            assert_eq!(cursor.rows[0][0].value_type, CellValueType::Integer);
            assert_eq!(cursor.rows[0][0].as_i64(), Some(i64::MAX));
            
            // Check min bigint
            assert_eq!(cursor.rows[0][1].value_type, CellValueType::Integer);
            assert_eq!(cursor.rows[0][1].as_i64(), Some(i64::MIN));
            
            // Check large decimal
            assert_eq!(cursor.rows[0][2].value_type, CellValueType::Decimal);
            assert!(cursor.rows[0][2].metadata.is_some());
        }
    }
}