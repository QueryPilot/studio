/**
 * CellValue types based on db_table_data API specification
 * These types represent the standardized cell values returned from the backend
 */

// Standardized types for consistent frontend rendering
export type CellValueType =
  | "Null" // SQL NULL - render as empty or "NULL" indicator
  | "Text" // String data - plain text with selection
  | "Integer" // Integer numbers - right-align, thousands separators
  | "Decimal" // Floating/decimal numbers - use precision/scale metadata
  | "Boolean" // Boolean values - checkboxes or true/false text
  | "Date" // Date only - locale date formatting
  | "DateTime" // Date with time - full datetime formatting with timezone
  | "Time" // Time only - time formatting without date
  | "Json" // JSON data - syntax highlighting, expand/collapse
  | "Binary" // Binary data - hex display or download options
  | "Uuid" // UUID values - formatted with hyphens, copy functionality
  | "Array" // Array/list values - expandable list with element formatting
  | "Geometry" // Spatial data - coordinates or map rendering
  | "Xml" // XML data - syntax highlighting and structure formatting
  | "Enum" // Enumerated values - show options, validate against enum
  | "Money" // Money special type of PG/MSSQL
  | "Unknown"; // Unsupported types - fallback to plain text

// Rich metadata for proper value formatting and display
export interface CellMetadata {
  precision?: number; // Numeric precision (total digits)
  scale?: number; // Numeric scale (decimal places)
  max_length?: number; // Maximum character length for text
  charset?: string; // Character encoding (utf8, latin1, etc.)
  timezone?: string; // Timezone for temporal types
  element_type?: string; // Element type for arrays
  srid?: number; // Spatial Reference System ID for geometry
  enum_values?: string[]; // Available values for enum types
  currency_symbol?: string; // Currency symbol for money types (e.g., "$", "€", "¥")
  currency_code?: string; // Currency code for money types (e.g., "USD", "EUR", "JPY")
  attributes?: Record<string, any>; // Additional database-specific metadata
}

// Main CellValue structure used throughout the application
export interface CellValue {
  value: any; // Actual data value or null for SQL NULL (any includes null)
  db_type: string; // Original database type (e.g., "VARCHAR(255)", "INT", "TIMESTAMP")
  value_type: CellValueType; // Standardized type for frontend rendering
  metadata?: CellMetadata; // Optional formatting and precision metadata
  is_truncated: boolean; // Whether value was truncated due to size limits
  byte_size?: number; // Original byte size (useful for binary/large data)
}
