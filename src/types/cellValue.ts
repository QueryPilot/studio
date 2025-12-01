/**
 * Grid cell value types for frontend rendering.
 * These types are used by the DataGrid components for display and editing.
 *
 * NOTE: For raw cell values from Rust backend, see backend.ts (RawCellValue)
 * NOTE: For schema column metadata, see schema.ts (ColumnMeta)
 */

/**
 * Standardized value types for consistent frontend rendering.
 * Used to determine how to format and display cell values.
 */
export type GridCellValueType =
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

/**
 * Rich metadata for proper value formatting and display.
 */
export interface GridCellMetadata {
  precision?: number; // Numeric precision (total digits)
  scale?: number; // Numeric scale (decimal places)
  max_length?: number; // Maximum character length for text
  charset?: string; // Character encoding (utf8, latin1, etc.)
  timezone?: string; // Timezone for temporal types
  element_type?: string; // Element type for arrays
  srid?: number; // Spatial Reference System ID for geometry
  enum_values?: string[]; // Available values for enum types
  currency_symbol?: string; // Currency symbol for money types (e.g., "$", "EUR", "JPY")
  currency_code?: string; // Currency code for money types (e.g., "USD", "EUR", "JPY")
  attributes?: Record<string, unknown>; // Additional database-specific metadata
}

/**
 * Grid cell value structure used by DataGrid components.
 * Wraps the raw value with type information and metadata for rendering.
 */
export interface GridCellValue {
  /** Actual data value (can be any JSON-serializable value or null) */
  value: unknown;
  /** Original database type (e.g., "VARCHAR(255)", "INT", "TIMESTAMP") */
  db_type: string;
  /** Standardized type for frontend rendering */
  value_type: GridCellValueType;
  /** Optional formatting and precision metadata */
  metadata?: GridCellMetadata;
  /** Whether value was truncated due to size limits */
  is_truncated: boolean;
  /** Original byte size (useful for binary/large data) */
  byte_size?: number;
}

// =============================================================================
// Legacy exports for backward compatibility
// These will be removed in a future version - migrate to GridCellValue/GridCellValueType
// =============================================================================

/** @deprecated Use GridCellValueType instead */
export type CellValueType = GridCellValueType;

/** @deprecated Use GridCellMetadata instead */
export type CellMetadata = GridCellMetadata;

/** @deprecated Use GridCellValue instead */
export type CellValue = GridCellValue;
