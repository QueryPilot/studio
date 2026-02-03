//! MCP (Model Context Protocol) Bridge Module
//!
//! This module provides an IPC server that listens on a Unix socket and handles
//! requests from the MCP sidecar. The bridge exposes database operations through
//! a JSON-RPC protocol, allowing AI agents to query and introspect databases.
//!
//! # Architecture
//!
//! ```text
//! MCP Sidecar ──> Unix Socket ──> MCP Bridge ──> ConnectionManager ──> Database
//! ```
//!
//! # Protocol
//!
//! Request format (JSON-RPC):
//! ```json
//! {"id": "req-1", "method": "query", "params": {...}}
//! ```
//!
//! Response format:
//! ```json
//! {"id": "req-1", "result": {...}}
//! {"id": "req-1", "error": {"code": -1, "message": "..."}}
//! ```

pub mod bridge;
pub mod handlers;
mod protocol;

pub use bridge::McpBridge;
pub use protocol::{JsonRpcError, JsonRpcRequest, JsonRpcResponse};
