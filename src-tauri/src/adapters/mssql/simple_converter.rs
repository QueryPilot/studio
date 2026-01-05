//! Simple SQL Server row converter for introspection and metadata queries.
//!
//! Lightweight alternative to DirectMsgPackEncoder for small result sets.

use serde_json::Value as JsonValue;
use tiberius::Row;

/// Minimal row-to-JSON converter for SQL Server introspection queries.
pub struct SimpleConverter;

impl SimpleConverter {
    /// Convert a row to JSON values.
    pub fn row_to_json(row: &Row) -> Vec<JsonValue> {
        (0..row.len())
            .map(|i| {
                // Try different types in order of likelihood
                if let Some(v) = row.try_get::<&str, _>(i).ok().flatten() {
                    return JsonValue::String(v.to_string());
                }
                if let Some(v) = row.try_get::<i32, _>(i).ok().flatten() {
                    return JsonValue::Number(v.into());
                }
                if let Some(v) = row.try_get::<i64, _>(i).ok().flatten() {
                    const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
                    const MIN_SAFE_INTEGER: i64 = -9_007_199_254_740_991;
                    if v > MAX_SAFE_INTEGER || v < MIN_SAFE_INTEGER {
                        return JsonValue::String(v.to_string());
                    }
                    return JsonValue::Number(v.into());
                }
                if let Some(v) = row.try_get::<i16, _>(i).ok().flatten() {
                    return JsonValue::Number(v.into());
                }
                if let Some(v) = row.try_get::<u8, _>(i).ok().flatten() {
                    return JsonValue::Number(v.into());
                }
                if let Some(v) = row.try_get::<f64, _>(i).ok().flatten() {
                    return serde_json::Number::from_f64(v)
                        .map_or(JsonValue::Null, JsonValue::Number);
                }
                if let Some(v) = row.try_get::<f32, _>(i).ok().flatten() {
                    return serde_json::Number::from_f64(v as f64)
                        .map_or(JsonValue::Null, JsonValue::Number);
                }
                if let Some(v) = row.try_get::<bool, _>(i).ok().flatten() {
                    return JsonValue::Bool(v);
                }
                if let Some(v) = row.try_get::<uuid::Uuid, _>(i).ok().flatten() {
                    return JsonValue::String(v.to_string());
                }
                if let Some(v) = row.try_get::<&[u8], _>(i).ok().flatten() {
                    use base64::engine::general_purpose::STANDARD;
                    use base64::Engine;
                    return JsonValue::String(STANDARD.encode(v));
                }
                // DateTime types - try to get as NaiveDateTime
                if let Some(v) = row.try_get::<chrono::NaiveDateTime, _>(i).ok().flatten() {
                    return JsonValue::String(v.to_string());
                }
                if let Some(v) = row.try_get::<chrono::NaiveDate, _>(i).ok().flatten() {
                    return JsonValue::String(v.to_string());
                }
                if let Some(v) = row.try_get::<chrono::NaiveTime, _>(i).ok().flatten() {
                    return JsonValue::String(v.to_string());
                }
                // Decimal - convert to string
                if let Some(v) = row.try_get::<tiberius::numeric::Numeric, _>(i).ok().flatten() {
                    return JsonValue::String(v.to_string());
                }
                // XML
                if let Some(v) = row.try_get::<&tiberius::xml::XmlData, _>(i).ok().flatten() {
                    return JsonValue::String(v.to_string());
                }

                // Fallback to null
                JsonValue::Null
            })
            .collect()
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
