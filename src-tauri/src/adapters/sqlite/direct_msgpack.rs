//! Direct SQLite to MessagePack encoder for high-performance streaming.
//!
//! High-performance encoder optimized for SQLite result sets with:
//! - Adaptive parallelism via rayon for large batches
//! - Two-phase design: collect owned values (sequential), encode (parallel)
//!
//! rusqlite::Row is borrowed from the Statement and cannot be sent across
//! threads. We work around this by collecting cell values into `OwnedCell`
//! during the sequential iteration, then encoding them in parallel with rayon.

use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rayon::prelude::*;
use rmp::encode;
use rusqlite::types::ValueRef;
use rusqlite::Row;
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
        tracing::warn!("SQLite row encode failed (chunked): {}", e);
        // Drop partial row bytes to preserve MsgPack row boundaries.
        buf.truncate(row_start);
        write_null_row(buf, column_count);
    }
}

/// Owned cell value extracted from a rusqlite Row.
/// This is Send + Sync, unlike rusqlite::ValueRef which borrows from the Row.
pub enum OwnedCell {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl OwnedCell {
    /// Extract an owned cell from a rusqlite row at the given index
    pub fn from_row(row: &Row, idx: usize) -> Self {
        match row.get_ref(idx).ok() {
            None | Some(ValueRef::Null) => OwnedCell::Null,
            Some(ValueRef::Integer(i)) => OwnedCell::Integer(i),
            Some(ValueRef::Real(f)) => OwnedCell::Real(f),
            Some(ValueRef::Text(bytes)) => match std::str::from_utf8(bytes) {
                Ok(s) => OwnedCell::Text(s.to_string()),
                Err(_) => OwnedCell::Text(BASE64_STANDARD.encode(bytes)),
            },
            Some(ValueRef::Blob(bytes)) => OwnedCell::Blob(bytes.to_vec()),
        }
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

/// Direct SQLite to MessagePack encoder
pub struct DirectMsgPackEncoder {
    column_count: usize,
    estimated_row_size: usize,
}

impl DirectMsgPackEncoder {
    /// Create new encoder with column count
    pub fn new(column_count: usize) -> Self {
        // SQLite has simple types, ~20 bytes per cell on average
        let estimated_row_size = column_count * 20 + msgpack_array_header_size(column_count);
        Self {
            column_count,
            estimated_row_size,
        }
    }

    /// Collect a rusqlite Row into a Vec of owned cell values.
    /// This must be called sequentially (rusqlite Row is borrowed).
    pub fn collect_row(&self, row: &Row) -> Vec<OwnedCell> {
        (0..self.column_count)
            .map(|i| OwnedCell::from_row(row, i))
            .collect()
    }

    /// Encode a batch of owned rows to MessagePack with adaptive parallelism.
    ///
    /// - Small batches (< 64 rows): sequential encoding
    /// - Large batches: parallel encoding with rayon
    pub fn encode_owned_batch(&self, rows: &[Vec<OwnedCell>]) -> Result<Vec<u8>> {
        if rows.is_empty() {
            let mut buf = Vec::with_capacity(8);
            encode::write_array_len(&mut buf, 0).map_err(Self::map_encode_err)?;
            return Ok(buf);
        }

        if rows.len() < PARALLEL_THRESHOLD {
            return self.encode_owned_sequential(rows);
        }

        self.encode_owned_parallel(rows)
    }

    /// Sequential encoding for small batches
    pub(crate) fn encode_owned_sequential(&self, rows: &[Vec<OwnedCell>]) -> Result<Vec<u8>> {
        let estimated = self.estimated_row_size * rows.len() + 8;
        let mut buffer = Vec::with_capacity(estimated);

        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;

        for row in rows {
            self.encode_owned_row(&mut buffer, row)?;
        }

        Ok(buffer)
    }

    /// Chunked parallel encoding for large batches.
    /// Each rayon thread gets one buffer for its chunk of rows,
    /// reducing allocations from N (one per row) to ~num_threads.
    pub(crate) fn encode_owned_parallel(&self, rows: &[Vec<OwnedCell>]) -> Result<Vec<u8>> {
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
                        self.encode_owned_row(row_buf, row)
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

    /// Encode a single owned row as a MessagePack array
    #[inline]
    fn encode_owned_row<W: Write>(&self, buf: &mut W, cells: &[OwnedCell]) -> Result<()> {
        encode::write_array_len(buf, cells.len() as u32).map_err(Self::map_encode_err)?;

        for cell in cells {
            self.encode_owned_cell(buf, cell)?;
        }

        Ok(())
    }

    /// Encode an owned cell value to MessagePack
    #[inline]
    fn encode_owned_cell<W: Write>(&self, buf: &mut W, cell: &OwnedCell) -> Result<()> {
        match cell {
            OwnedCell::Null => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }
            OwnedCell::Integer(i) => {
                encode::write_i64(buf, *i).map_err(Self::map_encode_err)?;
            }
            OwnedCell::Real(f) => {
                encode::write_f64(buf, *f).map_err(Self::map_encode_err)?;
            }
            OwnedCell::Text(s) => {
                encode::write_str(buf, s).map_err(Self::map_encode_err)?;
            }
            OwnedCell::Blob(bytes) => {
                let b64 = BASE64_STANDARD.encode(bytes);
                encode::write_str(buf, &b64).map_err(Self::map_encode_err)?;
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
    fn test_msgpack_array_header_size() {
        assert_eq!(msgpack_array_header_size(0), 1);
        assert_eq!(msgpack_array_header_size(15), 1);
        assert_eq!(msgpack_array_header_size(16), 3);
        assert_eq!(msgpack_array_header_size(65536), 5);
    }

    #[test]
    fn test_chunked_parallel_matches_sequential() {
        let encoder = DirectMsgPackEncoder::new(3);
        let rows: Vec<Vec<OwnedCell>> = (0..128)
            .map(|i| {
                vec![
                    OwnedCell::Integer(i as i64),
                    OwnedCell::Text(format!("row_{}", i)),
                    OwnedCell::Real(i as f64 * 1.5),
                ]
            })
            .collect();

        let sequential_result = encoder.encode_owned_sequential(&rows).unwrap();
        let parallel_result = encoder.encode_owned_parallel(&rows).unwrap();

        let seq_decoded: rmpv::Value =
            rmpv::decode::read_value(&mut &sequential_result[..]).unwrap();
        let par_decoded: rmpv::Value = rmpv::decode::read_value(&mut &parallel_result[..]).unwrap();

        let seq_arr = seq_decoded.as_array().unwrap();
        let par_arr = par_decoded.as_array().unwrap();
        assert_eq!(seq_arr.len(), par_arr.len());
        assert_eq!(seq_arr.len(), 128);

        for idx in [0, 63, 127] {
            let s = seq_arr[idx].as_array().unwrap();
            let p = par_arr[idx].as_array().unwrap();
            assert_eq!(s[0].as_i64(), p[0].as_i64(), "row {} col 0", idx);
            assert_eq!(s[1].as_str(), p[1].as_str(), "row {} col 1", idx);
        }
    }

    #[test]
    fn test_encode_owned_cells() {
        let encoder = DirectMsgPackEncoder::new(3);
        let row = vec![
            OwnedCell::Integer(42),
            OwnedCell::Text("hello".to_string()),
            OwnedCell::Null,
        ];
        let rows = vec![row];
        let result = encoder.encode_owned_batch(&rows).unwrap();
        assert!(!result.is_empty());

        // Decode and verify structure: outer array of 1 row, inner array of 3 cells
        let decoded: rmpv::Value = rmpv::decode::read_value(&mut &result[..]).unwrap();
        let outer = decoded.as_array().expect("outer should be array");
        assert_eq!(outer.len(), 1);
        let inner = outer[0].as_array().expect("row should be array");
        assert_eq!(inner.len(), 3);
        assert_eq!(inner[0].as_i64(), Some(42));
        assert_eq!(inner[1].as_str(), Some("hello"));
        assert!(inner[2].is_nil());
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
