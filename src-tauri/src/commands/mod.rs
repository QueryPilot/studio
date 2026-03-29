//! Tauri command modules organized by database paradigm.
//!
//! Commands are split into:
//! - `connection.rs`: Unified connection lifecycle commands (connect, disconnect, test)
//! - `sql.rs`: SQL-specific commands (query, execute_query, switch_database)
//! - `document.rs`: Document database commands (MongoDB operations)
//! - `keyvalue.rs`: Key-value database commands (Redis operations)
//! - `backup.rs`: Backup and restore commands (backup, restore, preview)
//!
//! All commands are re-exported here for registration in lib.rs.

pub mod backup;
pub mod connection;
pub mod document;
pub mod duckdb;
pub mod keyvalue;
pub mod sql;
pub mod tunnel;

// Re-export all commands for easy access
pub use backup::*;
pub use connection::*;
pub use document::*;
pub use duckdb::*;
pub use keyvalue::*;
pub use sql::*;
pub use tunnel::*;
