use sqlx::postgres::PgValueRef;
use sqlx::ValueRef;
use serde_json::Value as JsonValue;
use rust_decimal::Decimal;
use chrono::{DateTime, Utc, NaiveDateTime};
use uuid::Uuid;
use super::converters::TypeConverter;

pub struct PostgresUuidConverter;

impl TypeConverter for PostgresUuidConverter {
    fn can_convert(&self, type_name: &str, _value: &dyn ValueRef) -> bool {
        type_name.to_uppercase().contains("UUID")
    }

    fn convert(&self, _type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }

        // Try to get as raw bytes and parse UUID
        if let Some(pg_value) = value.as_any().downcast_ref::<PgValueRef>() {
            if let Ok(uuid_bytes) = pg_value.as_bytes() {
                if uuid_bytes.len() == 16 {
                    let mut bytes = [0u8; 16];
                    bytes.copy_from_slice(uuid_bytes);
                    let uuid = Uuid::from_bytes(bytes);
                    return Ok(JsonValue::String(uuid.to_string()));
                }
            }
        }

        Err("UUID conversion failed".to_string())
    }
}

pub struct PostgresJsonConverter;

impl TypeConverter for PostgresJsonConverter {
    fn can_convert(&self, type_name: &str, _value: &dyn ValueRef) -> bool {
        let upper = type_name.to_uppercase();
        upper.contains("JSON") || upper.contains("JSONB")
    }

    fn convert(&self, _type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }

        if let Some(pg_value) = value.as_any().downcast_ref::<PgValueRef>() {
            if let Ok(json_bytes) = pg_value.as_bytes() {
                let json_str = String::from_utf8_lossy(json_bytes);
                return serde_json::from_str(&json_str)
                    .map_err(|e| format!("JSON parse error: {}", e));
            }
        }

        Err("JSON conversion failed".to_string())
    }
}

pub struct PostgresArrayConverter;

impl TypeConverter for PostgresArrayConverter {
    fn can_convert(&self, type_name: &str, _value: &dyn ValueRef) -> bool {
        type_name.contains("[]") || type_name.to_uppercase().contains("ARRAY")
    }

    fn convert(&self, type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }

        // Return a JSON object indicating this is an array type
        // Full array parsing would require more complex logic
        Ok(serde_json::json!({
            "type": "array",
            "arrayType": type_name,
            "value": format!("{:?}", value)
        }))
    }
}

pub struct PostgresDecimalConverter;

impl TypeConverter for PostgresDecimalConverter {
    fn can_convert(&self, type_name: &str, _value: &dyn ValueRef) -> bool {
        let upper = type_name.to_uppercase();
        upper.contains("NUMERIC") || upper.contains("DECIMAL")
    }

    fn convert(&self, _type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }

        // Return decimal as string to preserve precision
        Ok(JsonValue::String(format!("{:?}", value)))
    }
}

pub struct PostgresTimestampConverter;

impl TypeConverter for PostgresTimestampConverter {
    fn can_convert(&self, type_name: &str, _value: &dyn ValueRef) -> bool {
        let upper = type_name.to_uppercase();
        matches!(upper.as_str(), "TIMESTAMP" | "TIMESTAMPTZ" | "TIMESTAMP WITH TIME ZONE" | "TIMESTAMP WITHOUT TIME ZONE")
    }

    fn convert(&self, _type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }

        // Return timestamp as ISO string
        Ok(JsonValue::String(format!("{:?}", value)))
    }
}

pub struct PostgresByteaConverter;

impl TypeConverter for PostgresByteaConverter {
    fn can_convert(&self, type_name: &str, _value: &dyn ValueRef) -> bool {
        type_name.to_uppercase() == "BYTEA"
    }

    fn convert(&self, _type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }

        if let Some(pg_value) = value.as_any().downcast_ref::<PgValueRef>() {
            if let Ok(bytes) = pg_value.as_bytes() {
                return Ok(JsonValue::String(base64::encode(bytes)));
            }
        }

        Err("BYTEA conversion failed".to_string())
    }
}

pub struct PostgresNetworkConverter;

impl TypeConverter for PostgresNetworkConverter {
    fn can_convert(&self, type_name: &str, _value: &dyn ValueRef) -> bool {
        let upper = type_name.to_uppercase();
        matches!(upper.as_str(), "INET" | "CIDR" | "MACADDR" | "MACADDR8")
    }

    fn convert(&self, type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }

        Ok(serde_json::json!({
            "type": "network",
            "networkType": type_name,
            "value": format!("{:?}", value)
        }))
    }
}

/// Register all PostgreSQL type converters
pub fn register_postgres_converters() -> Vec<Box<dyn TypeConverter>> {
    vec![
        Box::new(PostgresUuidConverter),
        Box::new(PostgresJsonConverter),
        Box::new(PostgresArrayConverter),
        Box::new(PostgresDecimalConverter),
        Box::new(PostgresTimestampConverter),
        Box::new(PostgresByteaConverter),
        Box::new(PostgresNetworkConverter),
    ]
}