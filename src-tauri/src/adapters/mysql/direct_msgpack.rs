//! Direct MySQL to MessagePack encoder for high-performance streaming.
//!
//! High-performance encoder optimized for large result sets with:
//! - Adaptive parallelism (skip rayon overhead for small batches)
//! - Fast stack-buffer timestamp/date/time formatting (no format!())

use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use mysql_async::{Row, Value};
use rayon::prelude::*;
use rmp::encode;
use std::io::Write;
use std::sync::Mutex;

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
        tracing::warn!("MySQL row encode failed (chunked): {}", e);
        // Drop partial row bytes to preserve MsgPack row boundaries.
        buf.truncate(row_start);
        write_null_row(buf, column_count);
    }
}

/// Estimated average size per cell in bytes
const ESTIMATED_CELL_SIZE: usize = 32;

// ============================================================================
// Fast formatting helpers (shared pattern with PG/MSSQL encoders)
// ============================================================================

/// Fast digit pair lookup table (00-99)
static DIGIT_PAIRS: &[[u8; 2]; 100] = &[
    *b"00", *b"01", *b"02", *b"03", *b"04", *b"05", *b"06", *b"07", *b"08", *b"09", *b"10",
    *b"11", *b"12", *b"13", *b"14", *b"15", *b"16", *b"17", *b"18", *b"19", *b"20", *b"21",
    *b"22", *b"23", *b"24", *b"25", *b"26", *b"27", *b"28", *b"29", *b"30", *b"31", *b"32",
    *b"33", *b"34", *b"35", *b"36", *b"37", *b"38", *b"39", *b"40", *b"41", *b"42", *b"43",
    *b"44", *b"45", *b"46", *b"47", *b"48", *b"49", *b"50", *b"51", *b"52", *b"53", *b"54",
    *b"55", *b"56", *b"57", *b"58", *b"59", *b"60", *b"61", *b"62", *b"63", *b"64", *b"65",
    *b"66", *b"67", *b"68", *b"69", *b"70", *b"71", *b"72", *b"73", *b"74", *b"75", *b"76",
    *b"77", *b"78", *b"79", *b"80", *b"81", *b"82", *b"83", *b"84", *b"85", *b"86", *b"87",
    *b"88", *b"89", *b"90", *b"91", *b"92", *b"93", *b"94", *b"95", *b"96", *b"97", *b"98",
    *b"99",
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
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    min: u8,
    sec: u8,
    micro: u32,
) {
    write_4digits(dst, 0, year as u32);
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
fn format_date_fast(dst: &mut [u8; 10], year: u16, month: u8, day: u8) {
    write_4digits(dst, 0, year as u32);
    dst[4] = b'-';
    write_2digits(dst, 5, month as u32);
    dst[7] = b'-';
    write_2digits(dst, 8, day as u32);
}

/// Fast datetime without micros: "YYYY-MM-DD HH:MM:SS" (19 bytes)
#[inline]
fn format_datetime_no_micros(
    dst: &mut [u8; 19],
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    min: u8,
    sec: u8,
) {
    write_4digits(dst, 0, year as u32);
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

// ============================================================================
// DirectMsgPackEncoder
// ============================================================================

/// Direct MySQL to MessagePack encoder
pub struct DirectMsgPackEncoder {
    column_count: usize,
    estimated_row_size: usize,
}

impl DirectMsgPackEncoder {
    /// Create new encoder with column count
    pub fn new(column_count: usize) -> Self {
        Self {
            column_count,
            estimated_row_size: column_count * ESTIMATED_CELL_SIZE
                + msgpack_array_header_size(column_count),
        }
    }

    /// Create encoder from first row
    pub fn from_row(row: &Row) -> Self {
        let column_count = row.columns_ref().len();
        Self::new(column_count)
    }

    /// Encode a batch of rows directly to MessagePack bytes
    pub fn encode_batch(&self, rows: &[Row]) -> Result<Vec<u8>> {
        if rows.is_empty() {
            let mut buf = Vec::with_capacity(8);
            encode::write_array_len(&mut buf, 0).map_err(Self::map_encode_err)?;
            return Ok(buf);
        }

        if rows.len() < PARALLEL_THRESHOLD {
            return self.encode_sequential(rows);
        }

        self.encode_parallel(rows)
    }

    /// Sequential encoding for small batches
    fn encode_sequential(&self, rows: &[Row]) -> Result<Vec<u8>> {
        let estimated = self.estimated_row_size * rows.len() + 8;
        let mut buffer = Vec::with_capacity(estimated);

        encode::write_array_len(&mut buffer, rows.len() as u32)
            .map_err(Self::map_encode_err)?;

        for row in rows {
            self.encode_row(&mut buffer, row)?;
        }

        Ok(buffer)
    }

    /// Chunked parallel encoding for large batches.
    /// Each rayon thread gets one buffer for its chunk of rows,
    /// reducing allocations from N (one per row) to ~num_threads.
    fn encode_parallel(&self, rows: &[Row]) -> Result<Vec<u8>> {
        let num_threads = rayon::current_num_threads().max(1);
        let chunk_size = (rows.len() + num_threads - 1) / num_threads;
        let column_count = self.column_count;

        let chunk_buffers: Vec<Vec<u8>> = rows
            .par_chunks(chunk_size)
            .map(|chunk| {
                let estimated = self.estimated_row_size * chunk.len();
                let mut buf = take_chunk_buffer(estimated);
                for row in chunk {
                    encode_row_or_null(&mut buf, column_count, |row_buf| self.encode_row(row_buf, row));
                }
                buf
            })
            .collect();

        // Merge only ~num_threads chunk buffers instead of N row buffers
        let header_size = msgpack_array_header_size(rows.len());
        let total_chunk_bytes: usize = chunk_buffers.iter().map(|b| b.len()).sum();
        let mut buffer = Vec::with_capacity(header_size + total_chunk_bytes);

        encode::write_array_len(&mut buffer, rows.len() as u32)
            .map_err(Self::map_encode_err)?;
        for chunk_buf in chunk_buffers {
            buffer.extend_from_slice(&chunk_buf);
            return_chunk_buffer(chunk_buf);
        }

        Ok(buffer)
    }

    /// Encode a single row as a MessagePack array
    #[inline]
    fn encode_row<W: Write>(&self, buf: &mut W, row: &Row) -> Result<()> {
        encode::write_array_len(buf, self.column_count as u32)
            .map_err(Self::map_encode_err)?;

        for i in 0..self.column_count {
            self.encode_cell(buf, row.as_ref(i))?;
        }

        Ok(())
    }

    /// Encode a single cell value with fast stack-buffer formatters
    #[inline]
    fn encode_cell<W: Write>(&self, buf: &mut W, value: Option<&Value>) -> Result<()> {
        match value {
            None | Some(Value::NULL) => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }

            Some(Value::Bytes(bytes)) => {
                match std::str::from_utf8(bytes) {
                    Ok(s) => {
                        encode::write_str(buf, s).map_err(Self::map_encode_err)?;
                    }
                    Err(_) => {
                        let b64 = BASE64_STANDARD.encode(bytes);
                        encode::write_str(buf, &b64).map_err(Self::map_encode_err)?;
                    }
                }
            }

            Some(Value::Int(i)) => {
                encode::write_i64(buf, *i).map_err(Self::map_encode_err)?;
            }

            Some(Value::UInt(u)) => {
                encode::write_u64(buf, *u).map_err(Self::map_encode_err)?;
            }

            Some(Value::Float(f)) => {
                encode::write_f32(buf, *f).map_err(Self::map_encode_err)?;
            }

            Some(Value::Double(d)) => {
                encode::write_f64(buf, *d).map_err(Self::map_encode_err)?;
            }

            Some(Value::Date(year, month, day, hour, min, sec, micro)) => {
                if *micro > 0 {
                    let mut ts_buf = [0u8; 26];
                    format_datetime_fast(
                        &mut ts_buf, *year, *month, *day, *hour, *min, *sec, *micro,
                    );
                    let s = unsafe { std::str::from_utf8_unchecked(&ts_buf) };
                    encode::write_str(buf, s).map_err(Self::map_encode_err)?;
                } else if *hour == 0 && *min == 0 && *sec == 0 {
                    let mut date_buf = [0u8; 10];
                    format_date_fast(&mut date_buf, *year, *month, *day);
                    let s = unsafe { std::str::from_utf8_unchecked(&date_buf) };
                    encode::write_str(buf, s).map_err(Self::map_encode_err)?;
                } else {
                    let mut ts_buf = [0u8; 19];
                    format_datetime_no_micros(
                        &mut ts_buf, *year, *month, *day, *hour, *min, *sec,
                    );
                    let s = unsafe { std::str::from_utf8_unchecked(&ts_buf) };
                    encode::write_str(buf, s).map_err(Self::map_encode_err)?;
                }
            }

            Some(Value::Time(is_neg, days, hours, mins, secs, micros)) => {
                let total_hours = *days * 24 + (*hours as u32);
                // Stack buffer: sign(1) + hours(up to 10 for u32) + :MM:SS(6) + .ffffff(7) = 24 max
                let mut time_buf = [0u8; 26];
                let mut pos = 0;
                if *is_neg {
                    time_buf[pos] = b'-';
                    pos += 1;
                }
                if total_hours >= 100 {
                    // Use itoa for large hour values
                    let mut itoa_buf = itoa::Buffer::new();
                    let s = itoa_buf.format(total_hours);
                    time_buf[pos..pos + s.len()].copy_from_slice(s.as_bytes());
                    pos += s.len();
                } else {
                    write_2digits(&mut time_buf, pos, total_hours);
                    pos += 2;
                }
                time_buf[pos] = b':';
                pos += 1;
                write_2digits(&mut time_buf, pos, *mins as u32);
                pos += 2;
                time_buf[pos] = b':';
                pos += 1;
                write_2digits(&mut time_buf, pos, *secs as u32);
                pos += 2;
                if *micros > 0 {
                    time_buf[pos] = b'.';
                    pos += 1;
                    write_6digits(&mut time_buf, pos, *micros);
                    pos += 6;
                }
                let s = unsafe { std::str::from_utf8_unchecked(&time_buf[..pos]) };
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }
        }

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
