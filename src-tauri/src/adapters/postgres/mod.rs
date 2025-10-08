pub mod adapter;
pub mod fast_converter;
pub mod introspection;
pub mod parser;
// pub mod query;  // OLD: Replaced by query_fast (aggressive refactor)
pub mod query_fast;
pub mod query_builder;
pub mod types;

pub use adapter::PostgresAdapter;
// Exports for internal use
#[allow(unused_imports)]
pub use fast_converter::FastPostgresConverter;
#[allow(unused_imports)]
pub use query_fast::FastPostgresQueryExecutor;
