//! JSON-RPC protocol types for the MCP Bridge.
//!
//! Defines the request/response format used for IPC communication
//! between the MCP sidecar and the Tauri backend.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC request from MCP sidecar
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcRequest {
    /// Unique request identifier
    pub id: String,
    /// Method name to invoke
    pub method: String,
    /// Optional method parameters
    #[serde(default)]
    pub params: Value,
}

/// JSON-RPC successful response
#[derive(Debug, Clone, Serialize)]
pub struct JsonRpcResponse {
    /// Request identifier (matches request)
    pub id: String,
    /// Result data (present on success)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Error information (present on failure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

impl JsonRpcResponse {
    /// Create a successful response
    pub fn success(id: String, result: Value) -> Self {
        Self {
            id,
            result: Some(result),
            error: None,
        }
    }

    /// Create an error response
    pub fn error(id: String, code: i32, message: String) -> Self {
        Self {
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message,
                data: None,
            }),
        }
    }

    /// Create an error response with additional data
    pub fn error_with_data(id: String, code: i32, message: String, data: Value) -> Self {
        Self {
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message,
                data: Some(data),
            }),
        }
    }
}

/// JSON-RPC error information
#[derive(Debug, Clone, Serialize)]
pub struct JsonRpcError {
    /// Error code
    pub code: i32,
    /// Human-readable error message
    pub message: String,
    /// Optional additional error data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Standard JSON-RPC error codes
#[allow(dead_code)]
pub mod error_codes {
    /// Invalid JSON was received
    pub const PARSE_ERROR: i32 = -32700;
    /// The JSON sent is not a valid Request object
    pub const INVALID_REQUEST: i32 = -32600;
    /// The method does not exist / is not available
    pub const METHOD_NOT_FOUND: i32 = -32601;
    /// Invalid method parameter(s)
    pub const INVALID_PARAMS: i32 = -32602;
    /// Internal JSON-RPC error
    pub const INTERNAL_ERROR: i32 = -32603;

    // Application-specific error codes (must be >= -32000)
    /// Connection not found
    pub const CONNECTION_NOT_FOUND: i32 = -32000;
    /// Query execution failed
    pub const QUERY_FAILED: i32 = -32001;
    /// Database operation not supported
    pub const UNSUPPORTED_OPERATION: i32 = -32002;
    /// Query timeout
    pub const QUERY_TIMEOUT: i32 = -32003;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_request() {
        let json = r#"{"id": "req-1", "method": "query", "params": {"sql": "SELECT 1"}}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.id, "req-1");
        assert_eq!(req.method, "query");
        assert!(req.params.is_object());
    }

    #[test]
    fn test_deserialize_request_no_params() {
        let json = r#"{"id": "req-1", "method": "list_connections"}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.id, "req-1");
        assert_eq!(req.method, "list_connections");
        assert!(req.params.is_null());
    }

    #[test]
    fn test_serialize_success_response() {
        let resp = JsonRpcResponse::success("req-1".to_string(), serde_json::json!({"count": 42}));
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"id\":\"req-1\""));
        assert!(json.contains("\"result\""));
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn test_serialize_error_response() {
        let resp = JsonRpcResponse::error("req-1".to_string(), -32600, "Invalid request".to_string());
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"id\":\"req-1\""));
        assert!(json.contains("\"error\""));
        assert!(json.contains("-32600"));
        assert!(!json.contains("\"result\""));
    }
}
