//! Direct Oracle to MessagePack encoder for high-performance streaming.
//!
//! Since the oracle crate is synchronous (OCI/ODPI-C), all encoding happens
//! within spawn_blocking. Rows are encoded in progressive batches and sent
//! through an mpsc channel to the async streaming handler.

use crate::error::{AppError, Result};
use oracle::sql_type::{OracleType, Timestamp};
use oracle::Row;
use rmp::encode;
use std::io::Write;

/// Estimated average size per cell in bytes
const ESTIMATED_CELL_SIZE: usize = 32;

// ============================================================================
// Fast formatting helpers (shared pattern with MySQL/PG/MSSQL encoders)
// ============================================================================

/// Fast digit pair lookup table (00-99)
static DIGIT_PAIRS: &[[u8; 2]; 100] = &[
    *b"00", *b"01", *b"02", *b"03", *b"04", *b"05", *b"06", *b"07", *b"08", *b"09", *b"10", *b"11",
    *b"12", *b"13", *b"14", *b"15", *b"16", *b"17", *b"18", *b"19", *b"20", *b"21", *b"22", *b"23",
    *b"24", *b"25", *b"26", *b"27", *b"28", *b"29", *b"30", *b"31", *b"32", *b"33", *b"34", *b"35",
    *b"36", *b"37", *b"38", *b"39", *b"40", *b"41", *b"42", *b"43", *b"44", *b"45", *b"46", *b"47",
    *b"48", *b"49", *b"50", *b"51", *b"52", *b"53", *b"54", *b"55", *b"56", *b"57", *b"58", *b"59",
    *b"60", *b"61", *b"62", *b"63", *b"64", *b"65", *b"66", *b"67", *b"68", *b"69", *b"70", *b"71",
    *b"72", *b"73", *b"74", *b"75", *b"76", *b"77", *b"78", *b"79", *b"80", *b"81", *b"82", *b"83",
    *b"84", *b"85", *b"86", *b"87", *b"88", *b"89", *b"90", *b"91", *b"92", *b"93", *b"94", *b"95",
    *b"96", *b"97", *b"98", *b"99",
];

#[inline(always)]
fn write_2digits(dst: &mut [u8], offset: usize, val: u32) {
    let pair = DIGIT_PAIRS[val as usize % 100];
    dst[offset] = pair[0];
    dst[offset + 1] = pair[1];
}

#[inline(always)]
fn write_4digits(dst: &mut [u8], offset: usize, val: u32) {
    write_2digits(dst, offset, val / 100);
    write_2digits(dst, offset + 2, val % 100);
}

#[inline(always)]
fn write_6digits(dst: &mut [u8], offset: usize, val: u32) {
    write_2digits(dst, offset, val / 10000);
    write_2digits(dst, offset + 2, (val / 100) % 100);
    write_2digits(dst, offset + 4, val % 100);
}

/// Fast timestamp format: "YYYY-MM-DD HH:MM:SS.ffffff" (26 bytes)
#[inline]
#[allow(clippy::too_many_arguments)]
fn format_datetime_fast(
    dst: &mut [u8; 26],
    year: u32,
    month: u8,
    day: u8,
    hour: u8,
    min: u8,
    sec: u8,
    micro: u32,
) {
    write_4digits(dst, 0, year);
    dst[4] = b'-';
    write_2digits(dst, 5, month as u32);
    dst[7] = b'-';
    write_2digits(dst, 8, day as u32);
    dst[10] = b' ';
    write_2digits(dst, 11, hour as u32);
    dst[13] = b':';
    write_2digits(dst, 14, min as u32);
    dst[16] = b':';
    write_2digits(dst, 17, sec as u32);
    dst[19] = b'.';
    write_6digits(dst, 20, micro);
}

/// Fast date format: "YYYY-MM-DD" (10 bytes)
#[inline]
fn format_date_fast(dst: &mut [u8; 10], year: u32, month: u8, day: u8) {
    write_4digits(dst, 0, year);
    dst[4] = b'-';
    write_2digits(dst, 5, month as u32);
    dst[7] = b'-';
    write_2digits(dst, 8, day as u32);
}

/// Fast datetime without micros: "YYYY-MM-DD HH:MM:SS" (19 bytes)
#[inline]
fn format_datetime_no_micros(
    dst: &mut [u8; 19],
    year: u32,
    month: u8,
    day: u8,
    hour: u8,
    min: u8,
    sec: u8,
) {
    write_4digits(dst, 0, year);
    dst[4] = b'-';
    write_2digits(dst, 5, month as u32);
    dst[7] = b'-';
    write_2digits(dst, 8, day as u32);
    dst[10] = b' ';
    write_2digits(dst, 11, hour as u32);
    dst[13] = b':';
    write_2digits(dst, 14, min as u32);
    dst[16] = b':';
    write_2digits(dst, 17, sec as u32);
}

/// Calculate MessagePack array header size
#[inline(always)]
fn msgpack_array_header_size(len: usize) -> usize {
    if len < 16 {
        1
    } else if len < 65536 {
        3
    } else {
        5
    }
}

#[inline]
fn write_null_row(buf: &mut Vec<u8>, column_count: usize) {
    let _ = encode::write_array_len(buf, column_count as u32);
    for _ in 0..column_count {
        let _ = encode::write_nil(buf);
    }
}

// ============================================================================
// Oracle cell encoding
// ============================================================================

/// Encode a single Oracle cell to MessagePack.
/// Handles all Oracle types with fast formatting.
pub fn encode_oracle_cell<W: Write>(buf: &mut W, row: &Row, index: usize) -> Result<()> {
    let sql_value = &row.sql_values()[index];

    if sql_value.is_null().map_err(map_oracle_error)? {
        encode::write_nil(buf).map_err(map_io_err)?;
        return Ok(());
    }

    let oracle_type = row.column_info()[index].oracle_type();
    match oracle_type {
        OracleType::BinaryFloat => {
            let val: f32 = row.get(index).map_err(map_oracle_error)?;
            encode::write_f32(buf, val).map_err(map_encode_err)?;
        }
        OracleType::BinaryDouble => {
            let val: f64 = row.get(index).map_err(map_oracle_error)?;
            encode::write_f64(buf, val).map_err(map_encode_err)?;
        }
        OracleType::Number(_, scale) if *scale == 0 => {
            match row.get::<usize, i64>(index) {
                Ok(val) => encode::write_i64(buf, val).map_err(map_encode_err)?,
                Err(_) => {
                    // Number too large for i64, encode as string
                    let s: String = row.get(index).map_err(map_oracle_error)?;
                    encode::write_str(buf, &s).map_err(map_encode_err)?;
                }
            }
        }
        OracleType::Number(_, _) | OracleType::Float(_) => match row.get::<usize, f64>(index) {
            Ok(val) => {
                if val.is_finite() {
                    encode::write_f64(buf, val).map_err(map_encode_err)?;
                } else {
                    encode::write_nil(buf).map_err(map_io_err)?;
                }
            }
            Err(_) => {
                let s: String = row.get(index).map_err(map_oracle_error)?;
                encode::write_str(buf, &s).map_err(map_encode_err)?;
            }
        },
        OracleType::Int64 => {
            let val: i64 = row.get(index).map_err(map_oracle_error)?;
            encode::write_i64(buf, val).map_err(map_encode_err)?;
        }
        OracleType::UInt64 => {
            let val: u64 = row.get(index).map_err(map_oracle_error)?;
            if val <= i64::MAX as u64 {
                encode::write_i64(buf, val as i64).map_err(map_encode_err)?;
            } else {
                encode::write_str(buf, &val.to_string()).map_err(map_encode_err)?;
            }
        }
        OracleType::Boolean => {
            let val: bool = row.get(index).map_err(map_oracle_error)?;
            encode::write_bool(buf, val).map_err(map_io_err)?;
        }

        // Date/Timestamp: use fast stack-buffer formatting
        OracleType::Date
        | OracleType::Timestamp(_)
        | OracleType::TimestampTZ(_)
        | OracleType::TimestampLTZ(_) => match row.get::<usize, Timestamp>(index) {
            Ok(ts) => {
                let year = ts.year().unsigned_abs();
                let month = ts.month() as u8;
                let day = ts.day() as u8;
                let hour = ts.hour() as u8;
                let minute = ts.minute() as u8;
                let second = ts.second() as u8;
                let nano = ts.nanosecond();
                let micro = nano / 1000;

                if matches!(oracle_type, OracleType::Date)
                    && hour == 0
                    && minute == 0
                    && second == 0
                    && micro == 0
                {
                    let mut date_buf = [0u8; 10];
                    format_date_fast(&mut date_buf, year, month, day);
                    let s = unsafe { std::str::from_utf8_unchecked(&date_buf) };
                    encode::write_str(buf, s).map_err(map_encode_err)?;
                } else if micro == 0 {
                    let mut ts_buf = [0u8; 19];
                    format_datetime_no_micros(&mut ts_buf, year, month, day, hour, minute, second);
                    let s = unsafe { std::str::from_utf8_unchecked(&ts_buf) };
                    encode::write_str(buf, s).map_err(map_encode_err)?;
                } else {
                    let mut ts_buf = [0u8; 26];
                    format_datetime_fast(
                        &mut ts_buf,
                        year,
                        month,
                        day,
                        hour,
                        minute,
                        second,
                        micro,
                    );
                    let s = unsafe { std::str::from_utf8_unchecked(&ts_buf) };
                    encode::write_str(buf, s).map_err(map_encode_err)?;
                }
            }
            Err(_) => {
                let s: String = row.get(index).map_err(map_oracle_error)?;
                encode::write_str(buf, &s).map_err(map_encode_err)?;
            }
        },

        // Interval types
        OracleType::IntervalYM(_) | OracleType::IntervalDS(_, _) => {
            let s: String = row.get(index).map_err(map_oracle_error)?;
            encode::write_str(buf, &s).map_err(map_encode_err)?;
        }

        // JSON
        OracleType::Json => {
            let s: String = row.get(index).map_err(map_oracle_error)?;
            encode::write_str(buf, &s).map_err(map_encode_err)?;
        }

        // RAW/BLOB: hex-encode
        OracleType::Raw(_) | OracleType::LongRaw => match row.get::<usize, Vec<u8>>(index) {
            Ok(bytes) => {
                let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
                encode::write_str(buf, &hex).map_err(map_encode_err)?;
            }
            Err(_) => encode::write_nil(buf).map_err(map_io_err)?,
        },

        // CLOB/NCLOB: read as string
        OracleType::CLOB | OracleType::NCLOB => match row.get::<usize, String>(index) {
            Ok(s) => encode::write_str(buf, &s).map_err(map_encode_err)?,
            Err(_) => encode::write_nil(buf).map_err(map_io_err)?,
        },

        // BLOB/BFILE: display representation
        OracleType::BLOB | OracleType::BFILE => {
            encode::write_str(buf, "[BLOB]").map_err(map_encode_err)?;
        }

        // Catch-all: convert to string
        _ => match row.get::<usize, String>(index) {
            Ok(s) => encode::write_str(buf, &s).map_err(map_encode_err)?,
            Err(_) => {
                let display = format!("{}", sql_value);
                encode::write_str(buf, &display).map_err(map_encode_err)?;
            }
        },
    }
    Ok(())
}

fn map_oracle_error(err: oracle::Error) -> AppError {
    AppError::DatabaseError(err.to_string())
}

fn map_encode_err(e: rmp::encode::ValueWriteError) -> AppError {
    AppError::Internal(format!("MessagePack encode error: {}", e))
}

fn map_io_err(e: std::io::Error) -> AppError {
    AppError::Internal(format!("MessagePack IO error: {}", e))
}

/// Convert Oracle column info to the CellValueType used by the frontend.
pub fn oracle_type_to_cell_type(oracle_type: &OracleType) -> crate::types::CellValueType {
    use crate::types::CellValueType;
    match oracle_type {
        OracleType::Number(_, scale) if *scale == 0 => CellValueType::Integer,
        OracleType::Number(_, _)
        | OracleType::Float(_)
        | OracleType::BinaryFloat
        | OracleType::BinaryDouble => CellValueType::Decimal,
        OracleType::Int64 | OracleType::UInt64 => CellValueType::Integer,
        OracleType::Boolean => CellValueType::Boolean,
        OracleType::Date => CellValueType::Date,
        OracleType::Timestamp(_) | OracleType::TimestampTZ(_) | OracleType::TimestampLTZ(_) => {
            CellValueType::DateTime
        }
        OracleType::IntervalYM(_) | OracleType::IntervalDS(_, _) => CellValueType::Text,
        OracleType::Json => CellValueType::Json,
        OracleType::Raw(_) | OracleType::LongRaw | OracleType::BLOB | OracleType::BFILE => {
            CellValueType::Binary
        }
        _ => CellValueType::Text,
    }
}

// ============================================================================
// DirectMsgPackEncoder
// ============================================================================

/// Encodes a batch of collected Oracle rows to MessagePack.
/// Unlike MySQL/Postgres encoders, Oracle rows are collected synchronously
/// via the OCI cursor, so this only does the encoding step.
///
/// `oracle::Row` is `!Send` and `!Sync`, so NO parallel encoding with rayon
/// is possible. All encoding is sequential.
pub struct DirectMsgPackEncoder {
    column_count: usize,
    estimated_row_size: usize,
}

impl DirectMsgPackEncoder {
    pub fn new(column_count: usize) -> Self {
        Self {
            column_count,
            estimated_row_size: column_count * ESTIMATED_CELL_SIZE
                + msgpack_array_header_size(column_count),
        }
    }

    /// Encode a batch of rows (collected from Oracle cursor) to MsgPack bytes.
    /// Always sequential since `oracle::Row` is `!Send`.
    pub fn encode_batch(&self, rows: &[&Row]) -> Result<Vec<u8>> {
        if rows.is_empty() {
            let mut buf = Vec::with_capacity(8);
            encode::write_array_len(&mut buf, 0).map_err(Self::map_encode_err)?;
            return Ok(buf);
        }

        let estimated = self.estimated_row_size * rows.len() + 8;
        let mut buffer = Vec::with_capacity(estimated);
        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;

        for row in rows {
            let row_start = buffer.len();
            if let Err(e) = self.encode_row(&mut buffer, row) {
                tracing::warn!("Oracle row encode failed: {}", e);
                buffer.truncate(row_start);
                write_null_row(&mut buffer, self.column_count);
            }
        }

        Ok(buffer)
    }

    fn encode_row<W: Write>(&self, buf: &mut W, row: &Row) -> Result<()> {
        encode::write_array_len(buf, self.column_count as u32).map_err(Self::map_encode_err)?;
        for i in 0..self.column_count {
            encode_oracle_cell(buf, row, i)?;
        }
        Ok(())
    }

    fn map_encode_err(e: rmp::encode::ValueWriteError) -> AppError {
        AppError::Internal(format!("MessagePack encode error: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encoder_creation() {
        let encoder = DirectMsgPackEncoder::new(5);
        assert_eq!(encoder.column_count, 5);
    }

    #[test]
    fn test_format_datetime_fast() {
        let mut buf = [0u8; 26];
        format_datetime_fast(&mut buf, 2024, 3, 15, 14, 30, 45, 123456);
        let s = std::str::from_utf8(&buf).unwrap();
        assert_eq!(s, "2024-03-15 14:30:45.123456");
    }

    #[test]
    fn test_format_date_fast() {
        let mut buf = [0u8; 10];
        format_date_fast(&mut buf, 2024, 1, 5);
        let s = std::str::from_utf8(&buf).unwrap();
        assert_eq!(s, "2024-01-05");
    }

    #[test]
    fn test_format_datetime_no_micros() {
        let mut buf = [0u8; 19];
        format_datetime_no_micros(&mut buf, 2024, 12, 31, 23, 59, 59);
        let s = std::str::from_utf8(&buf).unwrap();
        assert_eq!(s, "2024-12-31 23:59:59");
    }

    #[test]
    fn test_msgpack_array_header_size() {
        assert_eq!(msgpack_array_header_size(0), 1);
        assert_eq!(msgpack_array_header_size(15), 1);
        assert_eq!(msgpack_array_header_size(16), 3);
        assert_eq!(msgpack_array_header_size(65536), 5);
    }

    #[test]
    fn test_empty_batch() {
        let encoder = DirectMsgPackEncoder::new(3);
        let rows: Vec<&Row> = vec![];
        let result = encoder.encode_batch(&rows).unwrap();
        let decoded: rmpv::Value = rmpv::decode::read_value(&mut &result[..]).unwrap();
        let arr = decoded.as_array().expect("should be array");
        assert_eq!(arr.len(), 0);
    }
}
