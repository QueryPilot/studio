use crate::types::*;
use serde_json::json;

mod cell_value_tests {
    use super::*;

    #[test]
    fn test_cell_value_constructors() {
        assert!(matches!(CellValue::null(), CellValue::Null));
        assert!(matches!(CellValue::boolean(true), CellValue::Bool(true)));
        assert!(matches!(CellValue::integer(42), CellValue::I64(42)));
        assert!(matches!(CellValue::text("hello"), CellValue::Text(_)));
        assert!(matches!(
            CellValue::bytes(vec![1, 2, 3]),
            CellValue::Bytes(_)
        ));
        assert!(matches!(
            CellValue::timestamp(1234567890),
            CellValue::Timestamp(1234567890)
        ));
        assert!(matches!(CellValue::date(100), CellValue::Date(100)));
    }

    #[test]
    fn test_cell_value_to_string() {
        assert_eq!(CellValue::Null.to_string(), "");
        assert_eq!(CellValue::Bool(true).to_string(), "true");
        assert_eq!(CellValue::Bool(false).to_string(), "false");
        assert_eq!(CellValue::I16(42).to_string(), "42");
        assert_eq!(CellValue::I32(123).to_string(), "123");
        assert_eq!(CellValue::I64(9999).to_string(), "9999");
        assert_eq!(CellValue::F32(3.14).to_string(), "3.14");
        assert_eq!(CellValue::F64(2.71828).to_string(), "2.71828");
        assert_eq!(CellValue::Text("hello".to_string()).to_string(), "hello");

        // Binary data
        let bytes = vec![0x00, 0xFF, 0xAB];
        assert_eq!(CellValue::Bytes(bytes).to_string(), "<Binary 3 bytes>");

        // JSON value
        let json_val = serde_json::json!({"key": "value"});
        let cell_value = CellValue::Json(json_val.clone());
        assert_eq!(cell_value.to_string(), json_val.to_string());
    }

    #[test]
    fn test_cell_value_is_empty() {
        assert!(CellValue::Null.is_empty());
        assert!(CellValue::Text("".to_string()).is_empty());
        assert!(!CellValue::Text("hello".to_string()).is_empty());
        assert!(!CellValue::Bool(false).is_empty());
        assert!(!CellValue::I64(0).is_empty());
    }

    #[test]
    fn test_cell_value_serialization() {
        // Test JSON serialization/deserialization roundtrip
        // Note: Due to #[serde(untagged)], some numeric types may deserialize
        // to different variants (e.g., Timestamp as I64). This is expected behavior.

        // Types that roundtrip cleanly with untagged enum
        let test_cases = vec![
            (CellValue::Null, ""),
            (CellValue::Bool(true), "true"),
            (CellValue::Bool(false), "false"),
            (
                CellValue::Text("Hello, World!".to_string()),
                "Hello, World!",
            ),
            (
                CellValue::Json(serde_json::json!({"test": "value"})),
                "{\"test\":\"value\"}",
            ),
        ];

        for (value, expected_str) in test_cases {
            let json = serde_json::to_string(&value).expect("Failed to serialize");
            let deserialized: CellValue =
                serde_json::from_str(&json).expect("Failed to deserialize");
            // Check that the deserialized value produces expected string output
            assert!(
                deserialized.to_string().contains(expected_str)
                    || deserialized.to_string() == expected_str
            );
        }

        // Test numeric types serialize/deserialize (may change variant due to untagged)
        let numeric_cases = vec![
            CellValue::I16(42),
            CellValue::I32(1234),
            CellValue::I64(999999),
        ];

        for value in numeric_cases {
            let json = serde_json::to_string(&value).expect("Failed to serialize");
            let _deserialized: CellValue =
                serde_json::from_str(&json).expect("Failed to deserialize");
            // Just verify it deserializes without error
        }

        // Test bytes separately
        let bytes = CellValue::Bytes(vec![0x00, 0xFF, 0xAB]);
        let json = serde_json::to_string(&bytes).unwrap();
        assert!(json.contains("[0,255,171]") || json.contains("[0, 255, 171]"));

        // Verify we can deserialize bytes
        let _deserialized: CellValue = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn test_timestamp_formatting() {
        // Test valid timestamp (Jan 1, 2024, 00:00:00 UTC)
        let micros = 1_704_067_200_000_000_i64; // 2024-01-01 00:00:00 UTC
        let cell = CellValue::Timestamp(micros);
        let formatted = cell.to_string();
        assert!(formatted.contains("2024-01-01"));
    }

    #[test]
    fn test_date_formatting() {
        // Days since epoch: 1970-01-01 + 100 days = 1970-04-11
        let cell = CellValue::Date(100);
        let formatted = cell.to_string();
        assert!(formatted.contains("1970-04-11"));
    }

    #[test]
    fn test_text_edge_cases() {
        // Empty string
        let empty = CellValue::text("");
        assert_eq!(empty.to_string(), "");
        assert!(empty.is_empty());

        // Unicode characters
        let unicode = CellValue::text("Hello, 世界! 🌍");
        assert_eq!(unicode.to_string(), "Hello, 世界! 🌍");

        // Special characters
        let special = CellValue::text("Line 1\nLine 2\tTabbed");
        assert_eq!(special.to_string(), "Line 1\nLine 2\tTabbed");
    }

    #[test]
    fn test_numeric_edge_cases() {
        // Negative numbers
        assert_eq!(CellValue::I64(-42).to_string(), "-42");
        assert_eq!(CellValue::F64(-3.14).to_string(), "-3.14");

        // Zero
        assert_eq!(CellValue::I64(0).to_string(), "0");
        assert_eq!(CellValue::F64(0.0).to_string(), "0");

        // Large numbers
        assert_eq!(CellValue::I64(i64::MAX).to_string(), i64::MAX.to_string());
        assert_eq!(CellValue::I64(i64::MIN).to_string(), i64::MIN.to_string());
    }

    #[test]
    fn test_bytes_edge_cases() {
        // Empty bytes
        let empty = CellValue::Bytes(vec![]);
        assert_eq!(empty.to_string(), "<Binary 0 bytes>");

        // Large binary data
        let large = CellValue::Bytes(vec![0; 1024]);
        assert_eq!(large.to_string(), "<Binary 1024 bytes>");
    }

    #[test]
    fn test_json_variants() {
        // Object
        let obj = CellValue::json(serde_json::json!({"name": "Alice", "age": 30}));
        assert!(obj.to_string().contains("Alice"));

        // Array
        let arr = CellValue::json(serde_json::json!([1, 2, 3, 4, 5]));
        assert!(
            arr.to_string().contains("[1,2,3,4,5]") || arr.to_string().contains("[1, 2, 3, 4, 5]")
        );

        // Nested structure
        let nested = CellValue::json(serde_json::json!({
            "user": {
                "name": "Bob",
                "roles": ["admin", "user"]
            }
        }));
        assert!(nested.to_string().contains("Bob"));
    }

    #[test]
    fn test_float_precision() {
        assert_eq!(CellValue::F32(3.14159).to_string(), "3.14159");
        assert_eq!(
            CellValue::F64(2.718281828459045).to_string(),
            "2.718281828459045"
        );
    }

    #[test]
    fn test_all_numeric_variants() {
        // Test all numeric types can be created and converted to strings
        let i16_val = CellValue::I16(i16::MAX);
        let i32_val = CellValue::I32(i32::MAX);
        let i64_val = CellValue::I64(i64::MAX);
        let f32_val = CellValue::F32(f32::MAX);
        let f64_val = CellValue::F64(f64::MAX);

        assert!(!i16_val.to_string().is_empty());
        assert!(!i32_val.to_string().is_empty());
        assert!(!i64_val.to_string().is_empty());
        assert!(!f32_val.to_string().is_empty());
        assert!(!f64_val.to_string().is_empty());
    }
}

mod db_type_tests {
    use super::*;

    #[test]
    fn test_db_type_equality() {
        assert_eq!(DbType::PostgreSQL, DbType::PostgreSQL);
        assert_eq!(DbType::MySQL, DbType::MySQL);
        assert_ne!(DbType::PostgreSQL, DbType::MySQL);
    }

    #[test]
    fn test_db_type_serialization() {
        let pg = DbType::PostgreSQL;
        let json = serde_json::to_string(&pg).unwrap();
        let deserialized: DbType = serde_json::from_str(&json).unwrap();
        assert_eq!(pg, deserialized);
    }

    #[test]
    fn test_all_db_types() {
        let types = vec![
            DbType::PostgreSQL,
            DbType::MySQL,
            DbType::SQLite,
            DbType::SQLServer,
        ];

        for db_type in types {
            let json = serde_json::to_string(&db_type).unwrap();
            let deserialized: DbType = serde_json::from_str(&json).unwrap();
            assert_eq!(db_type, deserialized);
        }
    }
}

mod column_meta_tests {
    use super::*;

    #[test]
    fn test_column_meta_creation() {
        let col = ColumnMeta {
            name: "id".to_string(),
            table_name: Some("users".to_string()),
            data_type: CellValueType::Integer,
            nullable: false,
            primary_key: true,
            db_type: "integer".to_string(),
            type_oid: Some(23),
            default_value: None,
            comment: Some("Primary key".to_string()),
            enum_values: None,
            type_category: None,
            precision: None,
            scale: None,
        };

        assert_eq!(col.name, "id");
        assert_eq!(col.table_name, Some("users".to_string()));
        assert!(!col.nullable);
        assert!(col.primary_key);
        assert_eq!(col.comment, Some("Primary key".to_string()));
    }

    #[test]
    fn test_column_meta_serialization() {
        let col = ColumnMeta {
            name: "email".to_string(),
            table_name: None,
            data_type: CellValueType::Text,
            nullable: false,
            primary_key: false,
            db_type: "varchar".to_string(),
            type_oid: Some(1043),
            default_value: None,
            comment: None,
            enum_values: None,
            type_category: None,
            precision: None,
            scale: None,
        };

        let json = serde_json::to_string(&col).unwrap();
        let deserialized: ColumnMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(col.name, deserialized.name);
        assert_eq!(col.nullable, deserialized.nullable);
    }

    #[test]
    fn test_column_with_precision_and_scale() {
        let col = ColumnMeta {
            name: "price".to_string(),
            table_name: None,
            data_type: CellValueType::Decimal,
            nullable: false,
            primary_key: false,
            db_type: "numeric".to_string(),
            type_oid: Some(1700),
            default_value: Some("0.00".to_string()),
            comment: None,
            enum_values: None,
            type_category: None,
            precision: Some(10),
            scale: Some(2),
        };

        assert_eq!(col.precision, Some(10));
        assert_eq!(col.scale, Some(2));
        assert_eq!(col.default_value, Some("0.00".to_string()));
    }

    #[test]
    fn test_column_with_enum_values() {
        let col = ColumnMeta {
            name: "status".to_string(),
            table_name: None,
            data_type: CellValueType::Enum("status_enum".to_string()),
            nullable: false,
            primary_key: false,
            db_type: "status_enum".to_string(),
            type_oid: Some(16385),
            default_value: Some("'pending'".to_string()),
            comment: None,
            enum_values: Some(vec![
                "pending".to_string(),
                "active".to_string(),
                "completed".to_string(),
            ]),
            type_category: Some("e".to_string()),
            precision: None,
            scale: None,
        };

        assert!(col.enum_values.is_some());
        assert_eq!(col.enum_values.as_ref().unwrap().len(), 3);
        assert_eq!(col.type_category, Some("e".to_string()));
    }
}

mod filter_tests {
    use super::*;

    #[test]
    fn test_filter_condition_serialization() {
        let condition = FilterCondition {
            column: "name".to_string(),
            operator: FilterOperator::Contains,
            value: serde_json::json!("test"),
            case_sensitive: true,
        };

        let json = serde_json::to_string(&condition).unwrap();
        let deserialized: FilterCondition = serde_json::from_str(&json).unwrap();
        assert_eq!(condition.column, deserialized.column);
    }

    #[test]
    fn test_logic_operator_serialization() {
        let and_op = LogicOperator::And;
        let json = serde_json::to_string(&and_op).unwrap();
        assert_eq!(json, "\"and\"");

        let or_op = LogicOperator::Or;
        let json = serde_json::to_string(&or_op).unwrap();
        assert_eq!(json, "\"or\"");
    }

    #[test]
    fn test_all_filter_operators() {
        let operators = vec![
            FilterOperator::Equals,
            FilterOperator::NotEquals,
            FilterOperator::Contains,
            FilterOperator::NotContains,
            FilterOperator::StartsWith,
            FilterOperator::EndsWith,
            FilterOperator::GreaterThan,
            FilterOperator::LessThan,
            FilterOperator::GreaterThanOrEqual,
            FilterOperator::LessThanOrEqual,
            FilterOperator::Between,
            FilterOperator::In,
            FilterOperator::NotIn,
            FilterOperator::IsNull,
            FilterOperator::IsNotNull,
        ];

        for op in operators {
            let json = serde_json::to_string(&op).unwrap();
            let _deserialized: FilterOperator = serde_json::from_str(&json).unwrap();
        }
    }

    #[test]
    fn test_filter_group_creation() {
        let group = FilterGroup {
            logic: LogicOperator::And,
            conditions: vec![
                FilterNode::Condition(FilterCondition {
                    column: "age".to_string(),
                    operator: FilterOperator::GreaterThan,
                    value: json!(18),
                    case_sensitive: false,
                }),
                FilterNode::Condition(FilterCondition {
                    column: "active".to_string(),
                    operator: FilterOperator::Equals,
                    value: json!(true),
                    case_sensitive: false,
                }),
            ],
        };

        assert_eq!(group.conditions.len(), 2);
        assert!(matches!(group.logic, LogicOperator::And));
    }
}

mod sort_tests {
    use super::*;

    #[test]
    fn test_sort_config_creation() {
        let sort = SortConfig {
            column: "created_at".to_string(),
            direction: SortDirection::Desc,
            nulls_position: NullsPosition::Last,
        };

        assert_eq!(sort.column, "created_at");
        assert!(matches!(sort.direction, SortDirection::Desc));
    }

    #[test]
    fn test_nulls_position_default() {
        assert!(matches!(NullsPosition::default(), NullsPosition::Last));
    }

    #[test]
    fn test_sort_direction_serialization() {
        let asc = SortDirection::Asc;
        let json = serde_json::to_string(&asc).unwrap();
        assert_eq!(json, "\"asc\"");

        let desc = SortDirection::Desc;
        let json = serde_json::to_string(&desc).unwrap();
        assert_eq!(json, "\"desc\"");
    }

    #[test]
    fn test_nulls_position_serialization() {
        let first = NullsPosition::First;
        let json = serde_json::to_string(&first).unwrap();
        assert_eq!(json, "\"first\"");

        let last = NullsPosition::Last;
        let json = serde_json::to_string(&last).unwrap();
        assert_eq!(json, "\"last\"");
    }
}

mod connection_types_tests {
    use super::*;

    #[test]
    fn test_connection_profile_creation() {
        let profile = ConnectionProfile {
            id: "test-123".to_string(),
            name: "Test Database".to_string(),
            db_type: DbType::PostgreSQL,
            host: "localhost".to_string(),
            port: 5432,
            database: "testdb".to_string(),
            username: "testuser".to_string(),
            password: Some("password".to_string()),
            ssl_mode: None,
            ssl_config: None,
            ssh_tunnel: None,
            bastion: None,
            options: std::collections::HashMap::new(),
        };

        assert_eq!(profile.id, "test-123");
        assert_eq!(profile.port, 5432);
        assert_eq!(profile.db_type, DbType::PostgreSQL);
    }

    #[test]
    fn test_ssl_mode_variants() {
        let modes = vec![
            SslMode::Disable,
            SslMode::Require,
            SslMode::VerifyCa,
            SslMode::VerifyFull,
        ];

        for mode in modes {
            let json = serde_json::to_string(&mode).unwrap();
            let _deserialized: SslMode = serde_json::from_str(&json).unwrap();
        }
    }

    #[test]
    fn test_connection_test_result() {
        let success = ConnectionTestResult {
            success: true,
            message: "Connection successful".to_string(),
            version: Some("PostgreSQL 15.0".to_string()),
            warnings: vec![],
        };

        assert!(success.success);
        assert_eq!(success.version, Some("PostgreSQL 15.0".to_string()));

        let failure = ConnectionTestResult {
            success: false,
            message: "Connection refused".to_string(),
            version: None,
            warnings: vec!["Port 5432 is not reachable".to_string()],
        };

        assert!(!failure.success);
        assert_eq!(failure.warnings.len(), 1);
    }
}

mod constraint_tests {
    use super::*;

    #[test]
    fn test_constraint_types() {
        let types = vec![
            ConstraintType::PrimaryKey,
            ConstraintType::ForeignKey,
            ConstraintType::Unique,
            ConstraintType::Check,
            ConstraintType::Exclusion,
        ];

        for constraint_type in types {
            let json = serde_json::to_string(&constraint_type).unwrap();
            let _deserialized: ConstraintType = serde_json::from_str(&json).unwrap();
        }
    }

    #[test]
    fn test_table_kind_variants() {
        let kinds = vec![
            TableKind::Regular,
            TableKind::Partitioned,
            TableKind::Foreign,
            TableKind::Temporary,
        ];

        for kind in kinds {
            let json = serde_json::to_string(&kind).unwrap();
            let _deserialized: TableKind = serde_json::from_str(&json).unwrap();
        }
    }
}
