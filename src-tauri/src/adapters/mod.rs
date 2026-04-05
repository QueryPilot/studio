pub mod duckdb;
pub mod mongodb;
pub mod mssql;
pub mod mysql;
pub mod oracle;
pub mod postgres;
pub mod redis;
pub mod sqlite;
pub mod trino;

// Re-export adapters for convenience
pub use duckdb::DuckDbAdapter;
pub use mongodb::MongoDbAdapter;
pub use oracle::OracleAdapter;
pub use redis::RedisAdapter;
pub use trino::TrinoAdapter;
