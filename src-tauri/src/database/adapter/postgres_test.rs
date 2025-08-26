#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::database::adapter::postgres::PostgresAdapter;
    use crate::database::adapter::{DbAdapter, QueryOptions, TableReadRequest};
    use crate::database::adapter::types::{PaginationMode, SortSpec, SortDirection, FilterSpec, FilterOperator, DbObjectKind, TableDataResponse};
    use crate::database::cell_value::CellValueType;
    use sqlx::postgres::PgPoolOptions;
    use serde_json::json;
    use std::time::Duration;

    async fn setup_test_pool() -> PostgresAdapter {
        let database_url = "postgresql://devuser:devpass123@localhost:15432/todoapp";
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(30))
            .connect(database_url)
            .await
            .expect("Failed to connect to test database");
        
        PostgresAdapter::new(pool)
    }

    async fn setup_test_table(adapter: &PostgresAdapter) {
        // Clean up any existing test objects first
        adapter.execute("DROP TABLE IF EXISTS test_data_types CASCADE", None).await.ok();
        adapter.execute("DROP TABLE IF EXISTS test_enum CASCADE", None).await.ok();
        adapter.execute("DROP FUNCTION IF EXISTS test_function CASCADE", None).await.ok();
        adapter.execute("DROP VIEW IF EXISTS test_view CASCADE", None).await.ok();
        adapter.execute("DROP MATERIALIZED VIEW IF EXISTS test_mat_view CASCADE", None).await.ok();
        adapter.execute("DROP TYPE IF EXISTS mood CASCADE", None).await.ok();
        
        let create_table = r#"
            CREATE TABLE test_data_types (
                -- Primary key
                id SERIAL PRIMARY KEY,
                
                -- Integer types
                smallint_col SMALLINT,
                integer_col INTEGER,
                bigint_col BIGINT,
                
                -- Decimal types
                decimal_col DECIMAL(10, 2),
                numeric_col NUMERIC(15, 5),
                real_col REAL,
                double_col DOUBLE PRECISION,
                money_col MONEY,
                
                -- String types
                char_col CHAR(10),
                varchar_col VARCHAR(255),
                text_col TEXT,
                
                -- Boolean
                boolean_col BOOLEAN,
                
                -- Date/Time types
                date_col DATE,
                time_col TIME,
                timetz_col TIME WITH TIME ZONE,
                timestamp_col TIMESTAMP,
                timestamptz_col TIMESTAMP WITH TIME ZONE,
                interval_col INTERVAL,
                
                -- Binary
                bytea_col BYTEA,
                
                -- UUID
                uuid_col UUID,
                
                -- JSON types
                json_col JSON,
                jsonb_col JSONB,
                
                -- Network types
                inet_col INET,
                cidr_col CIDR,
                macaddr_col MACADDR,
                macaddr8_col MACADDR8,
                
                -- Bit strings
                bit_col BIT(8),
                varbit_col BIT VARYING(16),
                
                -- Geometric types
                point_col POINT,
                line_col LINE,
                lseg_col LSEG,
                box_col BOX,
                path_col PATH,
                polygon_col POLYGON,
                circle_col CIRCLE,
                
                -- XML
                xml_col XML,
                
                -- Arrays
                int_array_col INTEGER[],
                text_array_col TEXT[],
                uuid_array_col UUID[],
                json_array_col JSON[],
                
                -- Range types
                int4range_col INT4RANGE,
                int8range_col INT8RANGE,
                numrange_col NUMRANGE,
                tsrange_col TSRANGE,
                tstzrange_col TSTZRANGE,
                daterange_col DATERANGE,
                
                -- Other
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        "#;
        
        adapter.execute(create_table, None).await
            .expect("Failed to create test table");
        
        // Create additional test objects
        adapter.execute(
            "CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy')",
            None
        ).await.ok();
        
        adapter.execute(
            "CREATE TABLE test_enum (id SERIAL PRIMARY KEY, current_mood mood)",
            None
        ).await.ok();
        
        adapter.execute(
            r#"CREATE OR REPLACE FUNCTION test_function(a INTEGER, b INTEGER) 
               RETURNS INTEGER AS $$ 
               BEGIN RETURN a + b; END; 
               $$ LANGUAGE plpgsql"#,
            None
        ).await.ok();
        
        adapter.execute(
            "CREATE VIEW test_view AS SELECT * FROM test_data_types WHERE id < 10",
            None
        ).await.ok();
        
        adapter.execute(
            "CREATE MATERIALIZED VIEW test_mat_view AS SELECT * FROM test_data_types WHERE id < 5",
            None
        ).await.ok();
    }

    async fn insert_test_data(adapter: &PostgresAdapter) {
        // Insert test record with basic data types
        let insert_sql = r#"
            INSERT INTO test_data_types (
                smallint_col, integer_col, bigint_col,
                decimal_col, numeric_col, real_col, double_col, money_col,
                char_col, varchar_col, text_col,
                boolean_col,
                date_col, time_col, timestamp_col,
                bytea_col, uuid_col,
                json_col, jsonb_col,
                inet_col, cidr_col, macaddr_col,
                point_col, circle_col,
                xml_col,
                int_array_col, text_array_col
            ) VALUES (
                32767, 2147483647, 9223372036854775807,
                12345.67, 123456.78901, 3.14159, 2.718281828459045, 1234.56,
                'CHAR', 'Test VARCHAR', E'This is a longer text field with multiple lines\nLine 2\nLine 3',
                true,
                '2024-01-15', '14:30:00', '2024-01-15 14:30:00',
                E'\\\\x48656c6c6f', '550e8400-e29b-41d4-a716-446655440000',
                '{"key": "value", "number": 42}', '{"nested": {"data": [1, 2, 3]}}',
                '192.168.1.1', '192.168.0.0/24', '08:00:2b:01:02:03',
                '(1,2)', '<(0,0),5>',
                '<root><child>value</child></root>',
                '{1,2,3,4,5}', '{"hello","world","test"}'
            )
        "#;
        
        adapter.execute(insert_sql, None).await
            .expect("Failed to insert test data");
        
        // Insert NULL values record
        adapter.execute(
            "INSERT INTO test_data_types (id) VALUES (DEFAULT)",
            None
        ).await.expect("Failed to insert NULL record");
        
        // Insert edge case values
        let edge_sql = r#"
            INSERT INTO test_data_types (
                smallint_col, integer_col, bigint_col,
                decimal_col, numeric_col, real_col, double_col,
                boolean_col, text_col
            ) VALUES 
            (-32768, -2147483648, -9223372036854775808, -99999.99, -999999.99999, -3.14, -2.71, false, ''),
            (0, 0, 0, 0, 0, 0, 0, false, E'Special chars: \t\n\r\\''),
            (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
        "#;
        
        adapter.execute(edge_sql, None).await
            .expect("Failed to insert edge case data");
    }

    #[tokio::test]
    async fn test_ping() {
        let adapter = setup_test_pool().await;
        let duration = adapter.ping().await.expect("Ping failed");
        assert!(duration.as_millis() > 0);
        assert!(duration.as_secs() < 5);
    }

    #[tokio::test]
    async fn test_list_databases() {
        let adapter = setup_test_pool().await;
        let databases = adapter.list_databases().await.expect("Failed to list databases");
        assert!(!databases.is_empty());
        assert!(databases.contains(&"todoapp".to_string()));
        assert!(databases.contains(&"postgres".to_string()));
    }

    #[tokio::test]
    async fn test_list_schemas() {
        let adapter = setup_test_pool().await;
        let schemas = adapter.list_schemas("todoapp").await.expect("Failed to list schemas");
        assert!(!schemas.is_empty());
        assert!(schemas.contains(&"public".to_string()));
    }

    #[tokio::test]
    async fn test_list_tables() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        
        let tables = adapter.list_tables("todoapp", "public").await
            .expect("Failed to list tables");
        
        assert!(!tables.is_empty());
        
        // Check for test table
        let test_table = tables.iter()
            .find(|t| t.name == "test_data_types")
            .expect("test_data_types table not found");
        
        assert_eq!(test_table.schema, "public");
        assert_eq!(test_table.kind, DbObjectKind::Table);
        
        // Check for view
        let view = tables.iter()
            .find(|t| t.name == "test_view")
            .expect("test_view not found");
        assert_eq!(view.kind, DbObjectKind::View);
        
        // Check for materialized view
        let mat_view = tables.iter()
            .find(|t| t.name == "test_mat_view")
            .expect("test_mat_view not found");
        assert_eq!(mat_view.kind, DbObjectKind::MaterializedView);
    }

    #[tokio::test]
    async fn test_list_functions() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        
        let functions = adapter.list_functions("todoapp", "public").await
            .expect("Failed to list functions");
        
        let test_func = functions.iter()
            .find(|f| f.name == "test_function")
            .expect("test_function not found");
        
        assert_eq!(test_func.schema, "public");
        assert_eq!(test_func.return_type, "integer");
        assert!(!test_func.arguments.is_empty());
    }

    #[tokio::test]
    async fn test_table_columns() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        
        let columns = adapter.table_columns("todoapp", "public", "test_data_types").await
            .expect("Failed to get table columns");
        
        assert!(!columns.is_empty());
        
        // Check primary key column
        let id_col = columns.iter()
            .find(|c| c.name == "id")
            .expect("id column not found");
        assert!(id_col.is_pk);
        assert!(!id_col.nullable);
        
        // Check various column types
        let varchar_col = columns.iter()
            .find(|c| c.name == "varchar_col")
            .expect("varchar_col not found");
        assert_eq!(varchar_col.db_type, "character varying");
        
        let json_col = columns.iter()
            .find(|c| c.name == "json_col")
            .expect("json_col not found");
        assert_eq!(json_col.is_json, Some(true));
        
        let uuid_col = columns.iter()
            .find(|c| c.name == "uuid_col")
            .expect("uuid_col not found");
        assert_eq!(uuid_col.db_type, "uuid");
    }

    #[tokio::test]
    async fn test_estimate_count() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        insert_test_data(&adapter).await;
        
        let count = adapter.estimate_count("todoapp", "public", "test_data_types").await
            .expect("Failed to estimate count");
        
        assert!(count >= 0);
    }

    #[tokio::test]
    async fn test_begin_query_and_fetch() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        insert_test_data(&adapter).await;
        
        let opts = QueryOptions {
            page_size: 2,
            max_rows: None,
            timeout_ms: None,
        };
        
        let cursor = adapter.begin_query(
            "SELECT * FROM test_data_types ORDER BY id",
            None,
            opts
        ).await.expect("Failed to begin query");
        
        assert!(!cursor.id.is_empty());
        assert!(!cursor.columns.is_empty());
        assert!(!cursor.rows.is_empty());
        assert_eq!(cursor.page_size, 2);
        
        // Check column metadata
        let id_col = cursor.columns.iter()
            .find(|c| c.name == "id")
            .expect("id column not found in cursor");
        assert_eq!(id_col.db_type, "INT4");
    }

    #[tokio::test]
    async fn test_execute_with_params() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        
        let params = vec![
            json!(100),
            json!("Test String"),
            json!(true),
        ];
        
        let result = adapter.execute(
            "INSERT INTO test_data_types (integer_col, text_col, boolean_col) VALUES ($1, $2, $3)",
            Some(params)
        ).await.expect("Failed to execute with params");
        
        assert_eq!(result.rows_affected, 1);
    }

    #[tokio::test]
    async fn test_transaction_operations() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        
        // Begin transaction
        let tx_id = adapter.begin_transaction().await
            .expect("Failed to begin transaction");
        assert!(!tx_id.is_empty());
        
        // Execute within transaction
        adapter.execute(
            "INSERT INTO test_data_types (integer_col) VALUES (999)",
            None
        ).await.expect("Failed to insert in transaction");
        
        // Rollback
        adapter.rollback(tx_id.clone()).await
            .expect("Failed to rollback");
        
        // Verify rollback
        let cursor = adapter.begin_query(
            "SELECT * FROM test_data_types WHERE integer_col = 999",
            None,
            QueryOptions::default()
        ).await.expect("Failed to query after rollback");
        
        assert_eq!(cursor.rows.len(), 0);
        
        // Test commit
        let tx_id2 = adapter.begin_transaction().await
            .expect("Failed to begin second transaction");
        
        adapter.execute(
            "INSERT INTO test_data_types (integer_col) VALUES (888)",
            None
        ).await.expect("Failed to insert in second transaction");
        
        adapter.commit(tx_id2).await
            .expect("Failed to commit");
        
        // Verify commit
        let cursor = adapter.begin_query(
            "SELECT * FROM test_data_types WHERE integer_col = 888",
            None,
            QueryOptions::default()
        ).await.expect("Failed to query after commit");
        
        assert_eq!(cursor.rows.len(), 1);
    }

    #[tokio::test]
    async fn test_server_version() {
        let adapter = setup_test_pool().await;
        let version = adapter.server_version().await
            .expect("Failed to get server version");
        
        assert!(!version.is_empty());
        assert!(version.to_lowercase().contains("postgresql"));
    }

    #[tokio::test]
    async fn test_all_data_types() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        insert_test_data(&adapter).await;
        
        let cursor = adapter.begin_query(
            "SELECT * FROM test_data_types WHERE id = 1",
            None,
            QueryOptions::default()
        ).await.expect("Failed to query all data types");
        
        assert_eq!(cursor.rows.len(), 1);
        let row = &cursor.rows[0];
        
        // Test integer types
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Integer)));
        
        // Test decimal types
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Decimal)));
        
        // Test boolean
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Boolean)));
        
        // Test string types
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Text)));
        
        // Test date/time types
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Date)));
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Time)));
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::DateTime)));
        
        // Test UUID
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Uuid)));
        
        // Test JSON
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Json)));
        
        // Test binary
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Binary)));
        
        // Test geometry
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Geometry)));
        
        // Test XML
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Xml)));
        
        // Test arrays
        assert!(row.iter().any(|cell| matches!(cell.value_type, CellValueType::Array)));
    }

    #[tokio::test]
    async fn test_null_values() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        insert_test_data(&adapter).await;
        
        let cursor = adapter.begin_query(
            "SELECT * FROM test_data_types WHERE id = 2",
            None,
            QueryOptions::default()
        ).await.expect("Failed to query NULL values");
        
        assert_eq!(cursor.rows.len(), 1);
        let row = &cursor.rows[0];
        
        // Check that NULL values are properly handled
        for cell in row {
            if cell.value.is_none() {
                assert!(!cell.db_type.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn test_edge_case_values() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        insert_test_data(&adapter).await;
        
        // Query min values
        let cursor = adapter.begin_query(
            "SELECT * FROM test_data_types WHERE smallint_col = -32768",
            None,
            QueryOptions::default()
        ).await.expect("Failed to query edge cases");
        
        assert_eq!(cursor.rows.len(), 1);
        
        // Query empty string
        let cursor = adapter.begin_query(
            "SELECT * FROM test_data_types WHERE text_col = ''",
            None,
            QueryOptions::default()
        ).await.expect("Failed to query empty string");
        
        assert_eq!(cursor.rows.len(), 1);
    }

    #[tokio::test]
    async fn test_table_read_request() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        insert_test_data(&adapter).await;
        
        let request = TableReadRequest {
            schema: Some("public".to_string()),
            table: "test_data_types".to_string(),
            select: Some(vec!["id".to_string(), "text_col".to_string(), "boolean_col".to_string()]),
            sorts: vec![SortSpec {
                column: "id".to_string(),
                direction: SortDirection::Desc,
            }],
            filters: vec![FilterSpec {
                column: "id".to_string(),
                operator: FilterOperator::LessThan,
                value: json!(10),
            }],
            search: None,
            pagination: PaginationMode::Offset { offset: 0, limit: 5 },
        };
        
        let (response, _) = adapter.read_table_data(request).await
            .expect("Failed to read table data");
        
        match response {
            TableDataResponse::Rows { rows, .. } => {
                assert!(!rows.is_empty());
                assert!(rows.len() <= 5);
                
                // Check that only selected columns are returned
                for row in &rows {
                    assert!(row.contains_key("id"));
                    assert!(row.contains_key("text_col"));
                    assert!(row.contains_key("boolean_col"));
                    assert_eq!(row.len(), 3);
                }
            },
            _ => panic!("Expected Rows response"),
        }
    }

    #[tokio::test]
    async fn test_special_characters_and_escaping() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        
        // Test with special characters
        let special_text = "Test with 'quotes' and \"double quotes\" and \\ backslash";
        let params = vec![json!(special_text)];
        
        adapter.execute(
            "INSERT INTO test_data_types (text_col) VALUES ($1)",
            Some(params)
        ).await.expect("Failed to insert special characters");
        
        let cursor = adapter.begin_query(
            "SELECT text_col FROM test_data_types WHERE text_col = $1",
            Some(vec![json!(special_text)]),
            QueryOptions::default()
        ).await.expect("Failed to query special characters");
        
        assert_eq!(cursor.rows.len(), 1);
    }

    #[tokio::test]
    async fn test_large_dataset_pagination() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        
        // Insert many records
        for i in 0..50 {
            adapter.execute(
                &format!("INSERT INTO test_data_types (integer_col, text_col) VALUES ({}, 'Row {}')", i, i),
                None
            ).await.expect("Failed to insert test data");
        }
        
        let opts = QueryOptions {
            page_size: 10,
            max_rows: None,
            timeout_ms: None,
        };
        
        let mut cursor = adapter.begin_query(
            "SELECT * FROM test_data_types ORDER BY id",
            None,
            opts
        ).await.expect("Failed to begin paginated query");
        
        assert_eq!(cursor.rows.len(), 10);
        assert!(!cursor.is_complete);
        
        // Fetch next page
        let page = adapter.fetch_page(&mut cursor, 1, 10).await
            .expect("Failed to fetch page");
        
        assert_eq!(page.page, 1);
        assert_eq!(page.rows.len(), 10);
    }

    #[tokio::test]
    async fn test_concurrent_connections() {
        let adapter = setup_test_pool().await;
        setup_test_table(&adapter).await;
        
        let mut handles = vec![];
        
        for i in 0..5 {
            let adapter_clone = setup_test_pool().await;
            let handle = tokio::spawn(async move {
                adapter_clone.execute(
                    &format!("INSERT INTO test_data_types (integer_col) VALUES ({})", i * 1000),
                    None
                ).await
            });
            handles.push(handle);
        }
        
        for handle in handles {
            let result = handle.await.expect("Task panicked");
            assert!(result.is_ok());
        }
        
        let cursor = adapter.begin_query(
            "SELECT COUNT(*) FROM test_data_types WHERE integer_col >= 0 AND integer_col < 5000",
            None,
            QueryOptions::default()
        ).await.expect("Failed to count concurrent inserts");
        
        assert!(!cursor.rows.is_empty());
    }

    #[tokio::test]
    async fn test_error_handling() {
        let adapter = setup_test_pool().await;
        
        // Test invalid SQL
        let result = adapter.execute("INVALID SQL STATEMENT", None).await;
        assert!(result.is_err());
        
        // Test non-existent table
        let result = adapter.table_columns("todoapp", "public", "non_existent_table").await;
        assert!(result.is_err() || result.unwrap().is_empty());
        
        // Test type mismatch
        let params = vec![json!("not a number")];
        let result = adapter.execute(
            "SELECT * FROM test_data_types WHERE id = $1",
            Some(params)
        ).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cleanup() {
        let adapter = setup_test_pool().await;
        
        // Clean up test objects
        adapter.execute("DROP TABLE IF EXISTS test_data_types CASCADE", None).await.ok();
        adapter.execute("DROP TABLE IF EXISTS test_enum CASCADE", None).await.ok();
        adapter.execute("DROP FUNCTION IF EXISTS test_function", None).await.ok();
        adapter.execute("DROP VIEW IF EXISTS test_view", None).await.ok();
        adapter.execute("DROP MATERIALIZED VIEW IF EXISTS test_mat_view", None).await.ok();
        adapter.execute("DROP TYPE IF EXISTS mood", None).await.ok();
        
        adapter.disconnect().await.expect("Failed to disconnect");
    }
}