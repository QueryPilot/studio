use crate::types::CellValueType;
use tiberius::ColumnType;

/// SQL Server type mapping - maps TDS column types to CellValueType for metadata
pub struct MssqlTypeConverter;

impl MssqlTypeConverter {
    /// Convert SQL Server column type to CellValueType
    pub fn column_type_to_cell_type(col_type: &ColumnType) -> CellValueType {
        match col_type {
            // Integer types
            ColumnType::Int1 => CellValueType::Integer,
            ColumnType::Int2 => CellValueType::Integer,
            ColumnType::Int4 => CellValueType::Integer,
            ColumnType::Int8 => CellValueType::Integer,
            ColumnType::Intn => CellValueType::Integer,

            // Floating point types
            ColumnType::Float4 => CellValueType::Decimal,
            ColumnType::Float8 => CellValueType::Decimal,
            ColumnType::Floatn => CellValueType::Decimal,

            // Decimal/Numeric types
            ColumnType::Decimaln => CellValueType::Decimal,
            ColumnType::Numericn => CellValueType::Decimal,
            ColumnType::Money => CellValueType::Money,
            ColumnType::Money4 => CellValueType::Money,

            // String types
            ColumnType::BigVarChar
            | ColumnType::BigChar
            | ColumnType::NVarchar
            | ColumnType::NChar
            | ColumnType::Text
            | ColumnType::NText => CellValueType::Text,

            // Binary types
            ColumnType::BigVarBin | ColumnType::BigBinary | ColumnType::Image => {
                CellValueType::Binary
            }

            // Date/Time types
            ColumnType::Datetime
            | ColumnType::Datetime2
            | ColumnType::Datetime4
            | ColumnType::Datetimen
            | ColumnType::DatetimeOffsetn => CellValueType::DateTime,
            ColumnType::Daten => CellValueType::Date,
            ColumnType::Timen => CellValueType::Time,

            // Boolean
            ColumnType::Bit | ColumnType::Bitn => CellValueType::Boolean,

            // UUID/GUID
            ColumnType::Guid => CellValueType::Uuid,

            // XML
            ColumnType::Xml => CellValueType::Xml,

            // SQL Variant (can hold any SQL Server data type)
            ColumnType::SSVariant => CellValueType::Text,

            // User-defined types
            ColumnType::Udt => CellValueType::CustomType("UDT".to_string()),

            // Unknown
            _ => CellValueType::Text,
        }
    }

    /// Get a string representation for db_type field
    pub fn column_type_to_string(col_type: &ColumnType) -> String {
        match col_type {
            ColumnType::Int1 => "TINYINT".to_string(),
            ColumnType::Int2 => "SMALLINT".to_string(),
            ColumnType::Int4 => "INT".to_string(),
            ColumnType::Int8 => "BIGINT".to_string(),
            ColumnType::Intn => "INT".to_string(),
            ColumnType::Float4 => "REAL".to_string(),
            ColumnType::Float8 => "FLOAT".to_string(),
            ColumnType::Floatn => "FLOAT".to_string(),
            ColumnType::Decimaln => "DECIMAL".to_string(),
            ColumnType::Numericn => "NUMERIC".to_string(),
            ColumnType::Money => "MONEY".to_string(),
            ColumnType::Money4 => "SMALLMONEY".to_string(),
            ColumnType::BigVarChar => "VARCHAR".to_string(),
            ColumnType::BigChar => "CHAR".to_string(),
            ColumnType::NVarchar => "NVARCHAR".to_string(),
            ColumnType::NChar => "NCHAR".to_string(),
            ColumnType::Text => "TEXT".to_string(),
            ColumnType::NText => "NTEXT".to_string(),
            ColumnType::BigVarBin => "VARBINARY".to_string(),
            ColumnType::BigBinary => "BINARY".to_string(),
            ColumnType::Image => "IMAGE".to_string(),
            ColumnType::Datetime => "DATETIME".to_string(),
            ColumnType::Datetime2 => "DATETIME2".to_string(),
            ColumnType::Datetime4 => "SMALLDATETIME".to_string(),
            ColumnType::Datetimen => "DATETIME".to_string(),
            ColumnType::DatetimeOffsetn => "DATETIMEOFFSET".to_string(),
            ColumnType::Daten => "DATE".to_string(),
            ColumnType::Timen => "TIME".to_string(),
            ColumnType::Bit => "BIT".to_string(),
            ColumnType::Bitn => "BIT".to_string(),
            ColumnType::Guid => "UNIQUEIDENTIFIER".to_string(),
            ColumnType::Xml => "XML".to_string(),
            ColumnType::SSVariant => "SQL_VARIANT".to_string(),
            ColumnType::Udt => "UDT".to_string(),
            _ => "UNKNOWN".to_string(),
        }
    }
}

