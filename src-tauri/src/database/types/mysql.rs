use super::converters::TypeConverter;
use serde_json::Value as JsonValue;
use sqlx::ValueRef;

/// Simple MySQL type converter - simplified for compilation
pub struct MySqlTypeConverter;

impl TypeConverter for MySqlTypeConverter {
    fn can_convert(&self, _type_name: &str, _value: &dyn ValueRef) -> bool {
        true // Handle all MySQL types with fallback
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

/// Register all MySQL type converters
pub fn register_mysql_converters() -> Vec<Box<dyn TypeConverter>> {
    vec![
        Box::new(MySqlTypeConverter),
    ]
}