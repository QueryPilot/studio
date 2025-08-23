use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use geojson::GeoJson;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use sqlx::mysql::{MySqlRow, MySqlTypeInfo, MySqlValueRef};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use wkt::TryFromWkt;

use crate::error::AppError;

pub struct MySqlEnhancedValueConverter {
    is_mariadb: bool,
}

impl MySqlEnhancedValueConverter {
    pub fn new(is_mariadb: bool) -> Self {
        Self { is_mariadb }
    }

    pub fn convert_row_value(&self, row: &MySqlRow, index: usize) -> Result<Value, AppError> {
        let column = row.columns()
            .get(index)
            .ok_or_else(|| AppError::Database(format!("Column index {} out of bounds", index)))?;
        
        let type_info = column.type_info();
        let type_name = type_info.name();
        
        // Handle NULL values
        if row.try_get_raw(index)
            .map_err(|e| AppError::Database(e.to_string()))?
            .is_null() {
            return Ok(Value::Null);
        }
        
        match type_name {
            // Numeric types
            "TINYINT" | "BOOL" | "BOOLEAN" => {
                if type_name == "BOOL" || type_name == "BOOLEAN" {
                    row.try_get::<bool, _>(index)
                        .map(Value::Bool)
                        .map_err(|e| AppError::Database(e.to_string()))
                } else {
                    row.try_get::<i8, _>(index)
                        .map(|v| json!(v))
                        .map_err(|e| AppError::Database(e.to_string()))
                }
            }
            "SMALLINT" => {
                row.try_get::<i16, _>(index)
                    .map(|v| json!(v))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            "MEDIUMINT" | "INT" | "INTEGER" => {
                row.try_get::<i32, _>(index)
                    .map(|v| json!(v))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            "BIGINT" => {
                row.try_get::<i64, _>(index)
                    .map(|v| json!(v))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            "FLOAT" => {
                row.try_get::<f32, _>(index)
                    .map(|v| json!(v))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            "DOUBLE" | "DOUBLE PRECISION" | "REAL" => {
                row.try_get::<f64, _>(index)
                    .map(|v| json!(v))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            "DECIMAL" | "NUMERIC" | "DEC" | "FIXED" => {
                row.try_get::<Decimal, _>(index)
                    .map(|v| json!(v.to_string()))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            
            // Date/Time types
            "DATE" => {
                row.try_get::<NaiveDate, _>(index)
                    .map(|d| Value::String(d.format("%Y-%m-%d").to_string()))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            "TIME" => {
                row.try_get::<NaiveTime, _>(index)
                    .map(|t| Value::String(t.format("%H:%M:%S").to_string()))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            "DATETIME" | "TIMESTAMP" => {
                row.try_get::<NaiveDateTime, _>(index)
                    .map(|dt| Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            "YEAR" => {
                row.try_get::<i16, _>(index)
                    .map(|y| json!(y))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            
            // String types
            "CHAR" | "VARCHAR" | "TINYTEXT" | "TEXT" | "MEDIUMTEXT" | "LONGTEXT" => {
                row.try_get::<String, _>(index)
                    .map(Value::String)
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            
            // Binary types
            "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" => {
                use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
                row.try_get::<Vec<u8>, _>(index)
                    .map(|bytes| Value::String(BASE64.encode(bytes)))
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            
            // JSON type
            "JSON" => {
                row.try_get::<serde_json::Value, _>(index)
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            
            // BIT type
            "BIT" => {
                self.convert_bit_type(row, index)
            }
            
            // ENUM and SET types
            "ENUM" | "SET" => {
                row.try_get::<String, _>(index)
                    .map(|s| {
                        if type_name == "SET" {
                            // SET values are comma-separated
                            json!({
                                "type": "set",
                                "values": s.split(',').map(|v| v.trim()).collect::<Vec<_>>()
                            })
                        } else {
                            Value::String(s)
                        }
                    })
                    .map_err(|e| AppError::Database(e.to_string()))
            }
            
            // Spatial types
            "GEOMETRY" | "POINT" | "LINESTRING" | "POLYGON" | 
            "MULTIPOINT" | "MULTILINESTRING" | "MULTIPOLYGON" | "GEOMETRYCOLLECTION" => {
                self.convert_spatial_type(row, index, type_name)
            }
            
            _ => {
                // Fallback to string representation
                row.try_get::<String, _>(index)
                    .map(Value::String)
                    .or_else(|_| {
                        // If string fails, try as bytes
                        use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
                        row.try_get::<Vec<u8>, _>(index)
                            .map(|bytes| Value::String(BASE64.encode(bytes)))
                    })
                    .map_err(|e| AppError::Database(format!("Unsupported type {}: {}", type_name, e)))
            }
        }
    }
    
    fn convert_bit_type(&self, row: &MySqlRow, index: usize) -> Result<Value, AppError> {
        // BIT type can be 1-64 bits
        // Try to get as u64 first, then convert to binary string
        if let Ok(val) = row.try_get::<u64, _>(index) {
            Ok(json!({
                "type": "bit",
                "decimal": val,
                "binary": format!("{:b}", val)
            }))
        } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(index) {
            // Convert bytes to bit string
            let bit_string = bytes.iter()
                .map(|b| format!("{:08b}", b))
                .collect::<String>();
            Ok(json!({
                "type": "bit",
                "binary": bit_string
            }))
        } else {
            Ok(Value::Null)
        }
    }
    
    fn convert_spatial_type(&self, row: &MySqlRow, index: usize, type_name: &str) -> Result<Value, AppError> {
        // MySQL spatial data is typically stored as WKB (Well-Known Binary)
        // We need to convert it to a more usable format
        
        if let Ok(bytes) = row.try_get::<Vec<u8>, _>(index) {
            // MySQL stores spatial data with a 4-byte SRID prefix
            // Skip it if present
            let wkb_bytes = if bytes.len() > 4 {
                &bytes[4..]
            } else {
                &bytes
            };
            
            // Try to parse WKB and convert to GeoJSON
            // For now, return as base64-encoded WKB
            use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
            Ok(json!({
                "type": "spatial",
                "subtype": type_name.to_lowercase(),
                "format": "wkb",
                "value": BASE64.encode(wkb_bytes)
            }))
        } else if let Ok(wkt_str) = row.try_get::<String, _>(index) {
            // Some MySQL functions return WKT format
            if let Ok(geometry) = geo_types::Geometry::<f64>::try_from_wkt_str(&wkt_str) {
                if let Ok(geojson) = serde_json::to_value(&GeoJson::from(&geometry)) {
                    return Ok(json!({
                        "type": "spatial",
                        "subtype": type_name.to_lowercase(),
                        "format": "geojson",
                        "value": geojson
                    }));
                }
            }
            
            // If WKT parsing fails, return the raw string
            Ok(json!({
                "type": "spatial",
                "subtype": type_name.to_lowercase(),
                "format": "wkt",
                "value": wkt_str
            }))
        } else {
            Ok(Value::Null)
        }
    }
    
    pub fn supports_returning_clause(&self) -> bool {
        // MariaDB supports RETURNING clause, MySQL doesn't (until MySQL 8.0.21+)
        self.is_mariadb
    }
    
    pub fn supports_window_functions(&self) -> bool {
        // Both MySQL 8.0+ and MariaDB 10.2+ support window functions
        // This would need version checking for accuracy
        true
    }
    
    pub fn supports_ctes(&self) -> bool {
        // Both MySQL 8.0+ and MariaDB 10.2.1+ support CTEs
        // This would need version checking for accuracy
        true
    }
}

impl Default for MySqlEnhancedValueConverter {
    fn default() -> Self {
        Self::new(false)
    }
}