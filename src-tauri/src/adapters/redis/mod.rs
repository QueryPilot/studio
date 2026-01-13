//! Redis adapter module
//!
//! Implements key-value database operations for Redis using the fred crate.

mod adapter;
mod types;

pub use adapter::RedisAdapter;
pub use types::*;
