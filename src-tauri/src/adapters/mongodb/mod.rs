//! MongoDB adapter module
//!
//! Implements document database operations for MongoDB using the official
//! mongodb Rust driver.

mod adapter;
mod msgpack_converter;
mod types;

pub use adapter::MongoDbAdapter;
pub use msgpack_converter::BsonMsgPackEncoder;
pub use types::*;
