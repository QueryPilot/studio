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

use postgres_protocol::types as proto;
use postgres_types::Type;
use serde_json::{json, Value as JsonValue};
use tokio_postgres::types::FromSql;
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

            Type::INT8 => {
                row.try_get::<_, Option<i64>>(idx)
                    .ok()
                    .flatten()
                    .map_or(JsonValue::Null, |v| {
                        // CRITICAL: BIGINT values beyond JavaScript's MAX_SAFE_INTEGER must be strings
                        // JavaScript Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9,007,199,254,740,991
                        // PostgreSQL BIGINT max = 9,223,372,036,854,775,807
                        const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
                        const MIN_SAFE_INTEGER: i64 = -9_007_199_254_740_991;

                        if !(MIN_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&v) {
                            // Send as string to preserve precision
                            JsonValue::String(v.to_string())
                        } else {
                            // Safe to send as number
                            JsonValue::Number(v.into())
                        }
                    })
            }

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

            // JSON/JSONB - keep structured JSON value
            Type::JSON | Type::JSONB => row
                .try_get::<_, Option<serde_json::Value>>(idx)
                .ok()
                .flatten()
                .map_or(JsonValue::Null, |v| v), // Return the Value directly

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

            // Range types - parse binary wire format using postgres_protocol
            _ if matches!(pg_type.kind(), postgres_types::Kind::Range(_)) => {
                Self::convert_range_value(row, idx, pg_type)
            }

            // Enum types - read as raw bytes and decode as UTF-8
            // PostgreSQL enum values are stored as text internally
            _ if matches!(pg_type.kind(), postgres_types::Kind::Enum(_)) => {
                // For enum types, we need to read the raw column value
                // tokio-postgres stores enum values as the variant name string
                Self::convert_enum_value(row, idx)
            }

            // All other types - try as string, then raw bytes with type-specific formatting
            _ => {
                // First try String (works for text-like types)
                if let Ok(Some(s)) = row.try_get::<_, Option<String>>(idx) {
                    return JsonValue::String(s);
                }
                // Try raw bytes with type-specific formatting
                if let Ok(Some(raw)) = row.try_get::<_, Option<RawBytes>>(idx) {
                    if let Some(s) = Self::format_raw_value(pg_type, &raw.0) {
                        return JsonValue::String(s);
                    }
                }
                // Check for NULL (raw bytes approach returns None for NULL)
                if let Ok(None) = row.try_get::<_, Option<RawBytes>>(idx) {
                    return JsonValue::Null;
                }
                // Final fallback: type placeholder
                tracing::warn!(
                    "SimpleConverter: Type {:?} (oid: {}) could not be converted",
                    pg_type,
                    pg_type.oid()
                );
                JsonValue::String(format!("<{}>", pg_type.name()))
            }
        }
    }

    /// Fallback for array types - try common array element types
    fn convert_array_fallback(row: &Row, idx: usize) -> JsonValue {
        // Try to get as array of bools
        if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<bool>>>(idx) {
            return JsonValue::Array(arr.into_iter().map(JsonValue::Bool).collect());
        }

        // Try to get as array of i32
        if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<i32>>>(idx) {
            return JsonValue::Array(
                arr.into_iter()
                    .map(|v| JsonValue::Number(v.into()))
                    .collect(),
            );
        }

        // Try to get as array of i64
        if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<i64>>>(idx) {
            return JsonValue::Array(arr.into_iter().map(|v| json!(v)).collect());
        }

        // Try to get as array of f64
        if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<f64>>>(idx) {
            return JsonValue::Array(
                arr.into_iter()
                    .map(|v| {
                        serde_json::Number::from_f64(v).map_or(JsonValue::Null, JsonValue::Number)
                    })
                    .collect(),
            );
        }

        // Try to get as array of strings
        if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<String>>>(idx) {
            return JsonValue::Array(arr.into_iter().map(JsonValue::String).collect());
        }

        // Fallback
        JsonValue::Null
    }

    /// Convert PostgreSQL enum value to JSON string.
    fn convert_enum_value(row: &Row, idx: usize) -> JsonValue {
        row.try_get::<_, Option<RawBytes>>(idx)
            .ok()
            .flatten()
            .and_then(|raw| std::str::from_utf8(&raw.0).ok().map(|s| s.to_string()))
            .map_or(JsonValue::Null, JsonValue::String)
    }

    /// Convert PostgreSQL range value to JSON string.
    ///
    /// Range types use a complex binary wire format that cannot be decoded with
    /// simple `from_utf8`. We use `postgres_protocol::types::range_from_sql` to
    /// properly parse the binary data, then format each bound value based on the
    /// inner element type.
    fn convert_range_value(row: &Row, idx: usize, pg_type: &Type) -> JsonValue {
        let raw = match row.try_get::<_, Option<RawBytes>>(idx) {
            Ok(Some(r)) => r,
            Ok(None) => return JsonValue::Null,
            Err(_) => return JsonValue::String(format!("<{}>", pg_type.name())),
        };

        let inner_type = match pg_type.kind() {
            postgres_types::Kind::Range(inner) => inner,
            _ => return JsonValue::String(format!("<{}>", pg_type.name())),
        };

        match proto::range_from_sql(&raw.0) {
            Ok(proto::Range::Empty) => JsonValue::String("empty".to_string()),
            Ok(proto::Range::Nonempty(lower, upper)) => {
                let (lower_str, lower_inclusive) = Self::format_range_bound(inner_type, lower);
                let (upper_str, upper_inclusive) = Self::format_range_bound(inner_type, upper);
                let open = if lower_inclusive { '[' } else { '(' };
                let close = if upper_inclusive { ']' } else { ')' };
                JsonValue::String(format!("{}{},{}{}", open, lower_str, upper_str, close))
            }
            Err(_) => JsonValue::String(format!("<{}>", pg_type.name())),
        }
    }

    /// Format a single range bound (lower or upper) into its string representation.
    ///
    /// Returns `(formatted_value, is_inclusive)`.
    fn format_range_bound(
        element_type: &Type,
        bound: proto::RangeBound<Option<&[u8]>>,
    ) -> (String, bool) {
        match bound {
            proto::RangeBound::Unbounded => (String::new(), false),
            proto::RangeBound::Inclusive(None) => (String::new(), true),
            proto::RangeBound::Exclusive(None) => (String::new(), false),
            proto::RangeBound::Inclusive(Some(bytes)) => {
                (Self::format_range_element(element_type, bytes), true)
            }
            proto::RangeBound::Exclusive(Some(bytes)) => {
                (Self::format_range_element(element_type, bytes), false)
            }
        }
    }

    /// Format the raw bytes of a range element value based on its PostgreSQL type.
    fn format_range_element(element_type: &Type, raw: &[u8]) -> String {
        match *element_type {
            Type::INT4 => {
                if raw.len() == 4 {
                    i32::from_be_bytes(raw.try_into().unwrap()).to_string()
                } else {
                    String::from_utf8_lossy(raw).to_string()
                }
            }
            Type::INT8 => {
                if raw.len() == 8 {
                    i64::from_be_bytes(raw.try_into().unwrap()).to_string()
                } else {
                    String::from_utf8_lossy(raw).to_string()
                }
            }
            Type::NUMERIC => {
                // Use rust_decimal to decode numeric binary format
                use postgres_types::FromSql;
                match rust_decimal::Decimal::from_sql(&Type::NUMERIC, raw) {
                    Ok(d) => d.to_string(),
                    Err(_) => String::from_utf8_lossy(raw).to_string(),
                }
            }
            Type::DATE => {
                // PostgreSQL DATE binary: i32 days since 2000-01-01
                if raw.len() == 4 {
                    let days = i32::from_be_bytes(raw.try_into().unwrap());
                    let pg_epoch = chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap();
                    match pg_epoch.checked_add_signed(chrono::Duration::days(days as i64)) {
                        Some(d) => d.to_string(),
                        None => format!("{} days", days),
                    }
                } else {
                    String::from_utf8_lossy(raw).to_string()
                }
            }
            Type::TIMESTAMP => {
                // PostgreSQL TIMESTAMP binary: i64 microseconds since 2000-01-01
                if raw.len() == 8 {
                    let us = i64::from_be_bytes(raw.try_into().unwrap());
                    let pg_epoch = chrono::NaiveDate::from_ymd_opt(2000, 1, 1)
                        .unwrap()
                        .and_hms_opt(0, 0, 0)
                        .unwrap();
                    match pg_epoch.checked_add_signed(chrono::Duration::microseconds(us)) {
                        Some(dt) => dt.to_string(),
                        None => format!("{} us", us),
                    }
                } else {
                    String::from_utf8_lossy(raw).to_string()
                }
            }
            Type::TIMESTAMPTZ => {
                // PostgreSQL TIMESTAMPTZ binary: i64 microseconds since 2000-01-01 UTC
                if raw.len() == 8 {
                    let us = i64::from_be_bytes(raw.try_into().unwrap());
                    let pg_epoch = chrono::NaiveDate::from_ymd_opt(2000, 1, 1)
                        .unwrap()
                        .and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc();
                    match pg_epoch.checked_add_signed(chrono::Duration::microseconds(us)) {
                        Some(dt) => dt.to_rfc3339(),
                        None => format!("{} us", us),
                    }
                } else {
                    String::from_utf8_lossy(raw).to_string()
                }
            }
            _ => {
                // Fallback: try UTF-8, then lossy conversion
                String::from_utf8_lossy(raw).to_string()
            }
        }
    }

    /// Format raw binary bytes into a string based on PostgreSQL type.
    /// Reuses binary parsing logic from DirectMsgPackEncoder.
    fn format_raw_value(pg_type: &Type, raw: &[u8]) -> Option<String> {
        match pg_type.name() {
            // INET / CIDR: family(1) + prefix(1) + is_cidr(1) + addr_len(1) + addr_bytes
            "inet" | "cidr" => Self::format_inet(raw),

            // INTERVAL: microseconds(i64) + days(i32) + months(i32) = 16 bytes
            "interval" => Self::format_interval(raw),

            // MACADDR: 6 bytes, MACADDR8: 8 bytes
            "macaddr" => Self::format_macaddr(raw, 6),
            "macaddr8" => Self::format_macaddr(raw, 8),

            // BIT / VARBIT: bit_len(i32) + data bytes
            "bit" | "varbit" => Self::format_bit(raw),

            // XML: UTF-8 text in binary format
            "xml" => std::str::from_utf8(raw).ok().map(|s| s.to_string()),

            // TSVECTOR: binary lexeme format
            "tsvector" => Self::format_tsvector(raw),

            // TSQUERY: try UTF-8 fallback (complex binary format)
            "tsquery" => std::str::from_utf8(raw).ok().map(|s| s.to_string()),

            // Range types are handled upstream in cell_to_json via convert_range_value

            // POINT: x(f64) + y(f64) = 16 bytes
            "point" => Self::format_point(raw),

            // Default: try UTF-8 interpretation
            _ => std::str::from_utf8(raw).ok().map(|s| s.to_string()),
        }
    }

    fn format_inet(raw: &[u8]) -> Option<String> {
        if raw.len() < 4 {
            return None;
        }
        let family = raw[0];
        let prefix = raw[1];
        let addr_len = raw[3] as usize;
        if raw.len() < 4 + addr_len {
            return None;
        }
        let addr = &raw[4..4 + addr_len];
        match family {
            2 if addr_len == 4 => {
                let ip = std::net::Ipv4Addr::new(addr[0], addr[1], addr[2], addr[3]);
                Some(if prefix == 32 {
                    ip.to_string()
                } else {
                    format!("{}/{}", ip, prefix)
                })
            }
            3 if addr_len == 16 => {
                let ip = std::net::Ipv6Addr::from(<[u8; 16]>::try_from(addr).ok()?);
                Some(if prefix == 128 {
                    ip.to_string()
                } else {
                    format!("{}/{}", ip, prefix)
                })
            }
            _ => None,
        }
    }

    fn format_interval(raw: &[u8]) -> Option<String> {
        if raw.len() != 16 {
            return None;
        }
        let microseconds = i64::from_be_bytes(raw[0..8].try_into().ok()?);
        let days = i32::from_be_bytes(raw[8..12].try_into().ok()?);
        let months = i32::from_be_bytes(raw[12..16].try_into().ok()?);

        let mut parts = Vec::new();
        if months != 0 {
            let years = months / 12;
            let mons = months % 12;
            if years != 0 {
                parts.push(format!(
                    "{} {}",
                    years,
                    if years.abs() == 1 { "year" } else { "years" }
                ));
            }
            if mons != 0 {
                parts.push(format!(
                    "{} {}",
                    mons,
                    if mons.abs() == 1 { "mon" } else { "mons" }
                ));
            }
        }
        if days != 0 {
            parts.push(format!(
                "{} {}",
                days,
                if days.abs() == 1 { "day" } else { "days" }
            ));
        }
        if microseconds != 0 || parts.is_empty() {
            let total_secs = microseconds / 1_000_000;
            let us = (microseconds % 1_000_000).unsigned_abs() as u32;
            let hours = total_secs / 3600;
            let mins = ((total_secs % 3600) / 60).unsigned_abs() as u32;
            let secs = (total_secs % 60).unsigned_abs() as u32;
            if us != 0 {
                parts.push(format!("{:02}:{:02}:{:02}.{:06}", hours, mins, secs, us));
            } else {
                parts.push(format!("{:02}:{:02}:{:02}", hours, mins, secs));
            }
        }
        Some(parts.join(" "))
    }

    fn format_macaddr(raw: &[u8], len: usize) -> Option<String> {
        if raw.len() != len {
            return None;
        }
        let parts: Vec<String> = raw.iter().map(|b| format!("{:02x}", b)).collect();
        Some(parts.join(":"))
    }

    fn format_bit(raw: &[u8]) -> Option<String> {
        if raw.len() < 4 {
            return None;
        }
        let bit_len = i32::from_be_bytes(raw[0..4].try_into().ok()?) as usize;
        let bytes = &raw[4..];
        let mut s = String::with_capacity(bit_len);
        for i in 0..bit_len {
            let byte_idx = i / 8;
            let bit_idx = 7 - (i % 8);
            if byte_idx < bytes.len() {
                s.push(if (bytes[byte_idx] >> bit_idx) & 1 == 1 {
                    '1'
                } else {
                    '0'
                });
            }
        }
        Some(s)
    }

    fn format_tsvector(raw: &[u8]) -> Option<String> {
        if raw.len() < 4 {
            return None;
        }
        let n_lexemes = i32::from_be_bytes(raw[0..4].try_into().ok()?) as usize;
        let mut offset = 4;
        let mut result = String::with_capacity(raw.len() * 2);

        for i in 0..n_lexemes {
            let lexeme_start = offset;
            while offset < raw.len() && raw[offset] != 0 {
                offset += 1;
            }
            if offset >= raw.len() {
                return None;
            }
            let lexeme = std::str::from_utf8(&raw[lexeme_start..offset]).ok()?;
            offset += 1; // skip null terminator

            if offset + 2 > raw.len() {
                return None;
            }
            let n_positions = u16::from_be_bytes(raw[offset..offset + 2].try_into().ok()?) as usize;
            offset += 2;

            if i > 0 {
                result.push(' ');
            }
            result.push('\'');
            result.push_str(lexeme);
            result.push('\'');

            if n_positions > 0 {
                result.push(':');
                for j in 0..n_positions {
                    if offset + 2 > raw.len() {
                        return None;
                    }
                    let pos_val = u16::from_be_bytes(raw[offset..offset + 2].try_into().ok()?);
                    offset += 2;
                    let position = pos_val & 0x3FFF;
                    if j > 0 {
                        result.push(',');
                    }
                    result.push_str(&position.to_string());
                }
            }
        }
        Some(result)
    }

    fn format_point(raw: &[u8]) -> Option<String> {
        if raw.len() != 16 {
            return None;
        }
        let x = f64::from_be_bytes(raw[0..8].try_into().ok()?);
        let y = f64::from_be_bytes(raw[8..16].try_into().ok()?);
        Some(format!("({},{})", x, y))
    }
}

/// Wrapper to extract raw binary bytes from any PostgreSQL column.
struct RawBytes(Vec<u8>);

impl<'a> FromSql<'a> for RawBytes {
    fn from_sql(
        _ty: &postgres_types::Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Ok(RawBytes(raw.to_vec()))
    }

    fn accepts(_ty: &postgres_types::Type) -> bool {
        true // Accept any type
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
