pub mod adapter;
pub mod direct_msgpack;
pub mod fast_converter;
pub mod parser;
pub mod pool;
pub mod query_fast;
pub mod types;
// NOTE: introspection module removed - frontend now uses IntrospectionService
// with dialect-specific SQL via commands::query. See: src/services/introspectionService.ts

pub use adapter::PostgresAdapter;
// Exports for internal use
#[allow(unused_imports)]
pub use direct_msgpack::DirectMsgPackEncoder;
#[allow(unused_imports)]
pub use fast_converter::FastPostgresConverter;
#[allow(unused_imports)]
pub use query_fast::FastPostgresQueryExecutor;
