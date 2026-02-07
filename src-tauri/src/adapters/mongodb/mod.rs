//! MongoDB adapter module
//!
//! Implements document database operations for MongoDB using the official
//! mongodb Rust driver.

mod adapter;
mod backup;
mod msgpack_converter;
mod types;

pub use adapter::{
    MongoCursorToken, MongoDbAdapter, MongoDocumentPage, MongoFieldStat, MongoSchemaSample,
};
pub use msgpack_converter::BsonMsgPackEncoder;
pub use types::*;
