use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Connection closed: {0}")]
    ConnectionClosed(String),

    #[error("Safe mode blocked: {0}")]
    SafeBlocked(String),

    #[error("SQL syntax error: {0}")]
    SqlSyntax(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Database driver error: {0}")]
    Driver(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("SSH error: {0}")]
    Ssh(String),

    #[error("SSH authentication failed: {0}")]
    SshAuthFailed(String),

    #[error("SSH connection timeout: {0}")]
    SshTimeout(String),

    #[error("SSH key error: {0}")]
    SshKeyError(String),

    #[error("SSH host key verification failed: {0}")]
    SshHostKey(String),

    #[error("SSH tunnel error: {0}")]
    SshTunnelError(String),

    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Unsupported: {0}")]
    Unsupported(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Database error: {0}")]
    DatabaseError(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "E_NOT_FOUND",
            AppError::ConnectionClosed(_) => "E_CONN_CLOSED",
            AppError::SafeBlocked(_) => "E_SAFE_BLOCKED",
            AppError::SqlSyntax(_) => "E_SQL_SYNTAX",
            AppError::Timeout(_) => "E_TIMEOUT",
            AppError::Driver(_) => "E_DRIVER",
            AppError::Io(_) => "E_IO",
            AppError::Ssh(_) => "E_SSH",
            AppError::SshAuthFailed(_) => "E_SSH_AUTH",
            AppError::SshTimeout(_) => "E_SSH_TIMEOUT",
            AppError::SshKeyError(_) => "E_SSH_KEY",
            AppError::SshHostKey(_) => "E_SSH_HOSTKEY",
            AppError::SshTunnelError(_) => "E_SSH_TUNNEL",
            AppError::Crypto(_) => "E_CRYPTO",
            AppError::Internal(_) => "E_INTERNAL",
            AppError::Unsupported(_) => "E_UNSUPPORTED",
            AppError::InvalidInput(_) => "E_INVALID_INPUT",
            AppError::ParseError(_) => "E_PARSE_ERROR",
            AppError::DatabaseError(_) => "E_DATABASE",
        }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        AppError::NotFound(msg.into())
    }

    pub fn sql_error(err: impl std::error::Error) -> Self {
        AppError::SqlSyntax(err.to_string())
    }

    pub fn driver_error(err: impl std::error::Error) -> Self {
        AppError::Driver(err.to_string())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        AppError::Internal(msg.into())
    }

    pub fn unsupported(msg: impl Into<String>) -> Self {
        AppError::Unsupported(msg.into())
    }
}

impl From<tokio_postgres::Error> for AppError {
    fn from(err: tokio_postgres::Error) -> Self {
        if let Some(db_err) = err.as_db_error() {
            AppError::SqlSyntax(format!("{}: {}", db_err.code().code(), db_err.message()))
        } else if err.is_closed() {
            AppError::ConnectionClosed(err.to_string())
        } else {
            AppError::Driver(err.to_string())
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Internal(format!("JSON error: {}", err))
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.serialize_field("details", &None::<String>)?;
        state.end()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
