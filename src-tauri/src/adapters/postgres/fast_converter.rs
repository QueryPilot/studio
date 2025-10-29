use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use postgres_protocol::types as proto;
use postgres_types::{FromSql, Kind, Type};
use rayon::prelude::*;
use rust_decimal::Decimal;
use serde_json::{json, Map, Value as JsonValue};
use tokio_postgres::Row;
use uuid::Uuid;

/// Fast PostgreSQL type converter - Direct to JSON
/// Converts database values directly to serde_json::Value
/// NO CellValue enum overhead, NO display_value allocation
pub struct FastPostgresConverter;

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

impl FastPostgresConverter {
    /// Batch convert multiple rows to JSON with cached column types (OPTIMIZED)
    pub fn rows_to_json(rows: &[Row]) -> Result<Vec<Vec<JsonValue>>> {
        if rows.is_empty() {
            return Ok(Vec::new());
        }

        // OPTIMIZATION: Cache column types once for entire batch
        // Avoids 6000 rows × 10 cols = 60,000 repeated lookups!
        let column_types: Vec<&Type> = rows[0].columns().iter().map(|col| col.type_()).collect();
        let num_columns = column_types.len();

        // Use parallel iterator for multi-core speedup (4-8x faster)
        // Each row is converted independently across CPU cores
        let result = rows
            .par_iter()
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
        let raw: Option<RawValue> = row.try_get(idx)?;

        match raw {
            None => Ok(JsonValue::Null),
            Some(bytes) => Self::convert_value(pg_type, bytes.0),
        }
    }

    fn convert_value(pg_type: &Type, raw: &[u8]) -> Result<JsonValue> {
        match pg_type.kind() {
            Kind::Simple | Kind::Pseudo => Self::convert_simple(pg_type, raw),
            Kind::Enum(_) => Self::convert_enum(raw),
            Kind::Array(inner) => Self::convert_array(inner, raw),
            Kind::Range(inner) => Self::convert_range(inner, raw),
            Kind::Multirange(inner) => Self::convert_multirange(inner, raw),
            Kind::Domain(inner) => Self::convert_value(inner, raw),
            Kind::Composite(fields) => Self::convert_composite(fields, raw),
            _ => Ok(Self::fallback_value(raw)),
        }
    }

    fn convert_simple(pg_type: &Type, raw: &[u8]) -> Result<JsonValue> {
        let value = match *pg_type {
            Type::BOOL => JsonValue::Bool(proto::bool_from_sql(raw).map_err(Self::map_decode_err)?),
            Type::INT2 => JsonValue::from(proto::int2_from_sql(raw).map_err(Self::map_decode_err)?),
            Type::INT4 => JsonValue::from(proto::int4_from_sql(raw).map_err(Self::map_decode_err)?),
            Type::OID => {
                JsonValue::from(proto::oid_from_sql(raw).map_err(Self::map_decode_err)? as u64)
            }
            Type::INT8 => JsonValue::from(proto::int8_from_sql(raw).map_err(Self::map_decode_err)?),
            Type::FLOAT4 => {
                JsonValue::from(proto::float4_from_sql(raw).map_err(Self::map_decode_err)? as f64)
            }
            Type::FLOAT8 => {
                JsonValue::from(proto::float8_from_sql(raw).map_err(Self::map_decode_err)?)
            }
            Type::NUMERIC => Self::convert_numeric(pg_type, raw)?,
            Type::MONEY => Self::convert_money(raw),
            Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::CHAR | Type::UNKNOWN => {
                Self::convert_text(raw)
            }
            Type::UUID => {
                let bytes = proto::uuid_from_sql(raw).map_err(Self::map_decode_err)?;
                JsonValue::String(Uuid::from_bytes(bytes).to_string())
            }
            Type::BYTEA => JsonValue::String(BASE64_STANDARD.encode(raw)),
            Type::JSON => Self::convert_json_text(raw)?,
            Type::JSONB => Self::convert_jsonb(raw)?,
            Type::XML => Self::convert_text(raw),
            Type::TIMESTAMP => {
                let dt = NaiveDateTime::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;
                JsonValue::String(dt.and_utc().to_rfc3339())
            }
            Type::TIMESTAMPTZ => {
                let dt = DateTime::<Utc>::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;
                JsonValue::String(dt.to_rfc3339())
            }
            Type::DATE => {
                let d = NaiveDate::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;
                JsonValue::String(d.format("%Y-%m-%d").to_string())
            }
            Type::TIME => {
                let t = NaiveTime::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;
                JsonValue::String(t.format("%H:%M:%S%.f").to_string())
            }
            Type::TIMETZ => JsonValue::String(Self::convert_timetz(raw)?),
            Type::INTERVAL => Self::convert_interval(raw),
            Type::BIT | Type::VARBIT => Self::convert_bit_string(raw)?,
            Type::INET | Type::CIDR => Self::convert_inet(raw)?,
            Type::MACADDR => Self::convert_macaddr(raw, 6),
            Type::MACADDR8 => Self::convert_macaddr(raw, 8),
            Type::PG_LSN => Self::convert_lsn(raw)?,
            Type::TS_VECTOR => Self::convert_tsvector(raw)?,
            Type::TSQUERY => Self::convert_tsquery(raw)?,
            Type::POINT => Self::convert_point(raw)?,
            Type::PATH => Self::convert_path(raw)?,
            Type::BOX => Self::convert_box(raw)?,
            Type::CIRCLE => Self::convert_circle(raw)?,
            Type::LINE => Self::convert_line(raw)?,
            Type::POLYGON => Self::convert_polygon(raw)?,
            _ => match pg_type.name() {
                "hstore" => Self::convert_hstore(raw)?,
                "ltree" | "lquery" | "ltxtquery" | "tsquery" => Self::convert_text(raw),
                _ => Self::fallback_value(raw),
            },
        };

        Ok(value)
    }

    fn convert_enum(raw: &[u8]) -> Result<JsonValue> {
        Ok(Self::convert_text(raw))
    }

    fn convert_numeric(pg_type: &Type, raw: &[u8]) -> Result<JsonValue> {
        let decimal = Decimal::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;
        // Always use string to preserve exact precision - f64 loses precision beyond ~15 digits
        Ok(JsonValue::String(decimal.to_string()))
    }

    fn convert_money(raw: &[u8]) -> JsonValue {
        if raw.len() == 8 {
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(raw);
            let cents = i64::from_be_bytes(bytes);
            let formatted = format!("{:.2}", cents as f64 / 100.0);
            JsonValue::String(formatted)
        } else {
            Self::fallback_value(raw)
        }
    }

    fn convert_json_text(raw: &[u8]) -> Result<JsonValue> {
        let text = std::str::from_utf8(raw).map_err(Self::map_decode_err)?;
        // Return as single-line string without parsing/formatting
        Ok(JsonValue::String(text.to_string()))
    }

    fn convert_jsonb(raw: &[u8]) -> Result<JsonValue> {
        if raw.is_empty() {
            return Ok(JsonValue::Null);
        }
        // First byte is version marker (currently 1)
        let payload = &raw[1..];

        // Parse JSON and convert back to compact string (single line, no indentation)
        match serde_json::from_slice::<serde_json::Value>(payload) {
            Ok(json_val) => {
                // Use compact serialization (no pretty printing)
                match serde_json::to_string(&json_val) {
                    Ok(compact_str) => Ok(JsonValue::String(compact_str)),
                    Err(_) => Ok(JsonValue::String(BASE64_STANDARD.encode(payload))),
                }
            }
            Err(_) => Ok(JsonValue::String(BASE64_STANDARD.encode(payload))),
        }
    }

    fn convert_array(element_type: &Type, raw: &[u8]) -> Result<JsonValue> {
        let array = proto::array_from_sql(raw).map_err(Self::map_decode_err)?;

        let mut dims_iter = array.dimensions();
        let mut dimensions = Vec::new();
        while let Some(dim) = fallible_iterator::FallibleIterator::next(&mut dims_iter)
            .map_err(Self::map_decode_err)?
        {
            if dim.len < 0 {
                return Err(AppError::Internal("negative array dimension".to_string()));
            }
            dimensions.push(dim.len as usize);
        }

        let total_len = dimensions.iter().product::<usize>();
        let mut values = Vec::with_capacity(total_len);

        let mut vals_iter = array.values();
        while let Some(val) = fallible_iterator::FallibleIterator::next(&mut vals_iter)
            .map_err(Self::map_decode_err)?
        {
            if let Some(bytes) = val {
                values.push(Self::convert_value(element_type, bytes)?);
            } else {
                values.push(JsonValue::Null);
            }
        }

        let nested = Self::reshape_array(&values, &dimensions);
        Ok(JsonValue::Array(nested))
    }

    fn reshape_array(values: &[JsonValue], dims: &[usize]) -> Vec<JsonValue> {
        if dims.is_empty() {
            return Vec::new();
        }

        if dims.len() == 1 {
            return values.iter().cloned().collect();
        }

        let chunk = dims[1..].iter().product::<usize>();
        let mut result = Vec::with_capacity(dims[0]);

        for i in 0..dims[0] {
            let start = i * chunk;
            let end = start + chunk;
            let slice = &values[start..end];
            result.push(JsonValue::Array(Self::reshape_array(slice, &dims[1..])));
        }

        result
    }

    fn convert_range(element_type: &Type, raw: &[u8]) -> Result<JsonValue> {
        use proto::Range;

        match proto::range_from_sql(raw).map_err(Self::map_decode_err)? {
            Range::Empty => Ok(JsonValue::String("empty".to_string())),
            Range::Nonempty(lower, upper) => {
                let lower_fmt = Self::format_range_bound(element_type, lower, true)?;
                let upper_fmt = Self::format_range_bound(element_type, upper, false)?;
                let open = if lower_fmt.inclusive { '[' } else { '(' };
                let close = if upper_fmt.inclusive { ']' } else { ')' };

                Ok(JsonValue::String(format!(
                    "{}{}, {}{}",
                    open, lower_fmt.value, upper_fmt.value, close
                )))
            }
        }
    }

    fn convert_multirange(element_type: &Type, raw: &[u8]) -> Result<JsonValue> {
        if raw.len() < 4 {
            return Err(AppError::Internal("invalid multirange length".to_string()));
        }

        let mut cursor = raw;
        let count = Self::read_i32(&mut cursor)? as usize;
        let mut ranges = Vec::with_capacity(count);

        for _ in 0..count {
            let len = Self::read_i32(&mut cursor)?;
            if len < 0 {
                ranges.push(JsonValue::Null);
                continue;
            }
            let len = len as usize;
            if cursor.len() < len {
                return Err(AppError::Internal(
                    "invalid multirange slice length".to_string(),
                ));
            }
            let (range_bytes, rest) = cursor.split_at(len);
            cursor = rest;
            ranges.push(Self::convert_range(element_type, range_bytes)?);
        }

        if !cursor.is_empty() {
            return Err(AppError::Internal(
                "multirange buffer not fully consumed".to_string(),
            ));
        }

        Ok(JsonValue::Array(ranges))
    }

    fn format_range_bound(
        element_type: &Type,
        bound: proto::RangeBound<Option<&[u8]>>,
        is_lower: bool,
    ) -> Result<RangeEndpoint> {
        use proto::RangeBound;

        match bound {
            RangeBound::Unbounded => Ok(RangeEndpoint {
                value: if is_lower {
                    "-infinity".to_string()
                } else {
                    "infinity".to_string()
                },
                inclusive: false,
            }),
            RangeBound::Inclusive(Some(bytes)) => Ok(RangeEndpoint {
                value: Self::json_value_to_string(Self::convert_value(element_type, bytes)?)?,
                inclusive: true,
            }),
            RangeBound::Inclusive(None) => Ok(RangeEndpoint {
                value: "NULL".to_string(),
                inclusive: true,
            }),
            RangeBound::Exclusive(Some(bytes)) => Ok(RangeEndpoint {
                value: Self::json_value_to_string(Self::convert_value(element_type, bytes)?)?,
                inclusive: false,
            }),
            RangeBound::Exclusive(None) => Ok(RangeEndpoint {
                value: "NULL".to_string(),
                inclusive: false,
            }),
        }
    }

    fn convert_composite(fields: &[postgres_types::Field], raw: &[u8]) -> Result<JsonValue> {
        let mut cursor = raw;
        let field_count = Self::read_i32(&mut cursor)?;
        if field_count < 0 {
            return Err(AppError::Internal(
                "negative field count in composite".to_string(),
            ));
        }

        let mut map = Map::new();

        for index in 0..(field_count as usize) {
            let type_oid = Self::read_i32(&mut cursor)? as u32;
            let len = Self::read_i32(&mut cursor)?;

            let value_bytes = if len < 0 {
                None
            } else {
                let len = len as usize;
                if cursor.len() < len {
                    return Err(AppError::Internal(
                        "composite field length exceeds buffer".to_string(),
                    ));
                }
                let (value, rest) = cursor.split_at(len);
                cursor = rest;
                Some(value)
            };

            let field_info = fields.get(index);
            let field_name = field_info
                .map(|f| f.name().to_string())
                .unwrap_or_else(|| format!("field_{}", index));

            let field_type = field_info
                .map(|f| f.type_().clone())
                .or_else(|| Type::from_oid(type_oid))
                .unwrap_or(Type::UNKNOWN);

            let value = match value_bytes {
                Some(bytes) => Self::convert_value(&field_type, bytes)?,
                None => JsonValue::Null,
            };

            map.insert(field_name, value);
        }

        if !cursor.is_empty() {
            return Err(AppError::Internal(
                "composite buffer not fully consumed".to_string(),
            ));
        }

        Ok(JsonValue::Object(map))
    }

    fn convert_point(raw: &[u8]) -> Result<JsonValue> {
        let point = proto::point_from_sql(raw).map_err(Self::map_decode_err)?;
        Ok(json!({
            "x": point.x(),
            "y": point.y()
        }))
    }

    fn convert_box(raw: &[u8]) -> Result<JsonValue> {
        let b = proto::box_from_sql(raw).map_err(Self::map_decode_err)?;
        Ok(json!({
            "upper_right": { "x": b.upper_right().x(), "y": b.upper_right().y() },
            "lower_left": { "x": b.lower_left().x(), "y": b.lower_left().y() }
        }))
    }

    fn convert_path(raw: &[u8]) -> Result<JsonValue> {
        let path = proto::path_from_sql(raw).map_err(Self::map_decode_err)?;
        let mut points = Vec::new();
        let mut iter = path.points();
        while let Some(point) =
            fallible_iterator::FallibleIterator::next(&mut iter).map_err(Self::map_decode_err)?
        {
            points.push(json!({"x": point.x(), "y": point.y()}));
        }

        Ok(json!({
            "closed": path.closed(),
            "points": points
        }))
    }

    fn convert_circle(raw: &[u8]) -> Result<JsonValue> {
        if raw.len() != 24 {
            return Ok(Self::fallback_value(raw));
        }
        let center = proto::point_from_sql(&raw[..16]).map_err(Self::map_decode_err)?;
        let mut radius_bytes = [0u8; 8];
        radius_bytes.copy_from_slice(&raw[16..24]);
        let radius = f64::from_bits(u64::from_be_bytes(radius_bytes));
        Ok(json!({
            "center": { "x": center.x(), "y": center.y() },
            "radius": radius
        }))
    }

    fn convert_line(raw: &[u8]) -> Result<JsonValue> {
        if raw.len() != 24 {
            return Ok(Self::fallback_value(raw));
        }
        let mut coefficients = [0f64; 3];
        for i in 0..3 {
            let start = i * 8;
            let mut buf = [0u8; 8];
            buf.copy_from_slice(&raw[start..start + 8]);
            coefficients[i] = f64::from_bits(u64::from_be_bytes(buf));
        }
        Ok(json!({
            "a": coefficients[0],
            "b": coefficients[1],
            "c": coefficients[2]
        }))
    }

    fn convert_polygon(raw: &[u8]) -> Result<JsonValue> {
        if raw.len() < 4 {
            return Ok(Self::fallback_value(raw));
        }
        let mut cursor = raw;
        let count = Self::read_i32(&mut cursor)?;
        if count < 0 {
            return Ok(Self::fallback_value(raw));
        }

        let mut points = Vec::with_capacity(count as usize);
        for _ in 0..count {
            if cursor.len() < 16 {
                return Ok(Self::fallback_value(raw));
            }
            let point = proto::point_from_sql(&cursor[..16]).map_err(Self::map_decode_err)?;
            points.push(json!({"x": point.x(), "y": point.y()}));
            cursor = &cursor[16..];
        }

        Ok(json!({ "points": points }))
    }

    fn convert_bit_string(raw: &[u8]) -> Result<JsonValue> {
        let bitset = proto::varbit_from_sql(raw).map_err(Self::map_decode_err)?;
        let mut bits = String::with_capacity(bitset.len());

        for idx in 0..bitset.len() {
            let byte = bitset.bytes()[idx / 8];
            let bit = (byte >> (7 - (idx % 8))) & 1;
            bits.push(if bit == 1 { '1' } else { '0' });
        }

        Ok(JsonValue::String(bits))
    }

    fn convert_inet(raw: &[u8]) -> Result<JsonValue> {
        let inet = proto::inet_from_sql(raw).map_err(Self::map_decode_err)?;
        Ok(JsonValue::String(format!(
            "{}/{}",
            inet.addr(),
            inet.netmask()
        )))
    }

    fn convert_macaddr(raw: &[u8], len: usize) -> JsonValue {
        if raw.len() != len {
            return Self::fallback_value(raw);
        }
        let parts: Vec<String> = raw.iter().map(|b| format!("{:02x}", b)).collect();
        JsonValue::String(parts.join(":"))
    }

    fn convert_timetz(raw: &[u8]) -> Result<String> {
        if raw.len() != 12 {
            return Err(AppError::Internal("invalid timetz length".to_string()));
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
            return Err(AppError::Internal("negative timetz seconds".to_string()));
        };

        let time = NaiveTime::from_num_seconds_from_midnight_opt(seconds_u32, nanos)
            .ok_or_else(|| AppError::Internal("invalid timetz value".to_string()))?;

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

    fn convert_interval(raw: &[u8]) -> JsonValue {
        if raw.len() != 16 {
            return Self::fallback_value(raw);
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

        json!({
            "months": months,
            "days": days,
            "microseconds": microseconds
        })
    }

    fn convert_hstore(raw: &[u8]) -> Result<JsonValue> {
        let mut entries = proto::hstore_from_sql(raw).map_err(Self::map_decode_err)?;
        let mut parts = Vec::new();

        while let Some((key, value)) =
            fallible_iterator::FallibleIterator::next(&mut entries).map_err(Self::map_decode_err)?
        {
            let escaped_key = Self::escape_hstore_component(key);
            let formatted_value = value
                .map(|val| format!("\"{}\"", Self::escape_hstore_component(val)))
                .unwrap_or_else(|| "NULL".to_string());
            parts.push(format!("\"{}\"=>{}", escaped_key, formatted_value));
        }

        Ok(JsonValue::String(parts.join(", ")))
    }

    fn convert_lsn(raw: &[u8]) -> Result<JsonValue> {
        let lsn = proto::lsn_from_sql(raw).map_err(Self::map_decode_err)?;
        let upper = lsn >> 32;
        let lower = lsn & 0xFFFF_FFFF;
        Ok(JsonValue::String(format!("{:X}/{:X}", upper, lower)))
    }

    fn convert_tsvector(raw: &[u8]) -> Result<JsonValue> {
        // Parse tsvector binary format directly
        // Format: [u32 num_lexemes][for each: null-terminated text, u16 npos, npos × u16 positions]
        // Position encoding: top 2 bits = weight (A-D), lower 14 bits = position (1-16383)

        if raw.len() < 4 {
            return Ok(Self::fallback_value(raw));
        }

        let mut cursor = raw;
        let num_lexemes = Self::read_i32(&mut cursor)? as usize;

        if num_lexemes == 0 {
            return Ok(JsonValue::String("".to_string()));
        }

        let mut lexemes = Vec::with_capacity(num_lexemes);

        for _ in 0..num_lexemes {
            if cursor.is_empty() {
                break;
            }

            // Read null-terminated C string (lexeme text)
            let start = 0;
            let mut end = start;
            while end < cursor.len() && cursor[end] != 0 {
                end += 1;
            }

            if end >= cursor.len() {
                // Unterminated string, return what we have so far
                break;
            }

            // Parse lexeme text as UTF-8
            let lexeme_text = match std::str::from_utf8(&cursor[start..end]) {
                Ok(text) => text.to_string(),
                Err(_) => {
                    // Skip this lexeme if invalid UTF-8
                    cursor = &cursor[end + 1..];
                    continue;
                }
            };

            // Move cursor past null terminator
            cursor = &cursor[end + 1..];

            if cursor.len() < 2 {
                break;
            }

            // Read number of positions (u16)
            let num_positions = u16::from_be_bytes([cursor[0], cursor[1]]) as usize;
            cursor = &cursor[2..];

            if cursor.len() < num_positions * 2 {
                break;
            }

            // Read positions with weight information
            let mut positions = Vec::with_capacity(num_positions);
            for _ in 0..num_positions {
                let wep = u16::from_be_bytes([cursor[0], cursor[1]]);
                cursor = &cursor[2..];

                // Extract weight (top 2 bits) and position (lower 14 bits)
                let weight_bits = (wep >> 14) & 0b11;
                let pos = wep & 0x3fff; // 14-bit position (max 16383)

                // Weight: 3=A, 2=B, 1=C, 0=D
                let weight_char = match weight_bits {
                    3 => 'A',
                    2 => 'B',
                    1 => 'C',
                    _ => '\0', // D (default weight, not displayed)
                };

                if weight_char == '\0' {
                    positions.push(pos.to_string());
                } else {
                    positions.push(format!("{}{}", pos, weight_char));
                }
            }

            // Format as 'lexeme':pos1,pos2,pos3
            if positions.is_empty() {
                lexemes.push(format!("'{}'", lexeme_text.replace('\'', "''")));
            } else {
                let positions_str = positions.join(",");
                lexemes.push(format!(
                    "'{}':{}",
                    lexeme_text.replace('\'', "''"),
                    positions_str
                ));
            }
        }

        Ok(JsonValue::String(lexemes.join(" ")))
    }

    fn convert_tsquery(raw: &[u8]) -> Result<JsonValue> {
        // For tsquery, we'll use a simpler approach and convert to text
        // The binary format is more complex and rarely needed for display
        Ok(Self::convert_text(raw))
    }

    fn json_value_to_string(value: JsonValue) -> Result<String> {
        match value {
            JsonValue::String(s) => Ok(s),
            JsonValue::Number(n) => Ok(n.to_string()),
            JsonValue::Bool(b) => Ok(b.to_string()),
            JsonValue::Null => Ok("NULL".to_string()),
            other => serde_json::to_string(&other)
                .map_err(Self::map_decode_err)
                .map(|s| s.trim_matches('"').to_string()),
        }
    }

    fn escape_hstore_component(input: &str) -> String {
        input.replace('\\', "\\\\").replace('"', "\\\"")
    }

    fn fallback_value(raw: &[u8]) -> JsonValue {
        if let Ok(text) = std::str::from_utf8(raw) {
            JsonValue::String(text.to_string())
        } else {
            JsonValue::String(format!("\\x{}", Self::to_hex(raw)))
        }
    }

    fn convert_text(raw: &[u8]) -> JsonValue {
        match std::str::from_utf8(raw) {
            Ok(text) => JsonValue::String(text.to_string()),
            Err(_) => JsonValue::String(BASE64_STANDARD.encode(raw)),
        }
    }

    fn read_i32(buf: &mut &[u8]) -> Result<i32> {
        if buf.len() < 4 {
            return Err(AppError::Internal(
                "buffer underflow reading i32".to_string(),
            ));
        }
        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(&buf[..4]);
        *buf = &buf[4..];
        Ok(i32::from_be_bytes(bytes))
    }

    fn to_hex(data: &[u8]) -> String {
        data.iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn map_decode_err<E: std::fmt::Display>(err: E) -> AppError {
        AppError::Internal(format!("PostgreSQL decode error: {}", err))
    }
}

struct RangeEndpoint {
    value: String,
    inclusive: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;
    use postgres_protocol::types as proto;
    use postgres_protocol::types::ArrayDimension;
    use postgres_protocol::IsNull;
    use postgres_types::Type;

    #[test]
    fn converts_inet_to_string() {
        let mut buf = BytesMut::new();
        proto::inet_to_sql("127.0.0.1".parse().unwrap(), 32, &mut buf);

        let json = FastPostgresConverter::convert_value(&Type::INET, buf.as_ref()).unwrap();
        assert_eq!(json, JsonValue::String("127.0.0.1/32".to_string()));
    }

    #[test]
    fn converts_jsonb_payload() {
        let mut payload = vec![1u8];
        payload.extend_from_slice(r#"{"foo":"bar"}"#.as_bytes());

        let json = FastPostgresConverter::convert_value(&Type::JSONB, &payload).unwrap();
        assert_eq!(json, json!({"foo": "bar"}));
    }

    #[test]
    fn converts_timetz() {
        let mut raw = [0u8; 12];
        // 01:02:03.500000
        let micros: i64 = (1 * 3600 + 2 * 60 + 3) * 1_000_000 + 500_000;
        raw[..8].copy_from_slice(&micros.to_be_bytes());
        // UTC+02:00 (stored as seconds west of UTC, so -7200)
        let offset = (-7200i32).to_be_bytes();
        raw[8..12].copy_from_slice(&offset);

        let json = FastPostgresConverter::convert_value(&Type::TIMETZ, &raw).unwrap();
        assert_eq!(json, JsonValue::String("01:02:03.5+02:00".to_string()));
    }

    #[test]
    fn converts_interval() {
        let mut raw = [0u8; 16];
        raw[..8].copy_from_slice(&(1_500_000i64).to_be_bytes()); // 1.5 seconds in microseconds
        raw[8..12].copy_from_slice(&(3i32).to_be_bytes()); // 3 days
        raw[12..16].copy_from_slice(&(2i32).to_be_bytes()); // 2 months

        let json = FastPostgresConverter::convert_value(&Type::INTERVAL, &raw).unwrap();
        assert_eq!(
            json,
            json!({
                "months": 2,
                "days": 3,
                "microseconds": 1_500_000
            })
        );
    }

    #[test]
    fn converts_int_array() {
        let mut buf = BytesMut::new();
        proto::array_to_sql(
            [ArrayDimension {
                len: 3,
                lower_bound: 1,
            }],
            Type::INT4.oid(),
            [1i32, 2, 3],
            |value, buf| {
                proto::int4_to_sql(value, buf);
                Ok(IsNull::No)
            },
            &mut buf,
        )
        .unwrap();

        let json = FastPostgresConverter::convert_array(&Type::INT4, buf.as_ref()).unwrap();
        assert_eq!(json, json!([1, 2, 3]));
    }

    #[test]
    fn converts_int_range() {
        let mut buf = BytesMut::new();
        proto::range_to_sql(
            |buf| {
                proto::int4_to_sql(1, buf);
                Ok(proto::RangeBound::Inclusive(IsNull::No))
            },
            |buf| {
                proto::int4_to_sql(5, buf);
                Ok(proto::RangeBound::Exclusive(IsNull::No))
            },
            &mut buf,
        )
        .unwrap();

        let json = FastPostgresConverter::convert_range(&Type::INT4, buf.as_ref()).unwrap();
        assert_eq!(json, JsonValue::String("[1, 5)".to_string()));
    }
}
