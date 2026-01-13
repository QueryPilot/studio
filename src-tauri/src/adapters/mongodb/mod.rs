//! MongoDB adapter module
//!
//! Implements document database operations for MongoDB using the official
//! mongodb Rust driver.

mod adapter;
mod types;

pub use adapter::MongoDbAdapter;
pub use types::*;
