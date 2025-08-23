use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use geojson::GeoJson;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use tiberius::{ColumnType, Row};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use uuid::Uuid;
use wkt::TryFromWkt;

use crate::error::AppError;

pub struct MssqlValueConverter;

impl MssqlValueConverter {
    pub fn new() -> Self {
        Self
    }

    pub fn convert_row_value(&self, row: &Row, index: usize, db_type: &str) -> Result<Value, AppError> {
        let col = row.columns()
            .get(index)
            .ok_or_else(|| AppError::Database(format!("Column index {} out of bounds", index)))?;

        match col.column_type() {
            ColumnType::Null => Ok(Value::Null),
            
            // Numeric types
            ColumnType::Bit => {
                Ok(row.get::<bool, _>(index)
                    .map(Value::Bool)
                    .unwrap_or(Value::Null))
            }
            ColumnType::Int1 => {
                Ok(row.get::<i8, _>(index)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null))
            }
            ColumnType::Int2 => {
                Ok(row.get::<i16, _>(index)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null))
            }
            ColumnType::Int4 => {
                Ok(row.get::<i32, _>(index)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null))
            }
            ColumnType::Int8 => {
                Ok(row.get::<i64, _>(index)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null))
            }
            ColumnType::Float4 => {
                Ok(row.get::<f32, _>(index)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null))
            }
            ColumnType::Float8 => {
                Ok(row.get::<f64, _>(index)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null))
            }
            
            // Decimal types
            ColumnType::Money | ColumnType::Money4 => {
                Ok(row.get::<Decimal, _>(index)
                    .map(|v| json!({
                        "value": v.to_string(),
                        "type": "money"
                    }))
                    .unwrap_or(Value::Null))
            }
            ColumnType::Decimaln | ColumnType::Numericn => {
                Ok(row.get::<Decimal, _>(index)
                    .map(|v| json!(v.to_string()))
                    .unwrap_or(Value::Null))
            }
            
            // String types
            ColumnType::BigVarChar | ColumnType::VarChar | ColumnType::NVarChar |
            ColumnType::BigChar | ColumnType::Char | ColumnType::NChar |
            ColumnType::Text | ColumnType::NText => {
                Ok(row.get::<&str, _>(index)
                    .map(|s| Value::String(s.to_string()))
                    .unwrap_or(Value::Null))
            }
            
            // XML type
            ColumnType::Xml => {
                Ok(row.get::<&str, _>(index)
                    .map(|s| json!({
                        "type": "xml",
                        "value": s
                    }))
                    .unwrap_or(Value::Null))
            }
            
            // Date/Time types
            ColumnType::Date => {
                Ok(row.get::<NaiveDate, _>(index)
                    .map(|d| Value::String(d.format("%Y-%m-%d").to_string()))
                    .unwrap_or(Value::Null))
            }
            ColumnType::Time => {
                Ok(row.get::<NaiveTime, _>(index)
                    .map(|t| Value::String(t.format("%H:%M:%S%.f").to_string()))
                    .unwrap_or(Value::Null))
            }
            ColumnType::DateTime | ColumnType::DateTime4 => {
                Ok(row.get::<NaiveDateTime, _>(index)
                    .map(|dt| Value::String(dt.format("%Y-%m-%d %H:%M:%S%.f").to_string()))
                    .unwrap_or(Value::Null))
            }
            ColumnType::DateTime2 => {
                Ok(row.get::<NaiveDateTime, _>(index)
                    .map(|dt| Value::String(dt.format("%Y-%m-%dT%H:%M:%S%.f").to_string()))
                    .unwrap_or(Value::Null))
            }
            ColumnType::DateTimeOffset => {
                Ok(row.get::<DateTime<Utc>, _>(index)
                    .map(|dt| Value::String(dt.to_rfc3339()))
                    .unwrap_or(Value::Null))
            }
            
            // Binary types
            ColumnType::BigVarBin | ColumnType::VarBinary | ColumnType::Binary |
            ColumnType::Image => {
                Ok(row.get::<&[u8], _>(index)
                    .map(|bytes| Value::String(BASE64.encode(bytes)))
                    .unwrap_or(Value::Null))
            }
            
            // UUID type
            ColumnType::Guid => {
                Ok(row.get::<Uuid, _>(index)
                    .map(|uuid| Value::String(uuid.to_string()))
                    .unwrap_or(Value::Null))
            }
            
            // Special types - handle as strings or JSON
            _ => {
                // Try to handle special types based on the db_type string
                if db_type.contains("hierarchyid") {
                    self.convert_hierarchyid(row, index)
                } else if db_type.contains("geography") || db_type.contains("geometry") {
                    self.convert_spatial(row, index)
                } else if db_type.contains("sql_variant") {
                    self.convert_sql_variant(row, index)
                } else {
                    // Fallback to string representation
                    Ok(row.get::<&str, _>(index)
                        .map(|s| Value::String(s.to_string()))
                        .unwrap_or(Value::Null))
                }
            }
        }
    }

    fn convert_hierarchyid(&self, row: &Row, index: usize) -> Result<Value, AppError> {
        // HierarchyID is typically returned as a string path like "/1/2/3/"
        Ok(row.get::<&str, _>(index)
            .map(|s| json!({
                "type": "hierarchyid",
                "path": s,
                "level": s.split('/').filter(|p| !p.is_empty()).count()
            }))
            .unwrap_or(Value::Null))
    }

    fn convert_spatial(&self, row: &Row, index: usize) -> Result<Value, AppError> {
        // Spatial data is typically returned as WKT or WKB
        // We'll try to parse it as WKT and convert to GeoJSON
        if let Some(wkt_str) = row.get::<&str, _>(index) {
            // Try to parse WKT and convert to GeoJSON
            if let Ok(geometry) = geo_types::Geometry::<f64>::try_from_wkt_str(wkt_str) {
                if let Ok(geojson) = serde_json::to_value(&GeoJson::from(&geometry)) {
                    return Ok(json!({
                        "type": "spatial",
                        "format": "geojson",
                        "value": geojson
                    }));
                }
            }
            
            // If WKT parsing fails, return the raw string
            Ok(json!({
                "type": "spatial",
                "format": "wkt",
                "value": wkt_str
            }))
        } else if let Some(bytes) = row.get::<&[u8], _>(index) {
            // If we get binary data (WKB), convert to base64
            Ok(json!({
                "type": "spatial",
                "format": "wkb",
                "value": BASE64.encode(bytes)
            }))
        } else {
            Ok(Value::Null)
        }
    }

    fn convert_sql_variant(&self, row: &Row, index: usize) -> Result<Value, AppError> {
        // SQL_VARIANT can contain any type, so we need dynamic detection
        // Try different types in order of likelihood
        
        if let Some(s) = row.get::<&str, _>(index) {
            return Ok(Value::String(s.to_string()));
        }
        
        if let Some(i) = row.get::<i64, _>(index) {
            return Ok(json!(i));
        }
        
        if let Some(f) = row.get::<f64, _>(index) {
            return Ok(json!(f));
        }
        
        if let Some(b) = row.get::<bool, _>(index) {
            return Ok(Value::Bool(b));
        }
        
        if let Some(dt) = row.get::<NaiveDateTime, _>(index) {
            return Ok(Value::String(dt.format("%Y-%m-%d %H:%M:%S%.f").to_string()));
        }
        
        // If all else fails, try to get as bytes
        if let Some(bytes) = row.get::<&[u8], _>(index) {
            return Ok(Value::String(BASE64.encode(bytes)));
        }
        
        Ok(Value::Null)
    }

}

impl Default for MssqlValueConverter {
    fn default() -> Self {
        Self::new()
    }
}