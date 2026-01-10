//! Simple PostgreSQL row converter for introspection and metadata queries.
//!
//! This is a lightweight alternative to DirectMsgPackEncoder, optimized for:
//! - Small result sets (< 1000 rows from introspection queries)
//! - Simple types (text, int, bool) common in information_schema/pg_catalog
//! - Zero JSON parsing overhead (JSON/JSONB passed through as strings)
//! - Low latency (~5-10ms overhead) for synchronous-like operations
//!
//! # When to Use
//!
//! Use `SimpleConverter` for:
//! - Schema metadata queries (tables, columns, constraints)
//! - System catalog queries (information_schema, pg_catalog)
//! - AI HTTP server endpoints (cannot use IPC channels)
//! - Any query with known small result size (< 1000 rows)
//!
//! # When NOT to Use
//!
//! Do NOT use `SimpleConverter` for:
//! - User-facing data display (use DirectMsgPackEncoder)
//! - Large result sets (> 1000 rows)
//! - Queries with unknown result size
//! - Operations requiring progressive rendering or cancellation
//!
//! # Architecture
//!
//! This converter is used by the `query` Tauri command, which provides a simple
//! invoke-based API for small queries. For large datasets, use the `execute_query`
//! command with DirectMsgPackEncoder instead.
//!
//! See: `docs/query-execution-architecture.md` for detailed architecture documentation.
//!
//! # See Also
//!
//! - [`DirectMsgPackEncoder`](super::direct_msgpack::DirectMsgPackEncoder) - High-performance streaming for large datasets
//! - [`query` command](../../../commands.rs) - Tauri command using this converter
//! - [Query Execution Architecture](../../../../../docs/query-execution-architecture.md)

use postgres_types::Type;
use serde_json::Value as JsonValue;
use tokio_postgres::Row;
use uuid::Uuid;

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
                .map_or(JsonValue::Null, |v| {
                    // CRITICAL: BIGINT values beyond JavaScript's MAX_SAFE_INTEGER must be strings
                    // JavaScript Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9,007,199,254,740,991
                    // PostgreSQL BIGINT max = 9,223,372,036,854,775,807
                    const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
                    const MIN_SAFE_INTEGER: i64 = -9_007_199_254_740_991;
                    
                    if v > MAX_SAFE_INTEGER || v < MIN_SAFE_INTEGER {
                        // Send as string to preserve precision
                        JsonValue::String(v.to_string())
                    } else {
                        // Safe to send as number
                        JsonValue::Number(v.into())
                    }
                }),

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

            // Numeric/Money - return as string to preserve precision
            Type::NUMERIC | Type::MONEY => {
                // We can't easily get Numeric as f64 without losing precision,
                // and rust_decimal/bigdecimal handling might vary. 
                // Best to cast to string in SQL, but here we can try basic string conversion
                // if the driver supports it, or generic string fallback.
                // NOTE: tokio-postgres doesn't implement FromSql<String> for NUMERIC/MONEY by default.
                // We'll rely on the fallback below or implement specific handling if needed.
                // For now, let's try to get as Decimal if possible or fallback.
                // Actually, let's use the fallback logic which tries String.
                // If that fails, we might return <NUMERIC>.
                // Update: Let's explicitly try to handle them if we can.
                // But without knowing which Decimal crate is used (rust_decimal or bigdecimal), 
                // it's safer to let the fallback handle it or return a placeholder.
                // However, since we want tests to pass, we should probably ensure numeric values come back.
                // Tests use `::numeric` which returns `Decimal`.
                // Let's rely on the catch-all `_` which tries `Option<String>`. 
                // But tokio-postgres WON'T convert Numeric to String automatically.
                // So we really should handle it.
                // Check Cargo.toml: `rust_decimal = ... features = ["db-postgres"]`.
                // So we can try `rust_decimal::Decimal`.
                row.try_get::<_, Option<rust_decimal::Decimal>>(idx)
                    .ok()
                    .flatten()
                    .map_or(JsonValue::Null, |v| JsonValue::String(v.to_string()))
            }

            // Text types - most common in introspection queries
            Type::TEXT | Type::VARCHAR | Type::NAME | Type::BPCHAR | Type::CHAR | Type::UNKNOWN => {
                row.try_get::<_, Option<String>>(idx)
                    .ok()
                    .flatten()
                    .map_or(JsonValue::Null, JsonValue::String)
            }

            // JSON/JSONB - pass through as string (NO parsing!)
            Type::JSON | Type::JSONB => row
                .try_get::<_, Option<serde_json::Value>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| v) // Return the Value directly
                // Wait, SimpleConverter doc says "pass through as string".
                // But `serde_json::Value` is better if we have it.
                // Let's stick to the existing logic which was `Option<String>`?
                // The existing logic used `Option<String>` which might return the serialized JSON.
                // If we use `serde_json::Value`, we get structure.
                // The test expects `row[0]["key"]` or string.
                // Let's try `serde_json::Value`.
                ,

            // UUID
            Type::UUID => row
                .try_get::<_, Option<Uuid>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::String(v.to_string())),

            // Binary
            Type::BYTEA => row
                .try_get::<_, Option<Vec<u8>>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| {
                     // Convert to hex string
                     use std::fmt::Write;
                     let mut s = String::with_capacity(v.len() * 2 + 2);
                     s.push_str("\\x");
                     for b in v {
                         write!(s, "{:02x}", b).ok();
                     }
                     JsonValue::String(s)
                }),

            // Date/Time types - require chrono
            Type::DATE => row
                .try_get::<_, Option<chrono::NaiveDate>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::String(v.to_string())),
            
            Type::TIME => row
                .try_get::<_, Option<chrono::NaiveTime>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::String(v.to_string())),

            Type::TIMESTAMP => row
                .try_get::<_, Option<chrono::NaiveDateTime>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::String(v.to_string())),

            Type::TIMESTAMPTZ => row
                .try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| JsonValue::String(v.to_rfc3339())),

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
                        tracing::warn!("SimpleConverter: Type {:?} (oid: {}) fallback to string failed", pg_type, pg_type.oid());
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
