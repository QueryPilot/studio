//! Direct SQL Server to MessagePack encoder for high-performance streaming.
//!
//! High-performance encoder for SQL Server result sets.

use crate::error::{AppError, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rmp::encode;
use std::io::Write;
use tiberius::Row;

/// Direct SQL Server to MessagePack encoder
pub struct DirectMsgPackEncoder {
    column_count: usize,
}

impl DirectMsgPackEncoder {
    /// Create new encoder with column count
    pub fn new(column_count: usize) -> Self {
        Self { column_count }
    }

    /// Create encoder from a row
    pub fn from_row(row: &Row) -> Self {
        Self::new(row.len())
    }

    /// Encode a single row to MessagePack bytes
    pub fn encode_row(&self, row: &Row) -> Result<Vec<u8>> {
        let estimated = self.column_count * 32 + 8;
        let mut buffer = Vec::with_capacity(estimated);

        encode::write_array_len(&mut buffer, self.column_count as u32)
            .map_err(Self::map_encode_err)?;

        for i in 0..self.column_count {
            self.encode_cell(&mut buffer, row, i)?;
        }

        Ok(buffer)
    }

    /// Encode a single cell value by trying different types
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
        if let Some(v) = row.try_get::<uuid::Uuid, _>(idx).ok().flatten() {
            let s = v.to_string();
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<&[u8], _>(idx).ok().flatten() {
            let b64 = BASE64_STANDARD.encode(v);
            encode::write_str(buf, &b64).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        // DateTime types
        if let Some(v) = row.try_get::<chrono::NaiveDateTime, _>(idx).ok().flatten() {
            let s = v.to_string();
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row
            .try_get::<chrono::DateTime<chrono::FixedOffset>, _>(idx)
            .ok()
            .flatten()
        {
            let s = v.to_rfc3339();
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row
            .try_get::<chrono::DateTime<chrono::Utc>, _>(idx)
            .ok()
            .flatten()
        {
            let s = v.to_rfc3339();
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<chrono::NaiveDate, _>(idx).ok().flatten() {
            let s = v.to_string();
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
            return Ok(());
        }
        if let Some(v) = row.try_get::<chrono::NaiveTime, _>(idx).ok().flatten() {
            let s = v.to_string();
            encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
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
}
