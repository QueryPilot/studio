//! Direct MessagePack Serializer for PostgreSQL Rows
//!
//! This module provides zero-allocation serialization from PostgreSQL rows
//! directly to MessagePack (or any serde format), bypassing the intermediate
//! `serde_json::Value` allocation tree used in `fast_converter.rs`.
//!
//! ## Performance Improvement
//!
//! The previous approach had two serialization steps:
//! 1. PostgreSQL `Row` → `Vec<Vec<serde_json::Value>>` (heap allocations)
//! 2. `Vec<Vec<serde_json::Value>>` → MessagePack bytes
//!
//! This module combines both into a single step:
//! 1. PostgreSQL `Row` → MessagePack bytes (direct serialization)
//!
//! This reduces memory churn significantly during large queries.

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use postgres_protocol::types as proto;
use postgres_types::{FromSql, Kind, Type};
use rust_decimal::Decimal;
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};
use tokio_postgres::Row;
use uuid::Uuid;

/// A wrapper around a slice of PostgreSQL rows that implements `Serialize`.
/// This allows direct serialization to any serde-compatible format (MessagePack, JSON, etc.)
/// without creating intermediate data structures.
pub struct SerializableRows<'a> {
    rows: &'a [Row],
    column_types: Vec<&'a Type>,
}

impl<'a> SerializableRows<'a> {
    /// Create a new serializable wrapper around rows.
    /// Caches column types once for efficient batch processing.
    pub fn new(rows: &'a [Row]) -> Self {
        let column_types = if rows.is_empty() {
            Vec::new()
        } else {
            rows[0].columns().iter().map(|col| col.type_()).collect()
        };
        Self { rows, column_types }
    }
}

impl Serialize for SerializableRows<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_seq(Some(self.rows.len()))?;
        for row in self.rows {
            seq.serialize_element(&SerializableRow {
                row,
                column_types: &self.column_types,
            })?;
        }
        seq.end()
    }
}

/// A wrapper around a single PostgreSQL row that implements `Serialize`.
struct SerializableRow<'a> {
    row: &'a Row,
    column_types: &'a [&'a Type],
}

impl Serialize for SerializableRow<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_seq(Some(self.column_types.len()))?;
        for (idx, pg_type) in self.column_types.iter().enumerate() {
            seq.serialize_element(&SerializableCell {
                row: self.row,
                idx,
                pg_type,
            })?;
        }
        seq.end()
    }
}

/// A wrapper around a single cell that implements `Serialize`.
struct SerializableCell<'a> {
    row: &'a Row,
    idx: usize,
    pg_type: &'a Type,
}

// Helper to get raw bytes from a row without allocating
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

impl Serialize for SerializableCell<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let raw: Option<RawValue> = self.row.try_get(self.idx).map_err(serde::ser::Error::custom)?;

        match raw {
            None => serializer.serialize_none(),
            Some(bytes) => serialize_value(self.pg_type, bytes.0, serializer),
        }
    }
}

/// Serialize a PostgreSQL value directly to the serde output.
fn serialize_value<S>(pg_type: &Type, raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match pg_type.kind() {
        Kind::Simple | Kind::Pseudo => serialize_simple(pg_type, raw, serializer),
        Kind::Enum(_) => serialize_text(raw, serializer),
        Kind::Array(inner) => serialize_array(inner, raw, serializer),
        Kind::Range(inner) => serialize_range(inner, raw, serializer),
        Kind::Multirange(inner) => serialize_multirange(inner, raw, serializer),
        Kind::Domain(inner) => serialize_value(inner, raw, serializer),
        Kind::Composite(fields) => serialize_composite(fields, raw, serializer),
        _ => serialize_fallback(raw, serializer),
    }
}

fn serialize_simple<S>(pg_type: &Type, raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match *pg_type {
        Type::BOOL => {
            let val = proto::bool_from_sql(raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_bool(val)
        }
        Type::INT2 => {
            let val = proto::int2_from_sql(raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_i16(val)
        }
        Type::INT4 => {
            let val = proto::int4_from_sql(raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_i32(val)
        }
        Type::OID => {
            let val = proto::oid_from_sql(raw).map_err(serde::ser::Error::custom)? as u64;
            serializer.serialize_u64(val)
        }
        Type::INT8 => {
            let val = proto::int8_from_sql(raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_i64(val)
        }
        Type::FLOAT4 => {
            let val = proto::float4_from_sql(raw).map_err(serde::ser::Error::custom)? as f64;
            serializer.serialize_f64(val)
        }
        Type::FLOAT8 => {
            let val = proto::float8_from_sql(raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_f64(val)
        }
        Type::NUMERIC => serialize_numeric(pg_type, raw, serializer),
        Type::MONEY => serialize_money(raw, serializer),
        Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::CHAR | Type::UNKNOWN => {
            serialize_text(raw, serializer)
        }
        Type::UUID => {
            let bytes = proto::uuid_from_sql(raw).map_err(serde::ser::Error::custom)?;
            let uuid_str = Uuid::from_bytes(bytes).to_string();
            serializer.serialize_str(&uuid_str)
        }
        Type::BYTEA => {
            let encoded = BASE64_STANDARD.encode(raw);
            serializer.serialize_str(&encoded)
        }
        Type::JSON => serialize_json_text(raw, serializer),
        Type::JSONB => serialize_jsonb(raw, serializer),
        Type::XML => serialize_text(raw, serializer),
        Type::TIMESTAMP => {
            let dt = NaiveDateTime::from_sql(pg_type, raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_str(&dt.and_utc().to_rfc3339())
        }
        Type::TIMESTAMPTZ => {
            let dt = DateTime::<Utc>::from_sql(pg_type, raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_str(&dt.to_rfc3339())
        }
        Type::DATE => {
            let d = NaiveDate::from_sql(pg_type, raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_str(&d.format("%Y-%m-%d").to_string())
        }
        Type::TIME => {
            let t = NaiveTime::from_sql(pg_type, raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_str(&t.format("%H:%M:%S%.f").to_string())
        }
        Type::TIMETZ => {
            let formatted = format_timetz(raw).map_err(serde::ser::Error::custom)?;
            serializer.serialize_str(&formatted)
        }
        Type::INTERVAL => serialize_interval(raw, serializer),
        Type::BIT | Type::VARBIT => serialize_bit_string(raw, serializer),
        Type::INET | Type::CIDR => serialize_inet(raw, serializer),
        Type::MACADDR => serialize_macaddr(raw, 6, serializer),
        Type::MACADDR8 => serialize_macaddr(raw, 8, serializer),
        Type::PG_LSN => serialize_lsn(raw, serializer),
        Type::TS_VECTOR | Type::TSQUERY => serialize_text(raw, serializer),
        Type::POINT => serialize_point(raw, serializer),
        Type::BOX => serialize_box(raw, serializer),
        Type::CIRCLE => serialize_circle(raw, serializer),
        Type::LINE => serialize_line(raw, serializer),
        Type::PATH => serialize_path(raw, serializer),
        Type::POLYGON => serialize_polygon(raw, serializer),
        _ => match pg_type.name() {
            "hstore" => serialize_hstore(raw, serializer),
            "ltree" | "lquery" | "ltxtquery" => serialize_text(raw, serializer),
            _ => serialize_fallback(raw, serializer),
        },
    }
}

fn serialize_text<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match std::str::from_utf8(raw) {
        Ok(text) => serializer.serialize_str(text),
        Err(_) => serializer.serialize_str(&BASE64_STANDARD.encode(raw)),
    }
}

fn serialize_numeric<S>(pg_type: &Type, raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let decimal = Decimal::from_sql(pg_type, raw).map_err(serde::ser::Error::custom)?;
    serializer.serialize_str(&decimal.to_string())
}

fn serialize_money<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if raw.len() == 8 {
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(raw);
        let cents = i64::from_be_bytes(bytes);
        let formatted = format!("{:.2}", cents as f64 / 100.0);
        serializer.serialize_str(&formatted)
    } else {
        serialize_fallback(raw, serializer)
    }
}

fn serialize_json_text<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let text = std::str::from_utf8(raw).map_err(serde::ser::Error::custom)?;
    serializer.serialize_str(text)
}

fn serialize_jsonb<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if raw.is_empty() {
        return serializer.serialize_none();
    }
    let payload = &raw[1..]; // Skip version byte

    match serde_json::from_slice::<serde_json::Value>(payload) {
        Ok(json_val) => match serde_json::to_string(&json_val) {
            Ok(compact_str) => serializer.serialize_str(&compact_str),
            Err(_) => serializer.serialize_str(&BASE64_STANDARD.encode(payload)),
        },
        Err(_) => serializer.serialize_str(&BASE64_STANDARD.encode(payload)),
    }
}

fn serialize_array<S>(element_type: &Type, raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let array = proto::array_from_sql(raw).map_err(serde::ser::Error::custom)?;

    // Collect values first (we need to know the count)
    let mut values = Vec::new();
    let mut vals_iter = array.values();
    while let Some(val) =
        fallible_iterator::FallibleIterator::next(&mut vals_iter).map_err(serde::ser::Error::custom)?
    {
        values.push(val);
    }

    let mut seq = serializer.serialize_seq(Some(values.len()))?;
    for val in values {
        if let Some(bytes) = val {
            seq.serialize_element(&ArrayElement {
                element_type,
                bytes,
            })?;
        } else {
            seq.serialize_element(&None::<()>)?;
        }
    }
    seq.end()
}

struct ArrayElement<'a> {
    element_type: &'a Type,
    bytes: &'a [u8],
}

impl Serialize for ArrayElement<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serialize_value(self.element_type, self.bytes, serializer)
    }
}

fn serialize_range<S>(element_type: &Type, raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    use proto::Range;

    let range = proto::range_from_sql(raw).map_err(serde::ser::Error::custom)?;
    match range {
        Range::Empty => serializer.serialize_str("empty"),
        Range::Nonempty(lower, upper) => {
            let lower_str = format_range_bound(element_type, lower, true)
                .map_err(serde::ser::Error::custom)?;
            let upper_str = format_range_bound(element_type, upper, false)
                .map_err(serde::ser::Error::custom)?;
            let open = if lower_str.1 { '[' } else { '(' };
            let close = if upper_str.1 { ']' } else { ')' };
            let formatted = format!("{}{}, {}{}", open, lower_str.0, upper_str.0, close);
            serializer.serialize_str(&formatted)
        }
    }
}

fn format_range_bound(
    element_type: &Type,
    bound: proto::RangeBound<Option<&[u8]>>,
    is_lower: bool,
) -> Result<(String, bool), String> {
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
            let val = value_to_string(element_type, bytes)?;
            Ok((val, true))
        }
        RangeBound::Inclusive(None) => Ok(("NULL".to_string(), true)),
        RangeBound::Exclusive(Some(bytes)) => {
            let val = value_to_string(element_type, bytes)?;
            Ok((val, false))
        }
        RangeBound::Exclusive(None) => Ok(("NULL".to_string(), false)),
    }
}

fn value_to_string(pg_type: &Type, raw: &[u8]) -> Result<String, String> {
    // For range bounds, we just need a string representation
    match *pg_type {
        Type::INT2 => Ok(proto::int2_from_sql(raw)
            .map_err(|e| e.to_string())?
            .to_string()),
        Type::INT4 => Ok(proto::int4_from_sql(raw)
            .map_err(|e| e.to_string())?
            .to_string()),
        Type::INT8 => Ok(proto::int8_from_sql(raw)
            .map_err(|e| e.to_string())?
            .to_string()),
        Type::FLOAT4 => Ok((proto::float4_from_sql(raw).map_err(|e| e.to_string())? as f64).to_string()),
        Type::FLOAT8 => Ok(proto::float8_from_sql(raw)
            .map_err(|e| e.to_string())?
            .to_string()),
        Type::TIMESTAMP => {
            let dt = NaiveDateTime::from_sql(pg_type, raw).map_err(|e| e.to_string())?;
            Ok(dt.and_utc().to_rfc3339())
        }
        Type::TIMESTAMPTZ => {
            let dt = DateTime::<Utc>::from_sql(pg_type, raw).map_err(|e| e.to_string())?;
            Ok(dt.to_rfc3339())
        }
        Type::DATE => {
            let d = NaiveDate::from_sql(pg_type, raw).map_err(|e| e.to_string())?;
            Ok(d.format("%Y-%m-%d").to_string())
        }
        _ => std::str::from_utf8(raw)
            .map(|s| s.to_string())
            .map_err(|e| e.to_string()),
    }
}

fn serialize_multirange<S>(
    element_type: &Type,
    raw: &[u8],
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if raw.len() < 4 {
        return Err(serde::ser::Error::custom("invalid multirange length"));
    }

    let mut cursor = raw;
    let count = read_i32(&mut cursor).map_err(serde::ser::Error::custom)? as usize;

    let mut seq = serializer.serialize_seq(Some(count))?;
    for _ in 0..count {
        let len = read_i32(&mut cursor).map_err(serde::ser::Error::custom)?;
        if len < 0 {
            seq.serialize_element(&None::<()>)?;
            continue;
        }
        let len = len as usize;
        if cursor.len() < len {
            return Err(serde::ser::Error::custom("invalid multirange slice"));
        }
        let (range_bytes, rest) = cursor.split_at(len);
        cursor = rest;
        seq.serialize_element(&RangeElement {
            element_type,
            bytes: range_bytes,
        })?;
    }
    seq.end()
}

struct RangeElement<'a> {
    element_type: &'a Type,
    bytes: &'a [u8],
}

impl Serialize for RangeElement<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serialize_range(self.element_type, self.bytes, serializer)
    }
}

fn serialize_composite<S>(
    fields: &[postgres_types::Field],
    raw: &[u8],
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut cursor = raw;
    let field_count = read_i32(&mut cursor).map_err(serde::ser::Error::custom)?;
    if field_count < 0 {
        return Err(serde::ser::Error::custom("negative field count"));
    }

    let mut map = serializer.serialize_map(Some(field_count as usize))?;

    for index in 0..(field_count as usize) {
        let type_oid = read_i32(&mut cursor).map_err(serde::ser::Error::custom)? as u32;
        let len = read_i32(&mut cursor).map_err(serde::ser::Error::custom)?;

        let field_info = fields.get(index);
        let field_name = field_info
            .map(|f| f.name().to_string())
            .unwrap_or_else(|| format!("field_{}", index));

        let field_type = field_info
            .map(|f| f.type_().clone())
            .or_else(|| Type::from_oid(type_oid))
            .unwrap_or(Type::UNKNOWN);

        if len < 0 {
            map.serialize_entry(&field_name, &None::<()>)?;
        } else {
            let len = len as usize;
            if cursor.len() < len {
                return Err(serde::ser::Error::custom("composite field length exceeds buffer"));
            }
            let (value, rest) = cursor.split_at(len);
            cursor = rest;
            map.serialize_entry(
                &field_name,
                &CompositeField {
                    field_type: &field_type,
                    bytes: value,
                },
            )?;
        }
    }
    map.end()
}

struct CompositeField<'a> {
    field_type: &'a Type,
    bytes: &'a [u8],
}

impl Serialize for CompositeField<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serialize_value(self.field_type, self.bytes, serializer)
    }
}

fn format_timetz(raw: &[u8]) -> Result<String, &'static str> {
    if raw.len() != 12 {
        return Err("invalid timetz length");
    }

    let mut time_bytes = [0u8; 8];
    time_bytes.copy_from_slice(&raw[..8]);
    let microseconds = i64::from_be_bytes(time_bytes);

    let seconds = (microseconds / 1_000_000) as i64;
    let micros = (microseconds % 1_000_000) as i64;
    let nanos = (micros * 1_000) as u32;
    let seconds_u32 = if seconds >= 0 {
        seconds as u32
    } else {
        return Err("negative timetz seconds");
    };

    let time = NaiveTime::from_num_seconds_from_midnight_opt(seconds_u32, nanos)
        .ok_or("invalid timetz value")?;

    let mut tz_bytes = [0u8; 4];
    tz_bytes.copy_from_slice(&raw[8..12]);
    let offset_west = i32::from_be_bytes(tz_bytes);
    let offset = -offset_west;
    let sign = if offset >= 0 { '+' } else { '-' };
    let offset_abs = offset.abs();
    let hours = offset_abs / 3600;
    let minutes = (offset_abs % 3600) / 60;

    Ok(format!(
        "{}{}{:02}:{:02}",
        time.format("%H:%M:%S%.f"),
        sign,
        hours,
        minutes
    ))
}

fn serialize_interval<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if raw.len() != 16 {
        return serialize_fallback(raw, serializer);
    }

    let mut micros_bytes = [0u8; 8];
    micros_bytes.copy_from_slice(&raw[..8]);
    let microseconds = i64::from_be_bytes(micros_bytes);

    let mut days_bytes = [0u8; 4];
    days_bytes.copy_from_slice(&raw[8..12]);
    let days = i32::from_be_bytes(days_bytes);

    let mut months_bytes = [0u8; 4];
    months_bytes.copy_from_slice(&raw[12..16]);
    let months = i32::from_be_bytes(months_bytes);

    let mut map = serializer.serialize_map(Some(3))?;
    map.serialize_entry("months", &months)?;
    map.serialize_entry("days", &days)?;
    map.serialize_entry("microseconds", &microseconds)?;
    map.end()
}

fn serialize_point<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let point = proto::point_from_sql(raw).map_err(serde::ser::Error::custom)?;
    let mut map = serializer.serialize_map(Some(2))?;
    map.serialize_entry("x", &point.x())?;
    map.serialize_entry("y", &point.y())?;
    map.end()
}

fn serialize_box<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let b = proto::box_from_sql(raw).map_err(serde::ser::Error::custom)?;
    let mut map = serializer.serialize_map(Some(2))?;
    
    // upper_right
    let mut ur = std::collections::HashMap::new();
    ur.insert("x", b.upper_right().x());
    ur.insert("y", b.upper_right().y());
    map.serialize_entry("upper_right", &ur)?;
    
    // lower_left
    let mut ll = std::collections::HashMap::new();
    ll.insert("x", b.lower_left().x());
    ll.insert("y", b.lower_left().y());
    map.serialize_entry("lower_left", &ll)?;
    
    map.end()
}

fn serialize_circle<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if raw.len() != 24 {
        return serialize_fallback(raw, serializer);
    }
    let center = proto::point_from_sql(&raw[..16]).map_err(serde::ser::Error::custom)?;
    let mut radius_bytes = [0u8; 8];
    radius_bytes.copy_from_slice(&raw[16..24]);
    let radius = f64::from_bits(u64::from_be_bytes(radius_bytes));

    let mut map = serializer.serialize_map(Some(2))?;
    
    let mut c = std::collections::HashMap::new();
    c.insert("x", center.x());
    c.insert("y", center.y());
    map.serialize_entry("center", &c)?;
    map.serialize_entry("radius", &radius)?;
    
    map.end()
}

fn serialize_line<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if raw.len() != 24 {
        return serialize_fallback(raw, serializer);
    }
    let mut coefficients = [0f64; 3];
    for i in 0..3 {
        let start = i * 8;
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&raw[start..start + 8]);
        coefficients[i] = f64::from_bits(u64::from_be_bytes(buf));
    }
    
    let mut map = serializer.serialize_map(Some(3))?;
    map.serialize_entry("a", &coefficients[0])?;
    map.serialize_entry("b", &coefficients[1])?;
    map.serialize_entry("c", &coefficients[2])?;
    map.end()
}

fn serialize_path<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let path = proto::path_from_sql(raw).map_err(serde::ser::Error::custom)?;
    let mut points = Vec::new();
    let mut iter = path.points();
    while let Some(point) =
        fallible_iterator::FallibleIterator::next(&mut iter).map_err(serde::ser::Error::custom)?
    {
        let mut p = std::collections::HashMap::new();
        p.insert("x", point.x());
        p.insert("y", point.y());
        points.push(p);
    }

    let mut map = serializer.serialize_map(Some(2))?;
    map.serialize_entry("closed", &path.closed())?;
    map.serialize_entry("points", &points)?;
    map.end()
}

fn serialize_polygon<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if raw.len() < 4 {
        return serialize_fallback(raw, serializer);
    }
    let mut cursor = raw;
    let count = read_i32(&mut cursor).map_err(serde::ser::Error::custom)?;
    if count < 0 {
        return serialize_fallback(raw, serializer);
    }

    let mut points = Vec::with_capacity(count as usize);
    for _ in 0..count {
        if cursor.len() < 16 {
            return serialize_fallback(raw, serializer);
        }
        let point = proto::point_from_sql(&cursor[..16]).map_err(serde::ser::Error::custom)?;
        let mut p = std::collections::HashMap::new();
        p.insert("x", point.x());
        p.insert("y", point.y());
        points.push(p);
        cursor = &cursor[16..];
    }

    let mut map = serializer.serialize_map(Some(1))?;
    map.serialize_entry("points", &points)?;
    map.end()
}

fn serialize_bit_string<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let bitset = proto::varbit_from_sql(raw).map_err(serde::ser::Error::custom)?;
    let mut bits = String::with_capacity(bitset.len());

    for idx in 0..bitset.len() {
        let byte = bitset.bytes()[idx / 8];
        let bit = (byte >> (7 - (idx % 8))) & 1;
        bits.push(if bit == 1 { '1' } else { '0' });
    }

    serializer.serialize_str(&bits)
}

fn serialize_inet<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let inet = proto::inet_from_sql(raw).map_err(serde::ser::Error::custom)?;
    let formatted = format!("{}/{}", inet.addr(), inet.netmask());
    serializer.serialize_str(&formatted)
}

fn serialize_macaddr<S>(raw: &[u8], len: usize, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if raw.len() != len {
        return serialize_fallback(raw, serializer);
    }
    let parts: Vec<String> = raw.iter().map(|b| format!("{:02x}", b)).collect();
    serializer.serialize_str(&parts.join(":"))
}

fn serialize_lsn<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let lsn = proto::lsn_from_sql(raw).map_err(serde::ser::Error::custom)?;
    let upper = lsn >> 32;
    let lower = lsn & 0xFFFF_FFFF;
    let formatted = format!("{:X}/{:X}", upper, lower);
    serializer.serialize_str(&formatted)
}

fn serialize_hstore<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut entries = proto::hstore_from_sql(raw).map_err(serde::ser::Error::custom)?;
    let mut parts = Vec::new();

    while let Some((key, value)) = fallible_iterator::FallibleIterator::next(&mut entries)
        .map_err(serde::ser::Error::custom)?
    {
        let escaped_key = escape_hstore_component(key);
        let formatted_value = value
            .map(|val| format!("\"{}\"", escape_hstore_component(val)))
            .unwrap_or_else(|| "NULL".to_string());
        parts.push(format!("\"{}\"=>{}", escaped_key, formatted_value));
    }

    serializer.serialize_str(&parts.join(", "))
}

fn escape_hstore_component(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

fn serialize_fallback<S>(raw: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if let Ok(text) = std::str::from_utf8(raw) {
        serializer.serialize_str(text)
    } else {
        let hex: String = raw.iter().map(|b| format!("{:02x}", b)).collect();
        serializer.serialize_str(&format!("\\x{}", hex))
    }
}

fn read_i32(buf: &mut &[u8]) -> Result<i32, &'static str> {
    if buf.len() < 4 {
        return Err("buffer underflow reading i32");
    }
    let mut bytes = [0u8; 4];
    bytes.copy_from_slice(&buf[..4]);
    *buf = &buf[4..];
    Ok(i32::from_be_bytes(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_empty_rows() {
        let rows: Vec<Row> = vec![];
        let wrapper = SerializableRows::new(&rows);
        let bytes = rmp_serde::to_vec(&wrapper).unwrap();
        let decoded: Vec<Vec<serde_json::Value>> = rmp_serde::from_slice(&bytes).unwrap();
        assert!(decoded.is_empty());
    }
}

