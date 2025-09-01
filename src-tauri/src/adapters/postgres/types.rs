use crate::types::*;
use crate::error::{AppError, Result};
use postgres_types::Type;
use tokio_postgres::types::ToSql;
use tokio_postgres::Row;
use serde_json::Value as JsonValue;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use uuid::Uuid;
use std::collections::HashMap;
use std::net::IpAddr;

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
            
            // Text search - these types might not be available in the version we're using
            // Type::TSVECTOR => CellValueType::TsVector,
            // Type::TSQUERY => CellValueType::TsQuery,
            
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
            
            // Multirange types (PG14+) - might not be available in our version
            // Type::INT4_MULTIRANGE => CellValueType::Multirange(Box::new(CellValueType::Integer)),
            // Type::INT8_MULTIRANGE => CellValueType::Multirange(Box::new(CellValueType::Integer)),
            // Type::NUM_MULTIRANGE => CellValueType::Multirange(Box::new(CellValueType::Decimal)),
            // Type::TS_MULTIRANGE => CellValueType::Multirange(Box::new(CellValueType::DateTime)),
            // Type::TSTZ_MULTIRANGE => CellValueType::Multirange(Box::new(CellValueType::DateTime)),
            // Type::DATE_MULTIRANGE => CellValueType::Multirange(Box::new(CellValueType::Date)),
            
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
                    CellValueType::CustomType(pg_type.name().to_string())
                }
            }
        }
    }
    
    pub fn oid_to_cell_type(oid: u32) -> CellValueType {
        match oid {
            // Numeric types
            20 => CellValueType::Integer,    // INT8
            21 => CellValueType::Integer,    // INT2
            23 => CellValueType::Integer,    // INT4
            700 => CellValueType::Decimal,   // FLOAT4
            701 => CellValueType::Decimal,   // FLOAT8
            1700 => CellValueType::Decimal,  // NUMERIC
            790 => CellValueType::Money,     // MONEY
            
            // String types
            25 => CellValueType::Text,       // TEXT
            1042 => CellValueType::Text,     // BPCHAR (blank-padded char)
            1043 => CellValueType::Text,     // VARCHAR
            18 => CellValueType::Text,       // CHAR
            19 => CellValueType::Text,       // NAME
            
            // Date/Time types
            1082 => CellValueType::Date,     // DATE
            1083 => CellValueType::Time,     // TIME
            1114 => CellValueType::DateTime, // TIMESTAMP
            1184 => CellValueType::DateTime, // TIMESTAMPTZ
            1186 => CellValueType::Interval, // INTERVAL
            1266 => CellValueType::Time,     // TIMETZ
            
            // Boolean
            16 => CellValueType::Boolean,    // BOOL
            
            // Binary
            17 => CellValueType::Binary,     // BYTEA
            
            // JSON types
            114 => CellValueType::Json,      // JSON
            3802 => CellValueType::Json,     // JSONB
            
            // UUID
            2950 => CellValueType::Uuid,     // UUID
            
            // Network types
            869 => CellValueType::Inet,      // INET
            650 => CellValueType::Cidr,      // CIDR
            829 => CellValueType::MacAddr,   // MACADDR
            774 => CellValueType::MacAddr8,  // MACADDR8
            
            // Geometric types
            600 => CellValueType::Geometry,  // POINT
            601 => CellValueType::Geometry,  // LSEG
            602 => CellValueType::Path,      // PATH
            603 => CellValueType::Box2d,     // BOX
            604 => CellValueType::Polygon,   // POLYGON
            628 => CellValueType::Geometry,  // LINE
            718 => CellValueType::Circle,    // CIRCLE
            
            // Text search types
            3614 => CellValueType::TsVector,     // TSVECTOR
            3615 => CellValueType::TsQuery,      // TSQUERY
            
            // XML
            142 => CellValueType::Xml,           // XML
            
            // Bit strings
            1560 => CellValueType::Bit,          // BIT
            1562 => CellValueType::VarBit,       // VARBIT
            
            // Arrays - common ones
            1000 => CellValueType::Array(Box::new(CellValueType::Boolean)),  // BOOL[]
            1001 => CellValueType::Array(Box::new(CellValueType::Binary)),   // BYTEA[]
            1002 => CellValueType::Array(Box::new(CellValueType::Text)),     // CHAR[]
            1005 => CellValueType::Array(Box::new(CellValueType::Integer)),  // INT2[]
            1007 => CellValueType::Array(Box::new(CellValueType::Integer)),  // INT4[]
            1016 => CellValueType::Array(Box::new(CellValueType::Integer)),  // INT8[]
            1009 => CellValueType::Array(Box::new(CellValueType::Text)),     // TEXT[]
            1015 => CellValueType::Array(Box::new(CellValueType::Text)),     // VARCHAR[]
            1021 => CellValueType::Array(Box::new(CellValueType::Decimal)),  // FLOAT4[]
            1022 => CellValueType::Array(Box::new(CellValueType::Decimal)),  // FLOAT8[]
            1231 => CellValueType::Array(Box::new(CellValueType::Decimal)),  // NUMERIC[]
            1115 => CellValueType::Array(Box::new(CellValueType::DateTime)), // TIMESTAMP[]
            1185 => CellValueType::Array(Box::new(CellValueType::DateTime)), // TIMESTAMPTZ[]
            1182 => CellValueType::Array(Box::new(CellValueType::Date)),     // DATE[]
            1183 => CellValueType::Array(Box::new(CellValueType::Time)),     // TIME[]
            2951 => CellValueType::Array(Box::new(CellValueType::Uuid)),     // UUID[]
            199 => CellValueType::Array(Box::new(CellValueType::Json)),      // JSON[]
            3807 => CellValueType::Array(Box::new(CellValueType::Json)),     // JSONB[]
            1041 => CellValueType::Array(Box::new(CellValueType::Inet)),     // INET[]
            651 => CellValueType::Array(Box::new(CellValueType::Cidr)),      // CIDR[]
            1040 => CellValueType::Array(Box::new(CellValueType::MacAddr)),  // MACADDR[]
            
            // Range types
            3904 => CellValueType::Range(Box::new(CellValueType::Integer)),     // INT4RANGE
            3926 => CellValueType::Range(Box::new(CellValueType::Integer)),     // INT8RANGE
            3906 => CellValueType::Range(Box::new(CellValueType::Decimal)),     // NUMRANGE
            3908 => CellValueType::Range(Box::new(CellValueType::DateTime)),    // TSRANGE
            3910 => CellValueType::Range(Box::new(CellValueType::DateTime)),    // TSTZRANGE
            3912 => CellValueType::Range(Box::new(CellValueType::Date)),        // DATERANGE
            
            // Multirange types (PG14+)
            4451 => CellValueType::Multirange(Box::new(CellValueType::Integer)), // INT4MULTIRANGE
            4536 => CellValueType::Multirange(Box::new(CellValueType::Integer)), // INT8MULTIRANGE
            4532 => CellValueType::Multirange(Box::new(CellValueType::Decimal)), // NUMMULTIRANGE
            4533 => CellValueType::Multirange(Box::new(CellValueType::DateTime)), // TSMULTIRANGE
            4534 => CellValueType::Multirange(Box::new(CellValueType::DateTime)), // TSTZMULTIRANGE
            4535 => CellValueType::Multirange(Box::new(CellValueType::Date)),    // DATEMULTIRANGE
            
            // Special PostgreSQL types
            2249 => CellValueType::Composite(vec![]),  // RECORD
            2278 => CellValueType::Void,               // VOID
            2279 => CellValueType::Trigger,            // TRIGGER
            3838 => CellValueType::EventTrigger,       // EVENT_TRIGGER
            3220 => CellValueType::PgLsn,              // PG_LSN
            5038 => CellValueType::PgSnapshot,         // PG_SNAPSHOT
            2970 => CellValueType::Txid,               // TXID_SNAPSHOT
            5069 => CellValueType::Xid8,               // XID8
            
            // OID types
            26 => CellValueType::Integer,              // OID
            2202 => CellValueType::Text,               // REGPROC
            2203 => CellValueType::Text,               // REGPROCEDURE
            2204 => CellValueType::Text,               // REGOPER
            2205 => CellValueType::Text,               // REGOPERATOR
            2206 => CellValueType::Text,               // REGCLASS
            3734 => CellValueType::Text,               // REGCONFIG
            4089 => CellValueType::Text,               // REGNAMESPACE
            4096 => CellValueType::Text,               // REGROLE
            
            // Default fallback
            _ => CellValueType::Text,
        }
    }
    
    pub fn value_to_cell(row: &Row, idx: usize) -> Result<CellValue> {
        let column = &row.columns()[idx];
        let pg_type = column.type_();
        let cell_type = Self::type_to_cell_type(pg_type);
        
        // Check for NULL values - postgres returns false for non-null
        // We need a better way to check NULL that works with all types
        
        // Convert based on type (and handle NULLs properly)
        let display_value = match *pg_type {
            // Numeric types
            Type::INT2 => {
                if let Ok(Some(val)) = row.try_get::<_, Option<i16>>(idx) {
                    val.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::INT4 => {
                if let Ok(Some(val)) = row.try_get::<_, Option<i32>>(idx) {
                    val.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::INT8 => {
                if let Ok(Some(val)) = row.try_get::<_, Option<i64>>(idx) {
                    val.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::FLOAT4 => {
                if let Ok(Some(val)) = row.try_get::<_, Option<f32>>(idx) {
                    val.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::FLOAT8 => {
                if let Ok(Some(val)) = row.try_get::<_, Option<f64>>(idx) {
                    val.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::NUMERIC => {
                if let Ok(Some(val)) = row.try_get::<_, Option<String>>(idx) {
                    val
                } else if let Ok(Some(val)) = row.try_get::<_, Option<f64>>(idx) {
                    val.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // String types
            Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::CHAR | Type::NAME => {
                if let Ok(Some(val)) = row.try_get::<_, Option<String>>(idx) {
                    val
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // Boolean
            Type::BOOL => {
                if let Ok(Some(val)) = row.try_get::<_, Option<bool>>(idx) {
                    val.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // Date/Time types
            Type::DATE => {
                if let Ok(Some(date)) = row.try_get::<_, Option<NaiveDate>>(idx) {
                    date.format("%Y-%m-%d").to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::TIME | Type::TIMETZ => {
                if let Ok(Some(time)) = row.try_get::<_, Option<NaiveTime>>(idx) {
                    time.format("%H:%M:%S%.f").to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::TIMESTAMP => {
                if let Ok(Some(ts)) = row.try_get::<_, Option<chrono::NaiveDateTime>>(idx) {
                    ts.format("%Y-%m-%dT%H:%M:%S%.f").to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::TIMESTAMPTZ => {
                if let Ok(Some(ts)) = row.try_get::<_, Option<DateTime<Utc>>>(idx) {
                    ts.to_rfc3339()
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // UUID
            Type::UUID => {
                if let Ok(Some(uuid)) = row.try_get::<_, Option<Uuid>>(idx) {
                    uuid.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // JSON/JSONB
            Type::JSON | Type::JSONB => {
                if let Ok(Some(json)) = row.try_get::<_, Option<JsonValue>>(idx) {
                    json.to_string()
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // Binary - encode as base64
            Type::BYTEA => {
                if let Ok(Some(bytes)) = row.try_get::<_, Option<Vec<u8>>>(idx) {
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // Network types
            Type::INET | Type::CIDR => {
                if let Ok(Some(addr)) = row.try_get::<_, Option<IpAddr>>(idx) {
                    addr.to_string()
                } else if let Ok(Some(s)) = row.try_get::<_, Option<String>>(idx) {
                    s
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // Arrays
            Type::BOOL_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<bool>>>(idx) {
                    serde_json::to_string(&arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::INT2_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<i16>>>(idx) {
                    serde_json::to_string(&arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::INT4_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<i32>>>(idx) {
                    serde_json::to_string(&arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::INT8_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<i64>>>(idx) {
                    serde_json::to_string(&arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::TEXT_ARRAY | Type::VARCHAR_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<String>>>(idx) {
                    serde_json::to_string(&arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::FLOAT4_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<f32>>>(idx) {
                    serde_json::to_string(&arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::FLOAT8_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<f64>>>(idx) {
                    serde_json::to_string(&arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::UUID_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<Uuid>>>(idx) {
                    let str_arr: Vec<String> = arr.iter().map(|u| u.to_string()).collect();
                    serde_json::to_string(&str_arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            Type::JSON_ARRAY | Type::JSONB_ARRAY => {
                if let Ok(Some(arr)) = row.try_get::<_, Option<Vec<JsonValue>>>(idx) {
                    serde_json::to_string(&arr)?
                } else {
                    return Ok(CellValue::null());
                }
            },
            
            // For all other types, try to get as string
            _ => {
                // Try Option<String> first for NULL handling
                if let Ok(Some(val)) = row.try_get::<_, Option<String>>(idx) {
                    val
                } else if let Ok(val) = row.try_get::<_, String>(idx) {
                    val
                } else {
                    return Ok(CellValue::null());
                }
            }
        };
        
        Ok(CellValue {
            value_type: cell_type,
            raw_value: None,
            display_value,
            db_specific: Some(DbSpecificValue::PostgreSQL(PostgresValue {
                oid: pg_type.oid(),
                type_name: pg_type.name().to_string(),
                type_modifier: -1, // Type modifier not directly available from Column
            })),
        })
    }
    
    pub fn is_array_oid(oid: u32) -> bool {
        // Common array OIDs
        matches!(oid, 
            1000 | 1001 | 1002 | 1005 | 1007 | 1009 | 1014 | 1015 | 1016 |
            1021 | 1022 | 1028 | 1040 | 1041 | 1115 | 1182 | 1183 | 1185 |
            1187 | 1231 | 1263 | 1270 | 199 | 3807 | 2951 | 651 | 1040
        )
    }
    
    pub fn get_base_oid_for_array(array_oid: u32) -> u32 {
        match array_oid {
            1000 => 16,    // bool[] -> bool
            1001 => 17,    // bytea[] -> bytea
            1002 => 18,    // char[] -> char
            1005 => 21,    // int2[] -> int2
            1007 => 23,    // int4[] -> int4
            1016 => 20,    // int8[] -> int8
            1009 => 25,    // text[] -> text
            1015 => 1043,  // varchar[] -> varchar
            1021 => 700,   // float4[] -> float4
            1022 => 701,   // float8[] -> float8
            1231 => 1700,  // numeric[] -> numeric
            1115 => 1114,  // timestamp[] -> timestamp
            1185 => 1184,  // timestamptz[] -> timestamptz
            1182 => 1082,  // date[] -> date
            1183 => 1083,  // time[] -> time
            2951 => 2950,  // uuid[] -> uuid
            199 => 114,    // json[] -> json
            3807 => 3802,  // jsonb[] -> jsonb
            1041 => 869,   // inet[] -> inet
            651 => 650,    // cidr[] -> cidr
            1040 => 829,   // macaddr[] -> macaddr
            _ => 25,       // default to text
        }
    }
}

// Add base64 encoding support
mod base64 {
    pub mod engine {
        pub mod general_purpose {
            pub const STANDARD: base64::engine::GeneralPurpose = 
                base64::engine::GeneralPurpose::new(
                    &base64::alphabet::STANDARD,
                    base64::engine::general_purpose::PAD
                );
        }
    }
    pub use ::base64::Engine;
}