//! Simple PostgreSQL row converter for introspection and CRUD queries.
//!
//! This is a lightweight alternative to fast_converter.rs, optimized for:
//! - Small result sets (introspection queries, CRUD validation)
//! - Simple types (text, int, bool) common in information_schema/pg_catalog
//! - Zero JSON parsing overhead (JSON/JSONB passed through as strings)
//!
//! For high-volume streaming queries, use DirectMsgPackEncoder instead.

use postgres_types::Type;
use serde_json::Value as JsonValue;
use tokio_postgres::Row;

/// Minimal row-to-JSON converter for introspection queries.
///
/// Handles common PostgreSQL types returned by information_schema and pg_catalog.
/// Complex types fall back to string representation.
pub struct SimpleConverter;

impl SimpleConverter {
    /// Convert multiple rows to JSON values.
    #[inline]
    pub fn rows_to_json(rows: &[Row]) -> Vec<Vec<JsonValue>> {
        rows.iter().map(Self::row_to_json).collect()
    }

    /// Convert a single row to JSON values.
    fn row_to_json(row: &Row) -> Vec<JsonValue> {
        let cols = row.columns();
        (0..cols.len())
            .map(|i| Self::cell_to_json(row, i, cols[i].type_()))
            .collect()
    }

    /// Convert a single cell to JSON value using tokio-postgres FromSql.
    fn cell_to_json(row: &Row, idx: usize, pg_type: &Type) -> JsonValue {
        match *pg_type {
            // Boolean
            Type::BOOL => row
                .try_get::<_, Option<bool>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, JsonValue::Bool),

            // Integers - use tokio-postgres built-in decoding
            Type::INT2 => row
                .try_get::<_, Option<i16>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::Number(v.into())),

            Type::INT4 => row
                .try_get::<_, Option<i32>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::Number(v.into())),

            Type::OID => row
                .try_get::<_, Option<u32>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::Number(v.into())),

            Type::INT8 => row
                .try_get::<_, Option<i64>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::Number(v.into())),

            // Floats
            Type::FLOAT4 => row
                .try_get::<_, Option<f32>>(idx)
                .ok()
                .flatten()
                .and_then(|v| serde_json::Number::from_f64(v as f64))
                .map_or(JsonValue::Null, JsonValue::Number),

            Type::FLOAT8 => row
                .try_get::<_, Option<f64>>(idx)
                .ok()
                .flatten()
                .and_then(serde_json::Number::from_f64)
                .map_or(JsonValue::Null, JsonValue::Number),

            // Text types - most common in introspection queries
            Type::TEXT | Type::VARCHAR | Type::NAME | Type::BPCHAR | Type::CHAR | Type::UNKNOWN => {
                row.try_get::<_, Option<String>>(idx)
                    .ok()
                    .flatten()
                    .map_or(JsonValue::Null, JsonValue::String)
            }

            // JSON/JSONB - pass through as string (NO parsing!)
            Type::JSON | Type::JSONB => row
                .try_get::<_, Option<String>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, JsonValue::String),

            // Arrays - convert to JSON array of strings
            _ if pg_type.name().starts_with('_') => Self::convert_array_fallback(row, idx),

            // All other types - try as string first, then fallback
            _ => row
                .try_get::<_, Option<String>>(idx)
                .ok()
                .flatten()
                .map_or_else(
                    || {
                        // Fallback: type doesn't implement FromSql<String>
                        // Return type name as placeholder
                        JsonValue::String(format!("<{}>", pg_type.name()))
                    },
                    JsonValue::String,
                ),
        }
    }

    /// Fallback for array types - try to get as Vec<String>
    fn convert_array_fallback(row: &Row, idx: usize) -> JsonValue {
        // Try to get as array of strings
        if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<String>>>(idx) {
            return JsonValue::Array(arr.into_iter().map(JsonValue::String).collect());
        }

        // Try to get as array of i32
        if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<i32>>>(idx) {
            return JsonValue::Array(arr.into_iter().map(|v| JsonValue::Number(v.into())).collect());
        }

        // Fallback
        JsonValue::Null
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: Full integration tests require a database connection.
    // These tests verify the module compiles correctly.

    #[test]
    fn test_simple_converter_exists() {
        // SimpleConverter should be usable
        let _converter = SimpleConverter;
    }
}
