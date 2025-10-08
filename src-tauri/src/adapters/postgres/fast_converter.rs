use crate::error::Result;
use crate::types::*;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Timelike, Utc};
use postgres_types::Type;
use serde_json::Value as JsonValue;
use tokio_postgres::Row;
use uuid::Uuid;

/// Fast PostgreSQL type converter - NO display_value allocation
/// Converts database values directly to CellValue enum variants
pub struct FastPostgresConverter;

impl FastPostgresConverter {
    /// Convert a PostgreSQL row cell to CellValue enum
    /// This is the FAST path - no string formatting, no display_value allocation
    pub fn row_to_cell(row: &Row, idx: usize) -> Result<CellValue> {
        let column = &row.columns()[idx];
        let pg_type = column.type_();

        // Fast path: use binary protocol extraction where possible
        match *pg_type {
            // Integers - direct extraction
            Type::INT2 => {
                match row.try_get::<_, Option<i16>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::I16(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::INT4 | Type::OID => {
                match row.try_get::<_, Option<i32>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::I32(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::INT8 => {
                match row.try_get::<_, Option<i64>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::I64(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // Floats - direct extraction
            Type::FLOAT4 => {
                match row.try_get::<_, Option<f32>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::F32(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::FLOAT8 => {
                match row.try_get::<_, Option<f64>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::F64(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::NUMERIC => {
                match row.try_get::<_, Option<rust_decimal::Decimal>>(idx) {
                    Ok(Some(val)) => {
                        // Convert to f64 for JSON serialization
                        use std::str::FromStr;
                        let s = val.to_string();
                        if let Ok(f) = f64::from_str(&s) {
                            Ok(CellValue::F64(f))
                        } else {
                            // Fallback to string for very large/small numbers
                            Ok(CellValue::Text(s))
                        }
                    }
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // Boolean
            Type::BOOL => {
                match row.try_get::<_, Option<bool>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Bool(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // Text types
            Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::CHAR => {
                match row.try_get::<_, Option<String>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Text(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // UUID - store as bytes
            Type::UUID => {
                match row.try_get::<_, Option<Uuid>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Bytes(val.as_bytes().to_vec())),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // Binary data
            Type::BYTEA => {
                match row.try_get::<_, Option<Vec<u8>>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Bytes(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // JSON types - store as raw JSON
            Type::JSON | Type::JSONB => {
                match row.try_get::<_, Option<JsonValue>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Json(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // Date/Time types - convert to microseconds epoch
            Type::TIMESTAMP => {
                match row.try_get::<_, Option<NaiveDateTime>>(idx) {
                    Ok(Some(val)) => {
                        let micros = val.and_utc().timestamp_micros();
                        Ok(CellValue::Timestamp(micros))
                    }
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::TIMESTAMPTZ => {
                match row.try_get::<_, Option<DateTime<Utc>>>(idx) {
                    Ok(Some(val)) => {
                        let micros = val.timestamp_micros();
                        Ok(CellValue::Timestamp(micros))
                    }
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::DATE => {
                match row.try_get::<_, Option<NaiveDate>>(idx) {
                    Ok(Some(val)) => {
                        // Days since Unix epoch
                        let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
                        let days = val.signed_duration_since(epoch).num_days() as i32;
                        Ok(CellValue::Date(days))
                    }
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::TIME | Type::TIMETZ => {
                match row.try_get::<_, Option<NaiveTime>>(idx) {
                    Ok(Some(val)) => {
                        // Store as seconds since midnight
                        let micros = val.num_seconds_from_midnight() as i64 * 1_000_000
                            + val.nanosecond() as i64 / 1000;
                        Ok(CellValue::Timestamp(micros))
                    }
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // Arrays - serialize to JSON
            Type::INT4_ARRAY => {
                match row.try_get::<_, Option<Vec<i32>>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Json(serde_json::to_value(val)?)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::INT8_ARRAY => {
                match row.try_get::<_, Option<Vec<i64>>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Json(serde_json::to_value(val)?)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }
            Type::TEXT_ARRAY | Type::VARCHAR_ARRAY => {
                match row.try_get::<_, Option<Vec<String>>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Json(serde_json::to_value(val)?)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => Ok(CellValue::Null),
                }
            }

            // Default: try as text
            _ => {
                // Try to get as text first
                match row.try_get::<_, Option<String>>(idx) {
                    Ok(Some(val)) => Ok(CellValue::Text(val)),
                    Ok(None) => Ok(CellValue::Null),
                    Err(_) => {
                        // Last resort: return null
                        Ok(CellValue::Null)
                    }
                }
            }
        }
    }

    /// Batch convert multiple rows
    pub fn rows_to_cells(rows: &[Row]) -> Result<Vec<Vec<CellValue>>> {
        let mut result = Vec::with_capacity(rows.len());

        for row in rows {
            let mut cell_row = Vec::with_capacity(row.len());
            for idx in 0..row.len() {
                cell_row.push(Self::row_to_cell(row, idx)?);
            }
            result.push(cell_row);
        }

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cell_value_serialization() {
        // Test that CellValue variants serialize properly
        let values = vec![
            CellValue::Null,
            CellValue::Bool(true),
            CellValue::I32(42),
            CellValue::I64(1234567890),
            CellValue::F64(3.14),
            CellValue::Text("hello".to_string()),
            CellValue::Bytes(vec![1, 2, 3]),
        ];

        for val in values {
            let json = serde_json::to_string(&val).unwrap();
            println!("Serialized: {}", json);
        }
    }
}
