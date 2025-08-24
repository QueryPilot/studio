use serde::{Serialize, Deserialize};

/// Shared data structure representing a database cell value with rich metadata
/// for proper frontend rendering. All database adapters convert their native
/// types to this standardized format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellValue {
    /// The actual value - None represents SQL NULL
    /// Uses serde_json::Value for maximum flexibility across database types
    pub value: Option<serde_json::Value>,
    
    /// Original database type string (e.g., "VARCHAR(255)", "INT", "TIMESTAMP", "JSONB")
    /// Preserves the exact type as reported by the database
    pub db_type: String,
    
    /// Standardized type category for consistent frontend rendering
    pub value_type: CellValueType,
    
    /// Optional formatting and precision metadata
    pub metadata: Option<CellMetadata>,
    
    /// Whether this value was truncated due to size limits
    /// Frontend can show truncation indicators or "view full" options
    pub is_truncated: bool,
    
    /// Original byte size of the data (useful for binary data and large text)
    /// Helps frontend decide on display strategies for large values
    pub byte_size: Option<usize>,
}

/// Standardized cell value types for consistent frontend rendering
/// Each type gives the frontend hints about how to display the data
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CellValueType {
    /// SQL NULL value - render as empty or "NULL" indicator
    Null,
    
    /// Text/string data (VARCHAR, TEXT, CHAR, NVARCHAR, etc.)
    /// Frontend renders as plain text with optional text selection
    Text,
    
    /// Integer numbers (INT, BIGINT, SMALLINT, TINYINT, etc.)
    /// Frontend can right-align and format with thousands separators
    Integer,
    
    /// Decimal/floating point numbers (DECIMAL, NUMERIC, FLOAT, DOUBLE, MONEY, etc.)
    /// Frontend uses precision/scale metadata for proper formatting
    Decimal,
    
    /// Boolean values (BOOLEAN, BIT(1), TINYINT(1), etc.)
    /// Frontend renders as checkboxes or true/false text
    Boolean,
    
    /// Date only values (DATE)
    /// Frontend formats according to locale date preferences
    Date,
    
    /// Date with time values (DATETIME, TIMESTAMP, TIMESTAMPTZ, etc.)
    /// Frontend formats with both date and time, respecting timezone
    DateTime,
    
    /// Time only values (TIME, TIMETZ)
    /// Frontend formats as time without date component
    Time,
    
    /// JSON/JSONB data
    /// Frontend can syntax highlight and provide expand/collapse functionality
    Json,
    
    /// Binary data (BYTEA, BLOB, BINARY, VARBINARY, IMAGE, etc.)
    /// Frontend shows hex representation or download options
    Binary,
    
    /// UUID values (UUID, UNIQUEIDENTIFIER)
    /// Frontend can format with hyphens and provide copy functionality
    Uuid,
    
    /// Array/list values (PostgreSQL arrays, JSON arrays, etc.)
    /// Frontend can show as expandable list with element type formatting
    Array,
    
    /// Geometric/spatial data (POINT, POLYGON, GEOMETRY, GEOGRAPHY, etc.)
    /// Frontend can show coordinates or render on maps
    Geometry,
    
    /// XML data (XML type)
    /// Frontend can syntax highlight and format XML structure
    Xml,
    
    /// Enumerated values (ENUM, SET)
    /// Frontend can show available options or validate against enum values
    Enum,
    
    /// Unknown or unsupported database types
    /// Frontend falls back to plain text representation
    Unknown,
}

/// Rich metadata for proper value formatting and display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellMetadata {
    /// Numeric precision (total number of significant digits)
    /// Used for DECIMAL, NUMERIC types - e.g., DECIMAL(10,2) has precision=10
    pub precision: Option<u32>,
    
    /// Numeric scale (digits after decimal point)
    /// Used for DECIMAL, NUMERIC types - e.g., DECIMAL(10,2) has scale=2
    pub scale: Option<u32>,
    
    /// Maximum character length for text types
    /// Used for VARCHAR, CHAR, etc. - helps frontend with input validation
    pub max_length: Option<u32>,
    
    /// Character set/encoding information
    /// e.g., "utf8", "latin1", "utf8mb4" - helps with display and validation
    pub charset: Option<String>,
    
    /// Timezone information for temporal types
    /// e.g., "UTC", "America/New_York" - critical for proper datetime display
    pub timezone: Option<String>,
    
    /// For array types: the element type
    /// e.g., "INTEGER" for INTEGER[] - helps frontend format array elements
    pub element_type: Option<String>,
    
    /// For geometry types: Spatial Reference System Identifier
    /// Critical for proper coordinate system interpretation
    pub srid: Option<u32>,
    
    /// For enum types: available enum values
    /// Helps frontend show dropdowns or validate input
    pub enum_values: Option<Vec<String>>,
    
    /// Additional database-specific attributes
    /// Flexible storage for type-specific metadata not covered above
    pub attributes: Option<std::collections::HashMap<String, serde_json::Value>>,
}

impl CellValue {
    /// Create a NULL cell value
    pub fn null(db_type: &str) -> Self {
        Self {
            value: None,
            db_type: db_type.to_string(),
            value_type: CellValueType::Null,
            metadata: None,
            is_truncated: false,
            byte_size: None,
        }
    }
    
    /// Create a text cell value
    pub fn text(value: String, db_type: &str) -> Self {
        let byte_size = value.len();
        Self {
            value: Some(serde_json::Value::String(value)),
            db_type: db_type.to_string(),
            value_type: CellValueType::Text,
            metadata: None,
            is_truncated: false,
            byte_size: Some(byte_size),
        }
    }
    
    /// Create an integer cell value
    pub fn integer(value: i64, db_type: &str) -> Self {
        Self {
            value: Some(serde_json::Value::Number(serde_json::Number::from(value))),
            db_type: db_type.to_string(),
            value_type: CellValueType::Integer,
            metadata: None,
            is_truncated: false,
            byte_size: None,
        }
    }
    
    /// Create a decimal cell value with metadata
    pub fn decimal(value: f64, db_type: &str, precision: Option<u32>, scale: Option<u32>) -> Self {
        let metadata = if precision.is_some() || scale.is_some() {
            Some(CellMetadata {
                precision,
                scale,
                max_length: None,
                charset: None,
                timezone: None,
                element_type: None,
                srid: None,
                enum_values: None,
                attributes: None,
            })
        } else {
            None
        };
        
        Self {
            value: serde_json::Number::from_f64(value).map(serde_json::Value::Number),
            db_type: db_type.to_string(),
            value_type: CellValueType::Decimal,
            metadata,
            is_truncated: false,
            byte_size: None,
        }
    }
    
    /// Create a boolean cell value
    pub fn boolean(value: bool, db_type: &str) -> Self {
        Self {
            value: Some(serde_json::Value::Bool(value)),
            db_type: db_type.to_string(),
            value_type: CellValueType::Boolean,
            metadata: None,
            is_truncated: false,
            byte_size: None,
        }
    }
    
    /// Create a JSON cell value
    pub fn json(value: serde_json::Value, db_type: &str) -> Self {
        let byte_size = value.to_string().len();
        Self {
            value: Some(value),
            db_type: db_type.to_string(),
            value_type: CellValueType::Json,
            metadata: None,
            is_truncated: false,
            byte_size: Some(byte_size),
        }
    }
    
    /// Check if the cell represents a NULL value
    pub fn is_null(&self) -> bool {
        self.value.is_none() || self.value_type == CellValueType::Null
    }
    
    /// Get the string representation of the value for display
    pub fn display_string(&self) -> String {
        match &self.value {
            None => "NULL".to_string(),
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(serde_json::Value::Null) => "NULL".to_string(),
            Some(v) => v.to_string(),
        }
    }
    
    /// Extract as i64 if possible (compatibility with serde_json::Value API)
    pub fn as_i64(&self) -> Option<i64> {
        match &self.value {
            Some(serde_json::Value::Number(n)) => n.as_i64(),
            _ => None,
        }
    }
    
    /// Extract as f64 if possible
    pub fn as_f64(&self) -> Option<f64> {
        match &self.value {
            Some(serde_json::Value::Number(n)) => n.as_f64(),
            _ => None,
        }
    }
    
    /// Extract as string if possible
    pub fn as_str(&self) -> Option<&str> {
        match &self.value {
            Some(serde_json::Value::String(s)) => Some(s),
            _ => None,
        }
    }
    
    /// Extract as boolean if possible
    pub fn as_bool(&self) -> Option<bool> {
        match &self.value {
            Some(serde_json::Value::Bool(b)) => Some(*b),
            _ => None,
        }
    }
    
    /// Get the underlying serde_json::Value (for compatibility)
    pub fn as_json_value(&self) -> Option<&serde_json::Value> {
        self.value.as_ref()
    }
}

impl Default for CellValue {
    fn default() -> Self {
        Self::null("UNKNOWN")
    }
}