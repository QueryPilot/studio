//! AI Context Module
//!
//! Stores context for AI agents: query history, active editor state, etc.
//! This data is synced from the frontend and persisted for `querypilot agent` CLI reads.

pub mod commands;
pub mod store;

pub use commands::AiContextState;
pub use store::{ActiveContext, AiContextStore, QueryHistoryEntry};
