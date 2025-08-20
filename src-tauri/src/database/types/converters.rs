use serde_json::Value as JsonValue;
use sqlx::ValueRef;

/// Trait for converting database-specific value references to JSON
pub trait TypeConverter: Send + Sync {
    /// Check if this converter can handle the given type and value
    fn can_convert(&self, type_name: &str, value: &dyn ValueRef) -> bool;
    
    /// Convert the value to a JSON representation
    fn convert(&self, type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String>;
}

/// Registry for managing type converters for different database types
pub struct TypeRegistry {
    converters: Vec<Box<dyn TypeConverter>>,
}

impl TypeRegistry {
    pub fn new() -> Self {
        Self {
            converters: Vec::new(),
        }
    }
    
    /// Register a new type converter
    pub fn register(&mut self, converter: Box<dyn TypeConverter>) {
        self.converters.push(converter);
    }
    
    /// Convert a value using the first matching converter
    pub fn convert(&self, type_name: &str, value: &dyn ValueRef) -> Result<JsonValue, String> {
        for converter in &self.converters {
            if converter.can_convert(type_name, value) {
                return converter.convert(type_name, value);
            }
        }
        
        // Default fallback conversion
        self.fallback_convert(value)
    }
    
    /// Fallback conversion for basic types
    fn fallback_convert(&self, value: &dyn ValueRef) -> Result<JsonValue, String> {
        if value.is_null() {
            return Ok(JsonValue::Null);
        }
        
        // Basic type conversions - this is database-agnostic
        // Each database adapter should provide specific converters for complex types
        Ok(JsonValue::String(format!("{:?}", value)))
    }
}