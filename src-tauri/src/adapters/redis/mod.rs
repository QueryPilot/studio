//! Redis adapter module
//!
//! Implements key-value database operations for Redis using the fred crate.

mod adapter;
mod msgpack_converter;
mod types;

pub use adapter::RedisAdapter;
pub use msgpack_converter::RedisMsgPackEncoder;
pub use types::*;
