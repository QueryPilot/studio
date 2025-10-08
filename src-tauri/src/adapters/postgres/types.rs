use crate::types::*;
use postgres_types::{Kind, Type};

/// PostgreSQL type mapping - maps Postgres types to CellValueType for metadata
pub struct PostgresTypeConverter;

impl PostgresTypeConverter {
    pub fn type_to_cell_type(pg_type: &Type) -> CellValueType {
        match *pg_type {
            // Numeric types
            Type::INT2 => CellValueType::Integer,
            Type::INT4 => CellValueType::Integer,
            Type::INT8 => CellValueType::Integer,
            Type::OID => CellValueType::Integer,
            Type::FLOAT4 => CellValueType::Decimal,
            Type::FLOAT8 => CellValueType::Decimal,
            Type::NUMERIC => CellValueType::Decimal,
            Type::MONEY => CellValueType::Money,

            // String types
            Type::TEXT => CellValueType::Text,
            Type::VARCHAR => CellValueType::Text,
            Type::BPCHAR => CellValueType::Text,
            Type::CHAR => CellValueType::Text,
            Type::NAME => CellValueType::Text,
            Type::UNKNOWN => CellValueType::Text,

            // Date/Time types
            Type::DATE => CellValueType::Date,
            Type::TIME => CellValueType::Time,
            Type::TIMETZ => CellValueType::Time,
            Type::TIMESTAMP => CellValueType::DateTime,
            Type::TIMESTAMPTZ => CellValueType::DateTime,
            Type::INTERVAL => CellValueType::Interval,

            // Boolean
            Type::BOOL => CellValueType::Boolean,

            // Binary
            Type::BYTEA => CellValueType::Binary,

            // JSON types
            Type::JSON => CellValueType::Json,
            Type::JSONB => CellValueType::Json,

            // UUID
            Type::UUID => CellValueType::Uuid,

            // Network types
            Type::INET => CellValueType::Inet,
            Type::CIDR => CellValueType::Cidr,
            Type::MACADDR => CellValueType::MacAddr,
            Type::MACADDR8 => CellValueType::MacAddr8,

            // Geometric types
            Type::POINT => CellValueType::Geometry,
            Type::LSEG => CellValueType::Geometry,
            Type::PATH => CellValueType::Path,
            Type::BOX => CellValueType::Box2d,
            Type::POLYGON => CellValueType::Polygon,
            Type::LINE => CellValueType::Geometry,
            Type::CIRCLE => CellValueType::Circle,

            // XML
            Type::XML => CellValueType::Xml,

            // Bit strings
            Type::BIT => CellValueType::Bit,
            Type::VARBIT => CellValueType::VarBit,

            // Arrays
            Type::BOOL_ARRAY => CellValueType::Array(Box::new(CellValueType::Boolean)),
            Type::BYTEA_ARRAY => CellValueType::Array(Box::new(CellValueType::Binary)),
            Type::CHAR_ARRAY => CellValueType::Array(Box::new(CellValueType::Text)),
            Type::INT2_ARRAY => CellValueType::Array(Box::new(CellValueType::Integer)),
            Type::INT4_ARRAY => CellValueType::Array(Box::new(CellValueType::Integer)),
            Type::INT8_ARRAY => CellValueType::Array(Box::new(CellValueType::Integer)),
            Type::TEXT_ARRAY => CellValueType::Array(Box::new(CellValueType::Text)),
            Type::VARCHAR_ARRAY => CellValueType::Array(Box::new(CellValueType::Text)),
            Type::FLOAT4_ARRAY => CellValueType::Array(Box::new(CellValueType::Decimal)),
            Type::FLOAT8_ARRAY => CellValueType::Array(Box::new(CellValueType::Decimal)),
            Type::UUID_ARRAY => CellValueType::Array(Box::new(CellValueType::Uuid)),
            Type::JSON_ARRAY => CellValueType::Array(Box::new(CellValueType::Json)),
            Type::JSONB_ARRAY => CellValueType::Array(Box::new(CellValueType::Json)),
            Type::TIMESTAMP_ARRAY => CellValueType::Array(Box::new(CellValueType::DateTime)),
            Type::TIMESTAMPTZ_ARRAY => CellValueType::Array(Box::new(CellValueType::DateTime)),
            Type::DATE_ARRAY => CellValueType::Array(Box::new(CellValueType::Date)),
            Type::TIME_ARRAY => CellValueType::Array(Box::new(CellValueType::Time)),
            Type::NUMERIC_ARRAY => CellValueType::Array(Box::new(CellValueType::Decimal)),
            Type::INET_ARRAY => CellValueType::Array(Box::new(CellValueType::Inet)),
            Type::CIDR_ARRAY => CellValueType::Array(Box::new(CellValueType::Cidr)),
            Type::MACADDR_ARRAY => CellValueType::Array(Box::new(CellValueType::MacAddr)),

            // Range types
            Type::INT4_RANGE => CellValueType::Range(Box::new(CellValueType::Integer)),
            Type::INT8_RANGE => CellValueType::Range(Box::new(CellValueType::Integer)),
            Type::NUM_RANGE => CellValueType::Range(Box::new(CellValueType::Decimal)),
            Type::TS_RANGE => CellValueType::Range(Box::new(CellValueType::DateTime)),
            Type::TSTZ_RANGE => CellValueType::Range(Box::new(CellValueType::DateTime)),
            Type::DATE_RANGE => CellValueType::Range(Box::new(CellValueType::Date)),

            // Special types
            Type::VOID => CellValueType::Void,
            Type::TRIGGER => CellValueType::Trigger,
            Type::PG_LSN => CellValueType::PgLsn,
            Type::PG_SNAPSHOT => CellValueType::PgSnapshot,

            // Record/Composite
            Type::RECORD => CellValueType::Composite(vec![]),

            // Handle custom/unknown types
            _ => {
                // Check if it's an array type
                if pg_type.name().ends_with("[]") {
                    CellValueType::Array(Box::new(CellValueType::Text))
                } else {
                    // Distinguish enums from other custom types
                    match pg_type.kind() {
                        Kind::Enum(_) => CellValueType::Enum(pg_type.name().to_string()),
                        Kind::Domain(inner) if matches!(inner.kind(), Kind::Enum(_)) => {
                            CellValueType::Enum(pg_type.name().to_string())
                        }
                        _ => CellValueType::CustomType(pg_type.name().to_string()),
                    }
                }
            }
        }
    }

    pub fn oid_to_cell_type(oid: u32) -> CellValueType {
        match oid {
            // Numeric types
            20 => CellValueType::Integer,   // INT8
            21 => CellValueType::Integer,   // INT2
            23 => CellValueType::Integer,   // INT4
            700 => CellValueType::Decimal,  // FLOAT4
            701 => CellValueType::Decimal,  // FLOAT8
            1700 => CellValueType::Decimal, // NUMERIC
            790 => CellValueType::Money,    // MONEY

            // String types
            25 => CellValueType::Text,   // TEXT
            1042 => CellValueType::Text, // BPCHAR
            1043 => CellValueType::Text, // VARCHAR
            18 => CellValueType::Text,   // CHAR
            19 => CellValueType::Text,   // NAME

            // Date/Time types
            1082 => CellValueType::Date,     // DATE
            1083 => CellValueType::Time,     // TIME
            1114 => CellValueType::DateTime, // TIMESTAMP
            1184 => CellValueType::DateTime, // TIMESTAMPTZ
            1186 => CellValueType::Interval, // INTERVAL
            1266 => CellValueType::Time,     // TIMETZ

            // Boolean
            16 => CellValueType::Boolean, // BOOL

            // Binary
            17 => CellValueType::Binary, // BYTEA

            // JSON types
            114 => CellValueType::Json,  // JSON
            3802 => CellValueType::Json, // JSONB

            // UUID
            2950 => CellValueType::Uuid, // UUID

            // Network types
            869 => CellValueType::Inet,     // INET
            650 => CellValueType::Cidr,     // CIDR
            829 => CellValueType::MacAddr,  // MACADDR
            774 => CellValueType::MacAddr8, // MACADDR8

            // Geometric types
            600 => CellValueType::Geometry, // POINT
            601 => CellValueType::Geometry, // LSEG
            602 => CellValueType::Path,     // PATH
            603 => CellValueType::Box2d,    // BOX
            604 => CellValueType::Polygon,  // POLYGON
            628 => CellValueType::Geometry, // LINE
            718 => CellValueType::Circle,   // CIRCLE

            // XML
            142 => CellValueType::Xml, // XML

            // Bit strings
            1560 => CellValueType::Bit,    // BIT
            1562 => CellValueType::VarBit, // VARBIT

            // Arrays
            1000 => CellValueType::Array(Box::new(CellValueType::Boolean)), // BOOL[]
            1005 => CellValueType::Array(Box::new(CellValueType::Integer)), // INT2[]
            1007 => CellValueType::Array(Box::new(CellValueType::Integer)), // INT4[]
            1016 => CellValueType::Array(Box::new(CellValueType::Integer)), // INT8[]
            1009 => CellValueType::Array(Box::new(CellValueType::Text)),    // TEXT[]
            1015 => CellValueType::Array(Box::new(CellValueType::Text)),    // VARCHAR[]
            1021 => CellValueType::Array(Box::new(CellValueType::Decimal)), // FLOAT4[]
            1022 => CellValueType::Array(Box::new(CellValueType::Decimal)), // FLOAT8[]

            // Range types
            3904 => CellValueType::Range(Box::new(CellValueType::Integer)),  // INT4RANGE
            3926 => CellValueType::Range(Box::new(CellValueType::Integer)),  // INT8RANGE
            3906 => CellValueType::Range(Box::new(CellValueType::Decimal)),  // NUMRANGE
            3908 => CellValueType::Range(Box::new(CellValueType::DateTime)), // TSRANGE
            3910 => CellValueType::Range(Box::new(CellValueType::DateTime)), // TSTZRANGE
            3912 => CellValueType::Range(Box::new(CellValueType::Date)),     // DATERANGE

            // Default fallback
            _ => CellValueType::CustomType("unknown".to_string()),
        }
    }
}
