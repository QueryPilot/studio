pub mod adapters;
pub mod ai;
pub mod aws;
pub mod commands;
pub mod core;
pub mod error;
pub mod keychain;
pub mod sentry_integration;
pub mod ssh;
pub mod state;
pub mod storage;
pub mod types;
pub mod updater;
pub mod vault;
// NOTE: window_state module removed - tracking now uses BroadcastChannel API on frontend

// Test modules - separated for better organization
#[cfg(test)]
mod tests;
