use super::converters::TypeConverter;
use serde_json::Value as JsonValue;
use sqlx::ValueRef;

/// Simple SQLite type converter - simplified for compilation
pub struct SqliteTypeConverter;

impl TypeConverter for SqliteTypeConverter {
    fn can_convert(&self, _type_name: &str, _value: &dyn ValueRef) -> bool {
        true // Handle all SQLite types with fallback
    }

    fn convert(&self, type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }

        // For now, use string representation for complex types
        // TODO: Add proper type-specific conversion logic
        Ok(JsonValue::String(format!("{}:{:?}", type_name, value)))
    }
}

/// Register all SQLite type converters
pub fn register_sqlite_converters() -> Vec<Box<dyn TypeConverter>> {
    vec![
        Box::new(SqliteTypeConverter),
    ]
}