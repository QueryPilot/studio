use crate::types::CellValueType;
use rusqlite::types::Type as SqliteType;

/// SQLite type mapping - maps SQLite types to CellValueType for metadata
pub struct SqliteTypeConverter;

impl SqliteTypeConverter {
    /// Convert SQLite type to CellValueType
    pub fn sqlite_type_to_cell_type(sqlite_type: SqliteType) -> CellValueType {
        match sqlite_type {
            SqliteType::Null => CellValueType::Null,
            SqliteType::Integer => CellValueType::Integer,
            SqliteType::Real => CellValueType::Decimal,
            SqliteType::Text => CellValueType::Text,
            SqliteType::Blob => CellValueType::Binary,
        }
    }

    /// Convert declared SQLite column type string to CellValueType
    /// SQLite uses type affinity, so we need to parse the declared type
    pub fn declared_type_to_cell_type(declared_type: Option<&str>) -> CellValueType {
        match declared_type {
            None => CellValueType::Text, // SQLite default affinity
            Some(t) => {
                let upper = t.to_uppercase();

                // INTEGER affinity
                if upper.contains("INT") {
                    return CellValueType::Integer;
                }

                // TEXT affinity
                if upper.contains("CHAR")
                    || upper.contains("CLOB")
                    || upper.contains("TEXT")
                    || upper.contains("VARCHAR")
                {
                    return CellValueType::Text;
                }

                // BLOB affinity
                if upper.contains("BLOB") || upper.is_empty() {
                    return CellValueType::Binary;
                }

                // REAL affinity
                if upper.contains("REAL")
                    || upper.contains("FLOA")
                    || upper.contains("DOUB")
                    || upper.contains("NUMERIC")
                    || upper.contains("DECIMAL")
                {
                    return CellValueType::Decimal;
                }

                // Boolean (stored as INTEGER in SQLite)
                if upper.contains("BOOL") {
                    return CellValueType::Boolean;
                }

                // Date/Time types (stored as TEXT, INTEGER, or REAL in SQLite)
                if upper.contains("DATE") {
                    return CellValueType::Date;
                }
                if upper.contains("TIME") {
                    return CellValueType::Time;
                }
                if upper.contains("DATETIME") || upper.contains("TIMESTAMP") {
                    return CellValueType::DateTime;
                }

                // JSON type (SQLite 3.38+ has JSON functions, but stores as TEXT)
                if upper.contains("JSON") {
                    return CellValueType::Json;
                }

                // Default to TEXT
                CellValueType::Text
            }
        }
    }

    /// Get a string representation for db_type field
    pub fn sqlite_type_to_string(sqlite_type: SqliteType) -> String {
        match sqlite_type {
            SqliteType::Null => "NULL".to_string(),
            SqliteType::Integer => "INTEGER".to_string(),
            SqliteType::Real => "REAL".to_string(),
            SqliteType::Text => "TEXT".to_string(),
            SqliteType::Blob => "BLOB".to_string(),
        }
    }
}
