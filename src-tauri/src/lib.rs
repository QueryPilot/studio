pub mod acp;
pub mod adapters;
pub mod core;
pub mod error;
pub mod keychain;
pub mod menu;
pub mod sentry_integration;
pub mod sql_engine;
pub mod ssh;
pub mod state;
pub mod storage;
pub mod types;
pub mod updater;
pub mod vault;

// Commands module - organized by paradigm
pub mod commands;
// NOTE: window_state module removed - tracking now uses BroadcastChannel API on frontend

// Test modules - separated for better organization
#[cfg(test)]
mod tests;
