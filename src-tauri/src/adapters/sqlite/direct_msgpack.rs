//! Direct SQLite to MessagePack encoder for high-performance streaming.
//!
//! High-performance encoder for SQLite result sets.

use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rmp::encode;
use rusqlite::types::ValueRef;
use rusqlite::Row;
use std::io::Write;

/// Direct SQLite to MessagePack encoder
pub struct DirectMsgPackEncoder {
    column_count: usize,
}

impl DirectMsgPackEncoder {
    /// Create new encoder with column count
    pub fn new(column_count: usize) -> Self {
        Self { column_count }
    }

    /// Encode a single row to MessagePack bytes
    pub fn encode_row(&self, row: &Row) -> Result<Vec<u8>> {
        let estimated = self.column_count * 32 + 8;
        let mut buffer = Vec::with_capacity(estimated);

        encode::write_array_len(&mut buffer, self.column_count as u32)
            .map_err(Self::map_encode_err)?;

        for i in 0..self.column_count {
            self.encode_cell(&mut buffer, row.get_ref(i).ok())?;
        }

        Ok(buffer)
    }

    /// Encode multiple rows to a single MessagePack array
    pub fn encode_batch(&self, rows: &[Vec<u8>]) -> Result<Vec<u8>> {
        if rows.is_empty() {
            let mut buf = Vec::with_capacity(8);
            encode::write_array_len(&mut buf, 0).map_err(Self::map_encode_err)?;
            return Ok(buf);
        }

        let total_size: usize = rows.iter().map(|r| r.len()).sum();
        let header_size = if rows.len() < 16 {
            1
        } else if rows.len() < 65536 {
            3
        } else {
            5
        };

        let mut buffer = Vec::with_capacity(header_size + total_size);
        encode::write_array_len(&mut buffer, rows.len() as u32).map_err(Self::map_encode_err)?;

        for row in rows {
            buffer.extend_from_slice(row);
        }

        Ok(buffer)
    }

    /// Encode a single cell value
    #[inline]
    fn encode_cell<W: Write>(&self, buf: &mut W, value: Option<ValueRef>) -> Result<()> {
        match value {
            None | Some(ValueRef::Null) => {
                encode::write_nil(buf).map_err(Self::map_io_err)?;
            }
            Some(ValueRef::Integer(i)) => {
                encode::write_i64(buf, i).map_err(Self::map_encode_err)?;
            }
            Some(ValueRef::Real(f)) => {
                encode::write_f64(buf, f).map_err(Self::map_encode_err)?;
            }
            Some(ValueRef::Text(bytes)) => {
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
            Some(ValueRef::Blob(bytes)) => {
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
}

