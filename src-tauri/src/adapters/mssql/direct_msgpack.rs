//! Direct SQL Server to MessagePack encoder for high-performance streaming.
//!
//! High-performance encoder optimized for large result sets with:
//! - Two-pass pre-allocation (pre-sized buffers)
//! - Adaptive parallelism (skip rayon overhead for small batches)
//! - Custom fast timestamp/date/time formatter (no chrono format!())
//! - Fast UUID formatting with lookup table

use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{Datelike, Timelike};
use rayon::prelude::*;
use rmp::encode;
use std::io::Write;
use std::sync::Mutex;
use tiberius::Row;

/// Threshold for parallel processing - below this, sequential is faster
const PARALLEL_THRESHOLD: usize = 64;

const CHUNK_BUF_DEFAULT_CAPACITY: usize = 64 * 1024;
static CHUNK_BUF_POOL: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());

/// Take a pooled buffer, cleared but retaining capacity.
#[inline]
fn take_chunk_buffer(estimated_capacity: usize) -> Vec<u8> {
    let mut pool = CHUNK_BUF_POOL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut buf = pool
        .pop()
        .unwrap_or_else(|| Vec::with_capacity(CHUNK_BUF_DEFAULT_CAPACITY.max(estimated_capacity)));
    drop(pool);

    buf.clear();
    let cap = buf.capacity();
    if cap < estimated_capacity {
        buf.reserve(estimated_capacity - cap);
    }
    buf
}

/// Return a buffer to the shared pool for reuse.
#[inline]
fn return_chunk_buffer(mut buf: Vec<u8>) {
    buf.clear();
    let mut pool = CHUNK_BUF_POOL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let max_pool_size = (rayon::current_num_threads().max(1) * 2).max(4);
    if pool.len() < max_pool_size {
        pool.push(buf);
    }
}

#[inline]
fn write_null_row(buf: &mut Vec<u8>, column_count: usize) {
    let _ = encode::write_array_len(buf, column_count as u32);
    for _ in 0..column_count {
        let _ = encode::write_nil(buf);
    }
}

#[inline]
fn encode_row_or_null<F>(buf: &mut Vec<u8>, column_count: usize, encode_row: F)
where
    F: FnOnce(&mut Vec<u8>) -> Result<()>,
{
    let row_start = buf.len();
    if let Err(e) = encode_row(buf) {
        tracing::warn!("MSSQL row encode failed (chunked): {}", e);
        // Drop partial row bytes to preserve MsgPack row boundaries.
        buf.truncate(row_start);
        write_null_row(buf, column_count);
    }
}

// ============================================================================
// Fast formatting helpers (ported from PostgreSQL encoder)
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

/// Hex encoding lookup table
static HEX_TABLE: &[u8; 16] = b"0123456789abcdef";

#[inline(always)]
fn hex_digit(nibble: u8) -> u8 {
    HEX_TABLE[nibble as usize]
}

/// Write 2-digit number using lookup table (branchless)
#[inline(always)]
fn write_2digits(dst: &mut [u8], offset: usize, val: u32) {
    let pair = DIGIT_PAIRS[val as usize % 100];
    dst[offset] = pair[0];
    dst[offset + 1] = pair[1];
}

/// Write 4-digit year
#[inline(always)]
fn write_4digits(dst: &mut [u8], offset: usize, val: u32) {
    write_2digits(dst, offset, val / 100);
    write_2digits(dst, offset + 2, val % 100);
}

/// Write 6-digit microseconds
#[inline(always)]
fn write_6digits(dst: &mut [u8], offset: usize, val: u32) {
    write_2digits(dst, offset, val / 10000);
    write_2digits(dst, offset + 2, (val / 100) % 100);
    write_2digits(dst, offset + 4, val % 100);
}

/// Fast timestamp format: "YYYY-MM-DD HH:MM:SS.ffffff" (26 bytes)
#[inline]
#[allow(clippy::too_many_arguments)]
fn format_timestamp_fast(
    dst: &mut [u8; 26],
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    min: u32,
    sec: u32,
    micros: u32,
) {
    write_4digits(dst, 0, year as u32);
    dst[4] = b'-';
    write_2digits(dst, 5, month);
    dst[7] = b'-';
    write_2digits(dst, 8, day);
    dst[10] = b' ';
    write_2digits(dst, 11, hour);
    dst[13] = b':';
    write_2digits(dst, 14, min);
    dst[16] = b':';
    write_2digits(dst, 17, sec);
    dst[19] = b'.';
    write_6digits(dst, 20, micros);
}

/// Fast timestamptz format: "YYYY-MM-DD HH:MM:SS.ffffff+HH:MM" (32 bytes)
#[inline]
#[allow(clippy::too_many_arguments)]
fn format_timestamptz_fast(
    dst: &mut [u8; 32],
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    min: u32,
    sec: u32,
    micros: u32,
    tz_hours: i32,
    tz_mins: i32,
) {
    write_4digits(dst, 0, year as u32);
    dst[4] = b'-';
    write_2digits(dst, 5, month);
    dst[7] = b'-';
    write_2digits(dst, 8, day);
    dst[10] = b' ';
    write_2digits(dst, 11, hour);
    dst[13] = b':';
    write_2digits(dst, 14, min);
    dst[16] = b':';
    write_2digits(dst, 17, sec);
    dst[19] = b'.';
    write_6digits(dst, 20, micros);
    dst[26] = if tz_hours >= 0 { b'+' } else { b'-' };
    write_2digits(dst, 27, tz_hours.unsigned_abs());
    dst[29] = b':';
    write_2digits(dst, 30, tz_mins.unsigned_abs());
}

/// Fast date format: "YYYY-MM-DD" (10 bytes)
#[inline]
fn format_date_fast(dst: &mut [u8; 10], year: i32, month: u32, day: u32) {
    write_4digits(dst, 0, year as u32);
    dst[4] = b'-';
    write_2digits(dst, 5, month);
    dst[7] = b'-';
    write_2digits(dst, 8, day);
}

/// Fast time format: "HH:MM:SS.ffffff" (15 bytes)
#[inline]
fn format_time_fast(dst: &mut [u8; 15], hour: u32, min: u32, sec: u32, micros: u32) {
    write_2digits(dst, 0, hour);
    dst[2] = b':';
    write_2digits(dst, 3, min);
    dst[5] = b':';
    write_2digits(dst, 6, sec);
    dst[8] = b'.';
    write_6digits(dst, 9, micros);
}

/// Fast UUID to hyphenated hex string (36 bytes)
/// Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#[inline(always)]
fn uuid_to_hex(bytes: &[u8; 16], dst: &mut [u8; 36]) {
    let mut d = 0;
    for &b in &bytes[0..4] {
        dst[d] = hex_digit(b >> 4);
        dst[d + 1] = hex_digit(b & 0x0f);
        d += 2;
    }
    dst[d] = b'-';
    d += 1;
    for &b in &bytes[4..6] {
        dst[d] = hex_digit(b >> 4);
        dst[d + 1] = hex_digit(b & 0x0f);
        d += 2;
    }
    dst[d] = b'-';
    d += 1;
    for &b in &bytes[6..8] {
        dst[d] = hex_digit(b >> 4);
        dst[d + 1] = hex_digit(b & 0x0f);
        d += 2;
    }
    dst[d] = b'-';
    d += 1;
    for &b in &bytes[8..10] {
        dst[d] = hex_digit(b >> 4);
        dst[d + 1] = hex_digit(b & 0x0f);
        d += 2;
    }
    dst[d] = b'-';
    d += 1;
    for &b in &bytes[10..16] {
        dst[d] = hex_digit(b >> 4);
        dst[d + 1] = hex_digit(b & 0x0f);
        d += 2;
    }
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

// ============================================================================
// DirectMsgPackEncoder
// ============================================================================

/// Direct SQL Server to MessagePack encoder
///
/// Encodes tiberius rows directly to MessagePack format with adaptive
/// parallelism and fast stack-buffer type formatters.
pub struct DirectMsgPackEncoder {
    column_count: usize,
    /// Estimated size per row (cached for performance)
    estimated_row_size: usize,
}

impl DirectMsgPackEncoder {
    /// Create new encoder with column count
    pub fn new(column_count: usize) -> Self {
        // Estimate ~32 bytes per column on average
        let estimated_row_size = column_count * 32 + msgpack_array_header_size(column_count);
        Self {
            column_count,
            estimated_row_size,
        }
    }

    /// Encode a batch of rows directly to MessagePack bytes.
    ///
    /// Uses adaptive strategy:
    /// - Small batches (< 64 rows): Sequential encoding (no rayon overhead)
    /// - Large batches: Parallel encoding with optimized buffer estimation
    pub fn encode_batch(&self, rows: &[Row]) -> Result<Vec<u8>> {
        if rows.is_empty() {
            let mut buf = Vec::with_capacity(8);
            encode::write_array_len(&mut buf, 0).map_err(Self::map_encode_err)?;
            return Ok(buf);
        }

        if rows.len() < PARALLEL_THRESHOLD {
            return self.encode_sequential(rows);
        }

        self.encode_parallel_two_pass(rows)
    }

    /// Sequential encoding for small batches - minimal overhead
    fn encode_sequential(&self, rows: &[Row]) -> Result<Vec<u8>> {
        let estimated = self.estimated_row_size * rows.len() + 8;
        let mut buffer = Vec::with_capacity(estimated);

        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;

        for row in rows {
            self.encode_row_inline(&mut buffer, row)?;
        }

        Ok(buffer)
    }

    /// Chunked parallel encoding for large batches.
    /// Each rayon thread gets one buffer for its chunk of rows,
    /// reducing allocations from N (one per row) to ~num_threads.
    fn encode_parallel_two_pass(&self, rows: &[Row]) -> Result<Vec<u8>> {
        let num_threads = rayon::current_num_threads().max(1);
        let chunk_size = rows.len().div_ceil(num_threads);
        let column_count = self.column_count;

        let chunk_buffers: Vec<Vec<u8>> = rows
            .par_chunks(chunk_size)
            .map(|chunk| {
                let estimated = self.estimated_row_size * chunk.len();
                let mut buf = take_chunk_buffer(estimated);
                for row in chunk {
                    encode_row_or_null(&mut buf, column_count, |row_buf| {
                        self.encode_row_inline(row_buf, row)
                    });
                }
                buf
            })
            .collect();

        // Merge only ~num_threads chunk buffers instead of N row buffers
        let header_size = msgpack_array_header_size(rows.len());
        let total_chunk_bytes: usize = chunk_buffers.iter().map(|b| b.len()).sum();
        let mut buffer = Vec::with_capacity(header_size + total_chunk_bytes);

        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;
        for chunk_buf in chunk_buffers {
            buffer.extend_from_slice(&chunk_buf);
            return_chunk_buffer(chunk_buf);
        }

        Ok(buffer)
    }

    /// Encode a single row as a MessagePack array inline into the buffer
    #[inline]
    fn encode_row_inline<W: Write>(&self, buf: &mut W, row: &Row) -> Result<()> {
        encode::write_array_len(buf, self.column_count as u32).map_err(Self::map_encode_err)?;

        for i in 0..self.column_count {
            self.encode_cell(buf, row, i)?;
        }

        Ok(())
    }

    /// Encode a single cell value by trying different types.
    /// Uses fast stack-buffer formatters for datetime/UUID types.
    #[inline]
    fn encode_cell<W: Write>(&self, buf: &mut W, row: &Row, idx: usize) -> Result<()> {
        // Try different types in order of likelihood
        if let Some(v) = row.try_get::<&str, _>(idx).ok().flatten() {
            encode::write_str(buf, v).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<i32, _>(idx).ok().flatten() {
            encode::write_i32(buf, v).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<i64, _>(idx).ok().flatten() {
            encode::write_i64(buf, v).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<i16, _>(idx).ok().flatten() {
            encode::write_i16(buf, v).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<u8, _>(idx).ok().flatten() {
            encode::write_u8(buf, v).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<f64, _>(idx).ok().flatten() {
            encode::write_f64(buf, v).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<f32, _>(idx).ok().flatten() {
            encode::write_f32(buf, v).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<bool, _>(idx).ok().flatten() {
            encode::write_bool(buf, v).map_err(Self::map_io_err)?;
            return Ok(());
        }
        // UUID - fast stack-buffer formatting
        if let Some(v) = row.try_get::<uuid::Uuid, _>(idx).ok().flatten() {
            let bytes = v.as_bytes();
            let mut hex_buf = [0u8; 36];
            uuid_to_hex(bytes, &mut hex_buf);
            let s = unsafe { std::str::from_utf8_unchecked(&hex_buf) };
            encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        // Binary data
        if let Some(v) = row.try_get::<&[u8], _>(idx).ok().flatten() {
            let b64 = BASE64_STANDARD.encode(v);
            encode::write_str(buf, &b64).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        // NaiveDateTime - fast stack-buffer formatting
        if let Some(v) = row.try_get::<chrono::NaiveDateTime, _>(idx).ok().flatten() {
            let year = v.year();
            if !(0..=9999).contains(&year) {
                // Fall back to chrono's Display for edge-case years (BC dates, etc.)
                encode::write_str(buf, &v.to_string()).map_err(Self::map_encode_err)?;
            } else {
                let mut ts_buf = [0u8; 26];
                format_timestamp_fast(
                    &mut ts_buf,
                    year,
                    v.month(),
                    v.day(),
                    v.hour(),
                    v.minute(),
                    v.second(),
                    v.nanosecond() / 1000,
                );
                // SAFETY: buffer contains only ASCII digits and separators
                let s = unsafe { std::str::from_utf8_unchecked(&ts_buf) };
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }
            return Ok(());
        }
        // DateTime<FixedOffset> - fast stack-buffer formatting
        if let Some(v) = row
            .try_get::<chrono::DateTime<chrono::FixedOffset>, _>(idx)
            .ok()
            .flatten()
        {
            let year = v.year();
            if !(0..=9999).contains(&year) {
                encode::write_str(buf, &v.to_string()).map_err(Self::map_encode_err)?;
            } else {
                let offset_secs = v.offset().local_minus_utc();
                let tz_hours = offset_secs / 3600;
                let tz_mins = (offset_secs % 3600).abs() / 60;
                let mut ts_buf = [0u8; 32];
                format_timestamptz_fast(
                    &mut ts_buf,
                    year,
                    v.month(),
                    v.day(),
                    v.hour(),
                    v.minute(),
                    v.second(),
                    v.nanosecond() / 1000,
                    tz_hours,
                    tz_mins,
                );
                // SAFETY: buffer contains only ASCII digits and separators
                let s = unsafe { std::str::from_utf8_unchecked(&ts_buf) };
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }
            return Ok(());
        }
        // DateTime<Utc> - fast stack-buffer formatting
        if let Some(v) = row
            .try_get::<chrono::DateTime<chrono::Utc>, _>(idx)
            .ok()
            .flatten()
        {
            let year = v.year();
            if !(0..=9999).contains(&year) {
                encode::write_str(buf, &v.to_string()).map_err(Self::map_encode_err)?;
            } else {
                let mut ts_buf = [0u8; 32];
                format_timestamptz_fast(
                    &mut ts_buf,
                    year,
                    v.month(),
                    v.day(),
                    v.hour(),
                    v.minute(),
                    v.second(),
                    v.nanosecond() / 1000,
                    0,
                    0,
                );
                // SAFETY: buffer contains only ASCII digits and separators
                let s = unsafe { std::str::from_utf8_unchecked(&ts_buf) };
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }
            return Ok(());
        }
        // NaiveDate - fast stack-buffer formatting
        if let Some(v) = row.try_get::<chrono::NaiveDate, _>(idx).ok().flatten() {
            let year = v.year();
            if !(0..=9999).contains(&year) {
                encode::write_str(buf, &v.to_string()).map_err(Self::map_encode_err)?;
            } else {
                let mut date_buf = [0u8; 10];
                format_date_fast(&mut date_buf, year, v.month(), v.day());
                // SAFETY: buffer contains only ASCII digits and separators
                let s = unsafe { std::str::from_utf8_unchecked(&date_buf) };
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }
            return Ok(());
        }
        // NaiveTime - fast stack-buffer formatting
        if let Some(v) = row.try_get::<chrono::NaiveTime, _>(idx).ok().flatten() {
            let mut time_buf = [0u8; 15];
            format_time_fast(
                &mut time_buf,
                v.hour(),
                v.minute(),
                v.second(),
                v.nanosecond() / 1000,
            );
            let s = unsafe { std::str::from_utf8_unchecked(&time_buf) };
            encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        // Decimal
        if let Some(v) = row
            .try_get::<tiberius::numeric::Numeric, _>(idx)
            .ok()
            .flatten()
        {
            let s = v.to_string();
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        // XML
        if let Some(v) = row
            .try_get::<&tiberius::xml::XmlData, _>(idx)
            .ok()
            .flatten()
        {
            let s = v.to_string();
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            return Ok(());
        }

        // Fallback to null
        encode::write_nil(buf).map_err(Self::map_io_err)?;
        Ok(())
    }

    fn map_encode_err(e: rmp::encode::ValueWriteError) -> AppError {
        AppError::Internal(format!("MessagePack encode error: {}", e))
    }

    fn map_io_err(e: std::io::Error) -> AppError {
        AppError::Internal(format!("MessagePack IO error: {}", e))
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
    fn test_msgpack_array_header_size() {
        assert_eq!(msgpack_array_header_size(0), 1);
        assert_eq!(msgpack_array_header_size(15), 1);
        assert_eq!(msgpack_array_header_size(16), 3);
        assert_eq!(msgpack_array_header_size(65535), 3);
        assert_eq!(msgpack_array_header_size(65536), 5);
    }

    #[test]
    fn test_format_timestamp_fast() {
        let mut buf = [0u8; 26];
        format_timestamp_fast(&mut buf, 2024, 3, 15, 14, 30, 45, 123456);
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
    fn test_format_time_fast() {
        let mut buf = [0u8; 15];
        format_time_fast(&mut buf, 9, 5, 3, 100);
        let s = std::str::from_utf8(&buf).unwrap();
        assert_eq!(s, "09:05:03.000100");
    }

    #[test]
    fn test_uuid_to_hex() {
        let uuid = [0x55u8; 16];
        let mut hex = [0u8; 36];
        uuid_to_hex(&uuid, &mut hex);
        let s = std::str::from_utf8(&hex).unwrap();
        assert_eq!(s, "55555555-5555-5555-5555-555555555555");
    }

    #[test]
    fn test_format_timestamptz_fast() {
        let mut buf = [0u8; 32];
        format_timestamptz_fast(&mut buf, 2024, 3, 15, 14, 30, 45, 0, 5, 30);
        let s = std::str::from_utf8(&buf).unwrap();
        assert_eq!(s, "2024-03-15 14:30:45.000000+05:30");
    }

    #[test]
    fn test_encode_row_or_null_truncates_partial_row() {
        let mut buf = Vec::new();
        encode_row_or_null(&mut buf, 3, |row_buf| {
            encode::write_array_len(row_buf, 3).unwrap();
            encode::write_i32(row_buf, 42).unwrap();
            Err(AppError::Internal("forced error".to_string()))
        });

        let decoded: rmpv::Value = rmpv::decode::read_value(&mut &buf[..]).unwrap();
        let row = decoded.as_array().expect("row should be array");
        assert_eq!(row.len(), 3);
        assert!(row.iter().all(rmpv::Value::is_nil));
    }
}
