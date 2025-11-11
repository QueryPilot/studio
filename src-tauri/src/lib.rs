pub mod adapters;
pub mod ai;
pub mod aws;
pub mod commands;
pub mod core;
pub mod crud;
pub mod error;
pub mod keychain;
pub mod ssh;
pub mod state;
pub mod storage;
pub mod types;
pub mod vault;
pub mod window_state;

// Test modules - separated for better organization
#[cfg(test)]
mod tests;
