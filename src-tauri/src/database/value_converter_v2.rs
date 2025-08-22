use sqlx::{Row, Column, TypeInfo, postgres::PgRow, mysql::MySqlRow, sqlite::SqliteRow};
use rust_decimal::Decimal;
use chrono::{DateTime, NaiveDate, NaiveTime, NaiveDateTime, Utc};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::database::adapter::types::ColumnMeta;

/// Convert PostgreSQL row values to strings with proper type handling
pub fn pg_row_to_strings(row: &PgRow, columns: &[ColumnMeta]) -> Vec<String> {
    columns.iter().enumerate().map(|(i, col)| {
        // Check if value is NULL first
        if row.try_get_raw(i)
            .map(|v| v.is_null())
            .unwrap_or(true) {
            return "null".to_string();
        }
        
        // Use proper types based on database type
        match col.db_type.to_uppercase().as_str() {
            // Integer types - preserve exact value
            "SMALLINT" | "INT2" => {
                row.try_get::<i16, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "INTEGER" | "INT" | "INT4" => {
                row.try_get::<i32, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "BIGINT" | "INT8" => {
                row.try_get::<i64, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            
            // Decimal/Numeric - use rust_decimal for EXACT precision
            "DECIMAL" | "NUMERIC" => {
                row.try_get::<Decimal, _>(i)
                    .map(|v| v.to_string()) // Preserves all digits
                    .unwrap_or_else(|_| {
                        // Fallback if not compiled with rust_decimal
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            
            // Floating point
            "REAL" | "FLOAT4" => {
                row.try_get::<f32, _>(i)
                    .map(|v| {
                        if v.is_finite() {
                            // Use enough precision to preserve value
                            format!("{:.9}", v).trim_end_matches('0').trim_end_matches('.').to_string()
                        } else if v.is_nan() {
                            "NaN".to_string()
                        } else if v.is_infinite() {
                            if v.is_sign_positive() { "Infinity" } else { "-Infinity" }.to_string()
                        } else {
                            v.to_string()
                        }
                    })
                    .unwrap_or_else(|_| "null".to_string())
            },
            "DOUBLE PRECISION" | "FLOAT8" | "FLOAT" => {
                row.try_get::<f64, _>(i)
                    .map(|v| {
                        if v.is_finite() {
                            // Use enough precision to preserve value
                            format!("{:.17}", v).trim_end_matches('0').trim_end_matches('.').to_string()
                        } else if v.is_nan() {
                            "NaN".to_string()
                        } else if v.is_infinite() {
                            if v.is_sign_positive() { "Infinity" } else { "-Infinity" }.to_string()
                        } else {
                            v.to_string()
                        }
                    })
                    .unwrap_or_else(|_| "null".to_string())
            },
            
            // Money type (PostgreSQL specific) - stored as i64 cents
            "MONEY" => {
                row.try_get::<i64, _>(i)
                    .map(|v| {
                        let dollars = v as f64 / 100.0;
                        format!("{:.2}", dollars)
                    })
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            
            // Boolean
            "BOOLEAN" | "BOOL" => {
                row.try_get::<bool, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            
            // Date/Time types with chrono
            "DATE" => {
                row.try_get::<NaiveDate, _>(i)
                    .map(|v| v.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            "TIME" | "TIME WITHOUT TIME ZONE" => {
                row.try_get::<NaiveTime, _>(i)
                    .map(|v| v.format("%H:%M:%S%.f").to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            "TIMESTAMP" | "TIMESTAMP WITHOUT TIME ZONE" => {
                row.try_get::<NaiveDateTime, _>(i)
                    .map(|v| v.format("%Y-%m-%d %H:%M:%S%.f").to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            "TIMESTAMPTZ" | "TIMESTAMP WITH TIME ZONE" => {
                row.try_get::<DateTime<Utc>, _>(i)
                    .map(|v| v.to_rfc3339())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            
            // JSON types
            "JSON" | "JSONB" => {
                row.try_get::<JsonValue, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            
            // UUID
            "UUID" => {
                row.try_get::<Uuid, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            
            // Network types (PostgreSQL)
            "INET" | "CIDR" => {
                #[cfg(feature = "ipnetwork")]
                {
                    row.try_get::<ipnetwork::IpNetwork, _>(i)
                        .map(|v| v.to_string())
                        .unwrap_or_else(|_| {
                            row.try_get::<String, _>(i)
                                .unwrap_or_else(|_| "null".to_string())
                        })
                }
                #[cfg(not(feature = "ipnetwork"))]
                {
                    row.try_get::<String, _>(i)
                        .unwrap_or_else(|_| "null".to_string())
                }
            },
            
            // MAC Address
            "MACADDR" | "MACADDR8" => {
                #[cfg(feature = "mac_address")]
                {
                    row.try_get::<mac_address::MacAddress, _>(i)
                        .map(|v| v.to_string())
                        .unwrap_or_else(|_| {
                            row.try_get::<String, _>(i)
                                .unwrap_or_else(|_| "null".to_string())
                        })
                }
                #[cfg(not(feature = "mac_address"))]
                {
                    row.try_get::<String, _>(i)
                        .unwrap_or_else(|_| "null".to_string())
                }
            },
            
            // Array types
            ty if ty.starts_with("_") || ty.ends_with("[]") => {
                // Try to get as JSON for array representation
                row.try_get::<JsonValue, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            
            // Default: get as string
            _ => {
                row.try_get::<String, _>(i)
                    .unwrap_or_else(|_| {
                        // Last resort: try bytes
                        row.try_get::<Vec<u8>, _>(i)
                            .map(|bytes| {
                                String::from_utf8(bytes)
                                    .unwrap_or_else(|_| "[binary data]".to_string())
                            })
                            .unwrap_or_else(|_| "null".to_string())
                    })
            }
        }
    }).collect()
}

/// Convert MySQL row to strings with proper type handling
pub fn mysql_row_to_strings_v2(row: &MySqlRow, columns: &[ColumnMeta]) -> Vec<String> {
    columns.iter().enumerate().map(|(i, col)| {
        if row.try_get_raw(i)
            .map(|v| v.is_null())
            .unwrap_or(true) {
            return "null".to_string();
        }
        
        match col.db_type.to_uppercase().as_str() {
            "TINYINT" => {
                row.try_get::<i8, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "SMALLINT" => {
                row.try_get::<i16, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "MEDIUMINT" | "INT" | "INTEGER" => {
                row.try_get::<i32, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "BIGINT" => {
                row.try_get::<i64, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "DECIMAL" | "NUMERIC" | "DEC" => {
                // MySQL can use rust_decimal too
                row.try_get::<Decimal, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            "FLOAT" => {
                row.try_get::<f32, _>(i)
                    .map(|v| format!("{:.9}", v).trim_end_matches('0').trim_end_matches('.').to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "DOUBLE" | "DOUBLE PRECISION" => {
                row.try_get::<f64, _>(i)
                    .map(|v| format!("{:.17}", v).trim_end_matches('0').trim_end_matches('.').to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            "DATE" => {
                row.try_get::<NaiveDate, _>(i)
                    .map(|v| v.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            "TIME" => {
                row.try_get::<NaiveTime, _>(i)
                    .map(|v| v.format("%H:%M:%S").to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            "DATETIME" | "TIMESTAMP" => {
                row.try_get::<NaiveDateTime, _>(i)
                    .map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            "JSON" => {
                row.try_get::<JsonValue, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            _ => {
                row.try_get::<String, _>(i)
                    .unwrap_or_else(|_| "null".to_string())
            }
        }
    }).collect()
}

/// Convert SQLite row to strings
pub fn sqlite_row_to_strings_v2(row: &SqliteRow, columns: &[ColumnMeta]) -> Vec<String> {
    columns.iter().enumerate().map(|(i, col)| {
        if row.try_get_raw(i)
            .map(|v| v.is_null())
            .unwrap_or(true) {
            return "null".to_string();
        }
        
        // SQLite is more flexible with types
        match col.db_type.to_uppercase().as_str() {
            ty if ty.contains("INT") => {
                row.try_get::<i64, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            ty if ty.contains("REAL") || ty.contains("FLOAT") || ty.contains("DOUBLE") => {
                row.try_get::<f64, _>(i)
                    .map(|v| format!("{:.17}", v).trim_end_matches('0').trim_end_matches('.').to_string())
                    .unwrap_or_else(|_| "null".to_string())
            },
            ty if ty.contains("DECIMAL") || ty.contains("NUMERIC") => {
                // SQLite stores DECIMAL as TEXT or REAL
                row.try_get::<String, _>(i)
                    .unwrap_or_else(|_| {
                        row.try_get::<f64, _>(i)
                            .map(|v| v.to_string())
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            ty if ty.contains("BOOL") => {
                row.try_get::<bool, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| {
                        row.try_get::<i64, _>(i)
                            .map(|v| (v != 0).to_string())
                            .unwrap_or_else(|_| "null".to_string())
                    })
            },
            _ => {
                row.try_get::<String, _>(i)
                    .unwrap_or_else(|_| "null".to_string())
            }
        }
    }).collect()
}