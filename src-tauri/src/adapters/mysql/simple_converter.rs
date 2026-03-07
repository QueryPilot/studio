//! Simple MySQL row converter for introspection and metadata queries.
//!
//! Lightweight alternative to DirectMsgPackEncoder for small result sets.

use mysql_async::consts::ColumnType;
use mysql_async::{Row, Value};
use serde_json::Value as JsonValue;

/// Minimal row-to-JSON converter for MySQL introspection queries.
pub struct SimpleConverter;

impl SimpleConverter {
    /// Convert multiple rows to JSON values.
    #[inline]
    pub fn rows_to_json(rows: &[Row]) -> Vec<Vec<JsonValue>> {
        rows.iter().map(Self::row_to_json).collect()
    }

    /// Convert a single row to JSON values.
    fn row_to_json(row: &Row) -> Vec<JsonValue> {
        let columns = row.columns_ref();
        (0..columns.len())
            .map(|i| {
                let col_type = columns[i].column_type();
                Self::value_to_json(row.as_ref(i), col_type)
            })
            .collect()
    }

    /// Convert a MySQL Value to JSON value.
    fn value_to_json(value: Option<&Value>, col_type: ColumnType) -> JsonValue {
        match value {
            None | Some(Value::NULL) => JsonValue::Null,

            Some(Value::Bytes(bytes)) => {
                match String::from_utf8(bytes.clone()) {
                    Ok(s) => {
                        if col_type == ColumnType::MYSQL_TYPE_JSON {
                            serde_json::from_str(&s).unwrap_or(JsonValue::String(s))
                        } else {
                            JsonValue::String(s)
                        }
                    }
                    Err(_) => {
                        use base64::engine::general_purpose::STANDARD;
                        use base64::Engine;
                        JsonValue::String(STANDARD.encode(bytes))
                    }
                }
            }

            Some(Value::Int(i)) => {
                // Handle BIGINT values beyond JavaScript's MAX_SAFE_INTEGER
                const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
                const MIN_SAFE_INTEGER: i64 = -9_007_199_254_740_991;

                if *i > MAX_SAFE_INTEGER || *i < MIN_SAFE_INTEGER {
                    JsonValue::String(i.to_string())
                } else {
                    JsonValue::Number((*i).into())
                }
            }

            Some(Value::UInt(u)) => {
                const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

                if *u > MAX_SAFE_INTEGER {
                    JsonValue::String(u.to_string())
                } else {
                    JsonValue::Number((*u).into())
                }
            }

            Some(Value::Float(f)) => {
                serde_json::Number::from_f64(*f as f64).map_or(JsonValue::Null, JsonValue::Number)
            }

            Some(Value::Double(d)) => {
                serde_json::Number::from_f64(*d).map_or(JsonValue::Null, JsonValue::Number)
            }

            Some(Value::Date(year, month, day, hour, min, sec, micro)) => {
                // Format as ISO 8601 datetime or date
                if *hour == 0 && *min == 0 && *sec == 0 && *micro == 0 {
                    JsonValue::String(format!("{:04}-{:02}-{:02}", year, month, day))
                } else if *micro > 0 {
                    JsonValue::String(format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
                        year, month, day, hour, min, sec, micro
                    ))
                } else {
                    JsonValue::String(format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                        year, month, day, hour, min, sec
                    ))
                }
            }

            Some(Value::Time(is_neg, days, hours, mins, secs, micros)) => {
                let total_hours = *days * 24 + (*hours as u32);
                let sign = if *is_neg { "-" } else { "" };
                if *micros > 0 {
                    JsonValue::String(format!(
                        "{}{:02}:{:02}:{:02}.{:06}",
                        sign, total_hours, mins, secs, micros
                    ))
                } else {
                    JsonValue::String(format!(
                        "{}{:02}:{:02}:{:02}",
                        sign, total_hours, mins, secs
                    ))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_converter_exists() {
        let _converter = SimpleConverter;
    }
}
