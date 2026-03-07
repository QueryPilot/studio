pub mod adapter;
pub mod backup;
pub mod direct_msgpack;
pub mod parser;
pub mod simple_converter;
pub mod types;
// NOTE: introspection module removed - frontend now uses IntrospectionService
// with dialect-specific SQL via commands::query. See: src/services/introspectionService.ts

pub use adapter::PostgresAdapter;
// Exports for internal use
#[allow(unused_imports)]
pub use direct_msgpack::DirectMsgPackEncoder;
#[allow(unused_imports)]
pub use simple_converter::SimpleConverter;
