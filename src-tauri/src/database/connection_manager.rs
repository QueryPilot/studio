// This file has been removed - all shared types are now in adapter/types.rs
// Each database adapter implements its own connection and execution logic.

// Re-export types from adapter/types for compatibility
pub use crate::database::adapter::types::{ConnectionConfig, DbType as DatabaseType};