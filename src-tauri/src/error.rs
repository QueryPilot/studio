use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, Serialize, Deserialize)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),
    
    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),
    
    #[error("Cursor not found: {0}")]
    CursorNotFound(String),
    
    #[error("Query cancelled: {0}")]
    QueryCancelled(String),
    
    #[error("Query not found: {0}")]
    QueryNotFound(String),
    
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    #[error("IO error: {0}")]
    Io(String),
    
    #[error("Serialization error: {0}")]
    Serialization(String),
    
    #[error("Timeout error: {0}")]
    Timeout(String),
    
    #[error("Unsupported operation: {0}")]
    Unsupported(String),
    
    #[error("Validation error: {0}")]
    ValidationError(String),
}

impl AppError {
    pub fn from_sqlx(e: sqlx::Error) -> Self {
        Self::Database(e.to_string())
    }
    
    pub fn from_io(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
    
    pub fn from_serde(e: serde_json::Error) -> Self {
        Self::Serialization(e.to_string())
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serialization(e.to_string())
    }
}

// Implement Tauri command error conversion
impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}