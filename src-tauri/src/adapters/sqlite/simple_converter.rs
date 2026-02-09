//! Simple SQLite row converter for introspection and metadata queries.
//!
//! Lightweight alternative to DirectMsgPackEncoder for small result sets.

use rusqlite::types::ValueRef;
use rusqlite::Row;
use serde_json::Value as JsonValue;

/// Minimal row-to-JSON converter for SQLite introspection queries.
pub struct SimpleConverter;

impl SimpleConverter {
    /// Convert a row to JSON values using column count.
    pub fn row_to_json(row: &Row, column_count: usize) -> Vec<JsonValue> {
        (0..column_count)
            .map(|i| Self::value_to_json(row.get_ref(i).ok()))
            .collect()
    }

    /// Convert a SQLite ValueRef to JSON value.
    fn value_to_json(value: Option<ValueRef>) -> JsonValue {
        match value {
            None => JsonValue::Null,
            Some(ValueRef::Null) => JsonValue::Null,
            Some(ValueRef::Integer(i)) => {
                // Handle BIGINT values beyond JavaScript's MAX_SAFE_INTEGER
                const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
                const MIN_SAFE_INTEGER: i64 = -9_007_199_254_740_991;

                if i > MAX_SAFE_INTEGER || i < MIN_SAFE_INTEGER {
                    JsonValue::String(i.to_string())
                } else {
                    JsonValue::Number(i.into())
                }
            }
            Some(ValueRef::Real(f)) => {
                serde_json::Number::from_f64(f).map_or(JsonValue::Null, JsonValue::Number)
            }
            Some(ValueRef::Text(bytes)) => {
                match std::str::from_utf8(bytes) {
                    Ok(s) => JsonValue::String(s.to_string()),
                    Err(_) => {
                        // Invalid UTF-8, encode as base64
                        use base64::engine::general_purpose::STANDARD;
                        use base64::Engine;
                        JsonValue::String(STANDARD.encode(bytes))
                    }
                }
            }
            Some(ValueRef::Blob(bytes)) => {
                use base64::engine::general_purpose::STANDARD;
                use base64::Engine;
                JsonValue::String(STANDARD.encode(bytes))
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
