use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use postgres_protocol::types as proto;
use postgres_types::{FromSql, Kind, Type};
use rayon::prelude::*;
use rmp::encode;
use rust_decimal::Decimal;
use std::io::Write;
use tokio_postgres::Row;
use uuid::Uuid;

/// Fast PostgreSQL to MessagePack converter - Direct encoding without serde_json::Value
/// Eliminates ~125,000 heap allocations for 12k rows by encoding directly to MsgPack bytes
pub struct FastMsgPackConverter;

struct RawValue<'a>(&'a [u8]);

impl<'a> FromSql<'a> for RawValue<'a> {
    fn from_sql(
        _: &Type,
        raw: &'a [u8],
    ) -> std::result::Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Ok(Self(raw))
    }

    fn from_sql_null(
        _: &Type,
    ) -> std::result::Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Err("unexpected NULL".into())
    }

    fn accepts(_: &Type) -> bool {
        true
    }
}

impl FastMsgPackConverter {
    fn estimate_buffer_size(rows_count: usize, column_types: &[&Type]) -> usize {
        let row_size: usize = column_types.iter().map(|t| match **t {
            Type::BOOL => 2,
            Type::INT2 => 4,
            Type::INT4 => 6,
            Type::INT8 | Type::FLOAT8 => 10,
            Type::TEXT | Type::VARCHAR => 64,
            Type::TIMESTAMP | Type::TIMESTAMPTZ => 36,
            Type::UUID => 40,
            Type::JSONB | Type::JSON => 128,
            Type::BYTEA => 256,
            _ => 32,
        }).sum();
        let estimated = rows_count * (row_size + column_types.len() * 2);
        (estimated as f64 * 1.2) as usize
    }

    /// Convert rows directly to MessagePack bytes - bypasses serde_json::Value entirely
    /// Uses rayon for parallel conversion of row batches
    pub fn rows_to_msgpack(rows: &[Row]) -> Result<Vec<u8>> {
        if rows.is_empty() {
            let mut buf = Vec::with_capacity(8);
            encode::write_array_len(&mut buf, 0).map_err(Self::map_encode_err)?;
            return Ok(buf);
        }

        // Cache column types once
        let column_types: Vec<&Type> = rows[0].columns().iter().map(|col| col.type_()).collect();

        let estimated_size = Self::estimate_buffer_size(rows.len(), &column_types);
        let mut buffer = Vec::with_capacity(estimated_size);

        // Write array header for all rows
        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;

        // For smaller batches, encode sequentially (rayon overhead not worth it)
        if rows.len() < 1024 {
            for row in rows {
                Self::encode_row(&mut buffer, row, &column_types)?;
            }
        } else {
            // Parallel encode: split into chunks, encode separately, merge
            let chunk_size = 512;
            let chunks: Vec<&[Row]> = rows.chunks(chunk_size).collect();

            let encoded_chunks: Vec<Result<Vec<u8>>> = chunks
                .par_iter()
                .map(|chunk| {
                    let chunk_size = Self::estimate_buffer_size(chunk.len(), &column_types);
                    let mut chunk_buf = Vec::with_capacity(chunk_size);
                    for row in *chunk {
                        Self::encode_row(&mut chunk_buf, row, &column_types)?;
                    }
                    Ok(chunk_buf)
                })
                .collect();

            // Merge chunks (already in order due to par_iter preserving order)
            for chunk_result in encoded_chunks {
                buffer.extend(chunk_result?);
            }
        }

        Ok(buffer)
    }

    #[inline(always)]
    fn encode_row<W: Write>(buf: &mut W, row: &Row, column_types: &[&Type]) -> Result<()> {
        encode::write_array_len(buf, column_types.len() as u32).map_err(Self::map_encode_err)?;

        for (idx, pg_type) in column_types.iter().enumerate() {
            let raw: Option<RawValue> = row.try_get(idx)?;
            match raw {
                None => encode::write_nil(buf).map_err(Self::map_encode_err)?,
                Some(bytes) => Self::encode_value(buf, pg_type, bytes.0)?,
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn encode_value<W: Write>(buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
        match pg_type.kind() {
            Kind::Simple | Kind::Pseudo => Self::encode_simple(buf, pg_type, raw),
            Kind::Enum(_) => Self::encode_string_fast(buf, raw),
            Kind::Array(inner) => Self::encode_array(buf, inner, raw),
            Kind::Range(inner) => Self::encode_range(buf, inner, raw),
            Kind::Domain(inner) => Self::encode_value(buf, inner, raw),
            Kind::Composite(_fields) => Self::encode_complex_as_base64(buf, raw),
            _ => Self::encode_fallback(buf, raw),
        }
    }

    #[inline(always)]
    fn encode_uuid_zero_alloc<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
        let bytes = proto::uuid_from_sql(raw).map_err(Self::map_decode_err)?;
        let uuid = Uuid::from_bytes(bytes);

        let mut stack_buf = [0u8; 36];
        uuid.hyphenated().encode_lower(&mut stack_buf);

        encode::write_str_len(buf, 36).map_err(Self::map_encode_err)?;
        buf.write_all(&stack_buf).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    #[inline(always)]
    fn encode_timestamp_zero_alloc<W: Write>(buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
        let dt = NaiveDateTime::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;

        let mut stack_buf = [0u8; 32];
        let mut cursor = std::io::Cursor::new(&mut stack_buf[..]);

        use std::io::Write as IoWrite;
        write!(cursor, "{}", dt.and_utc().format("%Y-%m-%dT%H:%M:%S%.fZ"))
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let len = cursor.position() as usize;
        encode::write_str_len(buf, len as u32).map_err(Self::map_encode_err)?;
        buf.write_all(&stack_buf[..len]).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    #[inline(always)]
    fn encode_timestamptz_zero_alloc<W: Write>(buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
        let dt = DateTime::<Utc>::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;

        let mut stack_buf = [0u8; 40];
        let mut cursor = std::io::Cursor::new(&mut stack_buf[..]);

        use std::io::Write as IoWrite;
        write!(cursor, "{}", dt.format("%Y-%m-%dT%H:%M:%S%.fZ"))
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let len = cursor.position() as usize;
        encode::write_str_len(buf, len as u32).map_err(Self::map_encode_err)?;
        buf.write_all(&stack_buf[..len]).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    #[inline(always)]
    fn encode_date_zero_alloc<W: Write>(buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
        let d = NaiveDate::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;

        let mut stack_buf = [0u8; 16];
        let mut cursor = std::io::Cursor::new(&mut stack_buf[..]);

        use std::io::Write as IoWrite;
        write!(cursor, "{}", d.format("%Y-%m-%d"))
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let len = cursor.position() as usize;
        encode::write_str_len(buf, len as u32).map_err(Self::map_encode_err)?;
        buf.write_all(&stack_buf[..len]).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    #[inline(always)]
    fn encode_time_zero_alloc<W: Write>(buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
        let t = NaiveTime::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;

        let mut stack_buf = [0u8; 32];
        let mut cursor = std::io::Cursor::new(&mut stack_buf[..]);

        use std::io::Write as IoWrite;
        write!(cursor, "{}", t.format("%H:%M:%S%.f"))
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let len = cursor.position() as usize;
        encode::write_str_len(buf, len as u32).map_err(Self::map_encode_err)?;
        buf.write_all(&stack_buf[..len]).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    #[inline(always)]
    fn encode_inet_zero_alloc<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
        let inet = proto::inet_from_sql(raw).map_err(Self::map_decode_err)?;

        let mut stack_buf = [0u8; 64];
        let mut cursor = std::io::Cursor::new(&mut stack_buf[..]);

        use std::io::Write as IoWrite;
        write!(cursor, "{}/{}", inet.addr(), inet.netmask())
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let len = cursor.position() as usize;
        encode::write_str_len(buf, len as u32).map_err(Self::map_encode_err)?;
        buf.write_all(&stack_buf[..len]).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    #[inline(always)]
    fn encode_simple<W: Write>(buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
        match *pg_type {
            Type::BOOL => {
                let val = proto::bool_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_bool(buf, val).map_err(Self::map_encode_err)?;
            }
            Type::INT2 => {
                let val = proto::int2_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_sint(buf, val as i64).map_err(Self::map_encode_err)?;
            }
            Type::INT4 => {
                let val = proto::int4_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_sint(buf, val as i64).map_err(Self::map_encode_err)?;
            }
            Type::OID => {
                let val = proto::oid_from_sql(raw).map_err(Self::map_decode_err)? as u64;
                encode::write_uint(buf, val).map_err(Self::map_encode_err)?;
            }
            Type::INT8 => {
                let val = proto::int8_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_sint(buf, val).map_err(Self::map_encode_err)?;
            }
            Type::FLOAT4 => {
                let val = proto::float4_from_sql(raw).map_err(Self::map_decode_err)? as f64;
                encode::write_f64(buf, val).map_err(Self::map_encode_err)?;
            }
            Type::FLOAT8 => {
                let val = proto::float8_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_f64(buf, val).map_err(Self::map_encode_err)?;
            }
            Type::NUMERIC => {
                let decimal = Decimal::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;
                let s = decimal.to_string();
                encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            }
            Type::MONEY => {
                if raw.len() == 8 {
                    let mut bytes = [0u8; 8];
                    bytes.copy_from_slice(raw);
                    let cents = i64::from_be_bytes(bytes);
                    let formatted = format!("{:.2}", cents as f64 / 100.0);
                    encode::write_str(buf, &formatted).map_err(Self::map_encode_err)?;
                } else {
                    Self::encode_fallback(buf, raw)?;
                }
            }
            Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::CHAR | Type::UNKNOWN => {
                Self::encode_string_fast(buf, raw)?;
            }
            Type::UUID => {
                Self::encode_uuid_zero_alloc(buf, raw)?;
            }
            Type::BYTEA => {
                let encoded = BASE64_STANDARD.encode(raw);
                encode::write_str(buf, &encoded).map_err(Self::map_encode_err)?;
            }
            Type::JSON => {
                Self::encode_string(buf, raw)?;
            }
            Type::JSONB => {
                if raw.is_empty() {
                    encode::write_nil(buf).map_err(Self::map_encode_err)?;
                } else {
                    let payload = &raw[1..];
                    match std::str::from_utf8(payload) {
                        Ok(text) => encode::write_str(buf, text).map_err(Self::map_encode_err)?,
                        Err(_) => {
                            let encoded = BASE64_STANDARD.encode(payload);
                            encode::write_str(buf, &encoded).map_err(Self::map_encode_err)?;
                        }
                    }
                }
            }
            Type::TIMESTAMP => {
                Self::encode_timestamp_zero_alloc(buf, pg_type, raw)?;
            }
            Type::TIMESTAMPTZ => {
                Self::encode_timestamptz_zero_alloc(buf, pg_type, raw)?;
            }
            Type::DATE => {
                Self::encode_date_zero_alloc(buf, pg_type, raw)?;
            }
            Type::TIME => {
                Self::encode_time_zero_alloc(buf, pg_type, raw)?;
            }
            Type::INTERVAL => {
                if raw.len() == 16 {
                    let mut micros_bytes = [0u8; 8];
                    micros_bytes.copy_from_slice(&raw[..8]);
                    let microseconds = i64::from_be_bytes(micros_bytes);

                    let mut days_bytes = [0u8; 4];
                    days_bytes.copy_from_slice(&raw[8..12]);
                    let days = i32::from_be_bytes(days_bytes);

                    let mut months_bytes = [0u8; 4];
                    months_bytes.copy_from_slice(&raw[12..16]);
                    let months = i32::from_be_bytes(months_bytes);

                    encode::write_map_len(buf, 3).map_err(Self::map_encode_err)?;
                    encode::write_str(buf, "months").map_err(Self::map_encode_err)?;
                    encode::write_sint(buf, months as i64).map_err(Self::map_encode_err)?;
                    encode::write_str(buf, "days").map_err(Self::map_encode_err)?;
                    encode::write_sint(buf, days as i64).map_err(Self::map_encode_err)?;
                    encode::write_str(buf, "microseconds").map_err(Self::map_encode_err)?;
                    encode::write_sint(buf, microseconds).map_err(Self::map_encode_err)?;
                } else {
                    Self::encode_fallback(buf, raw)?;
                }
            }
            Type::INET | Type::CIDR => {
                Self::encode_inet_zero_alloc(buf, raw)?;
            }
            Type::MACADDR => Self::encode_macaddr(buf, raw, 6)?,
            Type::MACADDR8 => Self::encode_macaddr(buf, raw, 8)?,
            Type::POINT => {
                let point = proto::point_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_map_len(buf, 2).map_err(Self::map_encode_err)?;
                encode::write_str(buf, "x").map_err(Self::map_encode_err)?;
                encode::write_f64(buf, point.x()).map_err(Self::map_encode_err)?;
                encode::write_str(buf, "y").map_err(Self::map_encode_err)?;
                encode::write_f64(buf, point.y()).map_err(Self::map_encode_err)?;
            }
            _ => Self::encode_fallback(buf, raw)?,
        }
        Ok(())
    }

    #[inline(always)]
    fn encode_string_fast<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
        encode::write_str_len(buf, raw.len() as u32).map_err(Self::map_encode_err)?;
        buf.write_all(raw).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    #[inline(always)]
    fn encode_string<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
        match std::str::from_utf8(raw) {
            Ok(text) => encode::write_str(buf, text).map_err(Self::map_encode_err)?,
            Err(_) => {
                let encoded = BASE64_STANDARD.encode(raw);
                encode::write_str(buf, &encoded).map_err(Self::map_encode_err)?;
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn hex_digit(nibble: u8) -> u8 {
        if nibble < 10 {
            b'0' + nibble
        } else {
            b'a' + (nibble - 10)
        }
    }

    #[inline(always)]
    fn encode_macaddr<W: Write>(buf: &mut W, raw: &[u8], len: usize) -> Result<()> {
        if raw.len() != len {
            return Self::encode_fallback(buf, raw);
        }

        let mut stack_buf = [0u8; 23];
        let mut idx = 0usize;

        for (i, byte) in raw.iter().enumerate() {
            if i > 0 {
                stack_buf[idx] = b':';
                idx += 1;
            }

            let hi = byte >> 4;
            let lo = byte & 0x0f;
            stack_buf[idx] = Self::hex_digit(hi);
            idx += 1;
            stack_buf[idx] = Self::hex_digit(lo);
            idx += 1;
        }

        encode::write_str_len(buf, idx as u32).map_err(Self::map_encode_err)?;
        buf.write_all(&stack_buf[..idx]).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    fn encode_array<W: Write>(buf: &mut W, element_type: &Type, raw: &[u8]) -> Result<()> {
        let array = proto::array_from_sql(raw).map_err(Self::map_decode_err)?;

        // Count elements
        let mut vals_iter = array.values();
        let mut elements = Vec::new();
        while let Some(val) =
            fallible_iterator::FallibleIterator::next(&mut vals_iter).map_err(Self::map_decode_err)?
        {
            elements.push(val);
        }

        encode::write_array_len(buf, elements.len() as u32).map_err(Self::map_encode_err)?;

        for val in elements {
            if let Some(bytes) = val {
                Self::encode_value(buf, element_type, bytes)?;
            } else {
                encode::write_nil(buf).map_err(Self::map_encode_err)?;
            }
        }
        Ok(())
    }

    fn encode_range<W: Write>(buf: &mut W, element_type: &Type, raw: &[u8]) -> Result<()> {
        use proto::Range;

        match proto::range_from_sql(raw).map_err(Self::map_decode_err)? {
            Range::Empty => {
                encode::write_str(buf, "empty").map_err(Self::map_encode_err)?;
            }
            Range::Nonempty(lower, upper) => {
                let lower_fmt = Self::format_range_bound(element_type, lower, true)?;
                let upper_fmt = Self::format_range_bound(element_type, upper, false)?;
                let open = if lower_fmt.1 { '[' } else { '(' };
                let close = if upper_fmt.1 { ']' } else { ')' };
                let s = format!("{}{}, {}{}", open, lower_fmt.0, upper_fmt.0, close);
                encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            }
        }
        Ok(())
    }

    fn format_range_bound(
        element_type: &Type,
        bound: proto::RangeBound<Option<&[u8]>>,
        is_lower: bool,
    ) -> Result<(String, bool)> {
        use proto::RangeBound;

        match bound {
            RangeBound::Unbounded => Ok((
                if is_lower {
                    "-infinity".to_string()
                } else {
                    "infinity".to_string()
                },
                false,
            )),
            RangeBound::Inclusive(Some(bytes)) => {
                let mut temp_buf = Vec::new();
                Self::encode_value(&mut temp_buf, element_type, bytes)?;
                // For range display, we need string representation
                // Use a simple approach: encode to msgpack then extract
                Ok((Self::bytes_to_display(bytes, element_type)?, true))
            }
            RangeBound::Inclusive(None) => Ok(("NULL".to_string(), true)),
            RangeBound::Exclusive(Some(bytes)) => {
                Ok((Self::bytes_to_display(bytes, element_type)?, false))
            }
            RangeBound::Exclusive(None) => Ok(("NULL".to_string(), false)),
        }
    }

    fn bytes_to_display(bytes: &[u8], pg_type: &Type) -> Result<String> {
        // Simple numeric/string extraction for range bounds
        match *pg_type {
            Type::INT2 => {
                let val = proto::int2_from_sql(bytes).map_err(Self::map_decode_err)?;
                Ok(val.to_string())
            }
            Type::INT4 => {
                let val = proto::int4_from_sql(bytes).map_err(Self::map_decode_err)?;
                Ok(val.to_string())
            }
            Type::INT8 => {
                let val = proto::int8_from_sql(bytes).map_err(Self::map_decode_err)?;
                Ok(val.to_string())
            }
            Type::FLOAT4 => {
                let val = proto::float4_from_sql(bytes).map_err(Self::map_decode_err)?;
                Ok(val.to_string())
            }
            Type::FLOAT8 => {
                let val = proto::float8_from_sql(bytes).map_err(Self::map_decode_err)?;
                Ok(val.to_string())
            }
            Type::DATE => {
                let d = NaiveDate::from_sql(pg_type, bytes).map_err(Self::map_decode_err)?;
                Ok(d.format("%Y-%m-%d").to_string())
            }
            Type::TIMESTAMP => {
                let dt = NaiveDateTime::from_sql(pg_type, bytes).map_err(Self::map_decode_err)?;
                Ok(dt.and_utc().to_rfc3339())
            }
            Type::TIMESTAMPTZ => {
                let dt = DateTime::<Utc>::from_sql(pg_type, bytes).map_err(Self::map_decode_err)?;
                Ok(dt.to_rfc3339())
            }
            _ => match std::str::from_utf8(bytes) {
                Ok(s) => Ok(s.to_string()),
                Err(_) => Ok(format!("\\x{}", Self::to_hex(bytes))),
            },
        }
    }

    #[inline(always)]
    fn encode_complex_as_base64<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
        let encoded = BASE64_STANDARD.encode(raw);
        encode::write_str(buf, &encoded).map_err(Self::map_encode_err)?;
        Ok(())
    }

    #[inline(always)]
    fn encode_fallback<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
        match std::str::from_utf8(raw) {
            Ok(text) => encode::write_str(buf, text).map_err(Self::map_encode_err)?,
            Err(_) => {
                let hex = format!("\\x{}", Self::to_hex(raw));
                encode::write_str(buf, &hex).map_err(Self::map_encode_err)?;
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn to_hex(data: &[u8]) -> String {
        data.iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn map_decode_err<E: std::fmt::Display>(err: E) -> AppError {
        AppError::Internal(format!("PostgreSQL decode error: {}", err))
    }

    fn map_encode_err<E: std::fmt::Display>(err: E) -> AppError {
        AppError::Internal(format!("MessagePack encode error: {}", err))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_rows() {
        let rows: Vec<Row> = vec![];
        let result = FastMsgPackConverter::rows_to_msgpack(&rows).unwrap();
        // Should be a msgpack array of length 0
        assert!(!result.is_empty());
    }
}
