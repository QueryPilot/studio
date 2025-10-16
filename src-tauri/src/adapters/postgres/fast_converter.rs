use crate::error::Result;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use postgres_types::Type;
use rayon::prelude::*;
use serde_json::Value as JsonValue;
use tokio_postgres::Row;
use uuid::Uuid;

/// Fast PostgreSQL type converter - Direct to JSON
/// Converts database values directly to serde_json::Value
/// NO CellValue enum overhead, NO display_value allocation
pub struct FastPostgresConverter;

impl FastPostgresConverter {
    /// Batch convert multiple rows to JSON with cached column types (OPTIMIZED)
    pub fn rows_to_json(rows: &[Row]) -> Result<Vec<Vec<JsonValue>>> {
        if rows.is_empty() {
            return Ok(Vec::new());
        }

        // OPTIMIZATION: Cache column types once for entire batch
        // Avoids 6000 rows × 10 cols = 60,000 repeated lookups!
        let column_types: Vec<&Type> = rows[0].columns().iter()
            .map(|col| col.type_())
            .collect();
        let num_columns = column_types.len();

        // Use parallel iterator for multi-core speedup (4-8x faster)
        // Each row is converted independently across CPU cores
        let result = rows.par_iter()
            .map(|row| {
                let mut json_row = Vec::with_capacity(num_columns);
                for idx in 0..num_columns {
                    // Use cached column type instead of row.columns()[idx].type_()
                    let pg_type = column_types[idx];
                    match Self::row_to_json_with_type(row, idx, pg_type) {
                        Ok(val) => json_row.push(val),
                        Err(_) => json_row.push(JsonValue::Null),
                    }
                }
                json_row
            })
            .collect();

        Ok(result)
    }

    /// Convert a cell to JSON using pre-extracted column type (OPTIMIZED)
    #[inline]
    fn row_to_json_with_type(row: &Row, idx: usize, pg_type: &Type) -> Result<JsonValue> {
        // Fast path: use binary protocol extraction where possible
        match *pg_type {
            // Integers - direct to JSON number
            Type::INT2 => {
                match row.try_get::<_, Option<i16>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val)),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::INT4 | Type::OID => {
                match row.try_get::<_, Option<i32>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val)),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::INT8 => {
                match row.try_get::<_, Option<i64>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val)),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // Floats - direct to JSON number
            Type::FLOAT4 => {
                match row.try_get::<_, Option<f32>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val)),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::FLOAT8 => {
                match row.try_get::<_, Option<f64>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val)),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::NUMERIC => {
                match row.try_get::<_, Option<rust_decimal::Decimal>>(idx) {
                    Ok(Some(val)) => {
                        use std::str::FromStr;
                        let s = val.to_string();
                        if let Ok(f) = f64::from_str(&s) {
                            Ok(JsonValue::from(f))
                        } else {
                            Ok(JsonValue::from(s))
                        }
                    }
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // Boolean - direct to JSON bool
            Type::BOOL => {
                match row.try_get::<_, Option<bool>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val)),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // Text types - direct to JSON string
            Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::CHAR => {
                match row.try_get::<_, Option<String>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val)),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // UUID - convert to string
            Type::UUID => {
                match row.try_get::<_, Option<Uuid>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val.to_string())),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // Binary data - base64 encode
            Type::BYTEA => {
                match row.try_get::<_, Option<Vec<u8>>>(idx) {
                    Ok(Some(val)) => {
                        let base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, val);
                        Ok(JsonValue::from(base64))
                    }
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // JSON types - already JSON, pass through
            Type::JSON | Type::JSONB => {
                match row.try_get::<_, Option<JsonValue>>(idx) {
                    Ok(Some(val)) => Ok(val),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // Date/Time types - ISO 8601 strings
            Type::TIMESTAMP => {
                match row.try_get::<_, Option<NaiveDateTime>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val.and_utc().to_rfc3339())),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::TIMESTAMPTZ => {
                match row.try_get::<_, Option<DateTime<Utc>>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val.to_rfc3339())),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::DATE => {
                match row.try_get::<_, Option<NaiveDate>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val.format("%Y-%m-%d").to_string())),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::TIME | Type::TIMETZ => {
                match row.try_get::<_, Option<NaiveTime>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val.format("%H:%M:%S%.f").to_string())),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // Arrays - serialize to JSON array
            Type::INT4_ARRAY => {
                match row.try_get::<_, Option<Vec<i32>>>(idx) {
                    Ok(Some(val)) => Ok(serde_json::to_value(val)?),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::INT8_ARRAY => {
                match row.try_get::<_, Option<Vec<i64>>>(idx) {
                    Ok(Some(val)) => Ok(serde_json::to_value(val)?),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
            Type::TEXT_ARRAY | Type::VARCHAR_ARRAY => {
                match row.try_get::<_, Option<Vec<String>>>(idx) {
                    Ok(Some(val)) => Ok(serde_json::to_value(val)?),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }

            // Default: try as text
            _ => {
                match row.try_get::<_, Option<String>>(idx) {
                    Ok(Some(val)) => Ok(JsonValue::from(val)),
                    Ok(None) => Ok(JsonValue::Null),
                    Err(_) => Ok(JsonValue::Null),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_value_serialization() {
        // Test that JSON values serialize properly
        let values = vec![
            JsonValue::Null,
            JsonValue::Bool(true),
            JsonValue::from(42),
            JsonValue::from(1234567890i64),
            JsonValue::from(3.14),
            JsonValue::from("hello"),
        ];

        for val in values {
            let json = serde_json::to_string(&val).unwrap();
            println!("Serialized: {}", json);
        }
    }
}
