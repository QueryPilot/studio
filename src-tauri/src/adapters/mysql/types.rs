use crate::types::CellValueType;
use mysql_async::consts::ColumnType;

/// MySQL type mapping - maps MySQL column types to CellValueType for metadata
pub struct MySqlTypeConverter;

impl MySqlTypeConverter {
    /// Convert MySQL column type to CellValueType
    pub fn column_type_to_cell_type(col_type: ColumnType, is_unsigned: bool) -> CellValueType {
        match col_type {
            // Integer types
            ColumnType::MYSQL_TYPE_TINY
            | ColumnType::MYSQL_TYPE_SHORT
            | ColumnType::MYSQL_TYPE_LONG
            | ColumnType::MYSQL_TYPE_LONGLONG
            | ColumnType::MYSQL_TYPE_INT24
            | ColumnType::MYSQL_TYPE_YEAR => CellValueType::Integer,

            // Floating point types
            ColumnType::MYSQL_TYPE_FLOAT | ColumnType::MYSQL_TYPE_DOUBLE => CellValueType::Decimal,

            // Decimal/Numeric types
            ColumnType::MYSQL_TYPE_DECIMAL | ColumnType::MYSQL_TYPE_NEWDECIMAL => {
                CellValueType::Decimal
            }

            // String types
            ColumnType::MYSQL_TYPE_VARCHAR
            | ColumnType::MYSQL_TYPE_VAR_STRING
            | ColumnType::MYSQL_TYPE_STRING
            | ColumnType::MYSQL_TYPE_ENUM
            | ColumnType::MYSQL_TYPE_SET => CellValueType::Text,

            // Text types
            ColumnType::MYSQL_TYPE_TINY_BLOB
            | ColumnType::MYSQL_TYPE_MEDIUM_BLOB
            | ColumnType::MYSQL_TYPE_LONG_BLOB
            | ColumnType::MYSQL_TYPE_BLOB => {
                // BLOB types can be text (TEXT, MEDIUMTEXT, etc.) or binary
                // We'll treat them as binary by default, but the charset info
                // would be needed to distinguish
                CellValueType::Binary
            }

            // Date/Time types
            ColumnType::MYSQL_TYPE_DATE | ColumnType::MYSQL_TYPE_NEWDATE => CellValueType::Date,
            ColumnType::MYSQL_TYPE_TIME | ColumnType::MYSQL_TYPE_TIME2 => CellValueType::Time,
            ColumnType::MYSQL_TYPE_DATETIME
            | ColumnType::MYSQL_TYPE_DATETIME2
            | ColumnType::MYSQL_TYPE_TIMESTAMP
            | ColumnType::MYSQL_TYPE_TIMESTAMP2 => CellValueType::DateTime,

            // JSON type (MySQL 5.7+)
            ColumnType::MYSQL_TYPE_JSON => CellValueType::Json,

            // Bit type
            ColumnType::MYSQL_TYPE_BIT => CellValueType::Bit,

            // Geometry types
            ColumnType::MYSQL_TYPE_GEOMETRY => CellValueType::Geometry,

            // NULL type
            ColumnType::MYSQL_TYPE_NULL => CellValueType::Null,

            // Unknown/other types
            _ => {
                if is_unsigned {
                    CellValueType::Integer
                } else {
                    CellValueType::Text
                }
            }
        }
    }

    /// Get a string representation of the MySQL column type for db_type field
    pub fn column_type_to_string(col_type: ColumnType) -> String {
        match col_type {
            ColumnType::MYSQL_TYPE_TINY => "TINYINT".to_string(),
            ColumnType::MYSQL_TYPE_SHORT => "SMALLINT".to_string(),
            ColumnType::MYSQL_TYPE_LONG => "INT".to_string(),
            ColumnType::MYSQL_TYPE_LONGLONG => "BIGINT".to_string(),
            ColumnType::MYSQL_TYPE_INT24 => "MEDIUMINT".to_string(),
            ColumnType::MYSQL_TYPE_FLOAT => "FLOAT".to_string(),
            ColumnType::MYSQL_TYPE_DOUBLE => "DOUBLE".to_string(),
            ColumnType::MYSQL_TYPE_DECIMAL => "DECIMAL".to_string(),
            ColumnType::MYSQL_TYPE_NEWDECIMAL => "DECIMAL".to_string(),
            ColumnType::MYSQL_TYPE_VARCHAR => "VARCHAR".to_string(),
            ColumnType::MYSQL_TYPE_VAR_STRING => "VARCHAR".to_string(),
            ColumnType::MYSQL_TYPE_STRING => "CHAR".to_string(),
            ColumnType::MYSQL_TYPE_BLOB => "BLOB".to_string(),
            ColumnType::MYSQL_TYPE_TINY_BLOB => "TINYBLOB".to_string(),
            ColumnType::MYSQL_TYPE_MEDIUM_BLOB => "MEDIUMBLOB".to_string(),
            ColumnType::MYSQL_TYPE_LONG_BLOB => "LONGBLOB".to_string(),
            ColumnType::MYSQL_TYPE_DATE => "DATE".to_string(),
            ColumnType::MYSQL_TYPE_NEWDATE => "DATE".to_string(),
            ColumnType::MYSQL_TYPE_TIME => "TIME".to_string(),
            ColumnType::MYSQL_TYPE_TIME2 => "TIME".to_string(),
            ColumnType::MYSQL_TYPE_DATETIME => "DATETIME".to_string(),
            ColumnType::MYSQL_TYPE_DATETIME2 => "DATETIME".to_string(),
            ColumnType::MYSQL_TYPE_TIMESTAMP => "TIMESTAMP".to_string(),
            ColumnType::MYSQL_TYPE_TIMESTAMP2 => "TIMESTAMP".to_string(),
            ColumnType::MYSQL_TYPE_YEAR => "YEAR".to_string(),
            ColumnType::MYSQL_TYPE_JSON => "JSON".to_string(),
            ColumnType::MYSQL_TYPE_ENUM => "ENUM".to_string(),
            ColumnType::MYSQL_TYPE_SET => "SET".to_string(),
            ColumnType::MYSQL_TYPE_BIT => "BIT".to_string(),
            ColumnType::MYSQL_TYPE_GEOMETRY => "GEOMETRY".to_string(),
            ColumnType::MYSQL_TYPE_NULL => "NULL".to_string(),
            _ => "UNKNOWN".to_string(),
        }
    }
}

