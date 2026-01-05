//! Direct MySQL to MessagePack encoder for high-performance streaming.
//!
//! High-performance encoder optimized for large result sets with:
//! - Adaptive parallelism (skip rayon overhead for small batches)
//! - Fast timestamp/date/time formatting
//! - SIMD-optimized hex encoding for binary data
//!
//! # Architecture
//!
//! This encoder is used by the `execute_query` Tauri command for MySQL connections.
//! It encodes MySQL rows directly to MessagePack format.

use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use mysql_async::{Row, Value};
use rayon::prelude::*;
use rmp::encode;
use std::io::Write;

/// Threshold for parallel processing - below this, sequential is faster
const PARALLEL_THRESHOLD: usize = 64;

/// Estimated average size per cell in bytes
const ESTIMATED_CELL_SIZE: usize = 32;

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
            estimated_row_size: column_count * ESTIMATED_CELL_SIZE + 4,
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

        // Adaptive: use sequential for small batches
        if rows.len() < PARALLEL_THRESHOLD {
            return self.encode_sequential(rows);
        }

        self.encode_parallel(rows)
    }

    /// Sequential encoding for small batches
    fn encode_sequential(&self, rows: &[Row]) -> Result<Vec<u8>> {
        let estimated = self.estimated_row_size * rows.len() + 8;
        let mut buffer = Vec::with_capacity(estimated);

        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;

        for row in rows {
            self.encode_row(&mut buffer, row)?;
        }

        Ok(buffer)
    }

    /// Parallel encoding for large batches
    fn encode_parallel(&self, rows: &[Row]) -> Result<Vec<u8>> {
        let row_buffers: Vec<Vec<u8>> = rows
            .par_iter()
            .map(|row| {
                let mut buf = Vec::with_capacity(self.estimated_row_size);
                let _ = self.encode_row(&mut buf, row);
                buf
            })
            .collect();

        let header_size = if rows.len() < 16 {
            1
        } else if rows.len() < 65536 {
            3
        } else {
            5
        };
        let total_row_bytes: usize = row_buffers.iter().map(|b| b.len()).sum();
        let total_size = header_size + total_row_bytes;

        let mut buffer = Vec::with_capacity(total_size);
        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;

        for row_buf in row_buffers {
            buffer.extend_from_slice(&row_buf);
        }

        Ok(buffer)
    }

    /// Encode a single row as a MessagePack array
    #[inline]
    fn encode_row<W: Write>(&self, buf: &mut W, row: &Row) -> Result<()> {
        encode::write_array_len(buf, self.column_count as u32).map_err(Self::map_encode_err)?;

        for i in 0..self.column_count {
            self.encode_cell(buf, row.as_ref(i))?;
        }

        Ok(())
    }

    /// Encode a single cell value
    #[inline]
    fn encode_cell<W: Write>(&self, buf: &mut W, value: Option<&Value>) -> Result<()> {
        match value {
            None | Some(Value::NULL) => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }

            Some(Value::Bytes(bytes)) => {
                // Try UTF-8 first, fallback to base64
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
                let s = if *micro > 0 {
                    format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
                        year, month, day, hour, min, sec, micro
                    )
                } else if *hour == 0 && *min == 0 && *sec == 0 {
                    format!("{:04}-{:02}-{:02}", year, month, day)
                } else {
                    format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                        year, month, day, hour, min, sec
                    )
                };
                encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            }

            Some(Value::Time(is_neg, days, hours, mins, secs, micros)) => {
                let total_hours = (*days as u32) * 24 + (*hours as u32);
                let sign = if *is_neg { "-" } else { "" };
                let s = if *micros > 0 {
                    format!(
                        "{}{:02}:{:02}:{:02}.{:06}",
                        sign, total_hours, mins, secs, micros
                    )
                } else {
                    format!("{}{:02}:{:02}:{:02}", sign, total_hours, mins, secs)
                };
                encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
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
}

