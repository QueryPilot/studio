use bson::{Bson, Decimal128};
use crate::database::cell_value::{CellValue, CellValueType, CellMetadata};
use std::collections::HashMap;

pub struct BsonConverter;

impl BsonConverter {
    pub fn new() -> Self {
        Self
    }
    
    pub fn bson_to_cell_value(&self, bson: &Bson, _field_name: &str) -> CellValue {
        match bson {
            Bson::Null => CellValue::null("null"),
            
            Bson::String(s) => {
                // Check if it's a UUID pattern
                if s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                    CellValue {
                        value: Some(serde_json::Value::String(s.clone())),
                        db_type: "ObjectId".to_string(),
                        value_type: CellValueType::Text,
                        metadata: None,
                        is_truncated: false,
                        byte_size: Some(s.len()),
                    }
                } else {
                    CellValue::text(s.clone(), "string")
                }
            }
            
            Bson::Int32(i) => CellValue::integer(*i as i64, "int32"),
            
            Bson::Int64(i) => CellValue::integer(*i, "int64"),
            
            Bson::Double(d) => CellValue::decimal(*d, "double", None, None),
            
            Bson::Decimal128(d) => {
                // Decimal128 has high precision
                let precision = 34; // MongoDB Decimal128 max precision
                let scale = self.extract_decimal_scale(d);
                
                match d.to_string().parse::<f64>() {
                    Ok(f) => CellValue::decimal(f, "decimal128", Some(precision), scale),
                    Err(_) => CellValue::text(d.to_string(), "decimal128")
                }
            }
            
            Bson::Boolean(b) => CellValue::boolean(*b, "boolean"),
            
            Bson::DateTime(dt) => {
                let chrono_dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(dt.timestamp_millis())
                    .unwrap_or_else(|| chrono::Utc::now());
                CellValue {
                    value: Some(serde_json::Value::String(chrono_dt.to_rfc3339())),
                    db_type: "date".to_string(),
                    value_type: CellValueType::DateTime,
                    metadata: Some(CellMetadata {
                        timezone: Some("UTC".to_string()),
                        ..Default::default()
                    }),
                    is_truncated: false,
                    byte_size: None,
                }
            }
            
            Bson::Binary(binary) => {
                let hex_string = hex::encode(&binary.bytes);
                CellValue {
                    value: Some(serde_json::Value::String(hex_string.clone())),
                    db_type: format!("binary({})", u8::from(binary.subtype)),
                    value_type: CellValueType::Binary,
                    metadata: Some(CellMetadata {
                        attributes: Some({
                            let mut attrs = HashMap::new();
                            attrs.insert("subtype".to_string(), serde_json::Value::Number((u8::from(binary.subtype)).into()));
                            attrs
                        }),
                        ..Default::default()
                    }),
                    is_truncated: false,
                    byte_size: Some(binary.bytes.len()),
                }
            }
            
            Bson::ObjectId(oid) => {
                let oid_string = oid.to_hex();
                CellValue {
                    value: Some(serde_json::Value::String(oid_string.clone())),
                    db_type: "objectId".to_string(),
                    value_type: CellValueType::Text, // Could be a specialized ObjectId type
                    metadata: Some(CellMetadata {
                        attributes: Some({
                            let mut attrs = HashMap::new();
                            attrs.insert("timestamp".to_string(), serde_json::Value::Number(oid.timestamp().timestamp_millis().into()));
                            attrs
                        }),
                        ..Default::default()
                    }),
                    is_truncated: false,
                    byte_size: Some(24), // ObjectId is always 24 hex chars
                }
            }
            
            Bson::Array(arr) => {
                let json_array: Vec<serde_json::Value> = arr.iter()
                    .map(|item| self.bson_to_json_value(item))
                    .collect();
                
                // Determine array element type
                let element_type = if !arr.is_empty() {
                    self.infer_bson_type(&arr[0])
                } else {
                    "mixed".to_string()
                };
                
                CellValue {
                    value: Some(serde_json::Value::Array(json_array)),
                    db_type: "array".to_string(),
                    value_type: CellValueType::Array,
                    metadata: Some(CellMetadata {
                        element_type: Some(element_type),
                        ..Default::default()
                    }),
                    is_truncated: false,
                    byte_size: None,
                }
            }
            
            Bson::Document(doc) => {
                let json_doc = self.document_to_json(doc);
                let json_string = serde_json::to_string(&json_doc).unwrap_or_else(|_| "{}".to_string());
                
                CellValue {
                    value: Some(json_doc),
                    db_type: "document".to_string(),
                    value_type: CellValueType::Json,
                    metadata: None,
                    is_truncated: false,
                    byte_size: Some(json_string.len()),
                }
            }
            
            Bson::RegularExpression(regex) => {
                let regex_string = format!("/{}/{}", regex.pattern, regex.options);
                CellValue::text(regex_string, "regex")
            }
            
            Bson::JavaScriptCode(code) => {
                CellValue::text(code.clone(), "javascript")
            }
            
            Bson::JavaScriptCodeWithScope(code_with_scope) => {
                let code_string = format!("{}; // scope: {}", 
                    code_with_scope.code, 
                    serde_json::to_string(&self.document_to_json(&code_with_scope.scope)).unwrap_or_default()
                );
                CellValue::text(code_string, "javascript_with_scope")
            }
            
            Bson::Timestamp(timestamp) => {
                CellValue {
                    value: Some(serde_json::json!({
                        "time": timestamp.time,
                        "increment": timestamp.increment
                    })),
                    db_type: "timestamp".to_string(),
                    value_type: CellValueType::Json,
                    metadata: Some(CellMetadata {
                        attributes: Some({
                            let mut attrs = HashMap::new();
                            attrs.insert("time".to_string(), serde_json::Value::Number(timestamp.time.into()));
                            attrs.insert("increment".to_string(), serde_json::Value::Number(timestamp.increment.into()));
                            attrs
                        }),
                        ..Default::default()
                    }),
                    is_truncated: false,
                    byte_size: None,
                }
            }
            
            Bson::Symbol(symbol) => {
                CellValue::text(symbol.clone(), "symbol")
            }
            
            Bson::MinKey => {
                CellValue {
                    value: Some(serde_json::Value::String("MinKey".to_string())),
                    db_type: "minKey".to_string(),
                    value_type: CellValueType::Text,
                    metadata: None,
                    is_truncated: false,
                    byte_size: None,
                }
            }
            
            Bson::MaxKey => {
                CellValue {
                    value: Some(serde_json::Value::String("MaxKey".to_string())),
                    db_type: "maxKey".to_string(),
                    value_type: CellValueType::Text,
                    metadata: None,
                    is_truncated: false,
                    byte_size: None,
                }
            }
            
            Bson::Undefined => {
                CellValue::null("undefined")
            }
            
            Bson::DbPointer(_dbref) => {
                // DbPointer fields are private, so we'll just use a generic representation
                let dbref_string = "DBRef(...)".to_string();
                CellValue::text(dbref_string, "dbpointer")
            }
        }
    }
    
    fn bson_to_json_value(&self, bson: &Bson) -> serde_json::Value {
        match bson {
            Bson::Null | Bson::Undefined => serde_json::Value::Null,
            Bson::String(s) => serde_json::Value::String(s.clone()),
            Bson::Int32(i) => serde_json::Value::Number((*i).into()),
            Bson::Int64(i) => serde_json::Value::Number((*i).into()),
            Bson::Double(d) => serde_json::Number::from_f64(*d).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null),
            Bson::Boolean(b) => serde_json::Value::Bool(*b),
            Bson::Array(arr) => {
                let json_arr: Vec<serde_json::Value> = arr.iter().map(|item| self.bson_to_json_value(item)).collect();
                serde_json::Value::Array(json_arr)
            }
            Bson::Document(doc) => self.document_to_json(doc),
            Bson::ObjectId(oid) => serde_json::Value::String(oid.to_hex()),
            Bson::DateTime(dt) => {
                let chrono_dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(dt.timestamp_millis())
                    .unwrap_or_else(|| chrono::Utc::now());
                serde_json::Value::String(chrono_dt.to_rfc3339())
            }
            Bson::Binary(bin) => serde_json::Value::String(hex::encode(&bin.bytes)),
            Bson::RegularExpression(regex) => serde_json::Value::String(format!("/{}/{}", regex.pattern, regex.options)),
            Bson::Decimal128(d) => serde_json::Value::String(d.to_string()),
            _ => serde_json::Value::String(format!("{:?}", bson)),
        }
    }
    
    fn document_to_json(&self, doc: &bson::Document) -> serde_json::Value {
        let mut json_obj = serde_json::Map::new();
        for (key, value) in doc {
            json_obj.insert(key.clone(), self.bson_to_json_value(value));
        }
        serde_json::Value::Object(json_obj)
    }
    
    fn infer_bson_type(&self, bson: &Bson) -> String {
        match bson {
            Bson::String(_) => "string".to_string(),
            Bson::Int32(_) => "int32".to_string(),
            Bson::Int64(_) => "int64".to_string(),
            Bson::Double(_) => "double".to_string(),
            Bson::Boolean(_) => "boolean".to_string(),
            Bson::Array(_) => "array".to_string(),
            Bson::Document(_) => "document".to_string(),
            Bson::ObjectId(_) => "objectId".to_string(),
            Bson::DateTime(_) => "date".to_string(),
            Bson::Binary(_) => "binary".to_string(),
            Bson::Decimal128(_) => "decimal128".to_string(),
            _ => "unknown".to_string(),
        }
    }
    
    fn extract_decimal_scale(&self, decimal: &Decimal128) -> Option<u32> {
        // Try to extract scale from decimal string representation
        let decimal_str = decimal.to_string();
        if let Some(dot_pos) = decimal_str.find('.') {
            let fractional_part = &decimal_str[dot_pos + 1..];
            Some(fractional_part.len() as u32)
        } else {
            Some(0)
        }
    }
}