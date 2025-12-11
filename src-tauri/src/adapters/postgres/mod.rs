pub mod adapter;
pub mod direct_serializer;
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
pub use direct_serializer::SerializableRows;
#[allow(unused_imports)]
pub use fast_converter::FastPostgresConverter;
#[allow(unused_imports)]
pub use query_fast::FastPostgresQueryExecutor;
