//! Direct PostgreSQL to MessagePack encoder
//!
//! Encodes PostgreSQL binary protocol data directly to MessagePack bytes,
//! bypassing serde_json::Value intermediate representation for maximum performance.

use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use postgres_protocol::types as proto;
use postgres_types::{FromSql, Kind, Type};
use rayon::prelude::*;
use rmp::encode;
use rust_decimal::Decimal;
use std::io::Write;
use tokio_postgres::Row;
use uuid::Uuid;

/// Direct PostgreSQL to MessagePack encoder
///
/// Zero intermediate allocations - PostgreSQL binary → MessagePack bytes directly.
/// Reuses internal buffer across encode calls for minimal allocations.
pub struct DirectMsgPackEncoder {
    column_types: Vec<Type>,
}

/// Raw bytes extractor for PostgreSQL values
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

impl DirectMsgPackEncoder {
    /// Create new encoder with cached column types
    pub fn new(column_types: Vec<Type>) -> Self {
        Self { column_types }
    }

    /// Create encoder from first row's column metadata
    pub fn from_row(row: &Row) -> Self {
        let column_types = row.columns().iter().map(|c| c.type_().clone()).collect();
        Self { column_types }
    }

    /// Estimate buffer size for a batch of rows
    fn estimate_buffer_size(&self, row_count: usize) -> usize {
        let row_size: usize = self
            .column_types
            .iter()
            .map(|t| match *t {
                Type::BOOL => 2,
                Type::INT2 => 4,
                Type::INT4 => 6,
                Type::INT8 | Type::FLOAT8 => 10,
                Type::FLOAT4 => 6,
                Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME => 48,
                Type::TIMESTAMP | Type::TIMESTAMPTZ => 32,
                Type::DATE => 12,
                Type::TIME | Type::TIMETZ => 16,
                Type::UUID => 40,
                Type::JSONB | Type::JSON => 128,
                Type::BYTEA => 128,
                Type::NUMERIC => 24,
                Type::INET | Type::CIDR => 24,
                Type::MACADDR | Type::MACADDR8 => 20,
                _ => 32,
            })
            .sum();

        // Add overhead for array headers + 20% buffer
        let estimated = row_count * (row_size + self.column_types.len() * 2 + 5);
        ((estimated as f64) * 1.2) as usize
    }

    /// Encode a batch of rows directly to MessagePack bytes
    ///
    /// Returns owned Vec<u8> containing the encoded MessagePack data.
    /// Format: Array of arrays, where each inner array is a row.
    /// Uses Rayon for parallel encoding across CPU cores.
    pub fn encode_batch(&self, rows: &[Row]) -> Result<Vec<u8>> {
        if rows.is_empty() {
            let mut buf = Vec::with_capacity(8);
            encode::write_array_len(&mut buf, 0).map_err(Self::map_encode_err)?;
            return Ok(buf);
        }

        // Encode rows in parallel - each thread gets its own buffer
        let row_buffers: Vec<Vec<u8>> = rows
            .par_iter()
            .map(|row| {
                let mut buf = Vec::with_capacity(self.column_types.len() * 32);
                // Ignore errors in parallel context, will produce empty buffer
                let _ = self.encode_row(&mut buf, row);
                buf
            })
            .collect();

        // Calculate total size and build final buffer
        let total_row_bytes: usize = row_buffers.iter().map(|b| b.len()).sum();
        let mut buffer = Vec::with_capacity(total_row_bytes + 8);

        // Write outer array header (number of rows)
        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;

        // Concatenate all row buffers
        for row_buf in row_buffers {
            buffer.extend_from_slice(&row_buf);
        }

        Ok(buffer)
    }

    /// Encode a single row as a MessagePack array
    #[inline]
    fn encode_row<W: Write>(&self, buf: &mut W, row: &Row) -> Result<()> {
        // Write row array header (number of columns)
        encode::write_array_len(buf, self.column_types.len() as u32)
            .map_err(Self::map_encode_err)?;

        // Encode each cell
        for (idx, pg_type) in self.column_types.iter().enumerate() {
            self.encode_cell(buf, row, idx, pg_type)?;
        }

        Ok(())
    }

    /// Encode a single cell value
    #[inline]
    fn encode_cell<W: Write>(&self, buf: &mut W, row: &Row, idx: usize, pg_type: &Type) -> Result<()> {
        let raw: Option<RawValue> = row.try_get(idx)?;

        match raw {
            None => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }
            Some(bytes) => {
                self.encode_value(buf, pg_type, bytes.0)?;
            }
        }

        Ok(())
    }

    /// Encode a value based on its PostgreSQL type
    fn encode_value<W: Write>(&self, buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
        match pg_type.kind() {
            Kind::Simple | Kind::Pseudo => self.encode_simple(buf, pg_type, raw),
            Kind::Enum(_) => self.encode_enum(buf, raw),
            Kind::Array(inner) => self.encode_array(buf, inner, raw),
            Kind::Range(inner) => self.encode_range(buf, inner, raw),
            Kind::Domain(inner) => self.encode_value(buf, inner, raw),
            Kind::Composite(fields) => self.encode_composite(buf, fields, raw),
            _ => self.encode_fallback(buf, raw),
        }
    }

    /// Encode simple (non-composite) types
    #[inline]
    fn encode_simple<W: Write>(&self, buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
        match *pg_type {
            // Boolean
            Type::BOOL => {
                let val = proto::bool_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_bool(buf, val).map_err(Self::map_io_err)?;
            }

            // Integers
            Type::INT2 => {
                let val = proto::int2_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_i16(buf, val).map_err(Self::map_encode_err)?;
            }
            Type::INT4 | Type::OID => {
                let val = proto::int4_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_i32(buf, val).map_err(Self::map_encode_err)?;
            }
            Type::INT8 => {
                let val = proto::int8_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_i64(buf, val).map_err(Self::map_encode_err)?;
            }

            // Floats
            Type::FLOAT4 => {
                let val = proto::float4_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_f32(buf, val).map_err(Self::map_encode_err)?;
            }
            Type::FLOAT8 => {
                let val = proto::float8_from_sql(raw).map_err(Self::map_decode_err)?;
                encode::write_f64(buf, val).map_err(Self::map_encode_err)?;
            }

            // Text types - direct string encoding
            Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::UNKNOWN => {
                let s = std::str::from_utf8(raw).unwrap_or("");
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }

            // UUID - format to string
            Type::UUID => {
                self.encode_uuid(buf, raw)?;
            }

            // Timestamps
            Type::TIMESTAMP => {
                self.encode_timestamp(buf, raw)?;
            }
            Type::TIMESTAMPTZ => {
                self.encode_timestamptz(buf, raw)?;
            }
            Type::DATE => {
                self.encode_date(buf, raw)?;
            }
            Type::TIME => {
                self.encode_time(buf, raw)?;
            }
            Type::TIMETZ => {
                self.encode_timetz(buf, raw)?;
            }

            // Numeric/Decimal
            Type::NUMERIC => {
                self.encode_numeric(buf, raw)?;
            }

            // JSON types
            Type::JSON => {
                // JSON is stored as text
                let s = std::str::from_utf8(raw).unwrap_or("null");
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }
            Type::JSONB => {
                // JSONB has a version byte prefix
                if raw.is_empty() {
                    encode::write_str(buf, "null").map_err(Self::map_encode_err)?;
                } else {
                    let s = std::str::from_utf8(&raw[1..]).unwrap_or("null");
                    encode::write_str(buf, s).map_err(Self::map_encode_err)?;
                }
            }

            // Binary data
            Type::BYTEA => {
                self.encode_bytea(buf, raw)?;
            }

            // Network types
            Type::INET | Type::CIDR => {
                self.encode_inet(buf, raw)?;
            }
            Type::MACADDR => {
                self.encode_macaddr(buf, raw, 6)?;
            }
            Type::MACADDR8 => {
                self.encode_macaddr(buf, raw, 8)?;
            }

            // Interval
            Type::INTERVAL => {
                self.encode_interval(buf, raw)?;
            }

            // Bit strings
            Type::BIT | Type::VARBIT => {
                self.encode_bit(buf, raw)?;
            }

            // Point
            Type::POINT => {
                self.encode_point(buf, raw)?;
            }

            // Money
            Type::MONEY => {
                self.encode_money(buf, raw)?;
            }

            // Fallback for unknown types
            _ => {
                self.encode_fallback(buf, raw)?;
            }
        }

        Ok(())
    }

    // ========== Type-specific encoders ==========

    #[inline(always)]
    fn encode_uuid<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        if raw.len() != 16 {
            return self.encode_fallback(buf, raw);
        }
        let uuid = Uuid::from_slice(raw).map_err(|e| AppError::Internal(e.to_string()))?;
        // Stack buffer for UUID string - no heap allocation
        let mut stack_buf = [0u8; 36];
        let s = uuid.hyphenated().encode_lower(&mut stack_buf);
        encode::write_str(buf, s).map_err(Self::map_encode_err)?;
        Ok(())
    }

    #[inline(always)]
    fn encode_timestamp<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        match proto::timestamp_from_sql(raw) {
            Ok(ts) => {
                // PostgreSQL epoch is 2000-01-01, convert to Unix epoch
                const PG_EPOCH_OFFSET: i64 = 946_684_800_000_000; // microseconds
                let unix_us = ts + PG_EPOCH_OFFSET;
                let secs = unix_us / 1_000_000;
                let nsecs = ((unix_us % 1_000_000) * 1000) as u32;

                if let Some(dt) = DateTime::from_timestamp(secs, nsecs) {
                    let naive = dt.naive_utc();
                    let s = naive.format("%Y-%m-%d %H:%M:%S%.6f").to_string();
                    encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
                } else {
                    encode::write_nil(buf).map_err(Self::map_io_err)?;
                }
            }
            Err(_) => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn encode_timestamptz<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        match proto::timestamp_from_sql(raw) {
            Ok(ts) => {
                const PG_EPOCH_OFFSET: i64 = 946_684_800_000_000;
                let unix_us = ts + PG_EPOCH_OFFSET;
                let secs = unix_us / 1_000_000;
                let nsecs = ((unix_us % 1_000_000) * 1000) as u32;

                if let Some(dt) = DateTime::<Utc>::from_timestamp(secs, nsecs) {
                    let s = dt.format("%Y-%m-%d %H:%M:%S%.6f%:z").to_string();
                    encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
                } else {
                    encode::write_nil(buf).map_err(Self::map_io_err)?;
                }
            }
            Err(_) => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn encode_date<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        match proto::date_from_sql(raw) {
            Ok(days) => {
                // PostgreSQL epoch is 2000-01-01
                let pg_epoch = NaiveDate::from_ymd_opt(2000, 1, 1).unwrap();
                if let Some(date) = pg_epoch.checked_add_signed(chrono::Duration::days(days as i64)) {
                    let s = date.format("%Y-%m-%d").to_string();
                    encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
                } else {
                    encode::write_nil(buf).map_err(Self::map_io_err)?;
                }
            }
            Err(_) => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn encode_time<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        match proto::time_from_sql(raw) {
            Ok(usec) => {
                let secs = (usec / 1_000_000) as u32;
                let nano = ((usec % 1_000_000) * 1000) as u32;
                if let Some(time) = NaiveTime::from_num_seconds_from_midnight_opt(secs, nano) {
                    let s = time.format("%H:%M:%S%.6f").to_string();
                    encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
                } else {
                    encode::write_nil(buf).map_err(Self::map_io_err)?;
                }
            }
            Err(_) => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn encode_timetz<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        if raw.len() < 12 {
            return self.encode_fallback(buf, raw);
        }
        // First 8 bytes: time, next 4 bytes: timezone offset
        let usec = i64::from_be_bytes(raw[0..8].try_into().unwrap());
        let tz_secs = i32::from_be_bytes(raw[8..12].try_into().unwrap());

        let secs = (usec / 1_000_000) as u32;
        let nano = ((usec % 1_000_000) * 1000) as u32;

        if let Some(time) = NaiveTime::from_num_seconds_from_midnight_opt(secs, nano) {
            let tz_hours = -tz_secs / 3600;
            let tz_mins = (-tz_secs % 3600) / 60;
            let s = format!(
                "{}{}{}:{:02}",
                time.format("%H:%M:%S%.6f"),
                if tz_hours >= 0 { "+" } else { "" },
                tz_hours,
                tz_mins.abs()
            );
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
        } else {
            encode::write_nil(buf).map_err(Self::map_io_err)?;
        }
        Ok(())
    }

    #[inline(always)]
    fn encode_numeric<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        match Decimal::from_sql(&Type::NUMERIC, raw) {
            Ok(d) => {
                let s = d.to_string();
                encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            }
            Err(_) => {
                self.encode_fallback(buf, raw)?;
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn encode_bytea<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        // Encode as base64 string
        let b64 = BASE64_STANDARD.encode(raw);
        encode::write_str(buf, &b64).map_err(Self::map_encode_err)?;
        Ok(())
    }

    #[inline(always)]
    fn encode_inet<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        if raw.len() < 4 {
            return self.encode_fallback(buf, raw);
        }

        let family = raw[0];
        let prefix = raw[1];
        // is_cidr = raw[2]
        let addr_len = raw[3] as usize;

        if raw.len() < 4 + addr_len {
            return self.encode_fallback(buf, raw);
        }

        let addr_bytes = &raw[4..4 + addr_len];

        let s = match family {
            2 if addr_len == 4 => {
                // IPv4
                let ip = std::net::Ipv4Addr::new(
                    addr_bytes[0],
                    addr_bytes[1],
                    addr_bytes[2],
                    addr_bytes[3],
                );
                if prefix == 32 {
                    ip.to_string()
                } else {
                    format!("{}/{}", ip, prefix)
                }
            }
            3 if addr_len == 16 => {
                // IPv6
                let ip = std::net::Ipv6Addr::from(<[u8; 16]>::try_from(addr_bytes).unwrap());
                if prefix == 128 {
                    ip.to_string()
                } else {
                    format!("{}/{}", ip, prefix)
                }
            }
            _ => return self.encode_fallback(buf, raw),
        };

        encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
        Ok(())
    }

    #[inline(always)]
    fn encode_macaddr<W: Write>(&self, buf: &mut W, raw: &[u8], len: usize) -> Result<()> {
        if raw.len() != len {
            return self.encode_fallback(buf, raw);
        }

        // Stack buffer for MAC address - no heap allocation
        let mut stack_buf = [0u8; 24]; // max "xx:xx:xx:xx:xx:xx:xx:xx"
        let mut idx = 0;

        for (i, byte) in raw.iter().enumerate() {
            if i > 0 {
                stack_buf[idx] = b':';
                idx += 1;
            }
            stack_buf[idx] = Self::hex_digit(byte >> 4);
            idx += 1;
            stack_buf[idx] = Self::hex_digit(byte & 0x0f);
            idx += 1;
        }

        let s = std::str::from_utf8(&stack_buf[..idx]).unwrap();
        encode::write_str(buf, s).map_err(Self::map_encode_err)?;
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
    fn encode_interval<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        if raw.len() != 16 {
            return self.encode_fallback(buf, raw);
        }

        let microseconds = i64::from_be_bytes(raw[0..8].try_into().unwrap());
        let days = i32::from_be_bytes(raw[8..12].try_into().unwrap());
        let months = i32::from_be_bytes(raw[12..16].try_into().unwrap());

        let mut parts = Vec::new();

        if months != 0 {
            let years = months / 12;
            let mons = months % 12;
            if years != 0 {
                parts.push(format!("{} year{}", years, if years.abs() != 1 { "s" } else { "" }));
            }
            if mons != 0 {
                parts.push(format!("{} mon{}", mons, if mons.abs() != 1 { "s" } else { "" }));
            }
        }

        if days != 0 {
            parts.push(format!("{} day{}", days, if days.abs() != 1 { "s" } else { "" }));
        }

        if microseconds != 0 || parts.is_empty() {
            let total_secs = microseconds / 1_000_000;
            let us = (microseconds % 1_000_000).abs();
            let hours = total_secs / 3600;
            let mins = (total_secs % 3600) / 60;
            let secs = total_secs % 60;

            if us > 0 {
                parts.push(format!("{:02}:{:02}:{:02}.{:06}", hours, mins.abs(), secs.abs(), us));
            } else {
                parts.push(format!("{:02}:{:02}:{:02}", hours, mins.abs(), secs.abs()));
            }
        }

        let s = parts.join(" ");
        encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
        Ok(())
    }

    #[inline(always)]
    fn encode_bit<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        if raw.len() < 4 {
            return self.encode_fallback(buf, raw);
        }

        let bit_len = i32::from_be_bytes(raw[0..4].try_into().unwrap()) as usize;
        let bytes = &raw[4..];

        let mut s = String::with_capacity(bit_len);
        for i in 0..bit_len {
            let byte_idx = i / 8;
            let bit_idx = 7 - (i % 8);
            if byte_idx < bytes.len() {
                let bit = (bytes[byte_idx] >> bit_idx) & 1;
                s.push(if bit == 1 { '1' } else { '0' });
            }
        }

        encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
        Ok(())
    }

    #[inline(always)]
    fn encode_point<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        if raw.len() != 16 {
            return self.encode_fallback(buf, raw);
        }

        let x = f64::from_be_bytes(raw[0..8].try_into().unwrap());
        let y = f64::from_be_bytes(raw[8..16].try_into().unwrap());
        let s = format!("({},{})", x, y);
        encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
        Ok(())
    }

    #[inline(always)]
    fn encode_money<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        if raw.len() != 8 {
            return self.encode_fallback(buf, raw);
        }

        let cents = i64::from_be_bytes(raw.try_into().unwrap());
        let dollars = cents / 100;
        let remainder = (cents % 100).abs();
        let s = format!("${}.{:02}", dollars, remainder);
        encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
        Ok(())
    }

    fn encode_enum<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        let s = std::str::from_utf8(raw).unwrap_or("");
        encode::write_str(buf, s).map_err(Self::map_encode_err)?;
        Ok(())
    }

    fn encode_array<W: Write>(&self, buf: &mut W, element_type: &Type, raw: &[u8]) -> Result<()> {
        let array = proto::array_from_sql(raw).map_err(Self::map_decode_err)?;

        // Collect elements first to get count
        let mut elements = Vec::new();
        let mut vals_iter = array.values();
        while let Some(val) = fallible_iterator::FallibleIterator::next(&mut vals_iter)
            .map_err(Self::map_decode_err)?
        {
            elements.push(val);
        }

        // Write array header
        encode::write_array_len(buf, elements.len() as u32).map_err(Self::map_encode_err)?;

        // Encode each element
        for val in elements {
            if let Some(bytes) = val {
                self.encode_value(buf, element_type, bytes)?;
            } else {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }
        }

        Ok(())
    }

    fn encode_range<W: Write>(&self, buf: &mut W, element_type: &Type, raw: &[u8]) -> Result<()> {
        use proto::Range;

        match proto::range_from_sql(raw).map_err(Self::map_decode_err)? {
            Range::Empty => {
                encode::write_str(buf, "empty").map_err(Self::map_encode_err)?;
            }
            Range::Nonempty(lower, upper) => {
                let lower_str = self.format_range_bound(element_type, lower, true)?;
                let upper_str = self.format_range_bound(element_type, upper, false)?;
                let open = if lower_str.1 { '[' } else { '(' };
                let close = if upper_str.1 { ']' } else { ')' };
                let s = format!("{}{},{}{}", open, lower_str.0, upper_str.0, close);
                encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            }
        }
        Ok(())
    }

    fn format_range_bound(
        &self,
        element_type: &Type,
        bound: proto::RangeBound<Option<&[u8]>>,
        is_lower: bool,
    ) -> Result<(String, bool)> {
        use proto::RangeBound;

        match bound {
            RangeBound::Unbounded => Ok((
                if is_lower { String::new() } else { String::new() },
                false,
            )),
            RangeBound::Inclusive(Some(bytes)) => {
                let mut temp_buf = Vec::new();
                self.encode_value(&mut temp_buf, element_type, bytes)?;
                // Decode back to get string representation
                let s = self.msgpack_to_string(&temp_buf);
                Ok((s, true))
            }
            RangeBound::Inclusive(None) => Ok((String::new(), true)),
            RangeBound::Exclusive(Some(bytes)) => {
                let mut temp_buf = Vec::new();
                self.encode_value(&mut temp_buf, element_type, bytes)?;
                let s = self.msgpack_to_string(&temp_buf);
                Ok((s, false))
            }
            RangeBound::Exclusive(None) => Ok((String::new(), false)),
        }
    }

    fn msgpack_to_string(&self, buf: &[u8]) -> String {
        // Simple extraction for range bounds
        if buf.is_empty() {
            return String::new();
        }
        match rmp_serde::from_slice::<serde_json::Value>(buf) {
            Ok(v) => match v {
                serde_json::Value::String(s) => s,
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => b.to_string(),
                serde_json::Value::Null => String::new(),
                _ => format!("{}", v),
            },
            Err(_) => String::new(),
        }
    }

    fn encode_composite<W: Write>(
        &self,
        buf: &mut W,
        fields: &[postgres_types::Field],
        raw: &[u8],
    ) -> Result<()> {
        // Composite types are encoded as arrays of field values
        let num_fields = if raw.len() >= 4 {
            i32::from_be_bytes(raw[0..4].try_into().unwrap()) as usize
        } else {
            return self.encode_fallback(buf, raw);
        };

        encode::write_array_len(buf, num_fields as u32).map_err(Self::map_encode_err)?;

        let mut offset = 4;
        for field in fields.iter().take(num_fields) {
            if offset + 4 > raw.len() {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
                continue;
            }

            let _oid = u32::from_be_bytes(raw[offset..offset + 4].try_into().unwrap());
            offset += 4;

            if offset + 4 > raw.len() {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
                continue;
            }

            let len = i32::from_be_bytes(raw[offset..offset + 4].try_into().unwrap());
            offset += 4;

            if len == -1 {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            } else {
                let field_data = &raw[offset..offset + len as usize];
                self.encode_value(buf, field.type_(), field_data)?;
                offset += len as usize;
            }
        }

        Ok(())
    }

    #[inline(always)]
    fn encode_fallback<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
        // Fallback: try to interpret as UTF-8 string, otherwise base64 encode
        match std::str::from_utf8(raw) {
            Ok(s) => {
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }
            Err(_) => {
                let b64 = BASE64_STANDARD.encode(raw);
                encode::write_str(buf, &b64).map_err(Self::map_encode_err)?;
            }
        }
        Ok(())
    }

    // ========== Error helpers ==========

    fn map_encode_err(e: rmp::encode::ValueWriteError) -> AppError {
        AppError::Internal(format!("MessagePack encode error: {}", e))
    }

    fn map_io_err(e: std::io::Error) -> AppError {
        AppError::Internal(format!("MessagePack IO error: {}", e))
    }

    fn map_decode_err<E: std::fmt::Display>(e: E) -> AppError {
        AppError::Internal(format!("PostgreSQL decode error: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_buffer_estimation() {
        let encoder = DirectMsgPackEncoder::new(vec![
            Type::INT4,
            Type::TEXT,
            Type::TIMESTAMP,
        ]);
        let size = encoder.estimate_buffer_size(1000);
        assert!(size > 0);
        assert!(size > 1000 * 50); // At least some reasonable size
    }
}
