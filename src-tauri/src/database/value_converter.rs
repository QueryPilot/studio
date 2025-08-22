use sqlx::{Row, Column, TypeInfo, Value, ValueRef, Decode};
use sqlx::postgres::{PgRow, PgValueRef};
use sqlx::mysql::MySqlRow;
use sqlx::sqlite::SqliteRow;
use rust_decimal::Decimal;
use chrono::{DateTime, NaiveDate, NaiveTime, NaiveDateTime, Utc};
use serde_json::Value as JsonValue;

use crate::database::adapter::types::ColumnMeta;
use crate::error::AppError;

/// Convert database row values to strings, preserving full precision
pub fn row_to_strings(row: &PgRow, columns: &[ColumnMeta]) -> Vec<String> {
  columns.iter().enumerate().map(|(i, col)| {
    // Check if value is NULL
    if row.try_get_raw(i)
      .map(|v| v.is_null())
      .unwrap_or(true) {
      return "null".to_string();
    }
    
    // Convert based on database type
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
      
      // Decimal/Numeric types - use rust_decimal for exact representation
      "DECIMAL" | "NUMERIC" => {
        row.try_get::<Decimal, _>(i)
          .map(|v| v.to_string())
          .unwrap_or_else(|_| {
            // Fallback to string if Decimal fails
            row.try_get::<String, _>(i)
              .unwrap_or_else(|_| "null".to_string())
          })
      },
      
      // Floating point - preserve all significant digits
      "REAL" | "FLOAT4" => {
        row.try_get::<f32, _>(i)
          .map(|v| {
            if v.is_finite() {
              format!("{:e}", v) // Scientific notation for consistency
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
              format!("{:e}", v) // Scientific notation for consistency
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
      
      // Money type (PostgreSQL specific)
      "MONEY" => {
        // Money is stored as i64 representing cents * 100
        row.try_get::<i64, _>(i)
          .map(|v| {
            // Convert cents to decimal string
            let dollars = v / 100;
            let cents = (v % 100).abs();
            format!("{}.{:02}", dollars, cents)
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
      
      // Date/Time types
      "DATE" => {
        row.try_get::<NaiveDate, _>(i)
          .map(|v| v.format("%Y-%m-%d").to_string())
          .unwrap_or_else(|_| "null".to_string())
      },
      "TIME" => {
        row.try_get::<NaiveTime, _>(i)
          .map(|v| v.format("%H:%M:%S%.f").to_string())
          .unwrap_or_else(|_| "null".to_string())
      },
      "TIMESTAMP" => {
        row.try_get::<NaiveDateTime, _>(i)
          .map(|v| v.format("%Y-%m-%d %H:%M:%S%.f").to_string())
          .unwrap_or_else(|_| "null".to_string())
      },
      "TIMESTAMPTZ" | "TIMESTAMP WITH TIME ZONE" => {
        row.try_get::<DateTime<Utc>, _>(i)
          .map(|v| v.to_rfc3339())
          .unwrap_or_else(|_| "null".to_string())
      },
      
      // JSON types
      "JSON" | "JSONB" => {
        row.try_get::<JsonValue, _>(i)
          .map(|v| v.to_string())
          .unwrap_or_else(|_| "null".to_string())
      },
      
      // UUID
      "UUID" => {
        row.try_get::<uuid::Uuid, _>(i)
          .map(|v| v.to_string())
          .unwrap_or_else(|_| "null".to_string())
      },
      
      // Array types - serialize as JSON
      ty if ty.starts_with("_") || ty.ends_with("[]") => {
        // PostgreSQL array types start with underscore
        row.try_get::<JsonValue, _>(i)
          .map(|v| v.to_string())
          .unwrap_or_else(|_| {
            row.try_get::<String, _>(i)
              .unwrap_or_else(|_| "null".to_string())
          })
      },
      
      // Default: try to get as string
      _ => {
        row.try_get::<String, _>(i)
          .unwrap_or_else(|_| {
            // Last resort: try to get raw bytes and convert
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

/// Convert MySQL row to strings
pub fn mysql_row_to_strings(row: &MySqlRow, columns: &[ColumnMeta]) -> Vec<String> {
  columns.iter().enumerate().map(|(i, col)| {
    // Similar implementation for MySQL
    // MySQL has different type names and handling
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
        row.try_get::<Decimal, _>(i)
          .map(|v| v.to_string())
          .unwrap_or_else(|_| {
            row.try_get::<String, _>(i)
              .unwrap_or_else(|_| "null".to_string())
          })
      },
      "FLOAT" => {
        row.try_get::<f32, _>(i)
          .map(|v| format!("{:e}", v))
          .unwrap_or_else(|_| "null".to_string())
      },
      "DOUBLE" => {
        row.try_get::<f64, _>(i)
          .map(|v| format!("{:e}", v))
          .unwrap_or_else(|_| "null".to_string())
      },
      _ => {
        row.try_get::<String, _>(i)
          .unwrap_or_else(|_| "null".to_string())
      }
    }
  }).collect()
}

/// Convert SQLite row to strings
pub fn sqlite_row_to_strings(row: &SqliteRow, columns: &[ColumnMeta]) -> Vec<String> {
  columns.iter().enumerate().map(|(i, col)| {
    // SQLite is more flexible with types
    if row.try_get_raw(i)
      .map(|v| v.is_null())
      .unwrap_or(true) {
      return "null".to_string();
    }
    
    // SQLite stores everything as one of: NULL, INTEGER, REAL, TEXT, BLOB
    // We need to be smart about conversion based on declared type
    match col.db_type.to_uppercase().as_str() {
      ty if ty.contains("INT") => {
        row.try_get::<i64, _>(i)
          .map(|v| v.to_string())
          .unwrap_or_else(|_| "null".to_string())
      },
      ty if ty.contains("REAL") || ty.contains("FLOAT") || ty.contains("DOUBLE") => {
        row.try_get::<f64, _>(i)
          .map(|v| format!("{:e}", v))
          .unwrap_or_else(|_| "null".to_string())
      },
      ty if ty.contains("DECIMAL") || ty.contains("NUMERIC") => {
        // SQLite doesn't have native decimal, stored as TEXT or REAL
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

/// Extract precision and scale from type string like DECIMAL(10,2)
pub fn extract_precision_scale(type_str: &str) -> (Option<i32>, Option<i32>) {
  if let Some(start) = type_str.find('(') {
    if let Some(end) = type_str.find(')') {
      let params = &type_str[start + 1..end];
      let parts: Vec<&str> = params.split(',').collect();
      
      if parts.len() == 2 {
        let precision = parts[0].trim().parse::<i32>().ok();
        let scale = parts[1].trim().parse::<i32>().ok();
        return (precision, scale);
      } else if parts.len() == 1 {
        let precision = parts[0].trim().parse::<i32>().ok();
        return (precision, Some(0));
      }
    }
  }
  
  (None, None)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_extract_precision_scale() {
    assert_eq!(extract_precision_scale("DECIMAL(10,2)"), (Some(10), Some(2)));
    assert_eq!(extract_precision_scale("NUMERIC(5)"), (Some(5), Some(0)));
    assert_eq!(extract_precision_scale("VARCHAR(255)"), (Some(255), Some(0)));
    assert_eq!(extract_precision_scale("INTEGER"), (None, None));
  }
}